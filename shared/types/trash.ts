export type TrashResultCode =
    | 'files-changed'
    | 'source-paths-unavailable'
    | 'source-missing'
    | 'trash-file-in-use'
    | 'trash-permission-denied'
    | 'trash-read-only'
    | 'trash-unsupported'
    | 'trash-unavailable'

export type TrashClipResult = {
    ok: boolean
    canceled?: boolean
    error?: string
    code?: TrashResultCode
    failurePresented?: boolean
    trashedCount?: number
}

export interface TrashMethods {
    moveClip(files: File[], clipName: string, locale: string): Promise<TrashClipResult>
}
