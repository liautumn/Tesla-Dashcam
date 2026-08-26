import {createApp} from 'vue'
import {createPinia} from 'pinia'
import App from './App.vue'
import i18n from './i18n'
import {useLocaleStore} from './stores/locale'
import log from './utils/logger'
import {reportFatalError} from './utils/fatalError'
import 'element-plus/theme-chalk/base.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import './styles/theme.css'

document.documentElement.classList.add('dark')

const app = createApp(App)
app.config.errorHandler = error => {
    log.error('Unhandled Vue renderer error', error)
    reportFatalError(error)
}
window.addEventListener('error', event => reportFatalError(event.error || event.message))
window.addEventListener('unhandledrejection', event => reportFatalError(event.reason))

log.info('Renderer process bootstrapped')

const pinia = createPinia()
app.use(pinia)
app.use(i18n)
useLocaleStore(pinia)

app.mount('#app').$nextTick(() => {
    postMessage({payload: 'removeLoading'}, '*')
})
