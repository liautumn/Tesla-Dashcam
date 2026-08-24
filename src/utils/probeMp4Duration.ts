const readU32 = (view: DataView, offset: number) => view.getUint32(offset, false)

const readU64 = (view: DataView, offset: number) => {
    const high = view.getUint32(offset, false)
    const low = view.getUint32(offset + 4, false)
    return Number((BigInt(high) << 32n) | BigInt(low))
}

const readBoxType = (view: DataView, offset: number) =>
    String.fromCharCode(
        view.getUint8(offset + 4),
        view.getUint8(offset + 5),
        view.getUint8(offset + 6),
        view.getUint8(offset + 7),
    )

const findMovieHeaderDuration = (buffer: ArrayBuffer) => {
    const view = new DataView(buffer)
    let offset = 0

    while (offset + 8 <= buffer.byteLength) {
        let size = readU32(view, offset)
        const type = readBoxType(view, offset)
        let headerSize = 8
        if (size === 1 && offset + 16 <= buffer.byteLength) {
            size = readU64(view, offset + 8)
            headerSize = 16
        } else if (size === 0) {
            size = buffer.byteLength - offset
        }
        if (size < headerSize || offset + size > buffer.byteLength) break

        if (type === 'mvhd') {
            const body = offset + headerSize
            const version = view.getUint8(body)
            const timescaleOffset = version === 1 ? body + 20 : body + 12
            const durationOffset = version === 1 ? body + 24 : body + 16
            if (durationOffset + (version === 1 ? 8 : 4) > buffer.byteLength) return 0
            const timescale = readU32(view, timescaleOffset)
            const duration = version === 1 ? readU64(view, durationOffset) : readU32(view, durationOffset)
            return timescale > 0 ? duration / timescale : 0
        }
        offset += size
    }
    return 0
}

export const probeMp4DurationFromFile = async (file: File) => {
    try {
        let offset = 0
        while (offset + 8 <= file.size) {
            const headerBuffer = await file.slice(offset, Math.min(offset + 16, file.size)).arrayBuffer()
            if (headerBuffer.byteLength < 8) break
            const header = new DataView(headerBuffer)
            let size = readU32(header, 0)
            const type = readBoxType(header, 0)
            let headerSize = 8
            if (size === 1) {
                if (headerBuffer.byteLength < 16) break
                size = readU64(header, 8)
                headerSize = 16
            } else if (size === 0) {
                size = file.size - offset
            }
            if (size < headerSize) break

            if (type === 'moov') {
                const contentSize = Math.min(size - headerSize, 512 * 1024)
                const content = await file.slice(offset + headerSize, offset + headerSize + contentSize).arrayBuffer()
                const duration = findMovieHeaderDuration(content)
                return Number.isFinite(duration) && duration > 0 ? duration : 0
            }
            offset += size
        }
    } catch {
        return 0
    }
    return 0
}

export const probeDurationFromUrl = (url: string, timeoutMs = 8000) =>
    new Promise<number>(resolve => {
        const video = document.createElement('video')
        let settled = false
        const finish = (duration: number) => {
            if (settled) return
            settled = true
            video.removeAttribute('src')
            video.load()
            resolve(Number.isFinite(duration) ? duration : 0)
        }
        video.preload = 'metadata'
        video.addEventListener('loadedmetadata', () => finish(video.duration), {once: true})
        video.addEventListener('error', () => finish(0), {once: true})
        video.src = url
        window.setTimeout(() => finish(0), timeoutMs)
    })
