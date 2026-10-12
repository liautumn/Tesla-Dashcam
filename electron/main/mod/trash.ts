import {BrowserWindow, dialog, ipcMain, shell} from 'electron'
import type {TrashClipResult, TrashResultCode} from '../../../shared/types'
import {createLogger} from '../utils/logger'
import {confirmAndDeleteClip} from './trashOperation.ts'
import {validateTrashFilesPayload} from './trashValidation.ts'

let mainWindow: BrowserWindow | null = null
let registered = false
let deleting = false
const log = createLogger('delete')

const deleteFailureMessage = (code: TrashResultCode | undefined, zh: boolean) => {
    switch (code) {
        case 'source-missing':
            return zh ? '片段已被移动或删除' : 'The clip was moved or deleted'
        case 'delete-file-in-use':
            return zh ? '视频文件仍被其他程序占用' : 'The video files are still in use by another app'
        case 'delete-permission-denied':
            return zh ? '没有权限删除这个片段' : 'Permission to delete this clip was denied'
        case 'delete-read-only':
            return zh ? '存储设备处于只读状态' : 'The storage device is read-only'
        case 'delete-unsupported':
            return zh ? '这个存储设备不支持删除操作' : 'This storage device does not support deletion'
        default:
            return zh ? '无法完整删除片段' : 'Unable to completely delete the clip'
    }
}

const presentDeleteFailure = async (
    window: BrowserWindow,
    result: TrashClipResult,
    sourcePath: string,
    zh: boolean,
) => dialog.showMessageBox(window, {
    type: 'error',
    title: zh ? '删除失败' : 'Deletion Failed',
    message: deleteFailureMessage(result.code, zh),
    detail: zh
        ? `删除过程未完成，部分文件可能已经永久删除。请重新选择 TeslaCam 文件夹以刷新列表后再试。\n\n系统错误：${result.error || '未知错误'}\n\n${sourcePath}`
        : `Deletion did not complete; some files may already have been permanently deleted. Choose the TeslaCam folder again to refresh the list before retrying.\n\nSystem error: ${result.error || 'Unknown error'}\n\n${sourcePath}`,
    buttons: zh ? ['在文件夹中显示', '关闭'] : ['Show in Folder', 'Close'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
})

export function registerTrash(window: BrowserWindow) {
    mainWindow = window
    if (registered) return
    registered = true

    // Keep the existing bridge/channel name for compatibility; deletion is permanent.
    ipcMain.handle('trash:move-clip', async (event, payload: unknown): Promise<TrashClipResult> => {
        const window = mainWindow
        if (!window || event.sender !== window.webContents) return {ok: false, error: 'No window'}
        if (deleting) return {ok: false, canceled: true}
        deleting = true
        try {
            const validated = validateTrashFilesPayload(payload)
            if (!validated.ok) return {ok: false, error: validated.error}

            const value = validated.value
            const zh = value.locale === 'zh-CN'
            const result = await confirmAndDeleteClip(value, async options => {
                const response = await dialog.showMessageBox(window, options)
                return response.response
            })
            if (!result.refreshRequired) return result

            log.warn('Unable to permanently delete clip directory', {
                path: value.directory.path,
                code: result.code,
                error: result.error,
            })
            try {
                const failure = await presentDeleteFailure(window, result, value.directory.path, zh)
                if (failure.response === 0) shell.showItemInFolder(value.directory.path)
                return {...result, failurePresented: true}
            } catch (error) {
                // Preserve refreshRequired even if the native error dialog is unavailable.
                log.warn('Unable to present deletion failure', {error})
                return result
            }
        } finally {
            deleting = false
        }
    })
}
