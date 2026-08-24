# Tesla Cinema Vue Rewrite Handoff

## Start here in a new session

Give the next coding session this instruction:

```text
Read VUE_REWRITE_HANDOFF.md completely before changing code. Treat the
TypeScript parser and Electron contracts as the current behavioral baseline.
Then inspect the referenced source and tests, report any assumptions that have
changed since commit 9a26733, and implement the Vue rewrite in the documented
order without discarding existing behavior or tests.
```

The handoff is documentation, not a claim that the Vue rewrite has started.
Before implementation, the new session should run `git status` and compare the
current commit with `9a26733`; later repository changes take precedence over
this snapshot.

## 1. Document purpose

This document records the code-reading results for the current Tesla Cinema
project so another session can begin the Vue rewrite without repeating the
initial investigation.

- Review date: 2026-08-24
- Branch: `main`
- Reviewed commit: `9a26733`
- Package version: `1.1.0`
- The worktree was clean when the source review finished; this handoff file was
  added afterward and is intentionally uncommitted.
- No product code was changed during the review.

The production application is Electron + React + TypeScript. The Python files
under `tesla_cinema/` and `sei_extractor.py` are experimental helpers and are
not the product source of truth. In particular, the Python SEI normalization
does not match corrections made from real footage in the TypeScript version.

## 2. Verification baseline

The following checks passed on the reviewed commit:

```bash
npm test -- --reporter=line
npm run lint
npx tsc -b --pretty false
npx tsc -p tsconfig.electron.json --pretty false
npx vite build
```

Playwright reported 81 tests: 71 passed and 10 skipped. The skipped tests are
the real-drive suite in `tests/realDrive.spec.ts`; it only runs when
`TESLACAM_DIR` points to an actual TeslaCam drive. Therefore the pure parser,
export composition, delete validation, layout, incident detection, and helper
tests passed, but real footage was not available in this environment.

## 3. Current architecture

```text
Electron main process
  electron/main.ts
  electron/preload.ts
  electron/composeExport.ts
  electron/trash*.ts
          |
          | window.electronAPI
          v
Renderer
  src/main.tsx
    ErrorBoundary
      I18nProvider
        App
          Home
            TitleBar -> Settings
            Sidebar -> Clip -> Thumb + ClipType
            Viewer
              Player x 6
              Progress
              Dashboard
              TrackMap
              ExportModal
              useSeiTelemetry
              useVideoExport
```

There is no router and no third-party global state library. State is split
between component-local React state, the i18n context, and two module-level
external stores backed by `localStorage`.

Important directories:

| Path              | Responsibility                                                  |
| ----------------- | --------------------------------------------------------------- |
| `src/app/`        | Folder loading, clip selection, deletion flow, top-level state  |
| `src/components/` | Library, playback, telemetry, export, settings UI               |
| `src/utils/`      | Models, Tesla file parsing, MP4/SEI parsing, timeline logic     |
| `electron/`       | Native window, IPC, disk paths, recycle bin, FFmpeg export      |
| `tests/`          | Parser, export, deletion, layout, and optional real-drive tests |
| `tesla_cinema/`   | Optional Python/PySide6 experiment; not authoritative           |

`src/app/Start.tsx` and `src/components/Preview.tsx` are unused legacy code.
The actual initial screen is always `Home`.

## 4. End-to-end data flow

```text
Directory input / drag-and-drop
        |
        v
      File[]
        |
        v
genClips() -----------------------------> CamClip[] / sidebar
        |
        | selected clip.videos
        v
genFootage() ---------------------------> CamFootage / six video players
        |
        | front-camera files only
        v
extractFootageSEI() -> Worker -> parseSEI -> SEIDataPoint[]
                                            |
                                            +-> Dashboard
                                            +-> GPS track
                                            +-> speed curve
                                            +-> hard-braking marks
                                            +-> export overlay
```

The original browser `File` objects must remain available. Object URLs alone
are insufficient because Electron's `webUtils.getPathForFile(file)` needs the
original objects for direct FFmpeg export and recycle-bin operations.

## 5. TeslaCam input contract

Expected layout:

```text
TeslaCam/
  RecentClips/
    YYYY-MM-DD_HH-mm-ss-front.mp4
    YYYY-MM-DD_HH-mm-ss-back.mp4
    ...
  SavedClips/
    YYYY-MM-DD_HH-mm-ss/
      YYYY-MM-DD_HH-mm-ss-front.mp4
      ...
      event.json
      thumb.png
  SentryClips/
    YYYY-MM-DD_HH-mm-ss/
      ...
```

