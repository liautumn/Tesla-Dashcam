import {contextBridge, ipcRenderer} from 'electron'
import type {
    FrameExportMethods,
    FrameExportStartRequest,
} from '../../../shared/types'

export function registerFrameExportRenderer() {
    contextBridge.exposeInMainWorld('frameExport', {
        start: (request: FrameExportStartRequest) => ipcRenderer.invoke('frame-export:start', request),
        write: (sessionId, frameData) => ipcRenderer.invoke('frame-export:write', {sessionId, frameData}),
        finish: sessionId => ipcRenderer.invoke('frame-export:finish', {sessionId}),
        cancel: sessionId => ipcRenderer.send('frame-export:cancel', {sessionId}),
    } satisfies FrameExportMethods)
}
