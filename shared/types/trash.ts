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

export interface TrashMethods {
    moveClip(files: File[], clipName: string, locale: string): Promise<TrashClipResult>
}