The accepted video name is defined in `electron/teslaCameraFile.ts` and is
strictly:

```regex
^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-(front|back|left_repeater|right_repeater|left_pillar|right_pillar)\.mp4$
```

It is case-sensitive and does not validate whether the date is a real calendar
date. The internal camera mapping is:

| File suffix      | Internal `CamName` |
| ---------------- | ------------------ |
| `front`          | `front`            |
| `back`           | `back`             |
| `left_repeater`  | `left`             |
| `right_repeater` | `right`            |
| `left_pillar`    | `left_pillar`      |
| `right_pillar`   | `right_pillar`     |

Folder input relies on `File.webkitRelativePath`. Drag-and-drop recursively
walks `FileSystemEntry` objects and reconstructs this property from
`entry.fullPath` in `src/app/index.tsx`.

### Clip grouping

`src/utils/genClips.ts` performs library grouping:

- All videos directly inside one `RecentClips` directory become one `CamClip`.
- Every leaf timestamp directory under `SavedClips` is a separate clip.
- Every leaf timestamp directory under `SentryClips` is a separate clip.
- Recent identity is `recent:${parentPath}`.
- Saved/Sentry identity is the complete relative parent path, preventing two
  same-named folders in different collections from colliding.
- Only exact lowercase `thumb.png` and `event.json` sidecars are recognized.
- Entries with no accepted Tesla videos are discarded.
- Clips are sorted newest first using the timestamp-shaped `name`.

`event.json` is parsed as JSON without runtime schema validation. Its expected
shape is represented by `CamClipEvent` in `src/utils/types.ts`:

```ts
type CamClipEvent = {
  timestamp: string;
  city: string;
  street?: string;
  est_lat: string;
  est_lon: string;
  reason: string;
  camera: string;
};
```

Save reason classification in `src/utils/parseFileType.ts` is intentionally
narrow:

- `vehicle_auto_emergency_braking` -> `aeb`
- `user_interaction_dashcam_icon_tapped` -> `manual`
- `user_interaction_dashcam_launcher_action_tapped` -> `manual`
- everything else -> no `saveType`

## 6. Authoritative domain models

The canonical renderer models are in `src/utils/types.ts`.

### `CamClip`

Contains stable `id`, timestamp/display `name`, collection type, optional save
type, optional thumbnail/event metadata, and the original `File[] videos`.

### `CamFootage`

Contains chronologically ordered segments, total continuous duration, all
created object URLs, and optional normalized SEI data.

### `CamSegment`

Contains:

- `name`: first 19 filename characters, such as `2026-08-17_10-23-00`
- `duration`: maximum detected duration across cameras in that segment
- `startSeconds`: cumulative duration of all preceding segments
- up to six camera object URLs

### `SEIDataPoint`

Contains an absolute offset on the assembled clip timeline plus:

- speed in km/h
- `P/R/N/D/UNKNOWN`
- steering-wheel angle in degrees
- brake and throttle percentages
- `OFF/STANDBY/AP/FSD/UNKNOWN`
- latitude and longitude

Do not replace `File` with a serialized DTO in the renderer store. For Vue,
prefer `shallowRef`, `shallowReactive`, or `markRaw` around `File`, `Worker`,
and `HTMLVideoElement` objects instead of deep proxying infrastructure values.

## 7. Footage assembly and MP4 duration

`src/utils/genFootage.ts` does the following:

1. Reads the first 19 filename characters as the segment identity.
2. Resolves the camera from the suffix after the timestamp.
3. Creates one object URL per accepted file.
4. Probes video durations with a concurrency limit of six.
5. Uses the largest camera duration as the segment duration.
6. Falls back to 60 seconds only when all duration probes for that segment fail.
7. Sorts segments oldest first and assigns cumulative `startSeconds`.

`src/utils/probeMp4Duration.ts` progressively walks top-level MP4 boxes and
reads `moov/mvhd`. Both version 0 and version 1 `mvhd` layouts are supported.
The `moov` read is capped at 512 KiB. If box parsing fails, a temporary
`<video>` metadata load is used before the final 60-second fallback.

The assembled timeline is continuous. Real wall-clock gaps between filenames
are not inserted. For example, two 60-second segments whose filenames are ten
minutes apart still occupy 120 seconds on the viewer timeline.

