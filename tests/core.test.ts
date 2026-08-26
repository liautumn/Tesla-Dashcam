import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import ffmpegStatic from 'ffmpeg-static'
import {prepareComposeExport} from '../electron/main/composeExport.ts'
import {moveClipDirectoryToSystemTrash} from '../electron/main/trashOperation.ts'
import {validateTrashFilesPayload} from '../electron/main/trashValidation.ts'
import {resolveTrashPaths} from '../electron/preload/resolveTrashPaths.ts'
import type {ComposeExportRequest} from '../shared/types/index.ts'
import type {SEIDataPoint} from '../src/types/tesla.ts'
import {detectHardBraking} from '../src/utils/detectIncidents.ts'
import {resolveExportCanvasSize, selectSegmentsInRange} from '../src/utils/exportLayout.ts'
import {convertToDataPoints} from '../src/utils/parseSEI.ts'
import {shareInflight} from '../src/utils/shareInflight.ts'
import {normalizeAppSettings, normalizeExportSettings} from '../src/stores/settings.ts'
import {formatTelemetryOverlay} from '../src/utils/telemetry.ts'

const graphOf = (prepared: ReturnType<typeof prepareComposeExport>) => {
    const index = prepared.args.indexOf('-filter_complex_script')
    assert.ok(index >= 0)
    return fs.readFileSync(prepared.args[index + 1], 'utf8')
}

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
    assert.equal(formatTelemetryOverlay(sample), '21 km/h  D  OFF')
    assert.equal(formatTelemetryOverlay({...sample, blinkerLeft: true}), '21 km/h  D  OFF  <')
    assert.equal(formatTelemetryOverlay({...sample, blinkerRight: true}), '21 km/h  D  OFF  >')
    assert.equal(formatTelemetryOverlay({...sample, blinkerLeft: true, blinkerRight: true}), '21 km/h  D  OFF  <>')
})

test('export canvas stays even and within the selected width', () => {
    const size = resolveExportCanvasSize({viewType: 'grid6', sourceWidth: 2896, sourceHeight: 1876, maxWidth: 2880})
    assert.equal(size.width, 2880)
    assert.equal(size.width % 2, 0)
    assert.equal(size.height % 2, 0)
    assert.equal(size.height, size.videoHeight + size.barHeight)
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
    })
    assert.equal(normalizeAppSettings({preferredLayout: 'grid6'}).preferredView, 'grid6')
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
