import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import ffmpegStatic from 'ffmpeg-static'
import {prepareComposeExport} from '../electron/main/mod/composeExportBuilder.ts'
import {moveClipDirectoryToSystemTrash} from '../electron/main/mod/trashOperation.ts'
import {validateTrashFilesPayload} from '../electron/main/mod/trashValidation.ts'
import {resolveTrashPaths} from '../electron/preload/mod/resolveTrashPaths.ts'
import type {ComposeExportRequest} from '../shared/types/index.ts'
import type {SEIDataPoint} from '../src/types/tesla.ts'
import {detectHardBraking} from '../src/utils/detectIncidents.ts'
import {
    resolveExportCanvasSize,
    resolveOverlayBarLayout,
    selectSegmentsInRange,
} from '../src/utils/exportLayout.ts'
import {convertToDataPoints} from '../src/utils/parseSEI.ts'
import {shareInflight} from '../src/utils/shareInflight.ts'
import {normalizeAppSettings, normalizeExportSettings} from '../src/stores/settings.ts'
import {formatTelemetryOverlay} from '../src/utils/telemetry.ts'
import {genClips} from '../src/utils/genClips.ts'

const graphOf = (prepared: ReturnType<typeof prepareComposeExport>) => {
    const index = prepared.args.indexOf('-filter_complex_script')
    assert.ok(index >= 0)
    return fs.readFileSync(prepared.args[index + 1], 'utf8')
}

const teslaFile = (relativePath: string) => {
    const file = new File(['video'], path.basename(relativePath), {type: 'video/mp4'})
    Object.defineProperty(file, 'webkitRelativePath', {value: relativePath})
    return file
}

test('clip discovery excludes every EncryptedClips category', async () => {
    const recent = '2026-08-31_10-00-00'
    const saved = '2026-08-31_11-00-00'
    const sentry = '2026-08-31_12-00-00'
    const encrypted = '2026-08-31_13-00-00'
    const clips = await genClips([
        teslaFile(`TeslaCam/RecentClips/${recent}-front.mp4`),
        teslaFile(`TeslaCam/SavedClips/${saved}/${saved}-front.mp4`),
        teslaFile(`TeslaCam/SentryClips/${sentry}/${sentry}-front.mp4`),
        teslaFile(`TeslaCam/EncryptedClips/RecentClips/${encrypted}-front.mp4`),
        teslaFile(`TeslaCam/EncryptedClips/SavedClips/${encrypted}/${encrypted}-front.mp4`),
        teslaFile(`TeslaCam/EncryptedClips/SentryClips/${encrypted}/${encrypted}-front.mp4`),
    ])

    assert.deepEqual(clips.map(clip => clip.type).sort(), ['recent', 'saved', 'sentry'])
    assert.ok(clips.every(clip => !clip.id.includes('EncryptedClips')))
})

test('compose export preserves a missing middle camera segment as black video', () => {
    const request: ComposeExportRequest = {
        sessionId: 'missing-middle',
        fileName: 'out.mp4',
        viewType: 'front',
        startSeconds: 0,
        durationSeconds: 3,
        fps: 24,
        segments: [
            {name: 's0', startSeconds: 0, duration: 1, paths: {front: '/tmp/front-0.mp4'}},
            {name: 's1', startSeconds: 1, duration: 1, paths: {}},
            {name: 's2', startSeconds: 2, duration: 1, paths: {front: '/tmp/front-2.mp4'}},
        ],
    }
    const prepared = prepareComposeExport(request, '/tmp/out.mp4')
    try {
        const graph = graphOf(prepared)
        assert.match(graph, /color=c=black:[^;]*d=1\.000/)
        assert.match(graph, /concat=n=3:v=1:a=0/)
        assert.equal(prepared.args.filter(value => value === '-i').length, 2)
    } finally {
        if (prepared.tmpDir) fs.rmSync(prepared.tmpDir, {recursive: true, force: true})
    }
})

