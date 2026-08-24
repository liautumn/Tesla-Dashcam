<script setup lang="ts">
import {computed, nextTick, onMounted, onUnmounted, ref, shallowReactive, watch} from 'vue'
import {ElSegmented} from 'element-plus'
import {
    CameraOff,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Pause,
    PictureInPicture,
    Play,
    RotateCcw,
    Volume2,
    VolumeX,
} from 'lucide-vue-next'
import {useI18n} from 'vue-i18n'
import type {CamClip, CamFootage, CamName, ViewType} from '../types/tesla'
import {cameraNames} from '../types/tesla'
import {formatDuration} from '../utils/formatDuration'
import {calcSeekInfo} from '../utils/genFootage'
import 'element-plus/theme-chalk/el-segmented.css'

const props = defineProps<{
    clip: CamClip
    footage: CamFootage
}>()

const emit = defineEmits<{
    previous: []
    next: []
}>()

const {t} = useI18n()
const hasPillarCameras = props.footage.segments.some(segment =>
    Boolean(segment.left_pillar || segment.right_pillar),
)
const labels = computed<Record<CamName, string>>(() => ({
    front: t('camera.front'),
    back: t('camera.back'),
    left: t('camera.left'),
    right: t('camera.right'),
    left_pillar: t('camera.left_pillar'),
    right_pillar: t('camera.right_pillar'),
}))
const layoutOptions = computed(() => {
    const options = [
        {label: t('layout.grid4'), value: 'grid4'},
        {label: t('layout.front'), value: 'front'},
    ]
    if (hasPillarCameras) options.unshift({label: t('layout.grid6'), value: 'grid6'})
    return options
})
const rates = [0.25, 0.5, 1, 1.5, 2]
const videoElements = shallowReactive(new Map<CamName, HTMLVideoElement>())
const endedCameras = new Set<CamName>()
const cameraTimes = new Map<CamName, number>()
const currentIndex = ref(0)
const playhead = ref(0)
const playing = ref(false)
const muted = ref(true)
const playbackRate = ref(1)
const view = ref<ViewType>(hasPillarCameras ? 'grid6' : 'grid4')
const seekSeconds = ref(0)

const currentSegment = computed(() => props.footage.segments[currentIndex.value])
const activeCameras = computed(() =>
    cameraNames.filter(camera => Boolean(currentSegment.value?.[camera])),
)
const pictureInPictureAvailable = computed(() =>
    Boolean(sourceFor('front') && document.pictureInPictureEnabled),
)

const sourceFor = (camera: CamName) => currentSegment.value?.[camera]
const visibleCamera = (camera: CamName) => {
    if (view.value === 'front') return camera === 'front'
    if (view.value === 'grid4') return !camera.endsWith('_pillar')
    return true
}

const setVideoRef = (camera: CamName, element: unknown) => {
    if (element instanceof HTMLVideoElement) videoElements.set(camera, element)
    else videoElements.delete(camera)
}

const configureVideo = (camera: CamName) => {
    const video = videoElements.get(camera)
    if (!video) return
    video.muted = muted.value
    video.playbackRate = playbackRate.value
}

const seekVideo = (camera: CamName) => {
    const video = videoElements.get(camera)
    if (!video || video.readyState < 1 || !Number.isFinite(seekSeconds.value)) return
    const duration = Number.isFinite(video.duration) ? video.duration : seekSeconds.value
    video.currentTime = Math.min(seekSeconds.value, duration)
}

const playVideos = async () => {
    const tasks = activeCameras.value.map(async camera => {
        const video = videoElements.get(camera)
        if (!video) return
        configureVideo(camera)
        await video.play()
    })
    await Promise.allSettled(tasks)
}

const pauseVideos = () => videoElements.forEach(video => video.pause())

const togglePlayback = async () => {
    if (!activeCameras.value.length) return
    if (!playing.value && playhead.value >= props.footage.duration - 0.01) await applySeek(0)
    playing.value = !playing.value
    if (playing.value) await playVideos()
    else pauseVideos()
}

const applySeek = async (seconds: number) => {
    const info = calcSeekInfo(props.footage, seconds)
    if (!info) return
    playhead.value = Math.min(Math.max(seconds, 0), props.footage.duration)
    seekSeconds.value = info.seconds
    endedCameras.clear()
    cameraTimes.clear()
    if (info.index !== currentIndex.value) {
        currentIndex.value = info.index
        await nextTick()
    }
    activeCameras.value.forEach(camera => {
        cameraTimes.set(camera, info.seconds)
        configureVideo(camera)
        seekVideo(camera)
    })
    if (playing.value) await playVideos()
}

