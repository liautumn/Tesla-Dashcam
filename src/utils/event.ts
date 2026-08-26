import type {CamClip, CamFootage} from '../types/tesla'
import {parseClipTime} from './clipTime'

export const calcEventSeconds = (clip: CamClip, footage: CamFootage) => {
    if (!clip.event?.timestamp || clip.saveType === 'manual') return undefined
    const eventTime = parseClipTime(clip.event.timestamp)?.getTime()
    if (!Number.isFinite(eventTime)) return undefined

    for (let index = footage.segments.length - 1; index >= 0; index -= 1) {
        const segment = footage.segments[index]
        const segmentTime = parseClipTime(segment.name)?.getTime()
        if (!Number.isFinite(segmentTime) || eventTime! < segmentTime!) continue
        const raw = segment.startSeconds + (eventTime! - segmentTime!) / 1000
        const preRoll = clip.saveType === 'aeb' ? 3 : 5
        const result = Math.max(0, raw - preRoll)
        return result <= footage.duration ? result : undefined
    }
    return undefined
}

export const genAmapUrl = (clip: CamClip) => {
    const latitude = Number(clip.event?.est_lat)
    const longitude = Number(clip.event?.est_lon)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return ''
    const name = encodeURIComponent([clip.event?.city, clip.event?.street].filter(Boolean).join(' ') || '事件记录点')
    return `https://uri.amap.com/marker?position=${longitude},${latitude}&name=${name}&coordinate=gaode&callnative=0`
}
