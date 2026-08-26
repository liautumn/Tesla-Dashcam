import {spawn, type ChildProcess} from 'node:child_process'
import fs from 'node:fs'
import {rm, stat} from 'node:fs/promises'
import path from 'node:path'
import {BrowserWindow, dialog, ipcMain} from 'electron'
import type {
    ComposeExportRequest,
    ComposeExportResult,
    ComposeProgressEvent,
} from '../../../shared/types'
import {prepareComposeExport} from './composeExportBuilder.ts'

type ComposeSession = {
    outputPath: string
    process: ChildProcess
    canceled: boolean
}

const composeSessions = new Map<string, ComposeSession>()
const pendingComposeSessions = new Set<string>()
const canceledComposeSessions = new Set<string>()
let encoderPromise: Promise<string | null> | undefined
let mainWindow: BrowserWindow | null = null
let registered = false

const camNames = new Set(['front', 'back', 'left', 'right', 'left_pillar', 'right_pillar'])
const viewTypes = new Set(['grid6', 'grid4', 'grid4old', ...camNames])

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)

const validateComposeRequest = (request: ComposeExportRequest) => {
    if (!request || typeof request !== 'object') return 'Invalid export request'
    if (!/^[\w.-]{1,64}$/.test(request.sessionId ?? '')) return 'Invalid export session'
    if (composeSessions.has(request.sessionId) || pendingComposeSessions.has(request.sessionId)) {
        return 'Export session already exists'
    }
    if (typeof request.fileName !== 'string' || request.fileName.length > 255 || path.extname(request.fileName).toLowerCase() !== '.mp4') {
        return 'Invalid output file name'
    }
    if (!viewTypes.has(request.viewType)) return 'Invalid export view'
    if (!Number.isFinite(request.startSeconds) || request.startSeconds < 0) return 'Invalid start time'
    if (!Number.isFinite(request.durationSeconds) || request.durationSeconds <= 0 || request.durationSeconds > 600) {
        return 'Invalid export duration'
    }
    if (!Array.isArray(request.segments) || !request.segments.length || request.segments.length > 1000) {
        return 'No export segments'
    }
    let sourceCount = 0
    for (const segment of request.segments) {
        if (!segment || typeof segment.name !== 'string' || segment.name.length > 64
            || !Number.isFinite(segment.startSeconds) || segment.startSeconds < 0
            || !Number.isFinite(segment.duration) || segment.duration <= 0 || segment.duration > 600) {
            return 'Invalid export segment'
        }
        if (!segment.paths || typeof segment.paths !== 'object') return 'Invalid export segment paths'
        for (const [camera, sourcePath] of Object.entries(segment.paths)) {
            if (!camNames.has(camera)) return 'Invalid camera name'
            if (sourcePath === undefined) continue
            sourceCount += 1
            if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath) || path.extname(sourcePath).toLowerCase() !== '.mp4') {
                return 'Invalid source path'
            }
            try {
                if (!fs.statSync(sourcePath).isFile()) return 'Source file not found'
            } catch {
                return 'Source file not found'
            }
        }
    }
    if (!sourceCount || sourceCount > 6000) return 'Invalid source count'
    if (request.fps !== undefined && (!Number.isFinite(request.fps) || request.fps < 1 || request.fps > 240)) {
        return 'Invalid frame rate'
    }
    if (request.layout) {
        const values = Object.values(request.layout)
        if (values.some(value => !Number.isFinite(value) || value < 0)) return 'Invalid export layout'
        if (request.layout.width < 2 || request.layout.width > 7680
            || request.layout.height < 2 || request.layout.height > 4320
            || request.layout.videoHeight < 2 || request.layout.videoHeight > request.layout.height
            || request.layout.barHeight !== request.layout.height - request.layout.videoHeight
            || request.layout.scale <= 0) return 'Invalid export layout'
    }
    if (request.overlay) {
        const overlay = request.overlay
        for (const value of [overlay.locationText, overlay.baseTimestampLabel, overlay.brandText]) {
            if (value !== undefined && (typeof value !== 'string' || value.length > 2048)) return 'Invalid overlay text'
        }
        if (overlay.baseTimestampEpoch !== undefined && !Number.isFinite(overlay.baseTimestampEpoch)) {
            return 'Invalid overlay timestamp'
        }
        for (const windows of [overlay.driveWindows, overlay.timeWindows]) {
            if (windows === undefined) continue
            if (!Array.isArray(windows) || windows.length > 1200) return 'Invalid overlay windows'
            for (const window of windows) {
                if (!window || !Number.isFinite(window.start) || !Number.isFinite(window.end)
                    || window.start < 0 || window.end <= window.start || window.end > request.durationSeconds + .01
                    || typeof window.text !== 'string' || window.text.length > 512) return 'Invalid overlay window'
            }
        }
    }
    return null
}