const seekBy = (seconds: number) => void applySeek(playhead.value + seconds)

const onTimelineInput = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement
    void applySeek(Number(input.value))
}

const onLoadedMetadata = (camera: CamName) => {
    configureVideo(camera)
    seekVideo(camera)
    if (playing.value) void videoElements.get(camera)?.play()
}

const onTimeUpdate = (camera: CamName) => {
    if (!currentSegment.value) return
    const video = videoElements.get(camera)
    if (!video) return
    cameraTimes.set(camera, video.currentTime)
    playhead.value = Math.min(
        currentSegment.value.startSeconds + Math.max(...cameraTimes.values()),
        props.footage.duration,
    )
}

const advanceSegment = async () => {
    if (currentIndex.value >= props.footage.segments.length - 1) {
        playing.value = false
        playhead.value = props.footage.duration
        pauseVideos()
        return
    }
    currentIndex.value += 1
    seekSeconds.value = 0
    playhead.value = currentSegment.value?.startSeconds ?? playhead.value
    endedCameras.clear()
    cameraTimes.clear()
    await nextTick()
    if (playing.value) await playVideos()
}

const onEnded = (camera: CamName) => {
    endedCameras.add(camera)
    if (activeCameras.value.every(item => endedCameras.has(item))) void advanceSegment()
}

const restart = () => void applySeek(0)

const togglePictureInPicture = async () => {
    const video = videoElements.get('front')
    if (!video || !pictureInPictureAvailable.value) return
    if (document.pictureInPictureElement) await document.exitPictureInPicture()
    else await video.requestPictureInPicture()
}

const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null
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
    } else if (event.key === ',') {
        seekBy(-1 / 30)
    } else if (event.key === '.') {
        seekBy(1 / 30)
    } else if (event.key.toLowerCase() === 'm') {
        muted.value = !muted.value
    } else if (event.key.toLowerCase() === 'p') {
        void togglePictureInPicture()
    } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        emit('previous')
    } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        emit('next')
    }
}

watch(playbackRate, rate => videoElements.forEach(video => { video.playbackRate = rate }))
watch(muted, value => videoElements.forEach(video => { video.muted = value }))
watch(
    () => props.clip.id,
    () => {
        playing.value = false
        pauseVideos()
        currentIndex.value = 0
        playhead.value = 0
        seekSeconds.value = 0
        endedCameras.clear()
        cameraTimes.clear()
    },
)

