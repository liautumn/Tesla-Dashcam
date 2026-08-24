export const parseClipTime = (value?: string) => {
    if (!value || value.length < 19) return undefined
    const parsed = new Date(
        Number(value.slice(0, 4)),
        Number(value.slice(5, 7)) - 1,
        Number(value.slice(8, 10)),
        Number(value.slice(11, 13)),
        Number(value.slice(14, 16)),
        Number(value.slice(17, 19)),
    )
    return Number.isNaN(parsed.valueOf()) ? undefined : parsed
}

export const formatClipTime = (value: string, locale: string) => {
    const date = parseClipTime(value)
    if (!date) return value
    return new Intl.DateTimeFormat(locale, {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).format(date)
}

export const clipDateKey = (value: string) => value.slice(0, 10)
