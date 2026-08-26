// 从 electron 中导入核心模块
import {app, BrowserWindow, shell} from 'electron'

// 把 import.meta.url 转成文件路径
import {fileURLToPath} from 'node:url'

// Node.js 路径工具
import path from 'node:path'

import log, {getLogDirectory, getLogFilePath} from './utils/logger'
import {resolveFFmpegPath} from './utils/ffmpeg'
import {cancelAllExports, registerIpcHandlers} from './ipc'

if (!app.isPackaged) {
    app.commandLine.appendSwitch('remote-debugging-port', '9229')
}

// 在 ESM 中模拟 __dirname
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// =======================
// 打包后的目录结构说明
// =======================
//
// ├─┬ dist-electron
// │ ├─┬ main
// │ │ └── index.js    > Electron 主进程入口
// │ └─┬ preload
// │   └── index.mjs   > Preload 脚本
// ├─┬ dist
// │ └── index.html    > 前端渲染页面
//

const APP_ROOT = path.join(__dirname, '../..')

// 主进程产物目录
export const MAIN_DIST = path.join(APP_ROOT, 'dist-electron')

// 前端页面目录
export const RENDERER_DIST = path.join(APP_ROOT, 'dist')

// Vite 开发服务器地址（dev 模式才有）
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

const publicDir = VITE_DEV_SERVER_URL
    ? path.join(APP_ROOT, 'public')
    : RENDERER_DIST

log.info('Main process bootstrapped', {
    isPackaged: app.isPackaged,
    logDirectory: getLogDirectory(),
    logFile: getLogFilePath(),
})

let ffmpegPath: string | undefined
try {
    ffmpegPath = resolveFFmpegPath(app.isPackaged)
    log.info('FFmpeg is available', {path: ffmpegPath})
} catch (error) {
    log.error('FFmpeg is unavailable; media export will be disabled', error)
}
registerIpcHandlers(ffmpegPath)

// Windows 10+ 设置 AppUserModelId，保证通知和任务栏正常
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

// =======================
// 单实例应用（防止多开）
// =======================

// 如果没有获取到单实例锁，说明已经有一个实例在运行
if (!app.requestSingleInstanceLock()) {
    app.quit()
    process.exit(0)
}

// 主窗口引用（防止被 GC 回收）
let win: BrowserWindow | null = null

// preload 脚本路径
const preload = path.join(__dirname, '../preload/index.mjs')

// 生产环境加载的 HTML
const indexHtml = path.join(RENDERER_DIST, 'index.html')

// =======================
// 创建主窗口
// =======================
async function createWindow() {
    log.info('Creating main window')

    const windowIcon =
        process.platform === 'win32'
            ? 'icons/win/icon.ico'
            : 'icons/png/512x512.png'

    const window = new BrowserWindow({
        // 窗口标题
        title: 'Tesla Dashcam',
        width: 1440,
        height: 900,
        minWidth: 960,
        minHeight: 640,
        // 防止启动闪一下
        show: false,
        // 隐藏原生菜单栏
        autoHideMenuBar: true,
        backgroundColor: '#0b0c0c',
        // 应用图标
        icon: path.join(publicDir, windowIcon),
        // Web 相关配置
        webPreferences: {
            // 预加载脚本（安全桥）1
            preload,
            nodeIntegration: false,    // 禁止 Renderer 直接使用 Node
            contextIsolation: true,    // 开启上下文隔离（推荐）
            sandbox: false,
        },
    })
    win = window
    window.removeMenu()
    window.once('ready-to-show', () => {
        window.show()
    })
    // =======================
    // 加载页面（开发 / 生产）
    // =======================

    if (VITE_DEV_SERVER_URL) {
        // 开发模式：加载 Vite dev server
        await window.loadURL(VITE_DEV_SERVER_URL)
        if (process.env.VITE_OPEN_DEVTOOLS === '1') window.webContents.openDevTools()
    } else {
        // 生产模式：加载本地 HTML
        await window.loadFile(indexHtml)
    }

    // =======================
    // 主进程 → 渲染进程通信示例
    // =======================

    // 页面加载完成后，主动给 Renderer 发消息
    // win.webContents.on('did-finish-load', () => {
    //     win?.webContents.send(
    //         'main-process-message',
    //         new Date().toLocaleString()
    //     )
    // })

    // =======================
    // 外部链接用系统浏览器打开
    // =======================

    window.webContents.setWindowOpenHandler(({url}) => {
        // https 链接用默认浏览器打开
        if (url.startsWith('https:')) void shell.openExternal(url)
        // 阻止 Electron 内部新开窗口
        return {action: 'deny'}
    })

    window.webContents.on('will-navigate', (event, url) => {
        if (url === window.webContents.getURL()) return
        event.preventDefault()
        if (url.startsWith('https:')) void shell.openExternal(url)
    })
}

// =======================
// Electron 生命周期
// =======================

// Electron 准备完成后创建窗口
app.whenReady()
    .then(async () => {
        log.info('Electron app is ready')
        await createWindow()
    })
    .catch(error => {
        log.error('Failed to create the main window', error)
    })

// 所有窗口关闭时触发
app.on('window-all-closed', () => {
    log.info('All windows closed')
    win = null
    cancelAllExports()
    // macOS：关闭窗口不退出应用
    if (process.platform !== 'darwin') app.quit()
})

// =======================
// 第二实例处理（配合单实例）
// =======================

app.on('second-instance', () => {
    log.warn('A second instance was blocked')
    if (win) {
        // 如果窗口最小化，先恢复
        if (win.isMinimized()) win.restore()
        // 聚焦窗口
        win.focus()
    }
})

// macOS：点击 Dock 图标重新激活
app.on('activate', () => {
    log.info('App activated')
    const allWindows = BrowserWindow.getAllWindows()
    if (allWindows.length) {
        allWindows[0].focus()
    } else {
        createWindow()
    }
})
