<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, ref, shallowRef, watch} from 'vue'
import {ElButton, ElMessage} from 'element-plus'
import {AlertCircle, Film, FolderOpen, LoaderCircle, UploadCloud} from 'lucide-vue-next'
import {useI18n} from 'vue-i18n'
import ClipSidebar from '../components/ClipSidebar.vue'
import VideoViewer from '../components/VideoViewer.vue'
import {useClipLibrary} from '../composables/useClipLibrary'
import type {CamFootage} from '../types/tesla'
import {genFootage, revokeFootage} from '../utils/genFootage'
import {useSettingsStore} from '../stores/settings'
import type {TrashClipResult} from '../../shared/types'
import 'element-plus/theme-chalk/el-button.css'
import 'element-plus/theme-chalk/el-message.css'

defineOptions({name: 'HomeView'})

const {locale, t} = useI18n()
const settingsStore = useSettingsStore()

const {
    clips,
    selectedClip,
    inputRef,
    dragging,
    scanning,
    error: libraryError,
    lastFolder,
    openFolder,
    onInputChange,
} = useClipLibrary()

const footage = shallowRef<CamFootage>()
const loadingFootage = ref(false)
const loadProgress = ref({current: 0, total: 0})
const footageError = ref('')
let loadGeneration = 0

const errorText = computed(() => {
    if (footageError.value) return footageError.value
    if (libraryError.value?.kind === 'no-videos') return t('home.noVideos')
    return libraryError.value?.message ?? ''
})

watch(
    selectedClip,
    async clip => {
        const generation = ++loadGeneration
        revokeFootage(footage.value)
        footage.value = undefined
        footageError.value = ''
        if (!clip) return

        loadingFootage.value = true
        loadProgress.value = {current: 0, total: clip.videos.length}
        try {
            const nextFootage = await genFootage(clip.videos, (current, total) => {
                if (generation === loadGeneration) loadProgress.value = {current, total}
            })
            if (generation !== loadGeneration) {
                revokeFootage(nextFootage)
                return
            }
            footage.value = nextFootage
        } catch (cause) {
            if (generation === loadGeneration) {
                footageError.value = cause instanceof Error ? cause.message : String(cause)
            }
        } finally {
            if (generation === loadGeneration) loadingFootage.value = false
        }
    },
    {flush: 'post'},
)

const selectRelative = (offset: number) => {
    if (!selectedClip.value) return
    const index = clips.value.findIndex(clip => clip.id === selectedClip.value?.id)
    const next = clips.value[index + offset]
    if (next) selectedClip.value = next
}

const deleteClip = async (clip: typeof selectedClip.value): Promise<TrashClipResult | undefined> => {
    if (!clip) return undefined
    const trash = window.trash
    if (!trash) return {ok: false, code: 'source-paths-unavailable'}

    const index = clips.value.findIndex(item => item.id === clip.id)
    loadGeneration += 1
    revokeFootage(footage.value)
    footage.value = undefined
    loadingFootage.value = false

    const result = await trash.moveClip(clip.videos, clip.name, String(locale.value))
    if (result.ok) {
        clips.value = clips.value.filter(item => item.id !== clip.id)
        selectedClip.value = clips.value[Math.min(Math.max(index, 0), clips.value.length - 1)]
        ElMessage.success(t('toast.deleted'))
    } else {
        selectedClip.value = undefined
        await nextTick()
        selectedClip.value = clip
    }
    return result
}

const onClipEnded = () => {
    if (settingsStore.app.autoAdvance) selectRelative(1)
}

onBeforeUnmount(() => {
    loadGeneration += 1
    revokeFootage(footage.value)
})
</script>

<template>
  <div class="workspace">
    <input ref="inputRef" class="folder-input" type="file" multiple @change="onInputChange" />

    <ClipSidebar
      :items="clips"
      :selected="selectedClip"
      :scanning="scanning"
      @open="openFolder"
      @select="selectedClip = $event"
    />

    <main class="content">
      <VideoViewer
        v-if="selectedClip && footage"
        :clip="selectedClip"
        :footage="footage"
        :delete-clip="deleteClip"
        @next="selectRelative(1)"
        @previous="selectRelative(-1)"
        @ended="onClipEnded"
      />

      <div v-else-if="loadingFootage" class="state state--loading">
        <LoaderCircle class="spin" :size="34" />
        <strong>{{ t('home.loadingTimeline') }}</strong>
        <span>{{ loadProgress.current }} / {{ loadProgress.total }}</span>
        <div class="load-track">
          <div
            class="load-track__value"
            :style="{width: `${loadProgress.total ? (loadProgress.current / loadProgress.total) * 100 : 0}%`}"
          />
        </div>
      </div>

      <div v-else-if="errorText" class="state state--error">
        <AlertCircle :size="32" />
        <strong>{{ t('home.loadFailed') }}</strong>
        <span>{{ errorText }}</span>
        <ElButton @click="openFolder"><FolderOpen :size="17" />{{ t('home.retry') }}</ElButton>
      </div>

      <div v-else-if="clips.length" class="state">
        <div class="state__mark"><Film :size="34" /></div>
        <strong>{{ t('home.selectClip') }}</strong>
      </div>

      <div v-else class="state state--empty">
        <div class="state__mark"><UploadCloud :size="34" /></div>
        <strong>{{ t('home.selectFolder') }}</strong>
        <span>{{ t('home.supportedFolders') }}</span>
        <ElButton type="primary" @click="openFolder"><FolderOpen :size="17" />{{ t('home.chooseFolder') }}</ElButton>
        <small v-if="lastFolder">{{ t('home.lastOpened', {folder: lastFolder}) }}</small>
      </div>
    </main>

    <div v-if="dragging" class="drop-overlay">
      <div class="drop-overlay__target">
        <UploadCloud :size="44" />
        <strong>{{ t('home.dropToLoad') }}</strong>
      </div>
    </div>
  </div>
</template>

<style scoped>
.workspace {
  background: #0b0c0c;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  height: 100%;
  min-height: 0;
}

.folder-input { display: none; }
.content { min-height: 0; min-width: 0; position: relative; }

.state {
  align-items: center;
  color: #747b7b;
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  justify-content: center;
  padding: 32px;
  text-align: center;
}

.state strong { color: #d6dada; font-size: 17px; font-weight: 500; }
.state span { font-size: 12px; max-width: 480px; }
.state small { color: #555b5b; }
.state__mark { align-items: center; border: 1px solid #353939; border-radius: 8px; color: #8d9393; display: flex; height: 70px; justify-content: center; width: 70px; }
.state--error svg { color: #d65a63; }

.load-track { background: #252828; border-radius: 2px; height: 3px; overflow: hidden; width: 220px; }
.load-track__value { background: #e82127; height: 100%; transition: width 160ms ease; }
.spin { animation: spin 900ms linear infinite; color: #e82127; }

.drop-overlay {
  align-items: center;
  backdrop-filter: blur(8px);
  background: rgb(0 0 0 / 76%);
  display: flex;
  inset: 0;
  justify-content: center;
  position: fixed;
  z-index: 100;
}

.drop-overlay__target {
  align-items: center;
  border: 2px dashed #e82127;
  border-radius: 8px;
  color: #f2f3f3;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 50px 72px;
}

.drop-overlay__target svg { color: #e82127; }

@keyframes spin { to { transform: rotate(360deg); } }

</style>
