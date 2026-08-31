import {defineStore} from 'pinia'
import {ref, watch} from 'vue'
import type {ComposeViewType} from '../../shared/types'

export type AppSettings = {
    autoAdvance: boolean
    autoSeekEvent: boolean
    sentryCameraFocus: boolean
    preferredView: ComposeViewType | null
}

export type ExportSettings = {
    showTime: boolean
    showLocation: boolean
    showDriveData: boolean
    hwAccel: boolean
    videoMaxWidth: 1920 | 2880 | 3840
}

const appKey = 'tesla-cam-app-settings'
const exportKey = 'tesla-cam-export-settings'

const viewTypes: readonly ComposeViewType[] = [
    'grid6',
    'grid4',
    'grid4old',
    'front',
    'back',
    'left',
    'right',
    'left_pillar',
    'right_pillar',
]

const asRecord = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {}

const storedBoolean = (value: unknown, fallback: boolean) =>
    typeof value === 'boolean' ? value : fallback

const readStoredValue = (key: string): unknown => {
    try {
        return JSON.parse(localStorage.getItem(key) ?? '{}')
    } catch {
        return {}
    }
}

export const normalizeAppSettings = (value: unknown): AppSettings => {
    const stored = asRecord(value)
    const preferred = stored.preferredView ?? stored.preferredLayout
    const preferredView = typeof preferred === 'string' && viewTypes.includes(preferred as ComposeViewType)
        ? preferred as ComposeViewType
        : null
    return {
        autoAdvance: storedBoolean(stored.autoAdvance, true),
        autoSeekEvent: storedBoolean(stored.autoSeekEvent, true),
        sentryCameraFocus: storedBoolean(stored.sentryCameraFocus, true),
        preferredView,
    }
}

export const normalizeExportSettings = (value: unknown): ExportSettings => {
    const stored = asRecord(value)
    const videoMaxWidth = [1920, 2880, 3840].includes(Number(stored.videoMaxWidth))
        ? Number(stored.videoMaxWidth) as ExportSettings['videoMaxWidth']
        : 3840
    return {
        showTime: storedBoolean(stored.showTime, true),
        showLocation: storedBoolean(stored.showLocation, true),
        showDriveData: storedBoolean(stored.showDriveData, true),
        hwAccel: storedBoolean(stored.hwAccel, true),
        videoMaxWidth,
    }
}

export const useSettingsStore = defineStore('settings', () => {
    const app = ref(normalizeAppSettings(readStoredValue(appKey)))
    const exportOptions = ref(normalizeExportSettings(readStoredValue(exportKey)))

    watch(app, value => localStorage.setItem(appKey, JSON.stringify(value)), {deep: true})
    watch(exportOptions, value => localStorage.setItem(exportKey, JSON.stringify(value)), {deep: true})

    return {app, exportOptions}
})
