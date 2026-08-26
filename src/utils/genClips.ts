import type {CamClip, CamClipEvent, ClipType} from '../types/tesla'
import {isTeslaCameraVideoName} from '../../shared/teslaCamera'

const manualReasons = new Set([
    'user_interaction_dashcam_icon_tapped',
    'user_interaction_dashcam_launcher_action_tapped',
])

const resolveClipType = (paths: string[]): ClipType | undefined => {
    if (paths.includes('RecentClips')) return 'recent'
    if (paths.includes('SavedClips')) return 'saved'
    if (paths.includes('SentryClips')) return 'sentry'
    return undefined
}

const resolveSaveType = (event?: CamClipEvent): CamClip['saveType'] => {
    if (event?.reason === 'vehicle_auto_emergency_braking') return 'aeb'
    if (event?.reason && manualReasons.has(event.reason)) return 'manual'
    return undefined
}

const isClipEvent = (value: unknown): value is CamClipEvent => {
    if (!value || typeof value !== 'object') return false
    const event = value as Record<string, unknown>
    return ['timestamp', 'city', 'est_lat', 'est_lon', 'reason', 'camera'].every(
        key => typeof event[key] === 'string',
    )
}

const readEvent = async (file: File) => {
    try {
        const value: unknown = JSON.parse(await file.text())
        return isClipEvent(value) ? value : undefined
    } catch {
        return undefined
    }
}

export const genClips = async (source: FileList | File[]) => {
    const clips = new Map<string, CamClip>()

    for (const file of Array.from(source)) {
        const relativePath = file.webkitRelativePath || file.name
        const paths = relativePath.split('/').filter(Boolean)
        const parentDir = paths.at(-2)
        if (!parentDir) continue

        const parentPath = paths.slice(0, -1).join('/')
        const type = resolveClipType(paths)
        const recent = parentDir === 'RecentClips'
        const id = recent ? `recent:${parentPath}` : parentPath
        let clip = clips.get(id)

        if (!clip) {
            clip = {
                id,
                name: recent ? 'RecentClips' : parentDir,
                type: recent ? 'recent' : type,
                videos: [],
            }
            clips.set(id, clip)
        }

        if (file.name === 'thumb.png') {
            clip.thumb = file
        } else if (isTeslaCameraVideoName(file.name)) {
            clip.videos.push(file)
        } else if (file.name === 'event.json') {
            clip.event = await readEvent(file)
            clip.saveType = resolveSaveType(clip.event)
        }
    }

    const result = Array.from(clips.values()).filter(clip => clip.videos.length > 0)
    for (const clip of result) {
        clip.videos.sort((left, right) => left.name.localeCompare(right.name))
        if (clip.type === 'recent') {
            clip.name = clip.videos.at(-1)?.name.slice(0, 19) ?? clip.name
        }
    }

    return result.sort((left, right) => right.name.localeCompare(left.name))
}