const ffmpegCompletes = (binaryPath: string, args: string[], timeoutMs = 12_000) =>
    new Promise<boolean>(resolve => {
        const process = spawn(binaryPath, args, {stdio: 'ignore', windowsHide: true})
        let settled = false
        const finish = (ok: boolean) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            resolve(ok)
        }
        const timer = setTimeout(() => {
            process.kill('SIGKILL')
            finish(false)
        }, timeoutMs)
        process.once('error', () => finish(false))
        process.once('close', code => finish(code === 0))
    })

const detectHardwareEncoder = (ffmpegPath: string) => {
    if (!encoderPromise) {
        encoderPromise = (async () => {
            const candidates = process.platform === 'darwin'
                ? ['h264_videotoolbox']
                : process.platform === 'win32'
                    ? ['h264_nvenc', 'h264_qsv', 'h264_amf']
                    : ['h264_nvenc', 'h264_qsv']
            for (const encoder of candidates) {
                const ok = await ffmpegCompletes(ffmpegPath, [
                    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
                    'color=c=black:s=320x240:d=.2:r=10', '-c:v', encoder, '-f', 'null', '-',
                ])
                if (ok) return encoder
            }
            return null
        })()
    }
    return encoderPromise
}

const detectSourceFps = (ffmpegPath: string, filePath: string) =>
    new Promise<number | null>(resolve => {
        const child = spawn(ffmpegPath, ['-hide_banner', '-i', filePath], {
            stdio: ['ignore', 'ignore', 'pipe'],
            windowsHide: true,
        })
        let stderr = ''
        let settled = false
        const finish = (value: number | null) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            resolve(value)
        }
        child.stderr?.on('data', chunk => {
            stderr = `${stderr}${String(chunk)}`.slice(-12_000)
        })
        const timer = setTimeout(() => {
            child.kill('SIGKILL')
            finish(null)
        }, 8000)
        child.once('error', () => finish(null))
        child.once('close', () => {
            const fps = Number(stderr.match(/([\d.]+)\s*fps/)?.[1])
            finish(Number.isFinite(fps) && fps >= 1 && fps <= 240 ? fps : null)
        })
    })

const deletePartial = async (filePath: string) => {
    try {
        await rm(filePath, {force: true})
    } catch {
        // Best effort cleanup after cancel or encode failure.
    }
}

