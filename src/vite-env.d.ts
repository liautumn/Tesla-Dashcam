/// <reference types="vite/client" />

import type {ComposeExportMethods} from '../shared/types/compose-export'
import type {FilesMethods} from '../shared/types/files'
import type {FrameExportMethods} from '../shared/types/frame-export'
import type {TrashMethods} from '../shared/types/trash'

declare module '*.vue' {
    import type {DefineComponent} from 'vue'

    const component: DefineComponent
    export default component
}

declare global {
    interface Window {
        files?: FilesMethods
        trash?: TrashMethods
        composeExport?: ComposeExportMethods
        frameExport?: FrameExportMethods
    }
}

export {}
