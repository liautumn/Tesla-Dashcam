<script setup lang="ts">
import {storeToRefs} from 'pinia'
import {ElDialog, ElSegmented, ElSwitch} from 'element-plus'
import {useI18n} from 'vue-i18n'
import {useLocaleStore} from '../stores/locale'
import {useSettingsStore} from '../stores/settings'
import 'element-plus/theme-chalk/el-dialog.css'
import 'element-plus/theme-chalk/el-segmented.css'
import 'element-plus/theme-chalk/el-switch.css'

defineProps<{modelValue: boolean}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const {t} = useI18n()
const localeStore = useLocaleStore()
const settingsStore = useSettingsStore()
const {locale} = storeToRefs(localeStore)
const {app, exportOptions} = storeToRefs(settingsStore)

const locales = [
    {label: '中文', value: 'zh-CN'},
    {label: 'English', value: 'en'},
]
const widths = [
    {label: '3840', value: 3840},
    {label: '2880', value: 2880},
    {label: '1920', value: 1920},
]
</script>

<template>
  <ElDialog
    :model-value="modelValue"
    :title="t('settings.title')"
    width="520px"
    align-center
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="settings">
      <section>
        <h3>{{ t('settings.general') }}</h3>
        <div class="setting-row">
          <span>{{ t('settings.language') }}</span>
          <ElSegmented v-model="locale" :options="locales" @change="localeStore.setLocale($event as 'zh-CN' | 'en')" />
        </div>
      </section>
      <section>
        <h3>{{ t('settings.playback') }}</h3>
        <label class="setting-row"><span>{{ t('settings.autoAdvance') }}</span><ElSwitch v-model="app.autoAdvance" /></label>
        <label class="setting-row"><span>{{ t('settings.autoSeekEvent') }}</span><ElSwitch v-model="app.autoSeekEvent" /></label>
        <label class="setting-row"><span>{{ t('settings.sentryCameraFocus') }}</span><ElSwitch v-model="app.sentryCameraFocus" /></label>
      </section>
      <section>
        <h3>{{ t('settings.export') }}</h3>
        <label class="setting-row"><span>{{ t('settings.exportTime') }}</span><ElSwitch v-model="exportOptions.showTime" /></label>
        <label class="setting-row"><span>{{ t('settings.exportLocation') }}</span><ElSwitch v-model="exportOptions.showLocation" /></label>
        <label class="setting-row"><span>{{ t('settings.exportDriveData') }}</span><ElSwitch v-model="exportOptions.showDriveData" /></label>
        <label class="setting-row"><span>{{ t('settings.exportHwAccel') }}</span><ElSwitch v-model="exportOptions.hwAccel" /></label>
        <div class="setting-row setting-row--stack">
          <span>{{ t('settings.exportVideoWidth') }}</span>
          <ElSegmented v-model="exportOptions.videoMaxWidth" :options="widths" />
        </div>
      </section>
    </div>
  </ElDialog>
</template>

<style scoped>
.settings { display: grid; gap: 20px; }
.settings section { display: grid; gap: 8px; }
.settings h3 { color: #8f9696; font-size: 11px; letter-spacing: 0; margin: 0 2px 3px; text-transform: uppercase; }
.setting-row { align-items: center; background: #181a1a; border: 1px solid #292c2c; border-radius: 6px; color: #d4d7d7; display: flex; font-size: 13px; justify-content: space-between; min-height: 43px; padding: 8px 12px; }
.setting-row--stack { align-items: stretch; flex-direction: column; gap: 9px; }
</style>
