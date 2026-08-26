import {shareInflight} from './shareInflight'

const frameCache = new Map<string, string>()
const inflight = new Map<string, Promise<string | null>>()
const concurrency = 2
let activeJobs = 0
const pendingJobs: (() => void)[] = []

const enqueue = <T>(job: () => Promise<T>) => new Promise<T>((resolve, reject) => {
    const start = () => {
        activeJobs += 1
        void job().then(resolve, reject).finally(() => {
            activeJobs -= 1
            pendingJobs.shift()?.()
        })
    }
    if (activeJobs < concurrency) start()
    else pendingJobs.push(start)
})

const extractPosterFrame = (file: File) => new Promise<string | null>(resolve => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.src = url
    let settled = false
    const done = (result: string | null) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        video.removeAttribute('src')
        video.load()
        URL.revokeObjectURL(url)
        resolve(result)
    }
    const timer = window.setTimeout(() => done(null), 8000)
    video.addEventListener('error', () => done(null), {once: true})
    video.addEventListener('loadedmetadata', () => {
        video.currentTime = Math.min(1, (video.duration || 2) / 2)
    }, {once: true})
    video.addEventListener('seeked', () => {
        try {
            const width = 192
            const height = Math.max(1, Math.round(width * (video.videoHeight || 9) / (video.videoWidth || 16)))
            const canvas = document.createElement('canvas')
            canvas.width = width
            canvas.height = height
            const context = canvas.getContext('2d')
            if (!context) return done(null)
            context.drawImage(video, 0, 0, width, height)
            done(canvas.toDataURL('image/jpeg', .6))
        } catch {
            done(null)
        }
    }, {once: true})
})

export const getCachedPosterFrame = (cacheKey: string) => frameCache.get(cacheKey)

export const getPosterFrame = (cacheKey: string, file: File) => {
    const cached = frameCache.get(cacheKey)
    if (cached) return Promise.resolve(cached)
    return shareInflight(inflight, cacheKey, async () => {
        const result = await enqueue(() => extractPosterFrame(file))
        if (result) frameCache.set(cacheKey, result)
        return result
    })
}