test('compose export also fills leading and trailing timeline gaps', () => {
    const request: ComposeExportRequest = {
        sessionId: 'edge-gaps', fileName: 'out.mp4', viewType: 'front',
        startSeconds: 0, durationSeconds: 4, fps: 24,
        segments: [{name: 's1', startSeconds: 1, duration: 2, paths: {front: '/tmp/front.mp4'}}],
    }
    const prepared = prepareComposeExport(request, '/tmp/out.mp4')
    try {
        const graph = graphOf(prepared)
        assert.equal((graph.match(/color=c=black/g) ?? []).length, 2)
        assert.match(graph, /concat=n=3:v=1:a=0/)
    } finally {
        if (prepared.tmpDir) fs.rmSync(prepared.tmpDir, {recursive: true, force: true})
    }
})

test('compose export preserves CJK location text', () => {
    const location = '\u4e0a\u6d77 \u822a\u4e1c\u8def'
    const request: ComposeExportRequest = {
        sessionId: 'cjk-location', fileName: 'out.mp4', viewType: 'front',
        startSeconds: 0, durationSeconds: 1, fps: 24,
        segments: [{name: 's0', startSeconds: 0, duration: 1, paths: {front: '/tmp/front.mp4'}}],
        overlay: {
            showTime: false,
            showLocation: true,
            showDriveData: false,
            locationText: location,
        },
    }
    const prepared = prepareComposeExport(request, '/tmp/out.mp4')
    try {
        assert.ok(prepared.tmpDir)
        const textValues = fs.readdirSync(prepared.tmpDir)
            .filter(file => /^t\d+\.txt$/.test(file))
            .map(file => fs.readFileSync(path.join(prepared.tmpDir!, file), 'utf8'))
        assert.ok(textValues.includes(location))
        assert.ok(textValues.includes(`| ${location}`))
        assert.ok(!textValues.includes('Location unavailable'))
        assert.ok(fs.statSync(path.resolve('public/fonts/NotoSansCJKsc-Regular.otf')).size > 1_000_000)
        assert.match(graphOf(prepared), /NotoSansCJKsc-Regular\.otf/)
    } finally {
        if (prepared.tmpDir) fs.rmSync(prepared.tmpDir, {recursive: true, force: true})
    }
})

test('FFmpeg compose keeps the missing middle second black and the full duration intact', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tesla-dashcam-compose-'))
    const makeColor = (name: string, color: string, duration: number) => {
        const output = path.join(root, name)
        const generated = spawnSync(ffmpegStatic!, [
            '-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
            `color=c=${color}:s=128x72:d=${duration}:r=12`, '-pix_fmt', 'yuv420p', output,
        ], {encoding: 'utf8'})
        assert.equal(generated.status, 0, generated.stderr)
        return output
    }
    const first = makeColor('first.mp4', 'red', .5)
    const last = makeColor('last.mp4', 'blue', .75)
    const output = path.join(root, 'out.mp4')
    const request: ComposeExportRequest = {
        sessionId: 'ffmpeg-gap', fileName: 'out.mp4', viewType: 'front',
        startSeconds: 0, durationSeconds: 3, fps: 12,
        segments: [
            {name: 's0', startSeconds: 0, duration: 1, paths: {front: first}},
            {name: 's1', startSeconds: 1, duration: 1, paths: {}},
            {name: 's2', startSeconds: 2, duration: 1, paths: {front: last}},
        ],
        overlay: {showTime: false, showLocation: false, showDriveData: false},
        layout: {
            width: 160, videoHeight: 90, barHeight: 30, height: 120, scale: .125,
            padding: 4, brandSize: 9, titleSize: 16, subSize: 12, gap: 2,
            hPad: 4, leftTextX: 4,
        },
    }
    const prepared = prepareComposeExport(request, output)
    try {
        const encoded = spawnSync(ffmpegStatic!, prepared.args, {encoding: 'utf8'})
        assert.equal(encoded.status, 0, encoded.stderr)
        const middle = spawnSync(ffmpegStatic!, [
            '-hide_banner', '-loglevel', 'error', '-ss', '1.5', '-i', output,
            '-frames:v', '1', '-vf', 'crop=80:40:40:20,signalstats,metadata=print:file=-',
            '-f', 'null', '-',
        ], {encoding: 'utf8'})
        assert.equal(middle.status, 0, middle.stderr)
        const luma = Number(middle.stdout.match(/signalstats\.YAVG=([\d.]+)/)?.[1])
        assert.ok(Number.isFinite(luma) && luma < 25, `middle-frame luma was ${luma}`)
        const durationProbe = spawnSync(ffmpegStatic!, ['-hide_banner', '-i', output, '-f', 'null', '-'], {encoding: 'utf8'})
        assert.match(durationProbe.stderr, /Duration: 00:00:03\.00/)
    } finally {
        if (prepared.tmpDir) fs.rmSync(prepared.tmpDir, {recursive: true, force: true})
        fs.rmSync(root, {recursive: true, force: true})
    }
})

