import type {CamFootage, CamSegment} from '../types/tesla'
import {probeDurationFromUrl, probeMp4DurationFromFile} from './probeMp4Duration'
import {parseTeslaVideoName} from './teslaCamera'

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
