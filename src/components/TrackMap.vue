<script setup lang="ts">
import {computed, ref} from 'vue'
import {Map} from 'lucide-vue-next'
import type {SEIDataPoint} from '../types/tesla'

const props = defineProps<{data: SEIDataPoint[]; playedSeconds: number}>()
const collapsed = ref(false)
const width = 200
const height = 130
const padding = 14

type GpsPoint = SEIDataPoint & {latitude: number; longitude: number}
const hasCoordinates = (point: SEIDataPoint): point is GpsPoint =>
    Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
    && (point.latitude !== 0 || point.longitude !== 0)

const track = computed(() => {
    const source = props.data.filter(hasCoordinates)
    if (source.length < 2) return null
    const step = Math.max(1, Math.floor(source.length / 400))
    const sampled = source.filter((_, index) => index % step === 0)
    if (sampled.at(-1) !== source.at(-1)) sampled.push(source.at(-1)!)
    const midLatitude = sampled.reduce((total, point) => total + point.latitude, 0) / sampled.length
    const cosine = Math.cos(midLatitude * Math.PI / 180)
    const xs = sampled.map(point => point.longitude * cosine)
    const ys = sampled.map(point => -point.latitude)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const scale = (Math.min(width, height) - padding * 2) / Math.max(maxX - minX, maxY - minY, 1e-7)
    const offsetX = (width - (maxX - minX) * scale) / 2
    const offsetY = (height - (maxY - minY) * scale) / 2
    const points = sampled.map((point, index) => ({
        x: offsetX + (xs[index] - minX) * scale,
        y: offsetY + (ys[index] - minY) * scale,
        seconds: point.offsetSeconds,
    }))
    const currentIndex = points.findLastIndex(point => point.seconds <= props.playedSeconds)
    const activeIndex = Math.max(0, currentIndex)
    const pathFor = (values: typeof points) => values
        .map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
        .join(' ')
    return {
        path: pathFor(points),
        traveled: pathFor(points.slice(0, activeIndex + 1)),
        start: points[0],
        current: points[activeIndex],
    }
})
</script>

<template>
  <button v-if="track && collapsed" class="track-map__collapsed" title="GPS" @click="collapsed = false"><Map :size="17" /></button>
  <div v-else-if="track" class="track-map">
    <button title="GPS" @click="collapsed = true"><Map :size="14" /></button>
    <svg :viewBox="`0 0 ${width} ${height}`">
      <path :d="track.path" fill="none" stroke="#ffffff44" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      <path :d="track.traveled" fill="none" stroke="#e82127" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
      <circle :cx="track.start.x" :cy="track.start.y" r="3" fill="#ffffff88" />
      <circle :cx="track.current.x" :cy="track.current.y" r="4.5" fill="#e82127" stroke="#fff" stroke-width="1.5" />
    </svg>
  </div>
</template>

<style scoped>
.track-map, .track-map__collapsed { backdrop-filter: blur(10px); background: rgb(15 16 16 / 84%); border: 1px solid #ffffff1c; bottom: 12px; left: 12px; position: absolute; z-index: 8; }
.track-map { height: 130px; overflow: hidden; width: 200px; }
.track-map svg { display: block; height: 100%; width: 100%; }
.track-map button { background: transparent; border: 0; color: #777; cursor: pointer; padding: 6px; position: absolute; right: 0; top: 0; z-index: 1; }
.track-map__collapsed { align-items: center; color: #aaa; cursor: pointer; display: flex; height: 34px; justify-content: center; padding: 0; width: 34px; }
</style>
