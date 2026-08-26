import {accessSync, constants} from 'node:fs'
import ffmpegStatic from 'ffmpeg-static'

export const resolveFFmpegPath = (isPackaged: boolean) => {
    if (!ffmpegStatic) {
        throw new Error(`FFmpeg is not available for ${process.platform}/${process.arch}`)
    }

    const binaryPath = isPackaged && ffmpegStatic.includes('app.asar')
        ? ffmpegStatic.replace('app.asar', 'app.asar.unpacked')
        : ffmpegStatic

    accessSync(binaryPath, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    return binaryPath
}