test('FFmpeg compose renders bundled Chinese telemetry below the camera image', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tesla-dashcam-cjk-render-'))
    const source = path.join(root, 'source.mp4')
    const output = path.join(root, 'out.mp4')
    const generated = spawnSync(ffmpegStatic!, [
        '-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
        'color=c=blue:s=640x360:d=0.5:r=10', '-pix_fmt', 'yuv420p', source,
    ], {encoding: 'utf8'})
    assert.equal(generated.status, 0, generated.stderr)

    const content = {showTime: true, showLocation: true, showDriveData: true}
    const size = resolveExportCanvasSize({
        viewType: 'front', sourceWidth: 640, sourceHeight: 360, overlay: content,
    })
    const bar = resolveOverlayBarLayout(size.scale, content)
    const request: ComposeExportRequest = {
        sessionId: 'cjk-render', fileName: 'out.mp4', viewType: 'front',
        startSeconds: 0, durationSeconds: .5, fps: 10,
        segments: [{name: 's0', startSeconds: 0, duration: .5, paths: {front: source}}],
        layout: {...bar, ...size, hPad: 11, leftTextX: 11},
        overlay: {
            ...content,
            brandText: 'TESLA DASHCAM',
            locationText: '上海市浦东新区',
            timeWindows: [{start: 0, end: .5, text: '2026/08/26 周三 12:34:56'}],
            driveWindows: [{
                start: 0,
                end: .5,
                text: '速度 72 km/h | 档位 D | 模式 TACC | 油门 38% | 刹车 100% | 转向灯 <',
            }],
        },
    }
    const prepared = prepareComposeExport(request, output)
    try {
        const graph = graphOf(prepared)
        const textYValues = Array.from(graph.matchAll(/drawtext=[^;]*:y=(\d+)/g), match => Number(match[1]))
        assert.ok(textYValues.length >= 4)
        assert.ok(textYValues.every(y => y >= size.videoHeight), textYValues.join(','))
        const encoded = spawnSync(ffmpegStatic!, prepared.args, {encoding: 'utf8'})
        assert.equal(encoded.status, 0, encoded.stderr)
        const bottom = spawnSync(ffmpegStatic!, [
            '-hide_banner', '-loglevel', 'error', '-ss', '0.2', '-i', output,
            '-frames:v', '1', '-vf',
            `crop=${size.width}:${size.barHeight}:0:${size.videoHeight},signalstats,metadata=print:file=-`,
            '-f', 'null', '-',
        ], {encoding: 'utf8'})
        assert.equal(bottom.status, 0, bottom.stderr)
        const maxLuma = Number(bottom.stdout.match(/signalstats\.YMAX=(\d+)/)?.[1])
        assert.ok(maxLuma > 100, `bottom-bar max luma was ${maxLuma}`)
    } finally {
        if (prepared.tmpDir) fs.rmSync(prepared.tmpDir, {recursive: true, force: true})
        fs.rmSync(root, {recursive: true, force: true})
    }
})