Every object URL in `CamFootage.urls` must be passed to `revokeFootage` when a
clip is replaced or the owning view is destroyed. The current `Home` releases
the active footage before deletion so Windows does not retain video file locks.

## 8. SEI extraction protocol

The TypeScript implementation in `src/utils/parseSEI.ts` is authoritative.

### Scheduling

- Only front-camera files are scanned for telemetry.
- Segments are matched by the first 19 filename characters.
- Up to two module Workers run in parallel through `src/utils/seiWorker.ts`.
- A failed segment logs a warning and does not fail the whole clip.
- If Workers cannot be constructed, parsing falls back to the renderer thread.
- All normalized points are finally sorted by `offsetSeconds`.

### MP4 and NAL scan

1. Progressively walk top-level MP4 boxes to locate `mdat`.
2. If `mdat` is at most 48 MiB, read it in one slice.
3. Otherwise scan it in 4 MiB chunks while carrying incomplete NAL data across
   chunk boundaries.
4. Interpret `mdat` as AVCC-style H.264 NAL units with a four-byte big-endian
   length prefix, not Annex B start codes.
5. Accept only NAL type 6 with payload type 5.
6. Skip the first three NAL bytes, require at least one `0x42` marker followed
   by `0x69`, remove the final RBSP stop byte, and strip H.264 emulation
   prevention bytes (`00 00 03` -> `00 00`).
7. Decode the remaining payload with the local protobuf decoder.

Streaming box discovery failure falls back to reading the full file. However,
a desynchronization during the large-file chunked NAL scan currently returns
the messages parsed so far instead of triggering the full-buffer fallback.

### Tesla protobuf fields

| Field | Wire type  | Current meaning            |
| ----- | ---------- | -------------------------- |
| 1     | varint     | version                    |
| 2     | varint     | gear state                 |
| 3     | varint     | frame sequence number      |
| 4     | float32 LE | vehicle speed              |
| 5     | float32 LE | accelerator pedal position |
| 6     | float32 LE | steering-wheel angle       |
| 7     | varint     | left blinker               |
| 8     | varint     | right blinker              |
| 9     | varint     | brake applied              |
| 10    | varint     | autopilot state            |
| 11    | float64 LE | latitude                   |
| 12    | float64 LE | longitude                  |
| 13    | float64 LE | heading                    |
| 14    | float64 LE | linear acceleration X      |
| 15    | float64 LE | linear acceleration Y      |
| 16    | float64 LE | linear acceleration Z      |

Unknown protobuf fields are skipped for supported wire types. Blinker,
heading, and acceleration fields remain in `RawSEIMessage` but are not included
in the normalized `SEIDataPoint` model.

### Timeline normalization

`convertToDataPoints` uses this policy:

- Prefer `frameSeqNo - min(frameSeqNo)` for sample positions.
- Fall back to sample index when sequence numbers are absent.
- Default to 36 fps.
- Estimate fps from sample span / segment duration only when the estimate is
  between 5 and 120 fps.
- Do not spread a short, sparse driving series across a long parked tail.
- If calculated samples overrun the segment, scale the series back into the
  segment window, then clamp every point to that window.

Raw value conversion is based on real-footage corrections:

- Gear: `0/1/2/3 -> P/D/R/N`.
- Autopilot: `0/1/2/3 -> OFF/FSD/AP/STANDBY`.
- Missing proto3 gear/AP fields mean zero, so they map to `P/OFF`, not unknown.
- Speed normally converts from m/s to km/h. Values above 90 are treated as
  already km/h-like and capped at 300 km/h.
- Park plus speed below 1.5 km/h is normalized to zero.
- Steering field 6 is already in degrees and is clamped to +/-900 degrees.
- Accelerator field 5 is already a 0-100 percentage and is clamped, not
  multiplied by 100.
- Brake is boolean and becomes 0 or 100 percent.

The Python parser still converts steering as radians and multiplies throttle by 100. Do not copy those transformations into the Vue version.

### Live sample selection

`src/components/viewer/useSeiTelemetry.ts` binary-searches for the last sample
at or before the playhead. A first sample more than 0.5 seconds after the
playhead is not shown. Samples older than two seconds are considered stale;
longer gaps progressively clear motion/pedal values while retaining location
and gear context.

Older firmware and parked clips may contain no SEI. `undefined` telemetry is a
normal supported state, not a parsing error.

## 9. Events, incidents, and maps

