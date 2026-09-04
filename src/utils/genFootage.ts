import type {CamFootage, CamSegment, SEIDataPoint} from '../types/tesla'
import {probeDurationFromUrl, probeMp4DurationFromFile} from './probeMp4Duration'
import {parseTeslaVideoName} from '../../shared/teslaCamera'

const mapPool = async <T>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<void>,
    onProgress?: (current: number, total: number) => void,
) => {
    let nextIndex = 0
    let completed = 0
    const runners = Array.from({length: Math.min(limit, Math.max(items.length, 1))}, async () => {
        while (nextIndex < items.length) {
            const item = items[nextIndex++]
            await worker(item)
            completed += 1
            onProgress?.(completed, items.length)
        }
    })
    await Promise.all(runners)
}

export const genFootage = async (
    files: File[],
    onProgress?: (current: number, total: number) => void,
): Promise<CamFootage> => {
    const urls: string[] = []
    const segments = new Map<string, CamSegment>()
    const jobs: {file: File; url: string; segment: CamSegment}[] = []

    try {
        for (const file of files) {
            const parsed = parseTeslaVideoName(file.name)
            if (!parsed) continue
            let segment = segments.get(parsed.segmentName)
            if (!segment) {
                segment = {name: parsed.segmentName, duration: 0, startSeconds: 0}
                segments.set(parsed.segmentName, segment)
            }
            const url = URL.createObjectURL(file)
            urls.push(url)
            segment[parsed.camera] = url
            jobs.push({file, url, segment})
        }

        await mapPool(jobs, 6, async job => {
            const parsedDuration = await probeMp4DurationFromFile(job.file)
            const duration = parsedDuration > 0 ? parsedDuration : await probeDurationFromUrl(job.url)
            if (duration > job.segment.duration) job.segment.duration = duration
        }, onProgress)

        const ordered = Array.from(segments.values()).sort((left, right) => left.name.localeCompare(right.name))
        let duration = 0
        for (const segment of ordered) {
            if (!(segment.duration > 0)) segment.duration = 60
            segment.startSeconds = duration
            duration += segment.duration
        }
        return {segments: ordered, duration, urls}
    } catch (error) {
        urls.forEach(url => URL.revokeObjectURL(url))
        throw error
    }
}

export const revokeFootage = (footage?: CamFootage) => {
    footage?.urls.forEach(url => URL.revokeObjectURL(url))
}

type SeiWorkerReply = {id: number; points?: SEIDataPoint[]; error?: string}

const extractWithWorker = (
    worker: Worker,
    file: File,
    startSeconds: number,
    duration: number,
    id: number,
    signal?: AbortSignal,
) => new Promise<SEIDataPoint[]>((resolve, reject) => {
    let settled = false
    const timer = window.setTimeout(() => finish(new Error('SEI extraction timed out')), 120_000)
    const finish = (error?: Error, points: SEIDataPoint[] = []) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        worker.removeEventListener('message', onMessage)
        worker.removeEventListener('error', onError)
        signal?.removeEventListener('abort', onAbort)
        if (error) reject(error)
        else resolve(points)
    }
    const onMessage = (event: MessageEvent<SeiWorkerReply>) => {
        if (event.data.id !== id) return
        finish(event.data.error ? new Error(event.data.error) : undefined, event.data.points)
    }
    const onError = (event: ErrorEvent) => finish(new Error(event.message || 'SEI worker failed'))
    const onAbort = () => finish(new DOMException('SEI extraction aborted', 'AbortError'))
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    signal?.addEventListener('abort', onAbort, {once: true})
    if (signal?.aborted) {
        onAbort()
        return
    }
    worker.postMessage({id, file, startSeconds, duration})
})

export const extractFootageSEI = async (
    files: File[],
    footage: CamFootage,
    signal?: AbortSignal,
) => {
    signal?.throwIfAborted()
    const frontFiles = new Map<string, File>()
    for (const file of files) {
        const parsed = parseTeslaVideoName(file.name)
        if (parsed?.camera === 'front') frontFiles.set(parsed.segmentName, file)
    }
    const jobs = footage.segments
        .map(segment => ({segment, file: frontFiles.get(segment.name)}))
        .filter((job): job is {segment: CamSegment; file: File} => Boolean(job.file))
    if (!jobs.length) return undefined

    const points: SEIDataPoint[] = []
    let workers: Worker[] = []
    try {
        workers = Array.from({length: Math.min(2, jobs.length)}, () =>
            new Worker(new URL('./seiWorker.ts', import.meta.url), {type: 'module'}),
        )
    } catch {
        workers = []
    }

    try {
        if (workers.length) {
            await Promise.all(workers.map(async (worker, workerIndex) => {
                for (let index = workerIndex; index < jobs.length; index += workers.length) {
                    signal?.throwIfAborted()
                    const {file, segment} = jobs[index]
                    try {
                        points.push(...await extractWithWorker(
                            worker,
                            file,
                            segment.startSeconds,
                            segment.duration,
                            index,
                            signal,
                        ))
                    } catch (error) {
                        if (signal?.aborted) throw error
                        console.warn(`SEI extraction failed for ${segment.name}`, error)
                    }
                }
            }))
        } else {
            const {convertToDataPoints, extractSEIFromFile} = await import('./parseSEI')
            await mapPool(jobs, 2, async ({file, segment}) => {
                signal?.throwIfAborted()
                try {
                    const raw = await extractSEIFromFile(file)
                    signal?.throwIfAborted()
                    points.push(...convertToDataPoints(raw, segment.startSeconds, segment.duration))
                } catch (error) {
                    if (signal?.aborted) throw error
                    console.warn(`SEI extraction failed for ${segment.name}`, error)
                }
            })
        }
    } finally {
        workers.forEach(worker => worker.terminate())
    }

    points.sort((left, right) => left.offsetSeconds - right.offsetSeconds)
    return points.length ? points : undefined
}

export const calcSeekInfo = (footage: CamFootage, seconds: number) => {
    if (!footage.segments.length) return null
    const target = Math.min(Math.max(seconds, 0), footage.duration)
    for (let index = footage.segments.length - 1; index >= 0; index -= 1) {
        const segment = footage.segments[index]
        if (target >= segment.startSeconds) {
            return {
                index,
                seconds: Math.min(target - segment.startSeconds, segment.duration),
            }
        }
    }
    return {index: 0, seconds: 0}
}
