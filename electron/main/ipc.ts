import {spawn, type ChildProcess, type ChildProcessWithoutNullStreams} from 'node:child_process'
import fs from 'node:fs'
import {rm, stat, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {BrowserWindow, dialog, ipcMain, shell} from 'electron'
import type {
    ComposeExportRequest,
    ComposeExportResult,
    ComposeProgressEvent,
    FrameExportResult,
    FrameExportStartRequest,
    FrameExportWriteResult,
    TrashClipResult,
} from '../../shared/types/index.js'
import {prepareComposeExport} from './composeExport.js'
import {moveClipDirectoryToSystemTrash} from './trashOperation.js'
import {validateTrashFilesPayload} from './trashValidation.js'

type ComposeSession = {
    outputPath: string
    process: ChildProcess
    canceled: boolean
}

type FrameExportSession = {
    outputPath: string
    process: ChildProcessWithoutNullStreams
    completion: Promise<void>
    frameCount: number
    expectedFrameBytes: number
    maxFrames: number
    canceled: boolean
}

const composeSessions = new Map<string, ComposeSession>()
const pendingComposeSessions = new Set<string>()
const canceledComposeSessions = new Set<string>()
const frameSessions = new Map<string, FrameExportSession>()
let encoderPromise: Promise<string | null> | undefined

const camNames = new Set(['front', 'back', 'left', 'right', 'left_pillar', 'right_pillar'])
const viewTypes = new Set(['grid6', 'grid4', 'grid4old', ...camNames])

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)

