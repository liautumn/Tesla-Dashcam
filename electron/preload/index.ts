// ------------------------------------------------------------------
// DOM Ready 工具函数
// ------------------------------------------------------------------
function domReady(
    // 默认等待 DOM 进入 interactive 或 complete
    condition: DocumentReadyState[] = ['complete', 'interactive']
) {
    return new Promise((resolve) => {

        // 如果当前状态已经满足条件
        if (condition.includes(document.readyState)) {

            // 立即 resolve
            resolve(true)

        } else {

            // 否则监听 document 状态变化
            document.addEventListener('readystatechange', () => {

                // 状态满足条件时 resolve
                if (condition.includes(document.readyState)) {
                    resolve(true)
                }
            }, {once: true})
        }
    })
}

// ------------------------------------------------------------------
// 安全 DOM 操作工具，避免重复插入 / 删除报错
// ------------------------------------------------------------------
const safeDOM = {

    // 安全地 append 子节点
    append(parent: HTMLElement, child: HTMLElement) {

        // 如果 parent 里还没有这个 child
        if (!Array.from(parent.children).find(e => e === child)) {

            // 才执行 append
            return parent.appendChild(child)
        }
    },

    // 安全地 remove 子节点
    remove(parent: HTMLElement, child: HTMLElement) {

        // 如果 parent 中存在这个 child
        if (Array.from(parent.children).find(e => e === child)) {

            // 才执行 remove
            return parent.removeChild(child)
        }
    },
}

// ------------------------------------------------------------------
// Loading 动图实现（应用启动过渡）
// ------------------------------------------------------------------
function useLoading() {
    const loadingImagePath = new URL('./loading.gif', window.location.href).toString()

    const styleContent = `
.app-loading-wrap {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #282c34;
  z-index: 9;
}
.app-loading-gif {
  display: block;
  max-width: min(46vw, 320px);
  max-height: min(46vh, 320px);
  object-fit: contain;
  user-select: none;
  -webkit-user-drag: none;
}
`

    const oStyle = document.createElement('style')
    const oDiv = document.createElement('div')
    const oImage = document.createElement('img')

    oStyle.id = 'app-loading-style'
    oStyle.textContent = styleContent
    oDiv.className = 'app-loading-wrap'
    oImage.className = 'app-loading-gif'
    oImage.alt = 'Application loading'
    oImage.src = loadingImagePath
    oDiv.appendChild(oImage)

    const clearLoading = () => {
        safeDOM.remove(document.head, oStyle)
        safeDOM.remove(document.body, oDiv)
    }

    // GIF 资源异常时直接移除遮罩，避免显示损坏图片
    oImage.addEventListener('error', clearLoading)

    // 返回控制 Loading 的方法
    return {

        // 显示 Loading
        appendLoading() {
            safeDOM.append(document.head, oStyle)
            safeDOM.append(document.body, oDiv)
        },

        // 移除 Loading
        removeLoading() {
            clearLoading()
        },
    }
}

// ------------------------------------------------------------------
// Loading 生命周期控制
// ------------------------------------------------------------------

// 解构出显示 / 移除 Loading 的方法
const {appendLoading, removeLoading} = useLoading()

// DOM 就绪后显示 Loading
domReady().then(appendLoading)

// 监听 Renderer 发出的启动完成消息
window.addEventListener('message', event => {
    if (
        event.source === window
        && typeof event.data === 'object'
        && event.data !== null
        && event.data.payload === 'removeLoading'
    ) {
        removeLoading()
    }
})

// 兜底：5 秒后强制移除 Loading，防止卡死
setTimeout(removeLoading, 4999)
