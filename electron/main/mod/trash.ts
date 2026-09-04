import {BrowserWindow, dialog, ipcMain, shell} from 'electron'
import type {TrashClipResult, TrashResultCode} from '../../../shared/types'
import {createLogger} from '../utils/logger'
import {moveClipDirectoryToSystemTrash} from './trashOperation.ts'
import {validateTrashFilesPayload} from './trashValidation.ts'

let mainWindow: BrowserWindow | null = null
let registered = false
const log = createLogger('trash')

const trashFailureCodes = new Set<TrashResultCode>([
    'source-missing',
    'trash-file-in-use',
    'trash-permission-denied',
    'trash-read-only',
    'trash-unsupported',
    'trash-unavailable',
])

const trashFailureMessage = (code: TrashResultCode | undefined, zh: boolean) => {
    switch (code) {
        case 'source-missing':
            return zh ? '片段已被移动或删除' : 'The clip was moved or deleted'
        case 'trash-file-in-use':
            return zh ? '视频文件仍被其他程序占用' : 'The video files are still in use by another app'
        case 'trash-permission-denied':
            return zh ? '没有权限修改这个片段' : 'Permission to modify this clip was denied'
        case 'trash-read-only':
            return zh ? '存储设备处于只读状态' : 'The storage device is read-only'
        case 'trash-unsupported':
            return zh ? '这个存储设备不支持系统废纸篓' : 'This storage device does not support the system Recycle Bin'
        default:
            return zh ? '无法将片段移到系统废纸篓' : 'Unable to move the clip to the system Recycle Bin'
    }
}

const presentTrashFailure = async (
    window: BrowserWindow,
    result: TrashClipResult,
    sourcePath: string,
    zh: boolean,
) => dialog.showMessageBox(window, {
    type: 'error',
    title: zh ? '无法移到废纸篓' : 'Unable to Move to Recycle Bin',
    message: trashFailureMessage(result.code, zh),
    detail: zh
        ? `应用没有执行永久删除。\n\n系统错误：${result.error || '未知错误'}\n\n${sourcePath}`
        : `The app did not permanently delete any files.\n\nSystem error: ${result.error || 'Unknown error'}\n\n${sourcePath}`,
    buttons: zh
        ? ['重试', '在文件夹中显示', '关闭']
        : ['Retry', 'Show in Folder', 'Close'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
})

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

        while (true) {
            const result = await moveClipDirectoryToSystemTrash(value, item => shell.trashItem(item))
            if (result.ok || !result.code || !trashFailureCodes.has(result.code)) return result

            log.warn('Unable to move clip directory to system trash', {
                path: value.directory.path,
                code: result.code,
                error: result.error,
            })
            const failure = await presentTrashFailure(mainWindow, result, value.directory.path, zh)
            if (failure.response === 0) continue
            if (failure.response === 1) shell.showItemInFolder(value.directory.path)
            return {...result, failurePresented: true}
        }
    })
}