`src/utils/calcEventSeconds.ts` maps `event.json.timestamp` into the assembled
timeline. Manual saves have no event marker. AEB events receive three seconds
of pre-roll; all other events receive five seconds. Results are clamped to zero
and discarded if they exceed footage duration.

Sentry camera focus currently maps `event.camera` as follows:

| Value | Camera         |
| ----- | -------------- |
| `0`   | front          |
| `3`   | left repeater  |
| `4`   | right repeater |
| `5`   | back           |

Unknown values and unavailable camera files fall back to the normal grid.

`src/utils/detectIncidents.ts` emits hard-braking markers when:

- at least four samples exist;
- starting speed is at least 20 km/h;
- speed falls by at least 15 km/h within 1.5 seconds; and
- brake is active at the start or end of the comparison window.

Markers within three seconds are merged. The marker is placed at the start of
the detected speed-drop window.

Map links come from `event.json` coordinates. A rough China bounding box
selects Amap by default; the UI exposes both Google Maps and Amap links. The
offline `TrackMap` filters zero/invalid GPS samples, downsamples to at most 400
points, and renders an SVG route with a playhead marker.

## 10. Playback state machine

The main playback logic lives in the large `src/components/Viewer.tsx` plus
`src/components/Player.tsx`.

- One player exists for every one of the six cameras.
- Cameras outside the current layout remain hidden but continue participating
  in playback/end state.
- All players receive the same `playing`, playback rate, and segment index.
- Player time updates are throttled to about eight updates per second.
- A missing camera URL reports itself ended immediately.
- Global segment position is the maximum current time reported by cameras in
  the active segment.
- The next segment starts only after all six camera states report the current
  segment index and ended state.
- Absolute seeks use `calcSeekInfo` to obtain segment index and local seconds,
  then apply `currentTime` to every video. Videos without metadata wait for
  `loadedmetadata` before receiving the seek.
- A clip change remounts `Viewer` through `key={clip.id}`, resetting transient
  state and triggering optional event auto-seek.

There is no periodic master-clock drift correction. Current synchronization
depends on common play/pause, common seeks, and common segment changes. The Vue
version can first preserve this behavior, then add drift correction as a
separately tested improvement.

Current shortcuts:

| Key                | Action                                          |
| ------------------ | ----------------------------------------------- |
| Space              | play/pause                                      |
| Left/Right         | seek -/+5 seconds                               |
| Shift + Left/Right | seek -/+1 second                                |
| Comma/Period       | approximately one 30 fps frame backward/forward |
| Up/Down            | previous/next clip                              |
| Delete             | confirm delete, then advance                    |
| F                  | fullscreen                                      |
| P                  | front-camera picture-in-picture                 |
| M                  | mute                                            |
| I/O                | export in/out points                            |

When porting, fixed six video DOM nodes with CSS layout changes are preferable
to remounting players when layouts change. Store the element refs in shallow
Vue refs and clean up every media/event listener explicitly.

## 11. Electron contract

Electron is largely framework-independent and can remain unchanged for a Vue +
Electron rewrite. Keep `contextIsolation: true` and `nodeIntegration: false`.
The preload currently needs `sandbox: false` for `webUtils.getPathForFile`.

The public renderer API is declared in `src/vite-env.d.ts` and exposed by
`electron/preload.ts`:

| API                                    | Purpose                                             |
| -------------------------------------- | --------------------------------------------------- |
| `windowControls`                       | native vs custom title bar mode                     |
| `minimize/maximize/close`              | desktop window controls                             |
| `saveFile`                             | native dialog and byte-buffer save                  |
| `showItemInFolder`                     | reveal output in system file manager                |
| `getPathForFile`                       | resolve browser `File` to absolute disk path        |
| `trashClip`                            | validate and move an entire clip directory to trash |
| `exportCompose`                        | direct source-file FFmpeg export                    |
| `exportComposeCancel`                  | cancel compose session                              |
| `onExportComposeProgress`              | subscribe/unsubscribe progress                      |
| `exportStart/exportFrame/exportFinish` | canvas RGBA fallback export                         |
| `exportCancel`                         | cancel fallback session                             |

Shared compose DTOs are in `electron/composeTypes.ts`; trash result types are
in `electron/trashTypes.ts`. Continue treating these as the single contract
source. Vue components must only call the preload API and must not import or
expose `ipcRenderer` directly.