export function registerComposeExport(window: BrowserWindow, ffmpegPath?: string) {
    mainWindow = window
    if (registered) return
    registered = true

    ipcMain.handle('compose-export:start', async (event, request: ComposeExportRequest): Promise<ComposeExportResult> => {
        if (event.sender !== mainWindow?.webContents) return {ok: false, error: 'No window'}
        if (!ffmpegPath) return {ok: false, error: 'FFmpeg is unavailable'}
        const invalid = validateComposeRequest(request)
        if (invalid) return {ok: false, error: invalid}
        pendingComposeSessions.add(request.sessionId)

        try {
            const save = await dialog.showSaveDialog(mainWindow, {
                defaultPath: request.fileName,
                filters: [{name: 'MP4 Video', extensions: ['mp4']}],
            })
            if (save.canceled || !save.filePath) return {ok: false, canceled: true}

            const firstSource = request.segments.flatMap(segment => Object.values(segment.paths)).find(Boolean)
            const fps = request.fps || (firstSource ? await detectSourceFps(ffmpegPath, firstSource) : null) || 30
            const effectiveRequest = {...request, fps}
            const hardwareEncoder = request.useHardware === false ? null : await detectHardwareEncoder(ffmpegPath)

            const run = async (encoder: string): Promise<ComposeExportResult> => {
                if (canceledComposeSessions.has(request.sessionId)) return {ok: false, canceled: true}
                let prepared: ReturnType<typeof prepareComposeExport>
                try {
                    prepared = prepareComposeExport(effectiveRequest, save.filePath!, {encoder})
                } catch (error) {
                    return {ok: false, error: errorText(error)}
                }

                const child = spawn(ffmpegPath, prepared.args, {
                    stdio: ['ignore', 'pipe', 'pipe'],
                    windowsHide: true,
                })
                const session: ComposeSession = {outputPath: save.filePath!, process: child, canceled: false}
                composeSessions.set(request.sessionId, session)
                let stderr = ''
                let progressBuffer = ''
                child.stderr?.on('data', chunk => {
                    stderr = `${stderr}${String(chunk)}`.slice(-12_000)
                })
                child.stdout?.on('data', chunk => {
                    progressBuffer += String(chunk)
                    const lines = progressBuffer.split(/\r?\n/)
                    progressBuffer = lines.pop() ?? ''
                    for (const line of lines) {
                        if (!line.startsWith('out_time_ms=')) continue
                        const microseconds = Number(line.slice(12))
                        if (!Number.isFinite(microseconds)) continue
                        const outTimeSec = microseconds / 1_000_000
                        const data: ComposeProgressEvent = {
                            sessionId: request.sessionId,
                            progress: Math.min(99, outTimeSec / request.durationSeconds * 100),
                            outTimeSec,
                        }
                        if (!event.sender.isDestroyed()) event.sender.send('compose-export:progress', data)
                    }
                })

                try {
                    const exitCode = await new Promise<number | null>((resolve, reject) => {
                        child.once('error', reject)
                        child.once('close', resolve)
                    })
                    if (session.canceled) {
                        await deletePartial(save.filePath!)
                        return {ok: false, canceled: true}
                    }
                    if (exitCode !== 0) {
                        await deletePartial(save.filePath!)
                        return {ok: false, error: stderr || `FFmpeg exited with ${exitCode}`}
                    }
                    const output = await stat(save.filePath!)
                    if (session.canceled) {
                        await deletePartial(save.filePath!)
                        return {ok: false, canceled: true}
                    }
                    if (output.size < 1000) {
                        await deletePartial(save.filePath!)
                        return {ok: false, error: 'Exported file is empty'}
                    }
                    return {
                        ok: true,
                        filePath: save.filePath!,
                        width: prepared.width,
                        height: prepared.height,
                        fps: prepared.fps,
                        encoder,
                    }
                } catch (error) {
                    await deletePartial(save.filePath!)
                    return {ok: false, error: errorText(error)}
                } finally {
                    composeSessions.delete(request.sessionId)
                    if (prepared.tmpDir) await rm(prepared.tmpDir, {recursive: true, force: true}).catch(() => undefined)
                }
            }

            let result = await run(hardwareEncoder ?? 'libx264')
            if (!result.ok && !result.canceled && hardwareEncoder) result = await run('libx264')
            return result
        } finally {
            pendingComposeSessions.delete(request.sessionId)
            canceledComposeSessions.delete(request.sessionId)
        }
    })

    ipcMain.on('compose-export:cancel', (event, payload: {sessionId?: unknown}) => {
        if (event.sender !== mainWindow?.webContents || typeof payload?.sessionId !== 'string') return
        const session = composeSessions.get(payload.sessionId)
        if (!session) {
            if (pendingComposeSessions.has(payload.sessionId)) canceledComposeSessions.add(payload.sessionId)
            return
        }
        session.canceled = true
        try {
            session.process.kill('SIGKILL')
        } catch {
            // The encoder may already have exited.
        }
    })

}

export const cancelComposeExports = () => {
    for (const sessionId of pendingComposeSessions) canceledComposeSessions.add(sessionId)
    for (const session of composeSessions.values()) {
        session.canceled = true
        try {
            session.process.kill('SIGKILL')
        } catch {
            // The encoder may already have exited.
        }
    }
    composeSessions.clear()
}
