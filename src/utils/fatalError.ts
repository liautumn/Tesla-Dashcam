import {ref} from 'vue'

export const fatalError = ref('')

export const reportFatalError = (error: unknown) => {
    if (fatalError.value) return
    fatalError.value = error instanceof Error ? error.stack || error.message : String(error)
}
