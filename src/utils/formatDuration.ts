export const formatDuration = (seconds: number) => {
    const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
    const hours = Math.floor(value / 3600)
    const minutes = Math.floor((value % 3600) / 60)
    const remaining = value % 60
    const minuteText = hours ? String(minutes).padStart(2, '0') : String(minutes)
    const secondText = String(remaining).padStart(2, '0')
    return hours ? `${hours}:${minuteText}:${secondText}` : `${minuteText}:${secondText}`
}
