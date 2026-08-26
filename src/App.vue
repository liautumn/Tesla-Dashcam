<script setup lang="ts">
import {storeToRefs} from 'pinia'
import {ElButton} from 'element-plus'
import {AlertTriangle, Languages, RefreshCw, Settings} from 'lucide-vue-next'
import {ref} from 'vue'
import {useI18n} from 'vue-i18n'
import HomeView from './views/HomeView.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import {useLocaleStore} from './stores/locale'
import 'element-plus/theme-chalk/el-button.css'
import {fatalError} from './utils/fatalError'

const localeStore = useLocaleStore()
const {locale} = storeToRefs(localeStore)
const {t} = useI18n()
const settingsOpen = ref(false)
const toggleLocale = () => localeStore.setLocale(locale.value === 'zh-CN' ? 'en' : 'zh-CN')
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
    <header class="titlebar">
      <div class="titlebar__brand">
        <span class="titlebar__logo" aria-hidden="true">
          <img src="/logo.png" alt="" />
        </span>
        <span>Tesla Dashcam</span>
      </div>
      <div class="titlebar__title">{{ t('app.title') }}</div>
      <div class="titlebar__actions">
        <ElButton text circle :title="t('app.switchLanguage')" @click="toggleLocale">
          <Languages :size="18" />
        </ElButton>
        <ElButton text circle :title="t('settings.title')" @click="settingsOpen = true">
          <Settings :size="18" />
        </ElButton>
      </div>
    </header>
    <main class="app-main"><HomeView /></main>
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
  grid-template-rows: 48px minmax(0, 1fr);
  height: 100vh;
  overflow: hidden;
}

.titlebar {
  -webkit-app-region: drag;
  align-items: center;
  background: #0c0d0d;
  border-bottom: 1px solid #292c2c;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  padding: 0 12px 0 16px;
  user-select: none;
}

.titlebar__brand {
  align-items: center;
  color: #e82127;
  display: flex;
  font-size: 12px;
  font-weight: 600;
  gap: 7px;
}

.titlebar__logo {
  border-radius: 50%;
  display: block;
  flex: 0 0 20px;
  height: 20px;
  overflow: hidden;
  position: relative;
}

.titlebar__logo img {
  height: 36px;
  left: 50%;
  max-width: none;
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 36px;
}

.titlebar__brand span { color: #b8bdbd; }
.titlebar__title { color: #868c8c; font-size: 13px; font-weight: 500; }
.titlebar__actions { -webkit-app-region: no-drag; display: flex; justify-self: end; }
.app-main { min-height: 0; }
</style>
