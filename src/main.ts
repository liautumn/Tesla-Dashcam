import {createApp} from 'vue'
import {createPinia} from 'pinia'
import App from './App.vue'
import i18n from './i18n'
import {useLocaleStore} from './stores/locale'
import log from './utils/logger'
import 'element-plus/theme-chalk/base.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import './styles/theme.css'

document.documentElement.classList.add('dark')

const app = createApp(App)

log.info('Renderer process bootstrapped')

const pinia = createPinia()
app.use(pinia)
app.use(i18n)
useLocaleStore(pinia)

app.mount('#app').$nextTick(() => {
    postMessage({payload: 'removeLoading'}, '*')
})
