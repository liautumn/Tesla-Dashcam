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

export type FrameExportStartRequest = {
    sessionId: string
    fileName: string
    width: number
    height: number
    fps: number
}

export type FrameExportResult = {
    ok: boolean
    canceled?: boolean
    filePath?: string
    error?: string
    frameCount?: number
}

export type FrameExportWriteResult = {
    ok: boolean
    error?: string
    frameNum?: number
}

export type TrashResultCode =
    | 'files-changed'
    | 'source-paths-unavailable'
    | 'trash-unavailable'

export type TrashClipResult = {
    ok: boolean
    canceled?: boolean
    error?: string
    code?: TrashResultCode
    trashedCount?: number
}

export type ElectronApi = {
    saveFile: (name: string, buffer: ArrayBuffer) => Promise<string | null>
    showItemInFolder: (path: string) => Promise<void>
    getPathForFile: (file: File) => string
    trashClip: (files: File[], clipName: string, locale: string) => Promise<TrashClipResult>
    exportCompose: (request: ComposeExportRequest) => Promise<ComposeExportResult>
    exportComposeCancel: (sessionId: string) => void
    onExportComposeProgress: (callback: (event: ComposeProgressEvent) => void) => () => void
    exportStart: (request: FrameExportStartRequest) => Promise<FrameExportResult>
    exportFrame: (sessionId: string, frameData: Uint8Array) => Promise<FrameExportWriteResult>
    exportFinish: (sessionId: string) => Promise<FrameExportResult>
    exportCancel: (sessionId: string) => void
}
