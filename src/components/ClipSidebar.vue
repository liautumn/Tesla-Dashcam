<script setup lang="ts">
import {computed, onUnmounted, ref} from 'vue'
import {ElButton, ElInput, ElSegmented} from 'element-plus'
import {Film, FolderOpen, Search, Settings} from 'lucide-vue-next'
import {useI18n} from 'vue-i18n'
import type {CamClip, ClipType} from '../types/tesla'
import {clipDateKey, formatClipTime, parseClipTime} from '../utils/clipTime'
import ClipThumbnail from './ClipThumbnail.vue'
import 'element-plus/theme-chalk/el-button.css'
import 'element-plus/theme-chalk/el-input.css'
import 'element-plus/theme-chalk/el-segmented.css'

type FilterType = ClipType | 'all'

const sidebarWidthKey = 'tesla-cam-sidebar-width'
const minSidebarWidth = 300
const maxSidebarWidth = 600

const props = defineProps<{
    items: CamClip[]
    selected?: CamClip
    scanning: boolean
}>()

const emit = defineEmits<{
    select: [clip: CamClip]
    open: []
    settings: []
}>()

const {locale, t} = useI18n()
const filter = ref<FilterType>('all')
const search = ref('')
const storedWidth = Number(localStorage.getItem(sidebarWidthKey))
const sidebarWidth = ref(
    Number.isFinite(storedWidth) && storedWidth >= minSidebarWidth && storedWidth <= maxSidebarWidth
        ? storedWidth
        : minSidebarWidth,
)
const resizing = ref(false)

const filterOptions = computed(() => [
    {label: `${t('sidebar.all')} ${props.items.length}`, value: 'all'},
    {label: `${t('sidebar.recent')} ${props.items.filter(item => item.type === 'recent').length}`, value: 'recent'},
    {label: `${t('sidebar.sentry')} ${props.items.filter(item => item.type === 'sentry').length}`, value: 'sentry'},
    {label: `${t('sidebar.saved')} ${props.items.filter(item => !item.type || item.type === 'saved').length}`, value: 'saved'},
])

const filteredItems = computed(() => {
    const query = search.value.trim().toLowerCase()
    return props.items.filter(item => {
        const matchesType = filter.value === 'all'
            || item.type === filter.value
            || (filter.value === 'saved' && !item.type)
        if (!matchesType) return false
        if (!query) return true
        const content = [item.name, item.event?.city, item.event?.street, item.event?.reason]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
        return content.includes(query)
    })
})

const groups = computed(() => {
    const grouped = new Map<string, CamClip[]>()
    for (const clip of filteredItems.value) {
        const key = clipDateKey(clip.name)
        const values = grouped.get(key) ?? []
        values.push(clip)
        grouped.set(key, values)
    }
    return Array.from(grouped, ([date, clips]) => ({date, clips}))
})

const groupLabel = (date: string) => {
    const keyFor = (value: Date) => [
        value.getFullYear(),
        String(value.getMonth() + 1).padStart(2, '0'),
        String(value.getDate()).padStart(2, '0'),
    ].join('-')
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    if (date === keyFor(today)) return t('sidebar.today')
    if (date === keyFor(yesterday)) return t('sidebar.yesterday')
    const parsed = parseClipTime(`${date}_00-00-00`)
    if (!parsed) return date
    return new Intl.DateTimeFormat(locale.value, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    }).format(parsed)
}

const clipTypeLabel = (clip: CamClip) => {
    if (clip.type === 'recent') return t('clipType.recent')
    if (clip.type === 'sentry') return t('clipType.sentry')
    if (clip.saveType === 'aeb') return t('clipType.aeb')
    if (clip.saveType === 'manual') return t('clipType.manual')
    return t('clipType.saved')
}

const locationLabel = (clip: CamClip) =>
    [clip.event?.city, clip.event?.street].filter(Boolean).join(' ') || t('sidebar.unknownLocation')

const posterFile = (clip: CamClip) =>
    clip.videos.find(file => file.name.endsWith('-front.mp4')) ?? clip.videos[0]

const posterKey = (clip: CamClip) => {
    const file = clip.thumb ?? posterFile(clip)
    return `${clip.id}:${file?.name ?? ''}:${file?.size ?? 0}:${file?.lastModified ?? 0}`
}

