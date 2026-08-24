import {defineStore} from 'pinia'
import {ref, watch} from 'vue'
import i18n from '../i18n'
import type {AppLocale} from '../i18n'

const localeKey = 'tesla-cam-locale'
const storedLocale = localStorage.getItem(localeKey)
const defaultLocale: AppLocale = storedLocale === 'en' ? 'en' : 'zh-CN'

export const useLocaleStore = defineStore(
    'locale',
    () => {
        const locale = ref<AppLocale>(defaultLocale)

        function setLocale(newLocale: AppLocale) {
            locale.value = newLocale
        }

        watch(
            locale,
            newLocale => {
                i18n.global.locale.value = newLocale
                document.documentElement.lang = newLocale
                localStorage.setItem(localeKey, newLocale)
            },
            {immediate: true},
        )

        return {locale, setLocale}
    },
)
