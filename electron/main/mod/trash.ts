import {BrowserWindow, dialog, ipcMain, shell} from 'electron'
import type {TrashClipResult} from '../../../shared/types'
import {moveClipDirectoryToSystemTrash} from './trashOperation.ts'
import {validateTrashFilesPayload} from './trashValidation.ts'

let mainWindow: BrowserWindow | null = null
let registered = false

export function registerTrash(window: BrowserWindow) {
    mainWindow = window
    if (registered) return
    registered = true

    ipcMain.handle('trash:move-clip', async (event, payload: unknown): Promise<TrashClipResult> => {
        if (event.sender !== mainWindow?.webContents) return {ok: false, error: 'No window'}
        const validated = validateTrashFilesPayload(payload)
        if (!validated.ok) return {ok: false, error: validated.error}

        const value = validated.value
        const zh = value.locale === 'zh-CN'
        const isRecent = value.kind === 'recent'
        const response = await dialog.showMessageBox(mainWindow, {
            type: 'warning',
            title: zh ? '移到系统废纸篓？' : 'Move to Recycle Bin?',
            message: isRecent
                ? (zh ? '将整个 RecentClips 目录移到系统废纸篓？' : 'Move the entire RecentClips folder to the Recycle Bin?')
                : (zh ? `将片段目录“${value.clipName}”移到系统废纸篓？` : `Move “${value.clipName}” to the Recycle Bin?`),
            detail: zh
                ? `已验证 ${value.files.length} 个视频和 ${value.otherFileCount} 个附属文件。此操作可从废纸篓恢复。\n\n${value.directory.path}`
                : `${value.files.length} videos and ${value.otherFileCount} sidecar files verified. This can be restored from the Recycle Bin.\n\n${value.directory.path}`,
            buttons: [zh ? '移到废纸篓' : 'Move to Recycle Bin', zh ? '取消' : 'Cancel'],
            defaultId: 1,
            cancelId: 1,
            noLink: true,
        })
        if (response.response !== 0) return {ok: false, canceled: true}
        return moveClipDirectoryToSystemTrash(value, item => shell.trashItem(item))
    })
}