If the Vue target is browser-only rather than Electron, feature parity is not
possible: absolute path recovery, FFmpeg child processes, native save dialogs,
and system recycle-bin operations depend on Electron.

## 12. Delete semantics

Deletion moves a whole verified directory to the system recycle bin. It never
permanently deletes individual MP4 files.

The boundary in `electron/trashValidation.ts` and `trashOperation.ts` requires:

- all renderer `File` objects resolve to paths, or the request fails atomically;
- absolute, unique, ordinary, non-symlink Tesla video files;
- every requested path comes from one directory;
- the source is `SavedClips/<clip>`, `SentryClips/<clip>`, or exactly
  `TeslaCam/RecentClips`;
- all Tesla videos in that directory are present in the request;
- no nested directories or symlinks exist in the directory;
- sidecars are inventoried;
- file identity and directory contents still match after native confirmation.

The whole directory is then passed once to `shell.trashItem`. Consequently,
deleting the single Recent library item moves the entire `RecentClips`
directory. The Vue UI must retain the current warning and release active video
resources before calling the API.

## 13. Export architecture

`src/components/viewer/useVideoExport.ts` owns renderer export state: in/out
points, progress, frame count, ETA, cancellation, and pipeline choice.

### Direct compose path

This is selected only when every source `File` resolves to an absolute disk
path and `exportCompose` is available.

- Maximum UI range: 600 seconds.
- Renderer sends only segments overlapping the selected range.
- `ComposeSegment.startSeconds` is absolute on the assembled clip timeline.
- Overlay time/data windows are relative to the export start.
- Renderer computes layout geometry shared with canvas screenshots.
- Main process detects source fps from the first source unless fps is supplied.
- `electron/composeExport.ts` constructs the FFmpeg filter graph.
- Per-camera pieces are trimmed, timestamp-reset, fps-normalized, and joined.
- Missing an entire requested camera produces a black source.
- Audio is dropped.
- Unicode text and long filter graphs use temporary files.
- Hardware encoders are probed in the order supported by the platform; a real
  full-size hardware failure retries once with `libx264`.
- Progress events carry `sessionId`, percent, and encoded output time.
- Cancellation kills FFmpeg and normally removes the partial compose output.

Keep `ffmpeg-static` and `dist/tesla-icon.png` in `asarUnpack`. FFmpeg cannot
read them from inside `app.asar`.

### Canvas RGBA fallback

This is used when native paths cannot be resolved.

- Maximum UI range: 60 seconds.
- Renderer seeks the video elements frame by frame at 30 fps.
- The current layout and overlay are drawn to canvas.
- Raw RGBA frames are sent sequentially and awaited to preserve backpressure.
- Main process pipes them to a software `libx264` FFmpeg process.

Screenshots and raw SEI CSV use `saveFile`. A successful result is revealed
with `showItemInFolder`.

## 14. Current UI state and persistence

Top-level ownership:

- `App`: clips, drag state, last folder display name.
- `Home`: selected clip, footage, load progress, delete flow/toast.
- `Sidebar`: filter, search, width.
- `Viewer`: player state, segment, play/rate, seek, view, mute, transient UI.
- `useSeiTelemetry`: extraction, current sample, incidents, export data windows.
- `useVideoExport`: export range and session state.

Persisted keys that should remain compatible:

| Key                         | Value                                                                         |
| --------------------------- | ----------------------------------------------------------------------------- |
| `tesla-cam-locale`          | `zh-CN` or `en`                                                               |
| `tesla-cam-last-folder`     | display name only; no restored permission                                     |
| `tesla-cam-sidebar-width`   | 240-600 pixel width                                                           |
| `tesla-cam-app-settings`    | auto advance, preferred layout, event seek, sentry focus, telemetry expansion |
| `tesla-cam-export-settings` | overlay flags, hardware encoding, maximum video width                         |

The current app settings defaults are auto-advance on, event auto-seek on,
sentry camera focus on, and expanded telemetry off. Export defaults show time
and location, hide driving data, use hardware acceleration, and use 3840 as the
maximum width.

The locale system is a small dictionary with English fallback and `{param}`
replacement. Day.js is currently initialized globally as Chinese and does not
change locale when the UI switches to English. Some layout/camera labels are
also hardcoded English. These are existing parity defects, not desired Vue
behavior.

## 15. Recommended Vue boundary

Do not rewrite binary parsing merely because the renderer framework changes.
The safest migration boundary is:

### Reuse directly

