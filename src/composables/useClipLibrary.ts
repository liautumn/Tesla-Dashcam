import {onMounted, onUnmounted, ref, shallowRef} from 'vue'
import type {CamClip} from '../types/tesla'
import {ENCRYPTED_CLIPS_DIRECTORY, genClips} from '../utils/genClips'

const lastFolderKey = 'tesla-cam-last-folder'

export type ClipLibraryError =
    | {kind: 'no-videos'}
    | {kind: 'load'; message: string}

const readDirectoryFiles = async (root: FileSystemDirectoryEntry) => {
    const files: File[] = []

    const readEntries = (reader: FileSystemDirectoryReader) =>
        new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))

    const visit = async (entry: FileSystemEntry): Promise<void> => {
        if (entry.isFile) {
            const file = await new Promise<File>((resolve, reject) =>
                (entry as FileSystemFileEntry).file(resolve, reject),
            )
            Object.defineProperty(file, 'webkitRelativePath', {
                configurable: true,
                value: entry.fullPath.replace(/^\//, ''),
            })
            files.push(file)
            return
        }

        if (entry.isDirectory) {
            if (entry.name === ENCRYPTED_CLIPS_DIRECTORY) return

            const reader = (entry as FileSystemDirectoryEntry).createReader()
            while (true) {
                const entries = await readEntries(reader)
                if (!entries.length) break
                for (const child of entries) await visit(child)
            }
        }
    }

    await visit(root)
    return files
}

export const useClipLibrary = () => {
    const clips = shallowRef<CamClip[]>([])
    const selectedClip = shallowRef<CamClip>()
    const inputRef = ref<HTMLInputElement>()
    const dragging = ref(false)
    const scanning = ref(false)
    const error = ref<ClipLibraryError>()
    const lastFolder = ref(localStorage.getItem(lastFolderKey) ?? '')
    let dragDepth = 0
    let loadGeneration = 0

    const loadFiles = async (
        source: FileList | File[],
        folderName?: string,
        generation = ++loadGeneration,
    ) => {
        if (!source.length) return
        if (generation !== loadGeneration) return
        scanning.value = true
        error.value = undefined
        clips.value = []
        selectedClip.value = undefined
        try {
            const result = await genClips(source)
            if (generation !== loadGeneration) return
            if (!result.length) {
                error.value = {kind: 'no-videos'}
                return
            }
            clips.value = result
            const firstFile = Array.from(source)[0]
            const resolvedName = folderName || firstFile?.webkitRelativePath.split('/')[0] || ''
            if (resolvedName) {
                lastFolder.value = resolvedName
                localStorage.setItem(lastFolderKey, resolvedName)
            }
        } catch (cause) {
            if (generation === loadGeneration) {
                error.value = {
                    kind: 'load',
                    message: cause instanceof Error ? cause.message : String(cause),
                }
            }
        } finally {
            if (generation === loadGeneration) {
                scanning.value = false
                if (inputRef.value) inputRef.value.value = ''
            }
        }
    }

    const openFolder = () => inputRef.value?.click()

    const onInputChange = (event: Event) => {
        const input = event.target as HTMLInputElement
        if (input.files) void loadFiles(input.files)
    }

    const onDragEnter = (event: DragEvent) => {
        event.preventDefault()
        dragDepth += 1
        if (dragDepth === 1) dragging.value = true
    }
    const onDragLeave = (event: DragEvent) => {
        event.preventDefault()
        dragDepth = Math.max(0, dragDepth - 1)
        if (!dragDepth) dragging.value = false
    }
    const onDragOver = (event: DragEvent) => {
        event.preventDefault()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }
    const onDrop = async (event: DragEvent) => {
        event.preventDefault()
        dragDepth = 0
        dragging.value = false
        const generation = ++loadGeneration
        scanning.value = true
        error.value = undefined
        try {
            const items = Array.from(event.dataTransfer?.items ?? [])
            for (const item of items) {
                const entry = item.webkitGetAsEntry?.()
                if (entry?.isDirectory) {
                    const files = await readDirectoryFiles(entry as FileSystemDirectoryEntry)
                    await loadFiles(files, entry.name, generation)
                    return
                }
            }
            const files = event.dataTransfer?.files
            if (files?.length) await loadFiles(files, undefined, generation)
        } catch (cause) {
            if (generation === loadGeneration) {
                error.value = {
                    kind: 'load',
                    message: cause instanceof Error ? cause.message : String(cause),
                }
            }
        } finally {
            if (generation === loadGeneration) scanning.value = false
        }
    }

    onMounted(() => {
        inputRef.value?.setAttribute('webkitdirectory', '')
        inputRef.value?.setAttribute('directory', '')
        window.addEventListener('dragenter', onDragEnter)
        window.addEventListener('dragleave', onDragLeave)
        window.addEventListener('dragover', onDragOver)
        window.addEventListener('drop', onDrop)
    })

    onUnmounted(() => {
        loadGeneration += 1
        window.removeEventListener('dragenter', onDragEnter)
        window.removeEventListener('dragleave', onDragLeave)
        window.removeEventListener('dragover', onDragOver)
        window.removeEventListener('drop', onDrop)
    })

    return {
        clips,
        selectedClip,
        inputRef,
        dragging,
        scanning,
        error,
        lastFolder,
        openFolder,
        onInputChange,
    }
}