test('SEI conversion exposes every decoded identity and driving-mode field', () => {
    const points = convertToDataPoints([{
        version: 4,
        frameSeqNo: 321,
        gearState: 1,
        autopilotState: 1,
        vehicleSpeedMps: 20,
        acceleratorPedalPosition: 38,
        steeringWheelAngle: 12.5,
        brakeApplied: true,
        blinkerOnLeft: true,
        latitudeDeg: 31.2304,
        longitudeDeg: 121.4737,
        headingDeg: 92,
        linearAccelerationX: -.3,
        linearAccelerationY: .2,
        linearAccelerationZ: 9.7,
    }], 0)
    assert.equal(points[0].seiVersion, 4)
    assert.equal(points[0].frameSequence, 321)
    assert.equal(points[0].autopilotState, 1)
    assert.equal(points[0].apStatus, 'FSD')
    assert.equal(points[0].speedKph, 72)
    assert.equal(points[0].throttlePct, 38)
    assert.equal(points[0].brakePct, 100)
    assert.equal(points[0].blinkerLeft, true)
    assert.equal(points[0].latitude, 31.2304)
    assert.equal(points[0].longitude, 121.4737)
    assert.equal(points[0].headingDeg, 92)
})

test('SEI conversion names Tesla autopilot state 3 as TACC', () => {
    const statuses = convertToDataPoints([
        {frameSeqNo: 0, autopilotState: 0},
        {frameSeqNo: 1, autopilotState: 1},
        {frameSeqNo: 2, autopilotState: 2},
        {frameSeqNo: 3, autopilotState: 3},
        {frameSeqNo: 4, autopilotState: 4},
    ], 0).map(point => point.apStatus)
    assert.deepEqual(statuses, ['OFF', 'FSD', 'AP', 'TACC', 'UNKNOWN'])
})

test('SEI conversion preserves missing GPS fields and derives heading from a real track', () => {
    const missing = convertToDataPoints([{frameSeqNo: 1}], 0)
    assert.equal(missing[0].latitude, null)
    assert.equal(missing[0].longitude, null)
    assert.equal(missing[0].headingDeg, null)

    const track = convertToDataPoints([
        {frameSeqNo: 1, latitudeDeg: 31.2304, longitudeDeg: 121.4737},
        {frameSeqNo: 2, latitudeDeg: 31.2304, longitudeDeg: 121.4738},
    ], 0)
    assert.ok(track[0].headingDeg !== null)
    assert.ok(Math.abs(track[0].headingDeg - 90) < 1)
    assert.equal(track[1].headingDeg, track[0].headingDeg)
})

const point = (offsetSeconds: number, speedKph: number, brakePct = 0): SEIDataPoint => ({
    seiVersion: 4, frameSequence: Math.round(offsetSeconds * 10), autopilotState: 0,
    offsetSeconds, speedKph, brakePct, gear: 'D', steeringAngleDeg: 0,
    throttlePct: 0, apStatus: 'OFF', latitude: null, longitude: null,
    blinkerLeft: false, blinkerRight: false, headingDeg: null,
    accelerationX: 0, accelerationY: 0, accelerationZ: 0,
})

test('hard braking detection emits one incident mark', () => {
    const points = [point(0, 60), point(.4, 55, 100), point(.8, 38, 100), point(1.2, 15, 100)]
    assert.deepEqual(detectHardBraking(points), [0])
})