- `electron/` main/preload/export/delete implementation and shared types
- `src/utils/types.ts`
- `src/utils/parseSEI.ts`
- `src/utils/probeMp4Duration.ts`
- `src/utils/genClips.ts`
- `src/utils/genFootage.ts`
- `src/utils/calcSeekInfo.ts`
- `src/utils/calcEventSeconds.ts`
- `src/utils/detectIncidents.ts`
- `src/utils/exportLayout.ts`
- `src/utils/genLocationUrl.ts`
- `src/utils/shareInflight.ts`
- `src/utils/seiWorker.ts`
- assets, Tailwind theme, and non-React tests

Some reused files can be hardened later, but keeping them initially unchanged
lets existing tests act as migration guards.

### Rewrite for Vue

- `src/main.tsx` -> Vue bootstrap
- `src/app/*.tsx` -> `App.vue` and library/selection composables
- React components -> Vue SFCs
- `useSeiTelemetry` -> Vue composable
- `useVideoExport` -> Vue composable
- settings external stores -> reactive composable or Pinia store
- React i18n context -> Vue injection/composable or `vue-i18n`
- React icon package usage -> chosen Vue icon bindings
- Vite React plugin -> `@vitejs/plugin-vue`

Pinia is optional. The application is small enough to use Vue composables and
provided stores. If Pinia is introduced, use it for library/settings state;
keep media elements, Workers, frame loops, and export sessions inside focused
composables rather than one deep global store.

Suggested renderer organization:

```text
src/
  main.ts
  App.vue
  components/
    title-bar/
    library/
    viewer/
    telemetry/
    export/
  composables/
    useClipLibrary.ts
    useFootage.ts
    usePlayback.ts
    useSeiTelemetry.ts
    useVideoExport.ts
    useSettings.ts
  utils/                 # initially preserve current pure/runtime utilities
  i18n/
```

Use a request generation/token when loading footage or SEI. A slow result for
an old clip must not overwrite the newly selected clip. Key shared SEI work by
`clip.id`, not `clip.name`.

## 16. Known issues and decisions for the rewrite

The next session should explicitly classify each item as either compatibility
behavior to preserve temporarily or a defect to fix with a test.

### High priority correctness

1. Recent display time uses the first input video, not a deterministic earliest
   or latest timestamp. `clip.videos` is also not explicitly sorted.
2. In-flight SEI work is keyed by `clip.name`; same-named Saved and Sentry clips
   can accidentally share a parse. Use `clip.id`.
3. Raw CSV header says `steering_rad`, but the real unit is degrees. Rename it
   with a compatibility decision.
4. `calcSeekInfo` assumes non-empty segments and can access `segments[-1]` for
   an invalid empty footage object.
5. Events in real wall-clock gaps are projected from the previous segment and
   can land beyond that segment. Equality with a segment timestamp is also a
   boundary case because the current search uses `isAfter`.
6. Worker request promises have no Worker-level `error` handling or timeout;
   a failed Worker can leave extraction pending.
7. Rapid clip changes have no explicit load generation guard; an older
   `genFootage` result can race a newer selection.
8. Multi-camera playback has no active drift correction.
9. Layout changes can remount visible/hidden players. Prefer stable nodes.
10. Direct FFmpeg compose skips a missing middle segment for one camera and can
    concatenate later footage early instead of inserting a black gap.

### IPC and export hardening

1. Compose runtime validation covers session, duration, and existing absolute
   MP4 paths, but not all view/layout/window/count fields.
2. The legacy RGBA IPC path has minimal runtime validation.
3. Duplicate session IDs can overwrite process maps.
4. Legacy cancellation/failure can leave a partial output file.
5. Compose stdout progress parsing does not buffer incomplete lines across
   chunks, so occasional progress updates may be lost.
6. Main-process logs include full FFmpeg arguments and therefore local paths.
7. `showItemInFolder` is declared as returning `void`, while preload currently
   returns the Promise from `ipcRenderer.invoke`.

### Existing UX/i18n behavior

1. Keyboard Up/Down navigates the full clip list, not the sidebar's filtered
   result list.
2. Remembered last folder is only a label; file permission is not restored.
3. Day.js locale does not follow the selected UI locale.
4. The browser-only mode has no title bar/settings entry because `TitleBar`
   returns nothing without Electron APIs.

## 17. Existing test coverage and gaps

Strong existing coverage:

- strict Tesla video filtering and Saved/Sentry identity separation
- SEI timing normalization and physical-value clamps
- hard-braking detection thresholds and merging
- export geometry and selected segment ranges
- FFmpeg composition for all layouts, overlays, Unicode/temp files, icon input
- recycle-bin payload validation, sidecars, symlinks, changed files, and
  whole-directory behavior
- window chrome behavior and shared in-flight task helper

Optional real-drive coverage:

- full library scan
- event parsing/classification
- duration probe against FFmpeg
- real multi-segment assembly
- event positioning
- dense monotonic SEI and physical ranges
- real incident detection
- real compose output

Important gaps to add during the Vue rewrite:

- Recent grouping and deterministic ordering
- `parseTime`, save classification, and malformed `event.json`
- empty and boundary `calcSeekInfo`
- MP4 byte-level parser fixtures, including NALs crossing 4 MiB chunks
- Worker crash/timeout behavior
- stale async clip-load protection
- Vue playback/seek/segment-transition component tests
- active multi-camera drift measurements
- missing middle-camera segment composition
- main/preload IPC integration and session collision tests
- cancellation cleanup for both export paths
- a packaged Vue + Electron smoke test

## 18. Suggested implementation order

1. Preserve current tests and add focused regression tests for any defect that
   will be fixed during migration.
2. Replace only the Vite/renderer bootstrap with Vue while leaving `electron/`
   and `src/utils/` operational.
3. Port folder input, drag/drop, clip grouping, sidebar, and selection.
4. Port footage loading with stale-request protection and object URL cleanup.
5. Port six stable players, segment transitions, seeking, shortcuts, and view
   layouts before adding telemetry.
6. Port lazy Worker SEI extraction keyed by `clip.id`, then Dashboard, timeline,
   incidents, and GPS track.
7. Port screenshots, CSV, direct compose export, canvas fallback, and progress
   cancellation without changing the IPC contract.
8. Port recycle-bin deletion and native confirmation behavior.
9. Restore settings/i18n compatibility using the existing storage keys.
10. Run unit tests, renderer type checks, Vite build, Electron smoke tests, and
    finally `tests/realDrive.spec.ts` against real footage.

## 19. Vue parity checklist

- [ ] Select or drag a TeslaCam, collection, or supported nested directory.
- [ ] Build Recent, Saved, and Sentry clips without identity collisions.
- [ ] Keep all original `File` objects available for native operations.
- [ ] Generate deterministic chronological segments and accurate durations.
- [ ] Revoke all object URLs on replacement, deletion, and unmount.
- [ ] Play up to six cameras through every segment.
- [ ] Seek, jump, step frames, change rate, mute, PiP, and fullscreen.
- [ ] Preserve event pre-roll and Sentry trigger-camera focus.
- [ ] Parse SEI off-thread without blocking the UI.
- [ ] Show correct live telemetry, stale state, GPS track, and incident marks.
- [ ] Preserve all layouts and layout persistence.
- [ ] Preserve screenshot and raw CSV export.
- [ ] Preserve direct FFmpeg export, RGBA fallback, progress, ETA, and cancel.
- [ ] Preserve whole-directory recycle-bin deletion and confirmation.
- [ ] Preserve Chinese/English UI and existing localStorage keys.
- [ ] Keep Electron isolation and the current preload-only renderer boundary.
- [ ] Pass the existing suite and new Vue parity/regression tests.

## 20. Primary files to read first

For a new implementation session, read these in order:

1. `src/utils/types.ts`
2. `src/utils/genClips.ts`
3. `src/utils/genFootage.ts`
4. `src/utils/probeMp4Duration.ts`
5. `src/utils/parseSEI.ts`
6. `src/utils/calcSeekInfo.ts`
7. `src/utils/calcEventSeconds.ts`
8. `src/components/Player.tsx`
9. `src/components/Viewer.tsx`
10. `src/components/viewer/useSeiTelemetry.ts`
11. `src/components/viewer/useVideoExport.ts`
12. `electron/composeTypes.ts`
13. `electron/preload.ts`
14. `electron/main.ts`
15. `electron/composeExport.ts`
16. `electron/trashValidation.ts`
17. `tests/parseSEI.spec.ts`
18. `tests/composeExport.spec.ts`
19. `tests/trashValidation.spec.ts`
20. `tests/realDrive.spec.ts`

This ordering starts from contracts and parsing, then moves through playback,
renderer state, native boundaries, and finally executable behavioral evidence.
