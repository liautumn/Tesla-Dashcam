<script setup lang="ts">
import {storeToRefs} from 'pinia'
import {
    computed,
    nextTick,
    onBeforeUnmount,
    onMounted,
    ref,
    shallowReactive,
    shallowRef,
    watch,
} from 'vue'
import {ElDialog, ElMessage} from 'element-plus'
import {
    CameraOff, ChevronLeft, ChevronRight, Download, FileSpreadsheet, Flag,
    ImageDown, MapPinned, Pause, PictureInPicture2, Play, RotateCcw,
    Trash2, Volume2, VolumeX, X,
} from 'lucide-vue-next'
import {useI18n} from 'vue-i18n'
import type {
    CamName,
    ComposeExportRequest,
    ComposeLayout,
    ComposeViewType,
    TrashClipResult,
} from '../../shared/types'
import {parseTeslaVideoName} from '../../shared/teslaCamera'
import {useLocaleStore} from '../stores/locale'
import {useSettingsStore} from '../stores/settings'
import type {CamClip, CamFootage} from '../types/tesla'
import {cameraNames} from '../types/tesla'
import {formatDuration} from '../utils/formatDuration'
import {calcEventSeconds, genAmapUrl} from '../utils/event'
import {
    resolveExportCanvasSize,
    resolveOverlayBarLayout,
    selectSegmentsInRange,
} from '../utils/exportLayout'
import {calcSeekInfo, extractFootageSEI} from '../utils/genFootage'
import {parseClipTime} from '../utils/clipTime'
import {detectHardBraking} from '../utils/detectIncidents'
import {buildTelemetryWindows, formatTelemetryOverlay, sampleTelemetry} from '../utils/telemetry'
import TelemetryDashboard from './TelemetryDashboard.vue'
import TrackMap from './TrackMap.vue'
import 'element-plus/theme-chalk/el-dialog.css'
import 'element-plus/theme-chalk/el-message.css'

const props = defineProps<{
    clip: CamClip
    footage: CamFootage
    deleteClip?: (clip: CamClip) => Promise<TrashClipResult | undefined>
}>()

const emit = defineEmits<{previous: []; next: []; ended: []}>()
const {t} = useI18n()
const localeStore = useLocaleStore()
const settingsStore = useSettingsStore()
const {locale} = storeToRefs(localeStore)
const {app: appSettings, exportOptions} = storeToRefs(settingsStore)

const rates = [0.25, 0.5, 1, 1.5, 2]
const videoElements = shallowReactive(new Map<CamName, HTMLVideoElement>())
const cameraTimes = new Map<CamName, number>()
const endedCameras = new Set<CamName>()
const currentIndex = ref(0)
const playhead = ref(0)
const seekSeconds = ref(0)
const playing = ref(true)
const muted = ref(true)
const playbackRate = ref(1)
const view = ref<ComposeViewType>('grid4')
const exportIn = ref<number>()
const exportOut = ref<number>()
const exporting = ref(false)
const exportProgress = ref(0)
const exportEta = ref('')
const exportFrameCount = ref(0)
const exportTotalFrames = ref(0)
const exportEncoding = ref(false)
const exportMode = ref<'compose' | 'frames'>('compose')
const timelineHover = ref<number>()
const deleting = ref(false)
const seiSeries = shallowRef(props.footage.seiData ?? [])
const seiLoading = ref(false)
let loadSeiGeneration = 0
let activeExportSession = ''
let exportStartedAt = 0
let cancelRequested = false
let lastDriftCorrection = 0
let endedEmitted = false