test('export telemetry uses angle brackets for turn signals', () => {
    const sample = point(0, 21)
    assert.equal(formatTelemetryOverlay(sample), 'Speed 21 km/h | Gear D | Mode OFF | Throttle 0% | Brake 0% | Signals --')
    assert.match(formatTelemetryOverlay({...sample, blinkerLeft: true}), /Signals <$/)
    assert.match(formatTelemetryOverlay({...sample, blinkerRight: true}), /Signals >$/)
    assert.match(formatTelemetryOverlay({...sample, blinkerLeft: true, blinkerRight: true}), /Signals <>$/)
    assert.equal(
        formatTelemetryOverlay({...sample, throttlePct: 38, brakePct: 100, apStatus: 'TACC'}, 'zh-CN'),
        '速度 21 km/h | 档位 D | 模式 TACC | 油门 38% | 刹车 100% | 转向灯 --',
    )
})

test('export canvas stays even and within the selected width', () => {
    const size = resolveExportCanvasSize({viewType: 'grid6', sourceWidth: 2896, sourceHeight: 1876, maxWidth: 2880})
    assert.equal(size.width, 2880)
    assert.equal(size.width % 2, 0)
    assert.equal(size.height % 2, 0)
    assert.equal(size.height, size.videoHeight + size.barHeight)
    assert.ok(size.barHeight > 0)
    const clean = resolveExportCanvasSize({
        viewType: 'front', sourceWidth: 1280, sourceHeight: 960, includeOverlayBar: false,
    })
    assert.equal(clean.barHeight, 0)
    assert.equal(clean.height, clean.videoHeight)
    const locationOnly = resolveExportCanvasSize({
        viewType: 'front', sourceWidth: 1280, sourceHeight: 960,
        overlay: {showTime: false, showLocation: true, showDriveData: false},
    })
    assert.ok(locationOnly.barHeight > 0)
    assert.ok(locationOnly.barHeight < size.barHeight)
    assert.equal(selectSegmentsInRange([
        {startSeconds: 0, duration: 2}, {startSeconds: 2, duration: 2}, {startSeconds: 4, duration: 2},
    ], 1.5, 1).length, 2)
})

test('shareInflight shares work and releases the registry', async () => {
    const registry = new Map<string, Promise<number>>()
    let starts = 0
    const start = async () => { starts += 1; return 42 }
    const first = shareInflight(registry, 'clip', start)
    const second = shareInflight(registry, 'clip', start)
    assert.equal(first, second)
    assert.equal(await first, 42)
    await Promise.resolve()
    assert.equal(starts, 1)
    assert.equal(registry.size, 0)
})

test('stored settings reject invalid values and preserve supported legacy layout', () => {
    assert.equal(normalizeExportSettings({}).showDriveData, true)
    assert.equal(normalizeExportSettings({showDriveData: false}).showDriveData, false)
    assert.deepEqual(normalizeAppSettings({
        autoAdvance: 'false',
        autoSeekEvent: false,
        sentryCameraFocus: 0,
        preferredView: {layout: 'front'},
    }), {
        autoAdvance: true,
        autoSeekEvent: false,
        sentryCameraFocus: true,
        preferredView: null,
        playbackRate: 1,
    })
    assert.equal(normalizeAppSettings({preferredLayout: 'grid6'}).preferredView, 'grid6')
    assert.equal(normalizeAppSettings({playbackRate: 10}).playbackRate, 10)
    assert.equal(normalizeAppSettings({playbackRate: 3}).playbackRate, 1)
    assert.deepEqual(normalizeExportSettings({
        showTime: false,
        showLocation: 'false',
        showDriveData: true,
        hwAccel: null,
        videoMaxWidth: 1234,
    }), {
        showTime: false,
        showLocation: true,
        showDriveData: true,
        hwAccel: true,
        videoMaxWidth: 3840,
    })
})

test('trash path resolution is all-or-nothing', () => {
    const files = [{name: 'a'}, {name: 'b'}] as File[]
    assert.deepEqual(resolveTrashPaths(files, file => `/tmp/${file.name}`), ['/tmp/a', '/tmp/b'])
    assert.equal(resolveTrashPaths(files, file => file.name === 'a' ? '/tmp/a' : ''), null)
})