const finishResize = (event?: PointerEvent) => {
    if (!resizing.value) return
    resizing.value = false
    if (event && (event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) {
        (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
    }
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    localStorage.setItem(sidebarWidthKey, String(sidebarWidth.value))
}

const onResizeStart = (event: PointerEvent) => {
    resizing.value = true
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
}

const onResize = (event: PointerEvent) => {
    if (!resizing.value) return
    sidebarWidth.value = Math.min(maxSidebarWidth, Math.max(minSidebarWidth, event.clientX))
}

onUnmounted(() => {
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
})
</script>

<template>
  <aside class="sidebar" :style="{width: `${sidebarWidth}px`}">
    <div class="sidebar__tools">
      <div class="sidebar__search-row">
        <ElInput v-model="search" clearable :placeholder="t('sidebar.search')">
          <template #prefix><Search :size="16" /></template>
        </ElInput>
        <ElButton
          class="sidebar__settings"
          :aria-label="t('settings.title')"
          :title="t('settings.title')"
          @click="emit('settings')"
        >
          <Settings :size="17" />
        </ElButton>
      </div>
      <ElSegmented v-model="filter" class="sidebar__filters" :options="filterOptions" />
      <ElButton class="sidebar__open" :loading="scanning" @click="emit('open')">
        <FolderOpen :size="17" />
        {{ t('sidebar.selectFolder') }}
      </ElButton>
    </div>

    <div class="sidebar__list">
      <div v-if="!filteredItems.length" class="sidebar__empty">
        <Film :size="28" />
        <span>{{ t('sidebar.noResults') }}</span>
      </div>

      <section v-for="group in groups" :key="group.date" class="clip-group">
        <div class="clip-group__title">
          <span>{{ groupLabel(group.date) }}</span>
          <span>{{ group.clips.length }}</span>
        </div>
        <button
          v-for="clip in group.clips"
          :key="clip.id"
          class="clip-item"
          :class="{'clip-item--active': clip.id === selected?.id}"
          type="button"
          @click="emit('select', clip)"
        >
          <div class="clip-item__thumb">
            <ClipThumbnail
              :key="posterKey(clip)"
              :file="clip.thumb"
              :video-file="posterFile(clip)"
              :cache-key="posterKey(clip)"
            />
          </div>
          <div class="clip-item__body">
            <div class="clip-item__headline">
              <strong>{{ formatClipTime(clip.name, locale) }}</strong>
              <span class="clip-item__type" :class="`clip-item__type--${clip.type || 'saved'}`">
                {{ clipTypeLabel(clip) }}
              </span>
            </div>
            <span class="clip-item__location">{{ locationLabel(clip) }}</span>
            <span v-if="clip.event?.reason" class="clip-item__reason">{{ clip.event.reason }}</span>
          </div>
        </button>
      </section>
    </div>

    <div class="sidebar__footer">{{ t('sidebar.clipCount', {total: items.length, shown: filteredItems.length}) }}</div>
    <div
      class="sidebar__resize"
      :class="{'sidebar__resize--active': resizing}"
      @pointerdown="onResizeStart"
      @pointermove="onResize"
      @pointerup="finishResize"
      @pointercancel="finishResize"
    />
  </aside>
</template>

<style scoped>
.sidebar {
  background: #111313;
  border-right: 1px solid #292c2c;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-width: 300px;
  max-width: 600px;
  position: relative;
  width: 300px;
}

.sidebar__tools {
  display: grid;
  gap: 10px;
  padding: 14px;
}

.sidebar__search-row {
  display: grid;
  gap: 8px;
  grid-template-columns: minmax(0, 1fr) 32px;
}

.sidebar__settings {
  height: 32px;
  margin: 0;
  padding: 0;
  width: 32px;
}

.sidebar__filters {
  width: 100%;
}

.sidebar__open {
  margin: 0;
  width: 100%;
}

.sidebar__list {
  overflow-y: auto;
  padding: 0 8px 16px;
}

.sidebar__empty {
  align-items: center;
  color: #6d7373;
  display: flex;
  flex-direction: column;
  gap: 10px;
  justify-content: center;
  min-height: 220px;
}

.clip-group__title {
  align-items: center;
  background: color-mix(in srgb, #111313 92%, transparent);
  color: #7e8585;
  display: flex;
  font-size: 11px;
  font-weight: 600;
  justify-content: space-between;
  padding: 9px 8px 6px;
  position: sticky;
  top: 0;
  z-index: 2;
}

.clip-item {
  align-items: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: inherit;
  cursor: pointer;
  display: grid;
  gap: 10px;
  grid-template-columns: 92px minmax(0, 1fr);
  margin-bottom: 3px;
  padding: 7px;
  text-align: left;
  width: 100%;
}

.clip-item:hover { background: #191c1c; }
.clip-item--active { background: #211719; border-color: #653036; }

.clip-item__thumb {
  align-items: center;
  aspect-ratio: 16 / 9;
  background: #202323;
  border-radius: 4px;
  color: #626969;
  display: flex;
  justify-content: center;
  overflow: hidden;
}

.clip-item__thumb img { height: 100%; object-fit: cover; width: 100%; }

.clip-item__body { display: grid; gap: 3px; min-width: 0; }
.clip-item__headline { align-items: center; display: flex; gap: 6px; }
.clip-item__headline strong { color: #e7eaea; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.clip-item__location, .clip-item__reason { color: #858b8b; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.clip-item__reason { color: #626969; }
.clip-item__type { border-radius: 3px; flex: 0 0 auto; font-size: 9px; padding: 2px 4px; }
.clip-item__type--recent { background: #1d3340; color: #79c5ef; }
.clip-item__type--sentry { background: #3b2920; color: #efae76; }
.clip-item__type--saved { background: #3d2024; color: #f08a91; }

.sidebar__footer {
  border-top: 1px solid #292c2c;
  color: #666c6c;
  font-size: 11px;
  padding: 9px 12px;
  text-align: center;
}

.sidebar__resize {
  bottom: 0;
  cursor: col-resize;
  position: absolute;
  right: -4px;
  top: 0;
  touch-action: none;
  width: 8px;
  z-index: 5;
}

.sidebar__resize::after {
  background: transparent;
  content: '';
  inset: 0 3px;
  position: absolute;
  transition: background 120ms ease;
}

.sidebar__resize:hover::after,
.sidebar__resize--active::after { background: #e82127; }

@media (max-width: 840px) {
  .clip-item { grid-template-columns: 1fr; }
  .clip-item__thumb { display: none; }
}
</style>
