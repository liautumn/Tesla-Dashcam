<script setup lang="ts">
import {ElButton} from 'element-plus'
import {AlertTriangle, RefreshCw} from 'lucide-vue-next'
import {ref} from 'vue'
import {useI18n} from 'vue-i18n'
import HomeView from './views/HomeView.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import 'element-plus/theme-chalk/el-button.css'
import {fatalError} from './utils/fatalError'

const {t} = useI18n()
const settingsOpen = ref(false)
const reload = () => window.location.reload()
</script>

<template>
  <div v-if="fatalError" class="fatal-error">
    <AlertTriangle :size="34" />
    <strong>{{ t('error.title') }}</strong>
    <span>{{ t('error.detail') }}</span>
    <pre>{{ fatalError }}</pre>
    <ElButton type="primary" @click="reload"><RefreshCw :size="16" />{{ t('error.reload') }}</ElButton>
  </div>
  <div v-else class="app-shell">
    <main class="app-main"><HomeView @settings="settingsOpen = true" /></main>
    <SettingsDialog v-model="settingsOpen" />
  </div>
</template>

<style scoped>
.fatal-error { align-items: center; background: #0b0c0c; color: #808787; display: flex; flex-direction: column; gap: 13px; height: 100vh; justify-content: center; padding: 32px; text-align: center; }
.fatal-error > svg { color: #e82127; }
.fatal-error strong { color: #eceeee; font-size: 18px; }
.fatal-error span { font-size: 12px; }
.fatal-error pre { background: #151717; border: 1px solid #2b2e2e; border-radius: 6px; color: #9da3a3; font-size: 10px; max-height: 180px; max-width: 720px; overflow: auto; padding: 12px; text-align: left; white-space: pre-wrap; width: 100%; }
.app-shell {
  background: #0b0c0c;
  color: #e5e8e8;
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  height: 100vh;
  overflow: hidden;
}

.app-main { height: 100%; min-height: 0; }
</style>
