export type ClipType = 'recent' | 'saved' | 'sentry'

export type CamClipEvent = {
    timestamp: string
    city: string
    street?: string
    est_lat: string
    est_lon: string
    reason: string
    camera: string
}

export type CamClip = {
    id: string
    name: string
    type?: ClipType
    saveType?: 'aeb' | 'manual'
    thumb?: File
    event?: CamClipEvent
    videos: File[]
}

export const cameraNames = [
    'front',
    'back',
    'left',
    'right',
    'left_pillar',
    'right_pillar',
] as const

export type CamName = (typeof cameraNames)[number]
export type ViewType = 'grid6' | 'grid4' | 'front'

export type CamSegment = {
    name: string
    duration: number
    startSeconds: number
} & Partial<Record<CamName, string>>

export type CamFootage = {
    segments: CamSegment[]
    duration: number
    urls: string[]
}

export type SeekInfo = {
    index: number
    seconds: number
}
