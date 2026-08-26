import type {SEIDataPoint} from '../types/tesla'

export const formatTelemetryOverlay = (
    sample: Pick<SEIDataPoint,
        'speedKph' | 'gear' | 'apStatus' | 'throttlePct' | 'brakePct' | 'blinkerLeft' | 'blinkerRight'>,
    locale: 'zh-CN' | 'en' = 'en',
) => {
    const signals = `${sample.blinkerLeft ? '<' : ''}${sample.blinkerRight ? '>' : ''}`
    const speed = Math.round(sample.speedKph)
    const throttle = Math.round(Math.max(0, Math.min(100, sample.throttlePct)))
    const brake = Math.round(Math.max(0, Math.min(100, sample.brakePct)))
    return locale === 'zh-CN'
        ? `速度 ${speed} km/h | 档位 ${sample.gear} | 模式 ${sample.apStatus} | 油门 ${throttle}% | 刹车 ${brake}% | 转向灯 ${signals || '--'}`
        : `Speed ${speed} km/h | Gear ${sample.gear} | Mode ${sample.apStatus} | Throttle ${throttle}% | Brake ${brake}% | Signals ${signals || '--'}`
}

export const sampleTelemetry = (series: SEIDataPoint[], target: number) => {
    if (!series.length) return null
    let low = 0
    let high = series.length - 1
    while (low < high) {
        const middle = (low + high + 1) >> 1
        if (series[middle].offsetSeconds <= target) low = middle
        else high = middle - 1
    }
    const sample = series[low]
    if (!sample || sample.offsetSeconds > target + 0.5) return null
    const age = target - sample.offsetSeconds
    if (age <= 2) return sample
    return {
        ...sample,
        offsetSeconds: target,
        speedKph: sample.gear === 'P' || age > 5 ? 0 : sample.speedKph,
        throttlePct: age > 5 ? 0 : sample.throttlePct,
        brakePct: age > 5 ? 0 : sample.brakePct,
    }
}

export const buildTelemetryWindows = (
    series: SEIDataPoint[],
    start: number,
    duration: number,
    locale: 'zh-CN' | 'en' = 'en',
) => {
    const windows: {start: number; end: number; text: string}[] = []
    const step = Math.max(1, duration / 240)
    for (let offset = 0; offset < duration; offset += step) {
        const sample = sampleTelemetry(series, start + offset)
        if (!sample) continue
        const text = formatTelemetryOverlay(sample, locale)
        const end = Math.min(duration, offset + step)
        const previous = windows.at(-1)
        if (previous?.text === text) previous.end = end
        else windows.push({start: offset, end, text})
    }
    return windows
}
