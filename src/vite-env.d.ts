/// <reference types="vite/client" />

import type {ElectronApi} from '../shared/types'

declare module '*.vue' {
    import type {DefineComponent} from 'vue'

    const component: DefineComponent
    export default component
}

declare global {
    interface Window {
        electronAPI?: ElectronApi
    }
}

export {}
