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

export interface FrameExportMethods {
    start(request: FrameExportStartRequest): Promise<FrameExportResult>
    write(sessionId: string, frameData: Uint8Array): Promise<FrameExportWriteResult>
    finish(sessionId: string): Promise<FrameExportResult>
    cancel(sessionId: string): void
}
