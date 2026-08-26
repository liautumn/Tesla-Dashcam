import {chromium} from '../../Tesla-cam/node_modules/playwright/index.mjs'

const browser = await chromium.connectOverCDP('http://127.0.0.1:9229')
const pages = browser.contexts().flatMap(context => context.pages())
const page = pages.find(candidate => /https?:\/\/(?:localhost|127\.0\.0\.1):\d+\//.test(candidate.url()))
if (!page) throw new Error(`Renderer page not found: ${pages.map(item => item.url()).join(', ')}`)

const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text())
})
await page.setViewportSize({width: 1440, height: 900})
await page.reload()
await page.waitForLoadState('domcontentloaded')
await page.locator('input[type=file]').setInputFiles('/Volumes/TESLADRIVE/TeslaCam/SavedClips')
await page.waitForFunction(() => document.querySelectorAll('.clip-item').length >= 2, null, {timeout: 120_000})
const defaultSelectionCount = await page.locator('.clip-item--active').count()
if (defaultSelectionCount) throw new Error('A clip was selected before user input')
await page.locator('.clip-item').first().click()
await page.waitForFunction(() => document.querySelectorAll('video').length === 6, null, {timeout: 120_000})
await page.waitForFunction(
    () => [...document.querySelectorAll('video')].some(video => video.readyState >= 2),
    null,
    {timeout: 120_000},
)
await page.waitForTimeout(6000)
await page.screenshot({path: '/private/tmp/tesla-dashcam-smoke.png'})

for (const label of ['六宫格', '经典四画面', '前视', '四宫格']) {
    await page.getByRole('button', {name: label, exact: true}).click()
    await page.waitForTimeout(300)
}
await page.locator('button[title="设置"]').click()
await page.waitForSelector('.el-dialog')
await page.waitForTimeout(400)
await page.screenshot({path: '/private/tmp/tesla-dashcam-settings.png'})
await page.keyboard.press('Escape')
await page.setViewportSize({width: 960, height: 640})
await page.waitForTimeout(500)
await page.screenshot({path: '/private/tmp/tesla-dashcam-compact.png'})

const result = await page.evaluate(defaultSelectionCount => ({
    title: document.title,
    clips: document.querySelectorAll('.clip-item').length,
    defaultSelectionCount,
    videos: [...document.querySelectorAll('video')].map(video => ({
        readyState: video.readyState,
        width: video.videoWidth,
        height: video.videoHeight,
        paused: video.paused,
    })),
    activeLayout: document.querySelector('.layout-switcher .is-active')?.textContent?.trim(),
    layouts: [...document.querySelectorAll('.layout-switcher button')].map(item => item.textContent?.trim()),
    amapLinks: [...document.querySelectorAll('a')].filter(link => link.href.includes('amap.com')).length,
    otherMapLinks: [...document.querySelectorAll('a')].filter(link => /maps|map\.baidu/i.test(link.href)).length,
    hasTelemetry: document.body.innerText.includes('km/h'),
    hasDesktopApi: Boolean(window.files && window.trash && window.composeExport && window.frameExport),
    hasLegacyElectronApi: 'electronAPI' in window,
    telemetryAlwaysExpanded: Boolean(document.querySelector('.dashboard__details')) && !document.querySelector('.dashboard__toggle'),
    hasDrivingMode: document.body.innerText.includes('驾驶模式'),
    hasSeiIdentity: document.body.innerText.includes('SEI') && document.body.innerText.includes('帧序号'),
    bodyOverflow: document.body.scrollHeight > innerHeight || document.body.scrollWidth > innerWidth,
    controlsOverflow: [...document.querySelectorAll('button')].some(button => button.scrollWidth > button.clientWidth + 1),
    text: document.body.innerText.slice(0, 1200),
}), defaultSelectionCount)
if (!result.hasDesktopApi || result.hasLegacyElectronApi) {
    throw new Error(`Unexpected preload API shape: ${JSON.stringify(result)}`)
}
console.log(JSON.stringify({result, errors}, null, 2))
await browser.close()