const validateComposeRequest = (request: ComposeExportRequest) => {
    if (!request || typeof request !== 'object') return 'Invalid export request'
    if (!/^[\w.-]{1,64}$/.test(request.sessionId ?? '')) return 'Invalid export session'
    if (composeSessions.has(request.sessionId) || pendingComposeSessions.has(request.sessionId)
        || frameSessions.has(request.sessionId)) return 'Export session already exists'
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

const validateFrameExportStart = (request: FrameExportStartRequest) => {
    if (!request || typeof request !== 'object') return 'Invalid export request'
    if (!/^[\w.-]{1,64}$/.test(request.sessionId ?? '')) return 'Invalid export session'
    if (composeSessions.has(request.sessionId) || pendingComposeSessions.has(request.sessionId)
        || frameSessions.has(request.sessionId)) return 'Export session already exists'
    if (typeof request.fileName !== 'string' || request.fileName.length > 255 || path.extname(request.fileName).toLowerCase() !== '.mp4') {
        return 'Invalid output file name'
    }
    if (!Number.isInteger(request.width) || request.width < 2 || request.width > 7680
        || request.width % 2 !== 0
        || !Number.isInteger(request.height) || request.height < 2 || request.height > 4320
        || request.height % 2 !== 0) return 'Invalid export dimensions'
    if (!Number.isFinite(request.fps) || request.fps < 1 || request.fps > 60) return 'Invalid frame rate'
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

const cleanupFrameSession = async (sessionId: string, removeOutput: boolean) => {
    const session = frameSessions.get(sessionId)
    if (!session) return
    frameSessions.delete(sessionId)
    try {
        if (!session.process.killed) session.process.kill('SIGKILL')
    } catch {
        // The encoder may already have exited.
    }
    await session.completion.catch(() => undefined)
    if (removeOutput) await deletePartial(session.outputPath)
}

export const registerIpcHandlers = (ffmpegPath?: string) => {
    ipcMain.handle('save-file', async (event, payload: {name?: unknown; buffer?: unknown}) => {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win || typeof payload?.name !== 'string' || !payload.name || payload.name.length > 255) return null
        if (!(payload.buffer instanceof ArrayBuffer)) return null
        const extension = path.extname(payload.name).toLowerCase()
        const filters: Electron.FileFilter[] = extension === '.csv'
            ? [{name: 'CSV', extensions: ['csv']}]
            : [{name: 'Images', extensions: ['jpg', 'jpeg', 'png']}]
        const result = await dialog.showSaveDialog(win, {defaultPath: payload.name, filters})
        if (result.canceled || !result.filePath) return null
        await writeFile(result.filePath, Buffer.from(payload.buffer))
        return result.filePath
    })

    ipcMain.handle('show-item-in-folder', (_event, filePath: unknown) => {
        if (typeof filePath === 'string' && path.isAbsolute(filePath)) shell.showItemInFolder(filePath)
    })

    ipcMain.handle('trash-files', async (event, payload: unknown): Promise<TrashClipResult> => {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win) return {ok: false, error: 'No window'}
        const validated = validateTrashFilesPayload(payload)
        if (!validated.ok) return {ok: false, error: validated.error}
        const value = validated.value
        const zh = value.locale === 'zh-CN'
        const isRecent = value.kind === 'recent'
        const response = await dialog.showMessageBox(win, {
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

    ipcMain.handle('export-compose', async (event, request: ComposeExportRequest): Promise<ComposeExportResult> => {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win) return {ok: false, error: 'No window'}
        if (!ffmpegPath) return {ok: false, error: 'FFmpeg is unavailable'}
        const invalid = validateComposeRequest(request)
        if (invalid) return {ok: false, error: invalid}
        pendingComposeSessions.add(request.sessionId)

        try {
            const save = await dialog.showSaveDialog(win, {
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
                        if (!event.sender.isDestroyed()) event.sender.send('export-compose-progress', data)
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

    ipcMain.on('export-compose-cancel', (_event, payload: {sessionId?: unknown}) => {
        if (typeof payload?.sessionId !== 'string') return
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

    ipcMain.handle('export-start', async (event, request: FrameExportStartRequest): Promise<FrameExportResult> => {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win) return {ok: false, error: 'No window'}
        if (!ffmpegPath) return {ok: false, error: 'FFmpeg is unavailable'}
        const invalid = validateFrameExportStart(request)
        if (invalid) return {ok: false, error: invalid}

        const save = await dialog.showSaveDialog(win, {
            defaultPath: request.fileName,
            filters: [{name: 'MP4 Video', extensions: ['mp4']}],
        })
        if (save.canceled || !save.filePath) return {ok: false, canceled: true}

        const args = [
            '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba',
            '-s:v', `${request.width}x${request.height}`,
            '-r', String(request.fps), '-i', 'pipe:0', '-an',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
            '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-threads', '0',
            save.filePath,
        ]
        const child = spawn(ffmpegPath, args, {
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
        frameSessions.set(request.sessionId, {
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

    ipcMain.handle('export-frame', async (_event, payload: {
        sessionId?: unknown
        frameData?: unknown
    }): Promise<FrameExportWriteResult> => {
        if (typeof payload?.sessionId !== 'string') return {ok: false, error: 'Invalid export session'}
        const session = frameSessions.get(payload.sessionId)
        if (!session || session.canceled) return {ok: false, error: 'Export session is unavailable'}
        if (!(payload.frameData instanceof Uint8Array) || payload.frameData.byteLength !== session.expectedFrameBytes) {
            return {ok: false, error: 'Invalid video frame'}
        }
        const frameData = payload.frameData
        if (session.frameCount >= session.maxFrames) return {ok: false, error: 'Fallback export is limited to 60 seconds'}

        const frameNum = session.frameCount
        try {
            const stdin = session.process.stdin
            if (stdin.destroyed || !stdin.writable) throw new Error('FFmpeg input is closed')
            await new Promise<void>((resolve, reject) => {
                stdin.write(Buffer.from(frameData), error => error ? reject(error) : resolve())
            })
            session.frameCount += 1
            return {ok: true, frameNum}
        } catch (error) {
            return {ok: false, error: errorText(error)}
        }
    })

    ipcMain.handle('export-finish', async (_event, payload: {sessionId?: unknown}): Promise<FrameExportResult> => {
        if (typeof payload?.sessionId !== 'string') return {ok: false, error: 'Invalid export session'}
        const session = frameSessions.get(payload.sessionId)
        if (!session) return {ok: false, error: 'No export session found'}
        if (session.canceled) {
            await cleanupFrameSession(payload.sessionId, true)
            return {ok: false, canceled: true}
        }
        if (!session.frameCount) {
            await cleanupFrameSession(payload.sessionId, true)
            return {ok: false, error: 'No frames captured'}
        }

        try {
            session.process.stdin.end()
            await session.completion
            const output = await stat(session.outputPath)
            if (output.size < 1000) throw new Error('Exported file is empty')
            frameSessions.delete(payload.sessionId)
            return {ok: true, filePath: session.outputPath, frameCount: session.frameCount}
        } catch (error) {
            const frameCount = session.frameCount
            await cleanupFrameSession(payload.sessionId, true)
            return {ok: false, error: errorText(error), frameCount}
        }
    })

    ipcMain.on('export-cancel', (_event, payload: {sessionId?: unknown}) => {
        if (typeof payload?.sessionId !== 'string') return
        const session = frameSessions.get(payload.sessionId)
        if (!session) return
        session.canceled = true
        void cleanupFrameSession(payload.sessionId, true)
    })
}

export const cancelAllExports = () => {
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
    for (const [sessionId, session] of frameSessions) {
        session.canceled = true
        void cleanupFrameSession(sessionId, true)
    }
}
