export type CamName =
    | 'front'
    | 'back'
    | 'left'
    | 'right'
    | 'left_pillar'
    | 'right_pillar'

export type ComposeViewType = 'grid6' | 'grid4' | 'grid4old' | CamName

export type ComposeSegment = {
    name: string
    startSeconds: number
    duration: number
    paths: Partial<Record<CamName, string>>
}

export type ComposeTextWindow = {
    start: number
    end: number
    text: string
}

export type ComposeLayout = {
    width: number
    height: number
    videoHeight: number
    barHeight: number
    scale: number
    padding: number
    brandSize: number
    titleSize: number
    subSize: number
    gap: number
    hPad: number
    leftTextX: number
}

export type ComposeOverlay = {
    showTime?: boolean
    showLocation?: boolean
    showDriveData?: boolean
    locationText?: string
    baseTimestampLabel?: string
    baseTimestampEpoch?: number
    driveWindows?: ComposeTextWindow[]
    timeWindows?: ComposeTextWindow[]
    brandText?: string
}

export type ComposeExportRequest = {
    sessionId: string
    fileName: string
    viewType: ComposeViewType
    startSeconds: number
    durationSeconds: number
    segments: ComposeSegment[]
    overlay?: ComposeOverlay
    layout?: ComposeLayout
    fps?: number
    useHardware?: boolean
}

export type ComposeExportResult = {
    ok: boolean
    canceled?: boolean
    filePath?: string
    error?: string
    width?: number
    height?: number
    fps?: number
    encoder?: string
}

export type ComposeProgressEvent = {
    sessionId: string
    progress: number
    outTimeSec: number
}

export interface ComposeExportMethods {
    start(request: ComposeExportRequest): Promise<ComposeExportResult>
    cancel(sessionId: string): void
    onProgress(callback: (event: ComposeProgressEvent) => void): () => void
}
