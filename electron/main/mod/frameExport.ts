import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process'
import {rm, stat} from 'node:fs/promises'
import path from 'node:path'
import {BrowserWindow, dialog, ipcMain} from 'electron'
import type {
    FrameExportResult,
    FrameExportStartRequest,
    FrameExportWriteResult,
} from '../../../shared/types'

type FrameExportSession = {
    outputPath: string
    process: ChildProcessWithoutNullStreams
    completion: Promise<void>
    frameCount: number
    expectedFrameBytes: number
    maxFrames: number
    canceled: boolean
}

const sessions = new Map<string, FrameExportSession>()
let mainWindow: BrowserWindow | null = null
let registered = false

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)

const validateStartRequest = (request: FrameExportStartRequest) => {
    if (!request || typeof request !== 'object') return 'Invalid export request'
    if (!/^[\w.-]{1,64}$/.test(request.sessionId ?? '')) return 'Invalid export session'
    if (sessions.has(request.sessionId)) return 'Export session already exists'
    if (typeof request.fileName !== 'string' || request.fileName.length > 255
        || path.extname(request.fileName).toLowerCase() !== '.mp4') return 'Invalid output file name'
    if (!Number.isInteger(request.width) || request.width < 2 || request.width > 7680
        || request.width % 2 !== 0
        || !Number.isInteger(request.height) || request.height < 2 || request.height > 4320
        || request.height % 2 !== 0) return 'Invalid export dimensions'
    if (!Number.isFinite(request.fps) || request.fps < 1 || request.fps > 60) return 'Invalid frame rate'
    return null
}

const deletePartial = async (filePath: string) => {
    await rm(filePath, {force: true}).catch(() => undefined)
}

const cleanupSession = async (sessionId: string, removeOutput: boolean) => {
    const session = sessions.get(sessionId)
    if (!session) return
    sessions.delete(sessionId)
    try {
        if (!session.process.killed) session.process.kill('SIGKILL')
    } catch {
        // The encoder may already have exited.
    }
    await session.completion.catch(() => undefined)
    if (removeOutput) await deletePartial(session.outputPath)
}

export function registerFrameExport(window: BrowserWindow, ffmpegPath?: string) {
    mainWindow = window
    if (registered) return
    registered = true

    ipcMain.handle('frame-export:start', async (event, request: FrameExportStartRequest): Promise<FrameExportResult> => {
        if (event.sender !== mainWindow?.webContents) return {ok: false, error: 'No window'}
        if (!ffmpegPath) return {ok: false, error: 'FFmpeg is unavailable'}
        const invalid = validateStartRequest(request)
        if (invalid) return {ok: false, error: invalid}

        const save = await dialog.showSaveDialog(mainWindow, {
            defaultPath: request.fileName,
            filters: [{name: 'MP4 Video', extensions: ['mp4']}],
        })
        if (save.canceled || !save.filePath) return {ok: false, canceled: true}

        const child = spawn(ffmpegPath, [
            '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba',
            '-s:v', `${request.width}x${request.height}`,
            '-r', String(request.fps), '-i', 'pipe:0', '-an',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
            '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-threads', '0',
            save.filePath,
        ], {
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
        })
        let stderr = ''
        child.stderr.on('data', chunk => {
            stderr = `${stderr}${String(chunk)}`.slice(-12_000)
        })
        const completion = new Promise<void>((resolve, reject) => {
            child.once('error', reject)
            child.once('close', code => {
                if (code === 0) resolve()
                else reject(new Error(stderr || `FFmpeg exited with ${code}`))
            })
        })
        void completion.catch(() => undefined)
        sessions.set(request.sessionId, {
            outputPath: save.filePath,
            process: child,
            completion,
            frameCount: 0,
            expectedFrameBytes: request.width * request.height * 4,
            maxFrames: Math.ceil(request.fps * 60) + 1,
            canceled: false,
        })
        return {ok: true, filePath: save.filePath}
    })

    ipcMain.handle('frame-export:write', async (event, payload: {
        sessionId?: unknown
        frameData?: unknown
    }): Promise<FrameExportWriteResult> => {
        if (event.sender !== mainWindow?.webContents) return {ok: false, error: 'No window'}
        if (typeof payload?.sessionId !== 'string') return {ok: false, error: 'Invalid export session'}
        const session = sessions.get(payload.sessionId)
        if (!session || session.canceled) return {ok: false, error: 'Export session is unavailable'}
        if (!(payload.frameData instanceof Uint8Array)
            || payload.frameData.byteLength !== session.expectedFrameBytes) {
            return {ok: false, error: 'Invalid video frame'}
        }
        if (session.frameCount >= session.maxFrames) {
            return {ok: false, error: 'Fallback export is limited to 60 seconds'}
        }

        const frameNum = session.frameCount
        try {
            const stdin = session.process.stdin
            if (stdin.destroyed || !stdin.writable) throw new Error('FFmpeg input is closed')
            await new Promise<void>((resolve, reject) => {
                stdin.write(Buffer.from(payload.frameData as Uint8Array), error => error ? reject(error) : resolve())
            })
            session.frameCount += 1
            return {ok: true, frameNum}
        } catch (error) {
            return {ok: false, error: errorText(error)}
        }
    })

    ipcMain.handle('frame-export:finish', async (event, payload: {sessionId?: unknown}): Promise<FrameExportResult> => {
        if (event.sender !== mainWindow?.webContents) return {ok: false, error: 'No window'}
        if (typeof payload?.sessionId !== 'string') return {ok: false, error: 'Invalid export session'}
        const session = sessions.get(payload.sessionId)
        if (!session) return {ok: false, error: 'No export session found'}
        if (session.canceled) {
            await cleanupSession(payload.sessionId, true)
            return {ok: false, canceled: true}
        }
        if (!session.frameCount) {
            await cleanupSession(payload.sessionId, true)
            return {ok: false, error: 'No frames captured'}
        }

        try {
            session.process.stdin.end()
            await session.completion
            const output = await stat(session.outputPath)
            if (output.size < 1000) throw new Error('Exported file is empty')
            sessions.delete(payload.sessionId)
            return {ok: true, filePath: session.outputPath, frameCount: session.frameCount}
        } catch (error) {
            const frameCount = session.frameCount
            await cleanupSession(payload.sessionId, true)
            return {ok: false, error: errorText(error), frameCount}
        }
    })

    ipcMain.on('frame-export:cancel', (event, payload: {sessionId?: unknown}) => {
        if (event.sender !== mainWindow?.webContents || typeof payload?.sessionId !== 'string') return
        const session = sessions.get(payload.sessionId)
        if (!session) return
        session.canceled = true
        void cleanupSession(payload.sessionId, true)
    })
}

export const cancelFrameExports = () => {
    for (const [sessionId, session] of sessions) {
        session.canceled = true
        void cleanupSession(sessionId, true)
    }
}
