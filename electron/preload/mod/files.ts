import {contextBridge, ipcRenderer, webUtils} from 'electron'
import type {FilesMethods} from '../../../shared/types'

export function registerFilesRenderer() {
    contextBridge.exposeInMainWorld('files', {
        save: (name, buffer) => ipcRenderer.invoke('files:save', {name, buffer}),
        showItemInFolder: path => ipcRenderer.invoke('files:show-item-in-folder', path),
        getPathForFile: file => webUtils.getPathForFile(file),
    } satisfies FilesMethods)
}
