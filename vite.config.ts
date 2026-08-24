import {defineConfig, loadEnv} from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron/simple'

const electronExternals = [/^electron-log(\/.*)?$/, /^ffmpeg-static$/]

export default defineConfig(({command, mode}) => {
    const env = loadEnv(mode, process.cwd(), '')
    const isServe = command === 'serve'
    const isBuild = command === 'build'

    return {
        plugins: [
            vue(),
            electron({
                main: {
                    entry: 'electron/main/index.ts',
                    onstart({startup}) {
                        startup()
                    },
                    vite: {
                        build: {
                            sourcemap: isServe,
                            minify: isBuild,
                            outDir: 'dist-electron/main',
                            rolldownOptions: {
                                external: electronExternals,
                            },
                        },
                    },
                },

                preload: {
                    input: 'electron/preload/index.ts',
                    vite: {
                        build: {
                            sourcemap: isServe ? 'inline' : false,
                            minify: isBuild,
                            outDir: 'dist-electron/preload',
                            rolldownOptions: {
                                external: electronExternals,
                            },
                        },
                    },
                }
            }),
        ],
        server: {
            host: env.VITE_DEV_HOST || '0.0.0.0',
            port: Number(env.VITE_DEV_PORT) || 5173,
        },
        clearScreen: false,
    }
})