test('trash validation inventories sidecars and moves the whole clip directory', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tesla-dashcam-trash-'))
    const clipName = '2026-08-21_18-08-31'
    const clipDir = path.join(root, 'TeslaCam', 'SavedClips', clipName)
    fs.mkdirSync(clipDir, {recursive: true})
    const front = path.join(clipDir, `${clipName}-front.mp4`)
    const back = path.join(clipDir, `${clipName}-back.mp4`)
    fs.writeFileSync(front, 'front')
    fs.writeFileSync(back, 'back')
    fs.writeFileSync(path.join(clipDir, 'event.json'), '{}')
    fs.writeFileSync(path.join(clipDir, 'thumb.png'), 'png')

    try {
        const validated = validateTrashFilesPayload({paths: [front, back], clipName, locale: 'zh-CN'})
        assert.equal(validated.ok, true)
        if (!validated.ok) return
        assert.equal(validated.value.otherFileCount, 2)
        let trashedPath = ''
        const result = await moveClipDirectoryToSystemTrash(validated.value, async value => { trashedPath = value })
        assert.equal(result.ok, true)
        assert.equal(result.trashedCount, 2)
        assert.equal(trashedPath, fs.realpathSync.native(clipDir))
    } finally {
        fs.rmSync(root, {recursive: true, force: true})
    }
})

test('trash validation accepts a standalone clip directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tesla-dashcam-standalone-trash-'))
    const clipName = '2026-08-31_17-27-56'
    const clipDir = path.join(root, clipName)
    fs.mkdirSync(clipDir, {recursive: true})
    const paths = ['front', 'back', 'left_repeater', 'right_repeater', 'left_pillar', 'right_pillar']
        .map(camera => path.join(clipDir, `${clipName}-${camera}.mp4`))
    for (const filePath of paths) fs.writeFileSync(filePath, 'video')
    fs.writeFileSync(path.join(clipDir, 'event.json'), '{}')

    try {
        const validated = validateTrashFilesPayload({paths, clipName, locale: 'en'})
        assert.equal(validated.ok, true)
        if (!validated.ok) return
        assert.equal(validated.value.kind, 'event')
        assert.equal(validated.value.files.length, 6)
        assert.equal(validated.value.otherFileCount, 1)
        assert.equal(validated.value.directory.path, fs.realpathSync.native(clipDir))
    } finally {
        fs.rmSync(root, {recursive: true, force: true})
    }
})

test('trash operation rejects changed or incomplete clip contents before deletion', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tesla-dashcam-trash-change-'))
    const clipName = '2026-08-21_18-08-31'
    const clipDir = path.join(root, 'TeslaCam', 'SentryClips', clipName)
    fs.mkdirSync(clipDir, {recursive: true})
    const front = path.join(clipDir, `${clipName}-front.mp4`)
    const back = path.join(clipDir, `${clipName}-back.mp4`)
    fs.writeFileSync(front, 'front')
    fs.writeFileSync(back, 'back')
    try {
        const partial = validateTrashFilesPayload({paths: [front], clipName, locale: 'en'})
        assert.equal(partial.ok, false)

        const validated = validateTrashFilesPayload({paths: [front, back], clipName, locale: 'en'})
        assert.equal(validated.ok, true)
        if (!validated.ok) return
        fs.writeFileSync(path.join(clipDir, 'event.json'), '{}')
        let trashCalls = 0
        const result = await moveClipDirectoryToSystemTrash(validated.value, async () => { trashCalls += 1 })
        assert.equal(result.ok, false)
        assert.equal(result.code, 'files-changed')
        assert.equal(trashCalls, 0)
    } finally {
        fs.rmSync(root, {recursive: true, force: true})
    }
})
