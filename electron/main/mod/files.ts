import {writeFile} from 'node:fs/promises'
import path from 'node:path'
import {BrowserWindow, dialog, ipcMain, shell} from 'electron'

let mainWindow: BrowserWindow | null = null
let registered = false

export function registerFiles(window: BrowserWindow) {
    mainWindow = window
    if (registered) return
    registered = true

    ipcMain.handle('files:save', async (event, payload: {name?: unknown; buffer?: unknown}) => {
        if (event.sender !== mainWindow?.webContents) return null
        if (typeof payload?.name !== 'string' || !payload.name || payload.name.length > 255) return null
        if (!(payload.buffer instanceof ArrayBuffer)) return null

        const extension = path.extname(payload.name).toLowerCase()
        const filters: Electron.FileFilter[] = extension === '.csv'
            ? [{name: 'CSV', extensions: ['csv']}]
            : [{name: 'Images', extensions: ['jpg', 'jpeg', 'png']}]
        const result = await dialog.showSaveDialog(mainWindow, {defaultPath: payload.name, filters})
        if (result.canceled || !result.filePath) return null
        await writeFile(result.filePath, Buffer.from(payload.buffer))
        return result.filePath
    })

    ipcMain.handle('files:show-item-in-folder', (event, filePath: unknown) => {
        if (event.sender !== mainWindow?.webContents) return
        if (typeof filePath === 'string' && path.isAbsolute(filePath)) shell.showItemInFolder(filePath)
    })
}
