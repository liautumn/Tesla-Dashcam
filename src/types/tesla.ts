import type {CamName} from '../../shared/types'

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
] as const satisfies readonly CamName[]

export type CamSegment = {
    name: string
    duration: number
    startSeconds: number
} & Partial<Record<CamName, string>>

export type CamFootage = {
    segments: CamSegment[]
    duration: number
    urls: string[]
    seiData?: SEIDataPoint[]
}

export type SeekInfo = {
    index: number
    seconds: number
}

export type GearState = 'P' | 'R' | 'N' | 'D' | 'UNKNOWN'
export type APStatus = 'OFF' | 'TACC' | 'AP' | 'FSD' | 'UNKNOWN'

export type SEIDataPoint = {
    seiVersion: number | null
    frameSequence: number | null
    autopilotState: number | null
    offsetSeconds: number
    speedKph: number
    gear: GearState
    steeringAngleDeg: number
    brakePct: number
    throttlePct: number
    apStatus: APStatus
    latitude: number | null
    longitude: number | null
    blinkerLeft: boolean
    blinkerRight: boolean
    headingDeg: number | null
    accelerationX: number
    accelerationY: number
    accelerationZ: number
}
