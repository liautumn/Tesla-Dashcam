<script setup lang="ts">
import {Film} from 'lucide-vue-next'
import {onMounted, onUnmounted, ref} from 'vue'
import {getCachedPosterFrame, getPosterFrame} from '../utils/posterFrame'

const props = defineProps<{
    file?: File
    videoFile?: File
    cacheKey: string
}>()

const root = ref<HTMLElement>()
const src = ref(getCachedPosterFrame(props.cacheKey))
let suppliedThumbUrl = ''
let observer: IntersectionObserver | undefined
let canceled = false

onMounted(() => {
    if (props.file) {
        suppliedThumbUrl = URL.createObjectURL(props.file)
        src.value = suppliedThumbUrl
        return
    }
    if (src.value || !props.videoFile || !root.value) return
    observer = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting)) return
        observer?.disconnect()
        void getPosterFrame(props.cacheKey, props.videoFile!).then(generated => {
            if (!canceled && generated) src.value = generated
        })
    }, {rootMargin: '120px'})
    observer.observe(root.value)
})

onUnmounted(() => {
    canceled = true
    observer?.disconnect()
    if (suppliedThumbUrl) URL.revokeObjectURL(suppliedThumbUrl)
})
</script>

<template>
  <div ref="root" class="thumbnail">
    <img v-if="src" :src="src" alt="" loading="lazy" />
    <Film v-else :size="22" />
  </div>
</template>

<style scoped>
.thumbnail { align-items: center; color: #626969; display: flex; height: 100%; justify-content: center; width: 100%; }
.thumbnail img { height: 100%; object-fit: cover; width: 100%; }
</style>
