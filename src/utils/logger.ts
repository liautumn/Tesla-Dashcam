import log from 'electron-log'

export const createLogger = (scope: string) => log.scope(scope)

export const logger = {
    info: (...args: Parameters<typeof log.info>) => log.info(...args),
    error: (...args: Parameters<typeof log.error>) => log.error(...args),
    warn: (...args: Parameters<typeof log.warn>) => log.warn(...args),
    debug: (...args: Parameters<typeof log.debug>) => log.debug(...args),
}

export default logger
