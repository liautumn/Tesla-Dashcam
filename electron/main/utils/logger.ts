import {app} from 'electron'
import log from 'electron-log'
import path from 'node:path'

const formatLogDate = (date: Date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')

    return `${year}-${month}-${day}`
}

const resolveLogDirectory = () => path.join(app.getPath('userData'), 'logs')

const resolveLogFilePath = (date = new Date()) =>
    path.join(resolveLogDirectory(), `${formatLogDate(date)}.log`)

const isBrokenPipeError = (error: unknown): error is NodeJS.ErrnoException =>
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'EPIPE'

const consoleTransportEnabled =
    !app.isPackaged || process.env.ELECTRON_LOG_CONSOLE === '1'

const defaultConsoleWrite = log.transports.console.writeFn.bind(log.transports.console)

// Some packaged launches do not provide a live stdout/stderr stream.
log.transports.console.writeFn = options => {
    try {
        defaultConsoleWrite(options)
    } catch (error) {
        if (isBrokenPipeError(error)) {
            return
        }

        throw error
    }
}

log.transports.file.resolvePathFn = (_variables, message) =>
    resolveLogFilePath(message?.date instanceof Date ? message.date : new Date())
log.transports.file.level = 'info'
log.transports.console.level = consoleTransportEnabled
    ? app.isPackaged
        ? 'info'
        : 'silly'
    : false

try {
    app.setAppLogsPath(resolveLogDirectory())
} catch {
    // ignore: Electron will fall back to the explicit file transport path above
}

log.initialize()

export const createLogger = (scope: string) => log.scope(scope)

export const getLogDirectory = () => resolveLogDirectory()

export const getLogFilePath = (date = new Date()) => resolveLogFilePath(date)

export const logger = {
    info: (...args: Parameters<typeof log.info>) => log.info(...args),
    error: (...args: Parameters<typeof log.error>) => log.error(...args),
    warn: (...args: Parameters<typeof log.warn>) => log.warn(...args),
    debug: (...args: Parameters<typeof log.debug>) => log.debug(...args),
}

export default logger