const currentSegment = computed(() => props.footage.segments[currentIndex.value])
const hasPillarCameras = computed(() => props.footage.segments.some(segment => segment.left_pillar || segment.right_pillar))
const sourceFor = (camera: CamName) => currentSegment.value?.[camera]
const activeCameras = computed(() => cameraNames.filter(camera => Boolean(sourceFor(camera))))
const labels = computed<Record<CamName, string>>(() => ({
    front: t('camera.front'),
    back: t('camera.back'),
    left: t('camera.left'),
    right: t('camera.right'),
    left_pillar: t('camera.left_pillar'),
    right_pillar: t('camera.right_pillar'),
}))
const layoutOptions = computed<{label: string; value: ComposeViewType}[]>(() => {
    const options: {label: string; value: ComposeViewType}[] = [
        {label: t('layout.grid4'), value: 'grid4'},
        {label: t('layout.grid4old'), value: 'grid4old'},
        {label: t('camera.front'), value: 'front'},
        {label: t('camera.back'), value: 'back'},
        {label: t('camera.left'), value: 'left'},
        {label: t('camera.right'), value: 'right'},
    ]
    if (hasPillarCameras.value) {
        options.unshift({label: t('layout.grid6'), value: 'grid6'})
        options.push(
            {label: t('camera.left_pillar'), value: 'left_pillar'},
            {label: t('camera.right_pillar'), value: 'right_pillar'},
        )
    }
    return options
})
const visibleCamera = (camera: CamName) => {
    if (view.value === 'grid6') return true
    if (view.value === 'grid4' || view.value === 'grid4old') return !camera.endsWith('_pillar')
    return view.value === camera
}
const locationText = computed(() =>
    [props.clip.event?.city, props.clip.event?.street].filter(Boolean).join(' ') || t('viewer.noLocation'),
)
const amapUrl = computed(() => genAmapUrl(props.clip))
const eventSeconds = computed(() => calcEventSeconds(props.clip, props.footage))
const currentTelemetry = computed(() => sampleTelemetry(seiSeries.value, playhead.value))
const incidentMarks = computed(() => detectHardBraking(seiSeries.value))
const currentDate = computed(() => {
    const date = parseClipTime(currentSegment.value?.name)
    return date ? new Date(date.getTime() + seekSeconds.value * 1000) : undefined
})
const dateText = computed(() => currentDate.value
    ? new Intl.DateTimeFormat(locale.value, {year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'}).format(currentDate.value)
    : props.clip.name.slice(0, 10),
)
const timeText = computed(() => currentDate.value
    ? new Intl.DateTimeFormat(locale.value, {hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false}).format(currentDate.value)
    : '--:--:--',
)
const exportWeekdays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const padExportNumber = (value: number) => String(value).padStart(2, '0')
const formatExportTimestamp = (date?: Date) => date
    ? `${date.getFullYear()}/${padExportNumber(date.getMonth() + 1)}/${padExportNumber(date.getDate())} ${exportWeekdays[date.getDay()]} ${padExportNumber(date.getHours())}:${padExportNumber(date.getMinutes())}:${padExportNumber(date.getSeconds())}`
    : `${props.clip.name.slice(0, 10)} --:--:--`
const resolveExportLocationText = (seconds: number) => {
    const label = [props.clip.event?.city, props.clip.event?.street].filter(Boolean).join(' ')
    if (label) return label
    const data = sampleTelemetry(seiSeries.value, seconds)
    if (data?.latitude !== null && data?.latitude !== undefined
        && data.longitude !== null && data.longitude !== undefined) {
        return `${data.latitude.toFixed(5)}, ${data.longitude.toFixed(5)}`
    }
    return 'Location unavailable'
}
const exportSelectionSeconds = computed(() =>
    exportIn.value !== undefined && exportOut.value !== undefined && exportOut.value > exportIn.value
        ? exportOut.value - exportIn.value
        : 0,
)
const exportableSeconds = computed(() => Math.min(
    600,
    exportSelectionSeconds.value || Math.max(0, props.footage.duration - playhead.value),
))
const speedPath = computed(() => {
    if (!seiSeries.value.length || props.footage.duration <= 0) return ''
    const data = seiSeries.value
    const step = Math.max(1, Math.floor(data.length / 220))
    const sampled = data.filter((_, index) => index % step === 0)
    const maxSpeed = Math.max(1, ...sampled.map(point => point.speedKph))
    return sampled.map((point, index) => {
        const x = point.offsetSeconds / props.footage.duration * 1000
        const y = 30 - point.speedKph / maxSpeed * 27
        return `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
})

const setVideoRef = (camera: CamName, value: unknown) => {
    if (value instanceof HTMLVideoElement) videoElements.set(camera, value)
    else videoElements.delete(camera)
}
const configureVideos = () => videoElements.forEach((video, camera) => {
    video.playbackRate = playbackRate.value
    video.muted = muted.value || camera !== 'front'
})
const playVideos = async () => {
    configureVideos()
    await Promise.allSettled(activeCameras.value.map(camera => videoElements.get(camera)?.play()))
}
const pauseVideos = () => videoElements.forEach(video => video.pause())
const togglePlayback = async () => {
    if (!activeCameras.value.length) return
    if (!playing.value && playhead.value >= props.footage.duration - 0.01) await applySeek(0)
    playing.value = !playing.value
    if (playing.value) await playVideos()
    else pauseVideos()
}
const seekVideo = (video: HTMLVideoElement, seconds: number) => {
    const apply = () => {
        const duration = Number.isFinite(video.duration) ? video.duration : seconds
        video.currentTime = Math.min(Math.max(seconds, 0), duration)
    }
    if (video.readyState >= 1) apply()
    else video.addEventListener('loadedmetadata', apply, {once: true})
}
const applySeek = async (seconds: number) => {
    const info = calcSeekInfo(props.footage, seconds)
    if (!info) return
    playhead.value = Math.min(Math.max(seconds, 0), props.footage.duration)
    seekSeconds.value = info.seconds
    cameraTimes.clear()
    endedCameras.clear()
    endedEmitted = false
    if (currentIndex.value !== info.index) {
        currentIndex.value = info.index
        await nextTick()
    }
    activeCameras.value.forEach(camera => {
        cameraTimes.set(camera, info.seconds)
        const video = videoElements.get(camera)
        if (video) seekVideo(video, info.seconds)
    })
    if (playing.value) await playVideos()
}
const seekBy = (seconds: number) => void applySeek(playhead.value + seconds)
const onLoadedMetadata = (camera: CamName) => {
    const video = videoElements.get(camera)
    if (!video) return
    configureVideos()
    seekVideo(video, seekSeconds.value)
    if (playing.value) void video.play().catch(() => undefined)
}
const onTimeUpdate = (camera: CamName) => {
    const video = videoElements.get(camera)
    if (!video || !currentSegment.value) return
    cameraTimes.set(camera, video.currentTime)
    const times = [...cameraTimes.values()]
    const segmentTime = times.length ? Math.max(...times) : video.currentTime
    seekSeconds.value = segmentTime
    playhead.value = Math.min(currentSegment.value.startSeconds + segmentTime, props.footage.duration)
    const now = performance.now()
    if (playing.value && now - lastDriftCorrection > 1000) {
        lastDriftCorrection = now
        activeCameras.value.forEach(item => {
            const peer = videoElements.get(item)
            if (peer && Math.abs(peer.currentTime - segmentTime) > 0.35) peer.currentTime = segmentTime
        })
    }
}
const advanceSegment = async () => {
    if (currentIndex.value >= props.footage.segments.length - 1) {
        playing.value = false
        playhead.value = props.footage.duration
        pauseVideos()
        if (!endedEmitted) {
            endedEmitted = true
            emit('ended')
        }
        return
    }
    currentIndex.value += 1
    seekSeconds.value = 0
    playhead.value = currentSegment.value?.startSeconds ?? playhead.value
    cameraTimes.clear()
    endedCameras.clear()
    await nextTick()
    if (playing.value) await playVideos()
}
const onEnded = (camera: CamName) => {
    endedCameras.add(camera)
    if (activeCameras.value.every(item => endedCameras.has(item))) void advanceSegment()
}
const changeView = (next: ComposeViewType) => {
    view.value = next
    appSettings.value.preferredView = next
    configureVideos()
}
const focusCamera = (camera: CamName) => changeView(
    view.value === camera ? (hasPillarCameras.value ? 'grid6' : 'grid4') : camera,
)
const togglePictureInPicture = async () => {
    const video = videoElements.get('front')
    if (!video || !document.pictureInPictureEnabled) return
    try {
        if (document.pictureInPictureElement) await document.exitPictureInPicture()
        else await video.requestPictureInPicture()
    } catch (error) {
        ElMessage.error(String(error))
    }
}
const markExportIn = () => { exportIn.value = playhead.value }
const markExportOut = () => { exportOut.value = playhead.value }
const clearExportRange = () => {
    exportIn.value = undefined
    exportOut.value = undefined
}
const pointPercent = (seconds?: number) => seconds === undefined || !props.footage.duration
    ? undefined
    : Math.max(0, Math.min(100, seconds / props.footage.duration * 100))
const updateTimelineHover = (event: PointerEvent) => {
    const rect = (event.currentTarget as HTMLInputElement).getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    timelineHover.value = ratio * props.footage.duration
}

const videoRects = (width: number, height: number, currentView = view.value) => {
    if (currentView === 'grid6') {
        const w = width / 3
        const h = height / 2
        return (['left', 'front', 'right', 'left_pillar', 'back', 'right_pillar'] as CamName[])
            .map((camera, index) => ({camera, x: index % 3 * w, y: Math.floor(index / 3) * h, width: w, height: h}))
    }
    if (currentView === 'grid4') {
        const w = width / 2
        const h = height / 2
        return (['front', 'back', 'left', 'right'] as CamName[])
            .map((camera, index) => ({camera, x: index % 2 * w, y: Math.floor(index / 2) * h, width: w, height: h}))
    }
    if (currentView === 'grid4old') {
        const top = height * .6
        return [
            {camera: 'front' as CamName, x: 0, y: 0, width, height: top},
            ...(['left', 'back', 'right'] as CamName[]).map((camera, index) => ({
                camera, x: index * width / 3, y: top, width: width / 3, height: height - top,
            })),
        ]
    }
    return [{camera: currentView as CamName, x: 0, y: 0, width, height}]
}
const resolveCanvas = (maxWidth = 3840) => {
    const source = [...videoElements.values()].find(video => video.videoWidth > 0)
    return resolveExportCanvasSize({
        viewType: view.value,
        sourceWidth: source?.videoWidth || 1280,
        sourceHeight: source?.videoHeight || 720,
        maxWidth,
    })
}
const drawCurrentView = (context: CanvasRenderingContext2D, width: number, height: number, videoHeight: number) => {
    context.fillStyle = '#000'
    context.fillRect(0, 0, width, height)
    for (const rect of videoRects(width, videoHeight)) {
        const video = videoElements.get(rect.camera)
        context.fillStyle = '#050505'
        context.fillRect(rect.x, rect.y, rect.width, rect.height)
        if (video && video.readyState >= 2 && video.videoWidth > 0) {
            const scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight)
            const drawWidth = video.videoWidth * scale
            const drawHeight = video.videoHeight * scale
            context.drawImage(
                video,
                rect.x + (rect.width - drawWidth) / 2,
                rect.y + (rect.height - drawHeight) / 2,
                drawWidth,
                drawHeight,
            )
        }
    }
    const scale = width / 1280
    const bar = resolveOverlayBarLayout(scale)
    const y = videoHeight
    if (exportOptions.value.showDriveData && currentTelemetry.value) {
        const data = currentTelemetry.value
        const topBarHeight = Math.round(50 * scale)
        const pad = Math.round(24 * scale)
        context.fillStyle = '#00000099'
        context.fillRect(0, 0, width, topBarHeight)
        context.textBaseline = 'middle'
        context.font = `700 ${Math.max(16, Math.round(22 * scale))}px sans-serif`
        context.fillStyle = data.gear === 'D' ? '#22c55e' : data.gear === 'R' ? '#ef4444' : '#a3a3a3'
        context.fillText(data.gear, pad, topBarHeight / 2)
        const speedText = `${Math.round(data.speedKph)}`
        context.font = `700 ${Math.max(24, Math.round(36 * scale))}px sans-serif`
        context.fillStyle = data.speedKph > 120 ? '#ef4444' : data.speedKph > 80 ? '#eab308' : '#22c55e'
        const speedWidth = context.measureText(speedText).width
        context.fillText(speedText, (width - speedWidth) / 2, topBarHeight / 2)
        context.font = `500 ${Math.max(10, Math.round(12 * scale))}px sans-serif`
        context.fillStyle = '#8a9090'
        context.fillText('km/h', (width + speedWidth) / 2 + Math.round(10 * scale), topBarHeight / 2)
        const modeText = data.apStatus === 'OFF' ? 'MANUAL' : data.apStatus
        context.font = `600 ${Math.max(10, Math.round(12 * scale))}px sans-serif`
        context.fillStyle = data.apStatus === 'FSD' ? '#a78bfa' : data.apStatus === 'AP' ? '#60a5fa' : '#a3a3a3'
        context.fillText(modeText, width - pad - context.measureText(modeText).width, topBarHeight / 2)
    }
    const gradient = context.createLinearGradient(0, y, 0, height)
    gradient.addColorStop(0, '#111111')
    gradient.addColorStop(1, '#090909')
    context.fillStyle = gradient
    context.fillRect(0, y, width, height - y)
    context.fillStyle = '#ffffff1a'
    context.fillRect(0, y, width, 1)
    context.textBaseline = 'top'
    const hPad = Math.round(22 * scale)
    const leftTextX = hPad
    if (exportOptions.value.showTime) {
        context.fillStyle = '#fb7185'
        context.font = `${bar.brandSize}px sans-serif`
        context.fillText('TESLA DASHCAM', leftTextX, y + bar.padding)
        context.fillStyle = '#fafafa'
        context.font = `600 ${bar.titleSize}px sans-serif`
        context.fillText(formatExportTimestamp(currentDate.value), leftTextX, y + bar.padding + bar.brandSize + bar.gap)
    }
    const right: string[] = []
    if (exportOptions.value.showDriveData && currentTelemetry.value) {
        right.push(formatTelemetryOverlay(currentTelemetry.value))
    }
    if (exportOptions.value.showLocation) {
        const location = resolveExportLocationText(playhead.value)
        context.fillStyle = '#ef4444'
        context.font = `${bar.subSize}px sans-serif`
        context.textAlign = 'right'
        context.fillText(`| ${location}`, width - hPad, y + (right.length ? bar.padding : (bar.barHeight - bar.subSize) / 2))
        context.fillStyle = '#d4d4d8'
        context.fillText(location, width - hPad, y + (right.length ? bar.padding : (bar.barHeight - bar.subSize) / 2))
    }
    if (right.length) {
        context.fillStyle = '#22c55e'
        context.font = `${bar.subSize}px sans-serif`
        context.textAlign = 'right'
        context.fillText(right.join('   '), width - hPad, y + bar.barHeight - bar.subSize - bar.padding)
    }
    context.textAlign = 'left'
}
const exportScreenshot = async () => {
    try {
        const files = window.files
        if (!files) throw new Error(t('toast.desktopOnly'))
        const size = resolveCanvas()
        const canvas = document.createElement('canvas')
        canvas.width = size.width
        canvas.height = size.height
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Canvas is unavailable')
        drawCurrentView(context, size.width, size.height, size.videoHeight)
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', .92))
        if (!blob) throw new Error('Image encoding failed')
        const saved = await files.save(`${props.clip.name}-${view.value}.jpg`, await blob.arrayBuffer())
        if (saved) {
            await files.showItemInFolder(saved)
            ElMessage.success(t('toast.screenshotSaved'))
        }
    } catch (error) {
        ElMessage.error(t('toast.screenshotFailed', {error: String(error)}))
    }
}
const exportCsv = async () => {
    if (!seiSeries.value.length) {
        ElMessage.warning(t('toast.noMetadata'))
        return
    }
    try {
        const files = window.files
        if (!files) throw new Error(t('toast.desktopOnly'))
        const rows = seiSeries.value.map(point => [
            point.offsetSeconds.toFixed(3), point.seiVersion ?? '', point.frameSequence ?? '',
            point.autopilotState ?? '', point.speedKph.toFixed(2), point.gear,
            point.steeringAngleDeg.toFixed(2), point.brakePct.toFixed(0),
            point.throttlePct.toFixed(2), point.apStatus,
            point.latitude?.toFixed(8) ?? '', point.longitude?.toFixed(8) ?? '',
            point.blinkerLeft ? 1 : 0, point.blinkerRight ? 1 : 0,
            point.headingDeg?.toFixed(2) ?? '', point.accelerationX.toFixed(4),
            point.accelerationY.toFixed(4), point.accelerationZ.toFixed(4),
        ].join(','))
        const csv = `\ufeffoffset_s,sei_version,frame_sequence,autopilot_state_raw,speed_kph,gear,steering_deg,brake_pct,throttle_pct,ap_status,latitude,longitude,blinker_left,blinker_right,heading_deg,accel_x,accel_y,accel_z\n${rows.join('\n')}`
        const saved = await files.save(`${props.clip.name}-metadata.csv`, new TextEncoder().encode(csv).buffer)
        if (saved) {
            await files.showItemInFolder(saved)
            ElMessage.success(t('toast.csvExported'))
        }
    } catch (error) {
        ElMessage.error(t('toast.csvFailed', {error: String(error)}))
    }
}
const buildComposeSegments = (start: number, duration: number) => {
    const files = new Map<string, Partial<Record<CamName, string>>>()
    for (const file of props.clip.videos) {
        const parsed = parseTeslaVideoName(file.name)
        if (!parsed) continue
        const sourcePath = window.files?.getPathForFile(file)
        if (!sourcePath) continue
        const paths = files.get(parsed.segmentName) ?? {}
        paths[parsed.camera] = sourcePath
        files.set(parsed.segmentName, paths)
    }
    return selectSegmentsInRange(props.footage.segments, start, duration).map(segment => ({
        name: segment.name,
        startSeconds: segment.startSeconds,
        duration: segment.duration,
        paths: files.get(segment.name) ?? {},
    }))
}
const buildComposeLayout = (): ComposeLayout => {
    const size = resolveCanvas(exportOptions.value.videoMaxWidth)
    const bar = resolveOverlayBarLayout(size.scale)
    const hPad = Math.round(22 * size.scale)
    return {...size, ...bar, hPad, leftTextX: hPad}
}
const buildTimeWindows = (start: number, duration: number) => Array.from(
    {length: Math.ceil(duration)},
    (_, index) => {
        const info = calcSeekInfo(props.footage, start + index)
        const segment = info ? props.footage.segments[info.index] : undefined
        const base = parseClipTime(segment?.name)
        const date = base && info ? new Date(base.getTime() + info.seconds * 1000) : undefined
        return {
            start: index,
            end: Math.min(duration, index + 1),
            text: formatExportTimestamp(date),
        }
    },
)
const waitForVideoFrame = async (video: HTMLVideoElement) => {
    if (video.seeking || video.readyState < 2) {
        await new Promise<void>((resolve, reject) => {
            let settled = false
            let timer = 0
            const cleanup = () => {
                window.clearTimeout(timer)
                video.removeEventListener('seeked', finish)
                video.removeEventListener('loadeddata', finish)
                video.removeEventListener('error', fail)
            }
            const finish = () => {
                if (settled) return
                settled = true
                cleanup()
                resolve()
            }
            const fail = () => {
                if (settled) return
                settled = true
                cleanup()
                reject(new Error('Unable to seek a camera frame'))
            }
            timer = window.setTimeout(fail, 5000)
            video.addEventListener('seeked', finish, {once: true})
            video.addEventListener('loadeddata', finish, {once: true})
            video.addEventListener('error', fail, {once: true})
        })
    }
}

const seekExportFrame = async (seconds: number) => {
    await applySeek(seconds)
    await nextTick()
    await Promise.all(activeCameras.value.map(camera => {
        const video = videoElements.get(camera)
        return video ? waitForVideoFrame(video) : Promise.resolve()
    }))
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

const formatEta = (seconds: number) => seconds > 60
    ? `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
    : `${Math.round(Math.max(0, seconds))}s`

const runFrameExport = async (start: number, requestedDuration: number, fileName: string) => {
    const frameExport = window.frameExport
    if (!frameExport) throw new Error(t('toast.desktopOnly'))
    const duration = Math.min(60, requestedDuration)
    if (requestedDuration > duration) ElMessage.warning(t('toast.fallbackLimit'))
    const fps = 30
    const totalFrames = Math.ceil(duration * fps)
    const size = resolveCanvas(exportOptions.value.videoMaxWidth)
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext('2d', {willReadFrequently: true})
    if (!context) throw new Error('Canvas is unavailable')

    activeExportSession = `frames-${Date.now()}`
    exportMode.value = 'frames'
    exportFrameCount.value = 0
    exportTotalFrames.value = totalFrames
    exportEncoding.value = false
    exportStartedAt = performance.now()
    await seekExportFrame(start)
    if (cancelRequested) return {ok: false, canceled: true}

    const started = await frameExport.start({
        sessionId: activeExportSession,
        fileName,
        width: size.width,
        height: size.height,
        fps,
    })
    if (!started.ok) return started
    if (cancelRequested) {
        frameExport.cancel(activeExportSession)
        return {ok: false, canceled: true}
    }

    for (let frame = 0; frame < totalFrames; frame += 1) {
        if (cancelRequested) {
            frameExport.cancel(activeExportSession)
            return {ok: false, canceled: true}
        }
        if (frame > 0) await seekExportFrame(Math.min(props.footage.duration, start + frame / fps))
        drawCurrentView(context, size.width, size.height, size.videoHeight)
        const rgba = new Uint8Array(context.getImageData(0, 0, size.width, size.height).data)
        const written = await frameExport.write(activeExportSession, rgba)
        if (!written.ok) throw new Error(written.error || 'Failed to write video frame')

        const completed = frame + 1
        if (completed === totalFrames || completed % 3 === 0) {
            exportFrameCount.value = completed
            exportProgress.value = completed / totalFrames * 100
            const elapsed = (performance.now() - exportStartedAt) / 1000
            if (completed > 5 && elapsed > 0) {
                exportEta.value = formatEta((totalFrames - completed) / (completed / elapsed))
            }
        }
        if (completed % 6 === 0) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    }

    exportEncoding.value = true
    exportEta.value = ''
    return frameExport.finish(activeExportSession)
}

const exportVideo = async () => {
    const files = window.files
    const composeExport = window.composeExport
    const frameExport = window.frameExport
    if (!files || !composeExport || !frameExport) {
        ElMessage.error(t('toast.desktopOnly'))
        return
    }
    if (!exportableSeconds.value || exporting.value) {
        if (!exportableSeconds.value) ElMessage.warning(t('toast.noContent'))
        return
    }

    const start = exportSelectionSeconds.value && exportIn.value !== undefined ? exportIn.value : playhead.value
    const duration = exportableSeconds.value
    const fileName = `${props.clip.name}-${view.value}.mp4`
    cancelRequested = false
    exporting.value = true
    exportProgress.value = 0
    exportEta.value = ''
    exportFrameCount.value = 0
    exportTotalFrames.value = 0
    exportEncoding.value = false
    exportMode.value = 'compose'
    playing.value = false
    pauseVideos()

    try {
        let result: Awaited<ReturnType<typeof composeExport.start>> | undefined
        let composeError = ''
        let canCompose = true
        try {
            canCompose = props.clip.videos.every(file => Boolean(files.getPathForFile(file)))
        } catch {
            canCompose = false
        }

        if (canCompose) {
            activeExportSession = `compose-${Date.now()}`
            exportStartedAt = performance.now()
            let unsubscribe: (() => void) | undefined
            try {
                unsubscribe = composeExport.onProgress(event => {
                    if (event.sessionId !== activeExportSession) return
                    exportProgress.value = event.progress
                    exportFrameCount.value = Math.round(event.outTimeSec * 30)
                    const elapsed = (performance.now() - exportStartedAt) / 1000
                    if (event.outTimeSec > .5 && elapsed > 0) {
                        const rate = event.outTimeSec / elapsed
                        exportEta.value = formatEta((duration - event.outTimeSec) / rate)
                    }
                })
                const startInfo = calcSeekInfo(props.footage, start)
                const startBase = startInfo ? parseClipTime(props.footage.segments[startInfo.index]?.name) : undefined
                const startDate = startBase && startInfo ? new Date(startBase.getTime() + startInfo.seconds * 1000) : undefined
                const request: ComposeExportRequest = {
                    sessionId: activeExportSession,
                    fileName,
                    viewType: view.value,
                    startSeconds: start,
                    durationSeconds: duration,
                    segments: buildComposeSegments(start, duration),
                    layout: buildComposeLayout(),
                    overlay: {
                        showTime: exportOptions.value.showTime,
                        showLocation: exportOptions.value.showLocation,
                        showDriveData: exportOptions.value.showDriveData,
                        locationText: resolveExportLocationText(start),
                        baseTimestampLabel: formatExportTimestamp(startDate),
                        baseTimestampEpoch: startDate ? Math.round(startDate.getTime() / 1000) : undefined,
                        brandText: 'TESLA DASHCAM',
                        timeWindows: exportOptions.value.showTime ? buildTimeWindows(start, duration) : undefined,
                        driveWindows: exportOptions.value.showDriveData
                            ? buildTelemetryWindows(seiSeries.value, start, duration)
                            : undefined,
                    },
                    useHardware: exportOptions.value.hwAccel,
                }
                result = await composeExport.start(request)
            } catch (error) {
                composeError = error instanceof Error ? error.message : String(error)
            } finally {
                unsubscribe?.()
            }
            if (result?.canceled || cancelRequested) return
            if (result?.ok && result.filePath) {
                await files.showItemInFolder(result.filePath)
                ElMessage.success(t('toast.videoSaved'))
                return
            }
            composeError = result?.error || composeError
        }

        const fallback = await runFrameExport(start, duration, fileName)
        if (fallback.ok && fallback.filePath) {
            await files.showItemInFolder(fallback.filePath)
            ElMessage.success(t('toast.videoSaved'))
        } else if (!fallback.canceled) {
            throw new Error(fallback.error || composeError || 'Unknown export error')
        }
    } catch (error) {
        if (!cancelRequested) ElMessage.error(t('toast.exportError', {error: error instanceof Error ? error.message : String(error)}))
        if (activeExportSession) frameExport.cancel(activeExportSession)
    } finally {
        exporting.value = false
        exportProgress.value = 0
        exportEta.value = ''
        exportEncoding.value = false
        activeExportSession = ''
    }
}
const cancelExport = () => {
    cancelRequested = true
    if (!activeExportSession) return
    window.composeExport?.cancel(activeExportSession)
    window.frameExport?.cancel(activeExportSession)
}
const requestDelete = async () => {
    if (!props.deleteClip || deleting.value || exporting.value) return
    deleting.value = true
    try {
        const result = await props.deleteClip(props.clip)
        if (result && !result.ok && !result.canceled) {
            const message = result.code === 'source-paths-unavailable'
                ? t('toast.sourcePathsUnavailable')
                : result.code === 'files-changed'
                    ? t('toast.filesChanged')
                    : result.code === 'trash-unavailable'
                        ? t('toast.trashUnavailable')
                        : result.error || t('toast.deleteFailed')
            ElMessage.error(message)
        }
    } finally {
        deleting.value = false
    }
}
const resetForClip = async () => {
    if (exporting.value) cancelExport()
    pauseVideos()
    currentIndex.value = 0
    playhead.value = 0
    seekSeconds.value = 0
    playing.value = true
    exportIn.value = undefined
    exportOut.value = undefined
    cameraTimes.clear()
    endedCameras.clear()
    endedEmitted = false
    let preferred = appSettings.value.preferredView ?? (hasPillarCameras.value ? 'grid6' : 'grid4')
    if (!hasPillarCameras.value && (preferred === 'grid6' || preferred.endsWith('_pillar'))) preferred = 'grid4'
    const sentryMap: Record<string, CamName> = {'0': 'front', '3': 'left', '4': 'right', '5': 'back'}
    const sentryCamera = props.clip.type === 'sentry' && appSettings.value.sentryCameraFocus
        ? sentryMap[props.clip.event?.camera ?? '']
        : undefined
    view.value = sentryCamera && props.footage.segments.some(segment => segment[sentryCamera])
        ? sentryCamera
        : preferred
    await nextTick()
    if (appSettings.value.autoSeekEvent && eventSeconds.value !== undefined) await applySeek(eventSeconds.value)
    else await playVideos()
    const generation = ++loadSeiGeneration
    seiSeries.value = props.footage.seiData ?? []
    seiLoading.value = true
    try {
        const data = await extractFootageSEI(props.clip.videos, props.footage)
        if (generation === loadSeiGeneration) seiSeries.value = data ?? []
    } catch (error) {
        console.warn('Unable to read clip telemetry', error)
    } finally {
        if (generation === loadSeiGeneration) seiLoading.value = false
    }
}
const hasVisibleDialog = () => Array.from(document.querySelectorAll<HTMLElement>('.el-dialog'))
    .some(dialog => dialog.getClientRects().length > 0)

const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null
    if (exporting.value || deleting.value || hasVisibleDialog()) return
    if (event.metaKey || event.ctrlKey || event.altKey) return
    if (target?.matches('input, textarea, select, [contenteditable="true"]')) return
    if (event.code === 'Space') {
        event.preventDefault()
        void togglePlayback()
    } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        seekBy(event.shiftKey ? -1 : -5)
    } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        seekBy(event.shiftKey ? 1 : 5)
    } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        emit('previous')
    } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        emit('next')
    } else if (event.code === 'Comma') {
        playing.value = false
        pauseVideos()
        seekBy(-1 / 30)
    } else if (event.code === 'Period') {
        playing.value = false
        pauseVideos()
        seekBy(1 / 30)
    } else if (event.code === 'KeyM') {
        muted.value = !muted.value
    } else if (event.code === 'KeyP') {
        void togglePictureInPicture()
    } else if (event.code === 'KeyF') {
        if (document.fullscreenElement) void document.exitFullscreen()
        else void document.documentElement.requestFullscreen()
    } else if (event.code === 'KeyI') {
        markExportIn()
    } else if (event.code === 'KeyO') {
        markExportOut()
    } else if (event.code === 'Delete') {
        void requestDelete()
    }
}

watch(playbackRate, configureVideos)
watch(muted, configureVideos)
watch(() => props.clip.id, () => void resetForClip(), {immediate: true, flush: 'post'})
onMounted(() => window.addEventListener('keydown', onKeyDown))
onBeforeUnmount(() => {
    loadSeiGeneration += 1
    if (exporting.value) cancelExport()
    pauseVideos()
    window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <section class="viewer">
    <ElDialog v-model="exporting" :close-on-click-modal="false" :close-on-press-escape="false" :show-close="false" width="420px" align-center>
      <div class="export-dialog">
        <strong>{{ t('export.title') }}</strong>
        <div class="export-progress">
          <div class="export-progress__value" :style="{width: `${Math.max(0, Math.min(100, exportProgress))}%`}" />
        </div>
        <div class="export-dialog__stats">
          <strong>{{ Math.round(exportProgress) }}%</strong>
          <span v-if="exportMode === 'frames' && exportTotalFrames">{{ t('export.frames', {current: exportFrameCount, total: exportTotalFrames}) }}</span>
          <span v-else-if="exportFrameCount">{{ t('export.frameEstimate', {current: exportFrameCount}) }}</span>
        </div>
        <span>{{ exportEncoding ? t('export.encoding') : exportMode === 'frames' ? t('export.capturing') : t('export.processing') }}</span>
        <span v-if="exportEta">{{ t('export.eta', {time: exportEta}) }}</span>
        <button @click="cancelExport"><X :size="16" />{{ t('export.cancel') }}</button>
      </div>
    </ElDialog>

    <div class="viewer__toolbar">
      <div class="viewer__clip-meta">
        <strong>{{ clip.name.replace('_', ' ') }}</strong>
        <span>{{ t('viewer.summary', {files: clip.videos.length, segments: footage.segments.length}) }}<template v-if="seiLoading"> · {{ t('viewer.telemetryLoading') }}</template></span>
      </div>
      <div class="viewer__actions">
        <a v-if="amapUrl" :href="amapUrl" target="_blank" rel="noreferrer"><MapPinned :size="16" />{{ t('viewer.amap') }}</a>
        <button :title="t('viewer.pictureInPicture')" @click="togglePictureInPicture"><PictureInPicture2 :size="17" /></button>
        <button @click="exportScreenshot"><ImageDown :size="16" />{{ t('viewer.snapshot') }}</button>
        <button v-if="seiSeries.length" @click="exportCsv"><FileSpreadsheet :size="16" />{{ t('viewer.exportCsv') }}</button>
      </div>
    </div>

    <div class="viewer__stage">
      <div class="video-grid" :class="`video-grid--${view}`">
        <div
          v-for="camera in cameraNames"
          v-show="visibleCamera(camera)"
          :key="camera"
          class="camera"
          :class="`camera--${camera}`"
          @dblclick="focusCamera(camera)"
        >
          <video
            :ref="element => setVideoRef(camera, element)"
            :src="sourceFor(camera)"
            playsinline
            muted
            preload="metadata"
            @click="togglePlayback"
            @ended="onEnded(camera)"
            @loadedmetadata="onLoadedMetadata(camera)"
            @timeupdate="onTimeUpdate(camera)"
          />
          <div v-if="!sourceFor(camera)" class="camera__empty"><CameraOff :size="24" /></div>
          <span v-if="view.startsWith('grid')" class="camera__label">{{ labels[camera] }}</span>
        </div>
      </div>
      <TrackMap :data="seiSeries" :played-seconds="playhead" />
    </div>

    <TelemetryDashboard
      :data="currentTelemetry"
      :has-metadata="Boolean(seiSeries.length)"
      :date-text="dateText"
      :time-text="timeText"
      :location-text="locationText"
    />

    <div class="layout-switcher">
      <button v-for="option in layoutOptions" :key="option.value" :class="{'is-active': view === option.value}" @click="changeView(option.value)">
        {{ option.label }}
      </button>
    </div>

    <div class="controls">
      <div class="timeline-row">
        <span>{{ formatDuration(playhead) }}</span>
        <div class="timeline-shell">
          <div v-if="timelineHover !== undefined" class="timeline-tooltip" :style="{left: `${pointPercent(timelineHover)}%`}">{{ formatDuration(timelineHover) }}</div>
          <div class="timeline-track">
            <svg v-if="speedPath" viewBox="0 0 1000 30" preserveAspectRatio="none"><path :d="speedPath" /></svg>
            <div v-if="exportIn !== undefined && exportOut !== undefined && exportOut > exportIn" class="timeline-range" :style="{left: `${pointPercent(exportIn)}%`, width: `${pointPercent(exportOut)! - pointPercent(exportIn)!}%`}" />
            <div class="timeline-played" :style="{width: `${pointPercent(playhead)}%`}"><b /></div>
            <div v-if="eventSeconds !== undefined" class="timeline-mark timeline-mark--event" :style="{left: `${pointPercent(eventSeconds)}%`}" :title="t('viewer.event')" />
            <div v-for="mark in incidentMarks" :key="mark" class="timeline-mark timeline-mark--incident" :style="{left: `${pointPercent(mark)}%`}" :title="t('viewer.hardBraking')" />
            <div v-if="exportIn !== undefined" class="timeline-mark timeline-mark--in" :style="{left: `${pointPercent(exportIn)}%`}" />
            <div v-if="exportOut !== undefined" class="timeline-mark timeline-mark--out" :style="{left: `${pointPercent(exportOut)}%`}" />
            <div v-if="timelineHover !== undefined" class="timeline-hover" :style="{left: `${pointPercent(timelineHover)}%`}" />
          </div>
          <input
            type="range"
            min="0"
            step="0.01"
            :max="Math.max(footage.duration, .01)"
            :value="playhead"
            :aria-label="t('viewer.timeline')"
            @pointermove="updateTimelineHover"
            @pointerleave="timelineHover = undefined"
            @input="applySeek(Number(($event.currentTarget as HTMLInputElement).value))"
          />
        </div>
        <span>{{ formatDuration(footage.duration) }}</span>
      </div>

      <div class="controls__row">
        <div class="export-tools">
          <div class="range-tools">
            <button :class="{'is-set': exportIn !== undefined}" @click="markExportIn">IN {{ exportIn === undefined ? '--:--' : formatDuration(exportIn) }}</button>
            <button :class="{'is-set': exportOut !== undefined}" @click="markExportOut">OUT {{ exportOut === undefined ? '--:--' : formatDuration(exportOut) }}</button>
            <button v-if="exportIn !== undefined || exportOut !== undefined" :title="t('viewer.clearInOut')" @click="clearExportRange"><X :size="13" /></button>
          </div>
          <button class="command command--primary" :disabled="exporting || !exportableSeconds" @click="exportVideo"><Download :size="17" />{{ t('viewer.exportClip') }}</button>
        </div>

        <div class="playback-tools">
          <button :title="t('viewer.previousClip')" @click="emit('previous')"><ChevronLeft :size="18" /></button>
          <button class="jump" @click="seekBy(-5)">-5s</button>
          <button class="play" :title="playing ? t('viewer.pause') : t('viewer.play')" @click="togglePlayback">
            <Pause v-if="playing" :size="23" fill="currentColor" />
            <Play v-else :size="23" fill="currentColor" />
          </button>
          <button class="jump" @click="seekBy(5)">+5s</button>
          <button :title="t('viewer.nextClip')" @click="emit('next')"><ChevronRight :size="18" /></button>
        </div>

        <div class="viewer-tools">
          <button v-if="eventSeconds !== undefined" class="event-jump" :title="t('viewer.jumpToEvent')" @click="applySeek(eventSeconds)"><Flag :size="17" /></button>
          <select v-model.number="playbackRate" :aria-label="t('viewer.playbackSpeed')">
            <option v-for="rate in rates" :key="rate" :value="rate">{{ rate }}×</option>
          </select>
          <button :title="muted ? t('viewer.unmute') : t('viewer.mute')" @click="muted = !muted"><VolumeX v-if="muted" :size="18" /><Volume2 v-else :size="18" /></button>
          <button :title="t('viewer.restart')" @click="applySeek(0)"><RotateCcw :size="17" /></button>
          <button class="delete" :disabled="!deleteClip || deleting || exporting" :title="t('viewer.deleteClip')" @click="requestDelete"><Trash2 :size="18" /></button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.viewer { background: #080909; display: grid; grid-template-rows: auto minmax(0, 1fr) auto auto auto; height: 100%; min-width: 0; overflow: hidden; }
.viewer__toolbar { align-items: center; border-bottom: 1px solid #252828; display: flex; justify-content: space-between; min-height: 50px; padding: 7px 13px; }
.viewer__clip-meta { display: grid; gap: 2px; min-width: 0; }
.viewer__clip-meta strong { color: #eceeee; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.viewer__clip-meta span { color: #747a7a; font-size: 10px; }
.viewer__actions { align-items: center; display: flex; gap: 5px; }
.viewer__actions a, .viewer__actions button { align-items: center; background: #1d2020; border: 1px solid #303333; border-radius: 5px; color: #b7bcbc; cursor: pointer; display: inline-flex; font-size: 11px; gap: 5px; height: 31px; padding: 0 9px; text-decoration: none; }
.viewer__actions a:hover, .viewer__actions button:hover { background: #292c2c; color: #fff; }
.viewer__stage { min-height: 0; overflow: hidden; position: relative; }
.video-grid { display: grid; gap: 1px; height: 100%; min-height: 0; overflow: hidden; }
.video-grid--grid6 { grid-template-columns: repeat(3, minmax(0, 1fr)); grid-template-rows: repeat(2, minmax(0, 1fr)); }
.video-grid--grid4 { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: repeat(2, minmax(0, 1fr)); }
.video-grid--grid4old { grid-template-columns: repeat(3, minmax(0, 1fr)); grid-template-rows: 3fr 2fr; }
.video-grid--grid6 .camera--left { order: 1; }
.video-grid--grid6 .camera--front { order: 2; }
.video-grid--grid6 .camera--right { order: 3; }
.video-grid--grid6 .camera--left_pillar { order: 4; }
.video-grid--grid6 .camera--back { order: 5; }
.video-grid--grid6 .camera--right_pillar { order: 6; }
.video-grid--grid4 .camera--front { order: 1; }
.video-grid--grid4 .camera--back { order: 2; }
.video-grid--grid4 .camera--left { order: 3; }
.video-grid--grid4 .camera--right { order: 4; }
.video-grid--grid4old .camera--front { grid-column: 1 / -1; }
.video-grid--grid4old .camera--left { grid-column: 1; grid-row: 2; }
.video-grid--grid4old .camera--back { grid-column: 2; grid-row: 2; }
.video-grid--grid4old .camera--right { grid-column: 3; grid-row: 2; }
.video-grid--front, .video-grid--back, .video-grid--left, .video-grid--right, .video-grid--left_pillar, .video-grid--right_pillar { grid-template-columns: 1fr; grid-template-rows: 1fr; }
.camera { align-items: center; background: #030404; display: flex; justify-content: center; min-height: 0; min-width: 0; overflow: hidden; position: relative; }
.camera video { cursor: pointer; height: 100%; object-fit: contain; width: 100%; }
.camera__empty { color: #343939; position: absolute; }
.camera__label { background: rgb(0 0 0 / 66%); border-radius: 3px; color: #c8cccc; font-size: 9px; left: 7px; padding: 3px 5px; position: absolute; top: 7px; }
.layout-switcher { align-items: center; display: flex; gap: 5px; justify-content: center; min-height: 43px; overflow-x: auto; padding: 5px 10px; }
.layout-switcher button { background: #171919; border: 1px solid #2d3030; border-radius: 5px; color: #747a7a; cursor: pointer; flex: 0 0 auto; font-size: 10px; height: 27px; padding: 0 10px; }
.layout-switcher button:hover { color: #ddd; }
.layout-switcher button.is-active { background: #f3f3f3; border-color: #f3f3f3; color: #111; }
.controls { background: #121414; border-top: 1px solid #292c2c; display: grid; gap: 7px; padding: 7px 13px 10px; }
.timeline-row { align-items: center; color: #717777; display: flex; font-size: 10px; gap: 10px; }
.timeline-row > span { font-variant-numeric: tabular-nums; width: 34px; }
.timeline-row > span:last-child { text-align: right; }
.timeline-shell { height: 30px; position: relative; width: 100%; }
.timeline-shell input { appearance: none; background: transparent; cursor: pointer; height: 30px; inset: 0; margin: 0; opacity: 0; position: absolute; width: 100%; z-index: 10; }
.timeline-track { background: #373b3b; height: 6px; left: 0; overflow: visible; position: absolute; right: 0; top: 12px; transition: height 120ms ease, top 120ms ease; }
.timeline-shell:hover .timeline-track { background: #252828; height: 24px; top: 3px; }
.timeline-track svg { inset: 0; opacity: 0; pointer-events: none; position: absolute; transition: opacity 120ms ease; width: 100%; height: 100%; z-index: 4; }
.timeline-shell:hover .timeline-track svg { opacity: .7; }
.timeline-track svg path { fill: none; stroke: #e82127; stroke-width: 1.3; vector-effect: non-scaling-stroke; }
.timeline-played { background: #e6e9e9; bottom: 0; left: 0; position: absolute; top: 0; z-index: 3; }
.timeline-played b { background: #fff; border: 2px solid #bfc4c4; border-radius: 50%; box-shadow: 0 1px 5px #0008; height: 15px; position: absolute; right: 0; top: 50%; transform: translate(50%, -50%); width: 15px; }
.timeline-shell:hover .timeline-played { background: #ffffffc9; }
.timeline-tooltip { background: #252828; border: 1px solid #414545; border-radius: 4px; bottom: 31px; color: #f0f2f2; font-size: 10px; padding: 3px 6px; pointer-events: none; position: absolute; transform: translateX(-50%); z-index: 12; }
.timeline-hover { background: #ffffff66; bottom: 0; pointer-events: none; position: absolute; top: 0; width: 1px; z-index: 7; }
.timeline-mark { pointer-events: none; position: absolute; transform: translateX(-50%); z-index: 6; }
.timeline-mark--event { background: #e82127; bottom: -3px; top: -3px; width: 3px; }
.timeline-mark--incident { border-left: 4px solid transparent; border-right: 4px solid transparent; border-top: 6px solid #f4b942; top: -7px; }
.timeline-mark--in, .timeline-mark--out { background: #52a5ff; bottom: -3px; top: -3px; width: 2px; }
.timeline-range { background: #328be44d; bottom: 0; pointer-events: none; position: absolute; top: 0; z-index: 2; }
.controls__row { align-items: center; display: grid; gap: 10px; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); }
.export-tools, .viewer-tools, .playback-tools { align-items: center; display: flex; gap: 5px; }
.viewer-tools { justify-self: end; }
.range-tools { align-items: center; background: #1c1f1f; border-radius: 5px; display: flex; padding: 2px; }
.range-tools button { background: transparent; border: 0; border-radius: 3px; color: #696f6f; cursor: pointer; font-size: 9px; height: 27px; padding: 0 6px; }
.range-tools button.is-set { background: #17324b; color: #70b9ff; }
.command { align-items: center; border: 0; border-radius: 5px; cursor: pointer; display: flex; font-size: 11px; gap: 6px; height: 33px; padding: 0 10px; }
.command--primary { background: #e82127; color: #fff; }
.command:disabled { cursor: not-allowed; opacity: .45; }
.playback-tools button, .viewer-tools button { align-items: center; background: transparent; border: 0; border-radius: 5px; color: #a6abab; cursor: pointer; display: flex; height: 32px; justify-content: center; padding: 0; width: 32px; }
.playback-tools button:hover, .viewer-tools button:hover { background: #252828; color: #fff; }
.playback-tools .jump { font-size: 11px; font-variant-numeric: tabular-nums; width: 38px; }
.playback-tools .play { background: #f4f4f4; border-radius: 50%; color: #111; height: 43px; width: 43px; }
.playback-tools .play:hover { background: #fff; color: #000; }
.viewer-tools select { background: #202323; border: 1px solid #303333; border-radius: 5px; color: #d3d6d6; height: 32px; padding: 0 8px; }
.viewer-tools .event-jump { color: #ef4a50; }
.viewer-tools .delete { border: 1px solid #6b282b; color: #ef4a50; }
.viewer-tools button:disabled { cursor: not-allowed; opacity: .35; }
.export-dialog { display: grid; gap: 13px; text-align: center; }
.export-dialog strong { color: #eee; }
.export-dialog span { color: #818787; font-size: 11px; }
.export-progress { background: #292d2d; border-radius: 3px; height: 6px; overflow: hidden; position: relative; }
.export-progress__value { background: #e82127; border-radius: inherit; bottom: 0; left: 0; position: absolute; top: 0; transition: width 120ms linear; }
.export-dialog__stats { align-items: baseline; display: flex; justify-content: space-between; }
.export-dialog__stats strong { color: #f2f4f4; font-size: 18px; font-variant-numeric: tabular-nums; }
.export-dialog__stats span { font-variant-numeric: tabular-nums; }
.export-dialog button { align-items: center; background: #222525; border: 1px solid #343838; border-radius: 5px; color: #ccc; cursor: pointer; display: flex; gap: 6px; height: 34px; justify-content: center; }
@media (max-width: 1120px) {
  .viewer__actions button { font-size: 0; padding: 0 7px; }
  .controls__row { grid-template-columns: 1fr auto; }
  .viewer-tools { grid-column: 1 / -1; justify-self: end; }
}
</style>
