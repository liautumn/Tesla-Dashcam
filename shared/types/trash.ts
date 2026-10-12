export type TrashResultCode =
    | 'files-changed'
    | 'source-paths-unavailable'
    | 'source-missing'
    | 'delete-file-in-use'
    | 'delete-permission-denied'
    | 'delete-read-only'
    | 'delete-unsupported'
    | 'delete-failed'

export type TrashClipResult = {
    ok: boolean
    canceled?: boolean
    error?: string
    code?: TrashResultCode
    failurePresented?: boolean
    refreshRequired?: boolean
    deletedCount?: number
}

export interface TrashMethods {
    moveClip(files: File[], clipName: string, locale: string): Promise<TrashClipResult>
}