onMounted(() => window.addEventListener('keydown', onKeyDown))
onUnmounted(() => {
    pauseVideos()
    window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <section class="viewer">
    <div class="viewer__meta">
      <div>
        <strong>{{ clip.name.replace('_', ' ') }}</strong>
        <span>{{ t('viewer.summary', {files: clip.videos.length, segments: footage.segments.length}) }}</span>
      </div>
      <ElSegmented v-model="view" :options="layoutOptions" />
    </div>

    <div class="video-grid" :class="`video-grid--${view}`">
      <div
        v-for="camera in cameraNames"
        v-show="visibleCamera(camera)"
        :key="camera"
        class="camera"
        :class="`camera--${camera}`"
      >
        <video
          :ref="element => setVideoRef(camera, element)"
          :src="sourceFor(camera)"
          playsinline
          preload="metadata"
          @click="togglePlayback"
          @ended="onEnded(camera)"
          @loadedmetadata="onLoadedMetadata(camera)"
          @timeupdate="onTimeUpdate(camera)"
        />
        <div v-if="!sourceFor(camera)" class="camera__empty"><CameraOff :size="24" /></div>
        <span class="camera__label">{{ labels[camera] }}</span>
      </div>
    </div>

    <div class="controls">
      <input
        class="timeline"
        type="range"
        min="0"
        step="0.01"
        :max="Math.max(footage.duration, 0.01)"
        :value="playhead"
        :aria-label="t('viewer.timeline')"
        @input="onTimelineInput"
      />
      <div class="controls__row">
        <div class="controls__group">
          <button class="icon-button" :title="t('viewer.previousClip')" :aria-label="t('viewer.previousClip')" @click="emit('previous')">
            <ChevronLeft :size="20" />
          </button>
          <button class="icon-button icon-button--primary" :title="playing ? t('viewer.pause') : t('viewer.play')" :aria-label="playing ? t('viewer.pause') : t('viewer.play')" @click="togglePlayback">
            <Pause v-if="playing" :size="21" fill="currentColor" />
            <Play v-else :size="21" fill="currentColor" />
          </button>
          <button class="icon-button" :title="t('viewer.nextClip')" :aria-label="t('viewer.nextClip')" @click="emit('next')">
            <ChevronRight :size="20" />
          </button>
          <button class="icon-button" :title="t('viewer.restart')" :aria-label="t('viewer.restart')" @click="restart">
            <RotateCcw :size="18" />
          </button>
          <button class="icon-button" :title="muted ? t('viewer.unmute') : t('viewer.mute')" :aria-label="muted ? t('viewer.unmute') : t('viewer.mute')" @click="muted = !muted">
            <VolumeX v-if="muted" :size="19" />
            <Volume2 v-else :size="19" />
          </button>
          <button class="icon-button" :disabled="!pictureInPictureAvailable" :title="t('viewer.pictureInPicture')" :aria-label="t('viewer.pictureInPicture')" @click="togglePictureInPicture">
            <PictureInPicture :size="19" />
          </button>
        </div>

        <div class="controls__time">{{ formatDuration(playhead) }} / {{ formatDuration(footage.duration) }}</div>

        <label class="rate-select">
          <span>{{ playbackRate }}×</span>
          <select v-model.number="playbackRate" :aria-label="t('viewer.playbackSpeed')">
            <option v-for="rate in rates" :key="rate" :value="rate">{{ rate }}×</option>
          </select>
          <ChevronDown :size="14" />
        </label>
      </div>
    </div>
  </section>
</template>

<style scoped>
.viewer {
  background: #080909;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  height: 100%;
  min-width: 0;
}

.viewer__meta {
  align-items: center;
  border-bottom: 1px solid #252828;
  display: flex;
  justify-content: space-between;
  min-height: 54px;
  padding: 8px 14px;
}

.viewer__meta > div { display: grid; gap: 2px; }
.viewer__meta strong { color: #eceeee; font-size: 13px; font-weight: 600; }
.viewer__meta span { color: #747a7a; font-size: 11px; }

.video-grid {
  display: grid;
  gap: 2px;
  min-height: 0;
  overflow: hidden;
  padding: 2px;
}

.video-grid--grid6 { grid-template-columns: repeat(3, minmax(0, 1fr)); grid-template-rows: repeat(2, minmax(0, 1fr)); }
.video-grid--grid4 { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: repeat(2, minmax(0, 1fr)); }
.video-grid--front { grid-template-columns: 1fr; grid-template-rows: 1fr; }
.video-grid--grid6 .camera--left { order: 1; }
.video-grid--grid6 .camera--front { order: 2; }
.video-grid--grid6 .camera--right { order: 3; }
.video-grid--grid6 .camera--left_pillar { order: 4; }
.video-grid--grid6 .camera--back { order: 5; }
.video-grid--grid6 .camera--right_pillar { order: 6; }

.camera {
  align-items: center;
  background: #0d0f0f;
  display: flex;
  justify-content: center;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  position: relative;
}

.camera video { cursor: pointer; height: 100%; object-fit: contain; width: 100%; }
.camera__empty { color: #3e4444; position: absolute; }
.camera__label { background: rgb(0 0 0 / 62%); border-radius: 3px; color: #c8cccc; font-size: 10px; left: 8px; padding: 3px 5px; position: absolute; top: 8px; }

.controls { border-top: 1px solid #252828; padding: 0 14px 10px; }
.timeline { accent-color: #e82127; cursor: pointer; height: 22px; margin: 0; width: 100%; }
.controls__row { align-items: center; display: grid; grid-template-columns: 1fr auto 1fr; min-height: 38px; }
.controls__group { align-items: center; display: flex; gap: 3px; }
.controls__time { color: #a8adad; font-size: 12px; font-variant-numeric: tabular-nums; }

.icon-button {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 5px;
  color: #aeb3b3;
  cursor: pointer;
  display: inline-flex;
  height: 34px;
  justify-content: center;
  padding: 0;
  width: 34px;
}

.icon-button:hover { background: #242727; color: #fff; }
.icon-button:disabled { color: #484d4d; cursor: not-allowed; }
.icon-button:disabled:hover { background: transparent; }
.icon-button--primary { color: #fff; }

.rate-select {
  align-items: center;
  color: #aeb3b3;
  display: flex;
  gap: 4px;
  justify-self: end;
  position: relative;
}

.rate-select select { cursor: pointer; inset: 0; opacity: 0; position: absolute; width: 100%; }

@media (max-width: 960px) {
  .video-grid--grid6 { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: repeat(3, minmax(0, 1fr)); }
  .controls__row { grid-template-columns: 1fr auto; }
  .controls__time { display: none; }
}
</style>
