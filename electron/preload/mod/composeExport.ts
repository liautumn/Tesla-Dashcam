import {contextBridge, ipcRenderer, type IpcRendererEvent} from 'electron'
import type {
    ComposeExportMethods,
    ComposeExportRequest,
    ComposeProgressEvent,
} from '../../../shared/types'

export function registerComposeExportRenderer() {
    contextBridge.exposeInMainWorld('composeExport', {
        start: (request: ComposeExportRequest) => ipcRenderer.invoke('compose-export:start', request),
        cancel: sessionId => ipcRenderer.send('compose-export:cancel', {sessionId}),
        onProgress: callback => {
            const listener = (_event: IpcRendererEvent, data: ComposeProgressEvent) => callback(data)
            ipcRenderer.on('compose-export:progress', listener)
            return () => ipcRenderer.removeListener('compose-export:progress', listener)
        },
    } satisfies ComposeExportMethods)
}
