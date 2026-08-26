import {contextBridge, ipcRenderer, webUtils} from 'electron'
import type {TrashMethods} from '../../../shared/types'
import {resolveTrashPaths} from './resolveTrashPaths.ts'

export function registerTrashRenderer() {
    contextBridge.exposeInMainWorld('trash', {
        moveClip: async (files, clipName, locale) => {
            const paths = resolveTrashPaths(files, file => webUtils.getPathForFile(file))
            if (!paths) return {ok: false, code: 'source-paths-unavailable'}
            return ipcRenderer.invoke('trash:move-clip', {paths, clipName, locale})
        },
    } satisfies TrashMethods)
}
