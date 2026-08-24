<script setup lang="ts">
import {storeToRefs} from 'pinia'
import {ElButton} from 'element-plus'
import {CarFront, Languages} from 'lucide-vue-next'
import {useI18n} from 'vue-i18n'
import HomeView from './views/HomeView.vue'
import {useLocaleStore} from './stores/locale'
import 'element-plus/theme-chalk/el-button.css'

const localeStore = useLocaleStore()
const {locale} = storeToRefs(localeStore)
const {t} = useI18n()
const toggleLocale = () => localeStore.setLocale(locale.value === 'zh-CN' ? 'en' : 'zh-CN')
</script>

<template>
  <div class="app-shell">
    <header class="titlebar">
      <div class="titlebar__brand">
        <CarFront :size="19" />
        <span>Tesla Dashcam</span>
      </div>
      <div class="titlebar__title">{{ t('app.title') }}</div>
      <div class="titlebar__actions">
        <ElButton text circle :title="t('app.switchLanguage')" @click="toggleLocale">
          <Languages :size="18" />
        </ElButton>
      </div>
    </header>
    <main class="app-main"><HomeView /></main>
  </div>
</template>

<style scoped>
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
  gap: 8px;
}

.titlebar__brand span { color: #b8bdbd; }
.titlebar__title { color: #868c8c; font-size: 13px; font-weight: 500; }
.titlebar__actions { -webkit-app-region: no-drag; justify-self: end; }
.app-main { min-height: 0; }
</style>
