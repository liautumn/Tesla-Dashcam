/**
 * Build FFmpeg args that compose multi-camera Tesla footage from source files
 * (filter_complex: trim → concat per cam → layout stack → overlays).
 */

import fs from 'node:fs';
import os from 'os';
import path from 'node:path';

import type {
  CamName,
  ComposeExportRequest,
  ComposeSegment,
  ComposeViewType,
} from '../../../shared/types';

export type { ComposeExportRequest } from '../../../shared/types/compose-export.ts';

export type PreparedCompose = {
  args: string[];
  width: number;
  height: number;
  fps: number;
  /** Encoder selected for this run ('libx264' or a hardware encoder). */
  encoder: string;
  /** Temp dir holding drawtext textfiles — caller removes it after ffmpeg exits. */
  tmpDir: string | null;
};

/**
 * Encoder-specific output args, quality-matched around "visually great
 * dashcam footage". Hardware encoders trade a little compression efficiency
 * for a large wall-clock speedup.
 */
function encoderArgs(encoder: string): string[] {
  switch (encoder) {
    case 'h264_videotoolbox':
      return ['-c:v', 'h264_videotoolbox', '-b:v', '14M', '-allow_sw', '1'];
    case 'h264_nvenc':
      return [
        '-c:v',
        'h264_nvenc',
        '-preset',
        'p4',
        '-rc',
        'vbr',
        '-cq',
        '23',
        '-b:v',
        '0',
      ];
    case 'h264_qsv':
      return [
        '-c:v',
        'h264_qsv',
        '-preset',
        'veryfast',
        '-global_quality',
        '23',
      ];
    case 'h264_amf':
      return [
        '-c:v',
        'h264_amf',
        '-quality',
        'balanced',
        '-rc',
        'cqp',
        '-qp_i',
        '22',
        '-qp_p',
        '24',
      ];
    default:
      return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18'];
  }
}

export type Piece = {
  path: string;
  trimStart: number;
  trimDuration: number;
};

type TimelinePiece =
  | (Piece & { inputIndex: number })
  | { trimDuration: number; inputIndex?: undefined };

const CELL_W = 960;
const CELL_H = 540;
const BOTTOM_BAR = 60;

function even(n: number): number {
  const r = Math.max(2, Math.round(n));
  return r % 2 === 0 ? r : r + 1;
}

/** Round down to even, so N cells never exceed the canvas they sit in. */
function evenDown(n: number): number {
  const r = Math.max(2, Math.floor(n));
  return r % 2 === 0 ? r : r - 1;
}

/**
 * Bar metrics when the renderer did not supply a layout. Mirrors
 * resolveOverlayBarLayout in the renderer: the bar is sized by its contents so
 * the text can never spill out of it.
 */
function defaultBarLayout(width: number, overlay: ComposeExportRequest['overlay']) {
  const s = width / 1280;
  const padding = Math.max(4, Math.round(6 * s));
  const brandSize = Math.max(8, Math.round(9 * s));
  const titleSize = Math.max(15, Math.round(22 * s));
  const subSize = Math.max(10, Math.round(12 * s));
  const gap = Math.max(2, Math.round(3 * s));
  const hPad = Math.round(22 * s);
  const showTime = overlay?.showTime !== false;
  const showLocation = !!overlay?.showLocation;
  const showDriveData = !!overlay?.showDriveData;
  const rows: number[] = [];
  if (showTime || showLocation) {
    rows.push(Math.max(showTime ? brandSize : 0, showLocation ? subSize : 0));
  }
  if (showTime) rows.push(titleSize);
  if (showDriveData) rows.push(subSize);
  return {
    scale: s,
    padding,
    brandSize,
    titleSize,
    subSize,
    gap,
    hPad,
    leftTextX: hPad,
    barHeight: rows.length
      ? even(padding * 2 + rows.reduce((sum, row) => sum + row, 0) + gap * (rows.length - 1))
      : 0,
  };
}

/**
 * Escape a path for use as a quoted filtergraph option value:
 * `fontfile='C\:/Windows/…'`. Verified against ffmpeg 6.1: an UNQUOTED
 * `\:` does NOT protect the colon (the value splits and the remainder leaks
 * into the next positional option) — quoting plus `\:` is the only form the
 * graph parser handles correctly.
 */
function escPathValue(p: string): string {
  return `'${p.replace(/\\/g, '/').replace(/:/g, '\\:')}'`;
}

const CJK_RE = /[\u3000-\u9fff\uf900-\ufaff]/;
const BUNDLED_FONT_NAME = 'NotoSansCJKsc-Regular.otf';
let bundledFontCache: string | null | undefined;

function resolveBundledFont(): string | undefined {
  if (bundledFontCache !== undefined) return bundledFontCache ?? undefined;
  const candidates = [
    typeof process.resourcesPath === 'string'
      ? path.join(
          process.resourcesPath,
          'app.asar.unpacked',
          'dist',
          'fonts',
          BUNDLED_FONT_NAME,
        )
      : '',
    typeof process.resourcesPath === 'string'
      ? path.join(process.resourcesPath, 'fonts', BUNDLED_FONT_NAME)
      : '',
    path.resolve(process.cwd(), 'public', 'fonts', BUNDLED_FONT_NAME),
    path.resolve(process.cwd(), 'dist', 'fonts', BUNDLED_FONT_NAME),
  ];
  bundledFontCache = candidates.find(candidate => {
    if (!candidate) return false;
    try {
      const stat = fs.statSync(candidate);
      return stat.isFile() && stat.size > 1_000_000;
    } catch {
      return false;
    }
  }) ?? null;
  return bundledFontCache ?? undefined;
}

/** Resolve a system font so drawtext works with ffmpeg-static builds. */
function resolveFontFile(needsCJK: boolean): string | undefined {
  const bundled = resolveBundledFont();
  if (bundled) return bundled;
  const win = needsCJK
    ? [
        'C:\\Windows\\Fonts\\msyh.ttc',
        'C:\\Windows\\Fonts\\msyhbd.ttc',
        'C:\\Windows\\Fonts\\simhei.ttf',
        'C:\\Windows\\Fonts\\simsun.ttc',
        'C:\\Windows\\Fonts\\Deng.ttf',
        'C:\\Windows\\Fonts\\arial.ttf',
      ]
    : [
        'C:\\Windows\\Fonts\\arial.ttf',
        'C:\\Windows\\Fonts\\segoeui.ttf',
        'C:\\Windows\\Fonts\\msyh.ttc',
      ];
  const mac = needsCJK
    ? [
        '/System/Library/Fonts/PingFang.ttc',
        '/System/Library/Fonts/Hiragino Sans GB.ttc',
        '/System/Library/Fonts/STHeiti Medium.ttc',
        '/System/Library/Fonts/STHeiti Light.ttc',
        '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
        '/System/Library/Fonts/Supplemental/Songti.ttc',
        '/System/Library/Fonts/Supplemental/Arial.ttf',
      ]
    : [
        '/System/Library/Fonts/Supplemental/Arial.ttf',
        '/System/Library/Fonts/Helvetica.ttc',
      ];
  const linux = needsCJK
    ? [
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
        '/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf',
        '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
        '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
        '/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      ]
    : [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
      ];
  const candidates =
    process.platform === 'win32'
      ? win
      : process.platform === 'darwin'
        ? mac
        : linux;
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

/**
 * Writes drawtext literal texts to temp files and hands out `textfile=` refs.
 *
 * Why files instead of `text='…'`: (1) filtergraph text escaping is
 * two-leveled and quote-tricks silently render nothing on ffmpeg 6.1;
 * (2) non-ASCII argv is mangled on Windows builds (CJK became boxes).
 * A UTF-8 textfile sidesteps both. Identical texts share one file.
 */
class TextFilePool {
  private dir: string | null = null;
  private files = new Map<string, string>();

  /** Temp dir, created on demand — also used for the filtergraph script. */
  ensureDir(): string {
    if (!this.dir) {
      this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teslacam-compose-'));
    }
    return this.dir;
  }

  ref(text: string): string {
    let file = this.files.get(text);
    if (!file) {
      file = path.join(this.ensureDir(), `t${this.files.size}.txt`);
      fs.writeFileSync(file, text, 'utf8');
      this.files.set(text, file);
    }
    return `textfile=${escPathValue(file)}`;
  }

  get tmpDir(): string | null {
    return this.dir;
  }
}

/**
 * Build a drawtext filter for a LITERAL text (goes through a textfile).
 * `expansion=none` — textfile content is otherwise still `%`-expanded, and a
 * bare `%` (e.g. "100% grade") makes drawtext silently render nothing.
 */
function drawtextFile(
  pool: TextFilePool,
  text: string,
  style: string,
): string | null {
  if (!text) return null;
  const font = resolveFontFile(CJK_RE.test(text));
  const fontPart = font ? `fontfile=${escPathValue(font)}:` : '';
  return `drawtext=${fontPart}${pool.ref(text.replace(/\r?\n/g, ' '))}:expansion=none:${style}`;
}

/**
 * Build a drawtext filter for a RAW `text=` value we fully control
 * (e.g. `%{pts\:localtime\:…}` expansion — ASCII only, pre-escaped).
 */
function drawtextRaw(rawText: string, style: string): string | null {
  if (!rawText) return null;
  const font = resolveFontFile(false);
  const fontPart = font ? `fontfile=${escPathValue(font)}:` : '';
  return `drawtext=${fontPart}text='${rawText}':${style}`;
}

function collectTimelinePieces(
  segments: ComposeSegment[],
  cam: CamName,
  rangeStart: number,
  rangeDuration: number,
  addInput: (sourcePath: string) => number,
): TimelinePiece[] {
  const rangeEnd = rangeStart + rangeDuration;
  const pieces: TimelinePiece[] = [];
  let cursor = rangeStart;

  for (const seg of [...segments].sort((a, b) => a.startSeconds - b.startSeconds)) {
    const segStart = seg.startSeconds;
    const segEnd = seg.startSeconds + seg.duration;
    const overlapStart = Math.max(rangeStart, segStart);
    const overlapEnd = Math.min(rangeEnd, segEnd);
    const pieceStart = Math.max(overlapStart, cursor);
    if (overlapEnd - pieceStart <= 0.01) continue;

    if (pieceStart - cursor > 0.01) {
      pieces.push({ trimDuration: pieceStart - cursor });
    }

    const sourcePath = seg.paths[cam];
    const trimDuration = overlapEnd - pieceStart;
    if (sourcePath) {
      pieces.push({
        path: sourcePath,
        trimStart: Math.max(0, pieceStart - segStart),
        trimDuration,
        inputIndex: addInput(sourcePath),
      });
    } else {
      pieces.push({ trimDuration });
    }
    cursor = Math.max(cursor, overlapEnd);
  }

  if (rangeEnd - cursor > 0.01) pieces.push({ trimDuration: rangeEnd - cursor });
  return pieces;
}

function camsForView(viewType: ComposeViewType): CamName[] {
  switch (viewType) {
    case 'grid6':
      return ['left', 'front', 'right', 'left_pillar', 'back', 'right_pillar'];
    case 'grid4':
      return ['front', 'back', 'left', 'right'];
    case 'grid4old':
      return ['front', 'left', 'back', 'right'];
    default:
      return [viewType];
  }
}

function layoutSize(viewType: ComposeViewType): {
  width: number;
  height: number;
  videoHeight: number;
} {
  if (viewType === 'grid6') {
    return {
      width: even(CELL_W * 3),
      height: even(CELL_H * 2 + BOTTOM_BAR),
      videoHeight: CELL_H * 2,
    };
  }
  if (viewType === 'grid4') {
    return {
      width: even(CELL_W * 2),
      height: even(CELL_H * 2 + BOTTOM_BAR),
      videoHeight: CELL_H * 2,
    };
  }
  if (viewType === 'grid4old') {
    return {
      width: even(CELL_W * 3),
      height: even(CELL_H * 2 + BOTTOM_BAR),
      videoHeight: CELL_H * 2,
    };
  }
  return {
    width: even(CELL_W * 2),
    height: even(CELL_H * 2 + BOTTOM_BAR),
    videoHeight: CELL_H * 2,
  };
}

/**
 * Prepare ffmpeg argv (without binary path). Throws if required camera files missing.
 */
export function prepareComposeExport(
  req: ComposeExportRequest,
  outputPath: string,
  opts: { encoder?: string } = {},
): PreparedCompose {
  const encoder = opts.encoder || 'libx264';
  const fps = req.fps && req.fps > 0 ? req.fps : 30;
  const cams = camsForView(req.viewType);
  const legacy = layoutSize(req.viewType);
  const width = req.layout?.width ?? legacy.width;
  const videoHeight = req.layout?.videoHeight ?? legacy.videoHeight;
  const overlay = req.overlay || {};
  const bar = req.layout ?? defaultBarLayout(width, overlay);
  const barHeight = bar.barHeight;
  const height = req.layout?.height ?? even(videoHeight + barHeight);
  const gridCellW = evenDown(width / (req.viewType === 'grid4' ? 2 : 3));
  const gridCellH = evenDown(videoHeight / 2);

  const inputPaths: string[] = [];
  const camGroups: { cam: CamName; pieces: TimelinePiece[] }[] = [];

  for (const cam of cams) {
    const pieces = collectTimelinePieces(
      req.segments,
      cam,
      req.startSeconds,
      req.durationSeconds,
      sourcePath => {
        inputPaths.push(sourcePath);
        return inputPaths.length - 1;
      },
    );
    camGroups.push({ cam, pieces });
  }

  if (inputPaths.length === 0) {
    throw new Error('No source video files found for export range');
  }

  const filterParts: string[] = [];
  const scaledPads: string[] = [];
  const textPool = new TextFilePool();

  for (let g = 0; g < camGroups.length; g++) {
    const group = camGroups[g];
    const pieceLabels: string[] = [];

    // Cells are carved out of the real canvas rather than fixed 16:9 blocks.
    // Tesla cameras are 1.54:1, so 960x540 cells letterboxed every one of them.
    let cellW = gridCellW;
    let cellH = gridCellH;
    if (req.viewType === 'grid4old' && group.cam === 'front') {
      cellW = evenDown(width);
      cellH = evenDown(videoHeight * 0.6);
    } else if (req.viewType === 'grid4old') {
      cellW = evenDown(width / 3);
      cellH = evenDown(videoHeight * 0.4);
    } else if (!req.viewType.startsWith('grid')) {
      cellW = evenDown(width);
      cellH = evenDown(videoHeight);
    }

    const concatOut = `cam${g}`;
    const fitCell = `scale=${even(cellW)}:${even(cellH)}:force_original_aspect_ratio=decrease,` +
      `pad=${even(cellW)}:${even(cellH)}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,format=yuv420p`;

    if (group.pieces.length === 0) {
      filterParts.push(
        `color=c=black:s=${even(cellW)}x${even(cellH)}:d=${req.durationSeconds.toFixed(3)}:r=${fps}[${concatOut}]`,
      );
    } else {
      for (let p = 0; p < group.pieces.length; p++) {
        const piece = group.pieces[p];
        const lab = `c${g}p${p}`;
        const trimDur = Math.max(0.04, piece.trimDuration);
        if (piece.inputIndex === undefined) {
          filterParts.push(
            `color=c=black:s=${even(cellW)}x${even(cellH)}:d=${trimDur.toFixed(3)}:r=${fps}[${lab}]`,
          );
        } else {
          const trimStart = Math.max(0, piece.trimStart);
          filterParts.push(
            `[${piece.inputIndex}:v]trim=start=${trimStart.toFixed(3)}:duration=${trimDur.toFixed(3)},` +
              `setpts=PTS-STARTPTS,fps=${fps},tpad=stop_mode=add:stop_duration=${trimDur.toFixed(3)},` +
              `trim=duration=${trimDur.toFixed(3)},${fitCell}[${lab}]`,
          );
        }
        pieceLabels.push(`[${lab}]`);
      }

      if (pieceLabels.length === 1) {
        filterParts.push(`${pieceLabels[0]}null[${concatOut}]`);
      } else {
        filterParts.push(
          `${pieceLabels.join('')}concat=n=${pieceLabels.length}:v=1:a=0[${concatOut}]`,
        );
      }
    }

    scaledPads.push(`[${concatOut}]`);
  }

  if (req.viewType === 'grid6') {
    filterParts.push(
      `${scaledPads.join('')}xstack=inputs=6:layout=0_0|${gridCellW}_0|${gridCellW * 2}_0|0_${gridCellH}|${gridCellW}_${gridCellH}|${gridCellW * 2}_${gridCellH}[grid]`,
    );
  } else if (req.viewType === 'grid4') {
    filterParts.push(
      `${scaledPads.join('')}xstack=inputs=4:layout=0_0|${gridCellW}_0|0_${gridCellH}|${gridCellW}_${gridCellH}[grid]`,
    );
  } else if (req.viewType === 'grid4old') {
    filterParts.push(
      `${scaledPads[1]}${scaledPads[2]}${scaledPads[3]}hstack=inputs=3[bottom]`,
    );
    filterParts.push(`${scaledPads[0]}[bottom]vstack=inputs=2[grid]`);
  } else {
    filterParts.push(`${scaledPads[0]}copy[grid]`);
  }

  filterParts.push(`[grid]pad=${width}:${height}:0:0:black[base]`);

  let current = 'base';
  let step = 0;
  /** Chain any single-input filter expression onto the overlay stack. */
  const chain = (expr: string | null) => {
    if (!expr) return;
    const next = `ov${step++}`;
    filterParts.push(`[${current}]${expr}[${next}]`);
    current = next;
  };

  // ── Bottom info bar, matching the canvas overlay in Viewer.drawFrame ──
  const barY = videoHeight;
  const brandY = barY + bar.padding;
  const titleY = brandY + Math.max(bar.brandSize, bar.subSize) + bar.gap;

  if (barHeight > 0) {
    chain(
      `drawbox=x=0:y=${barY}:w=${width}:h=${barHeight}:color=0x111111@1:t=fill`,
    );
    chain(`drawbox=x=0:y=${barY}:w=${width}:h=1:color=white@0.1:t=fill`);
  }

  if (barHeight > 0 && overlay.showTime !== false) {
    if (overlay.brandText) {
      chain(
        drawtextFile(
          textPool,
          overlay.brandText,
          `fontsize=${bar.brandSize}:fontcolor=0xfb7185:x=${bar.leftTextX}:y=${brandY}`,
        ),
      );
    }

    const titleStyle = `fontsize=${bar.titleSize}:fontcolor=0xfafafa:x=${bar.leftTextX}:y=${titleY}`;
    if (overlay.timeWindows?.length) {
      // Pre-rendered localized timestamps, one gated window per second.
      for (const w of overlay.timeWindows) {
        if (!w.text || !(w.end > w.start)) continue;
        chain(
          drawtextFile(
            textPool,
            w.text,
            `${titleStyle}:enable='between(t,${w.start.toFixed(3)},${w.end.toFixed(3)})'`,
          ),
        );
      }
    } else if (
      typeof overlay.baseTimestampEpoch === 'number' &&
      Number.isFinite(overlay.baseTimestampEpoch)
    ) {
      // Fallback: ffmpeg's own clock, fixed 'YYYY-MM-DD HH:MM:SS' format.
      chain(
        drawtextRaw(
          `%{pts\\:localtime\\:${Math.round(overlay.baseTimestampEpoch)}}`,
          titleStyle,
        ),
      );
    } else if (overlay.baseTimestampLabel) {
      chain(drawtextFile(textPool, overlay.baseTimestampLabel, titleStyle));
    }
  }

  const hasDriveText = !!(
    overlay.showDriveData && overlay.driveWindows?.length
  );

  if (barHeight > 0 && overlay.showLocation && overlay.locationText) {
    const locY = overlay.showTime !== false || hasDriveText
      ? barY + bar.padding
      : Math.round(barY + (barHeight - bar.subSize) / 2);
    const locStyle = `fontsize=${bar.subSize}:x=w-tw-${bar.hPad}:y=${locY}`;

    // The red accent to the left of the text. FFmpeg cannot reference another
    // filter's text width, and measuring it in the renderer misplaces the bar
    // because the two use different fonts. Instead draw the same string twice,
    // both right-aligned to the same edge: the red pass carries a leading bar
    // glyph and is wider, so once the plain pass paints over it only that
    // glyph is left showing — exact at any width, no measurement.
    chain(
      drawtextFile(
        textPool,
        `| ${overlay.locationText}`,
        `${locStyle}:fontcolor=0xef4444`,
      ),
    );
    chain(
      drawtextFile(
        textPool,
        overlay.locationText,
        `${locStyle}:fontcolor=0xD4D4D8`,
      ),
    );
  }

  if (barHeight > 0 && overlay.showDriveData && overlay.driveWindows?.length) {
    // One drawtext per pre-sampled window, gated by enable=between(t,…).
    for (const w of overlay.driveWindows) {
      if (!w.text || !(w.end > w.start)) continue;
      chain(
        drawtextFile(
          textPool,
          w.text,
          `fontsize=${bar.subSize}:fontcolor=0x22c55e:x=w-tw-${bar.hPad}:` +
            `y=${barY + barHeight - bar.subSize - bar.padding}:` +
            `enable='between(t,${w.start.toFixed(3)},${w.end.toFixed(3)})'`,
        ),
      );
    }
  }

  filterParts.push(`[${current}]format=yuv420p[vout]`);

  const filterComplex = filterParts.join(';');
  const args: string[] = ['-y', '-hide_banner'];
  for (const p of inputPaths) {
    args.push('-i', p);
  }
  // The graph goes in a file, not argv. Windows caps a command line at 32767
  // characters and one gated drawtext per second of export runs ~240 chars —
  // past ~150 windows ffmpeg simply failed to spawn, so long exports with
  // drive data or a localized clock could never work from argv.
  const graphFile = path.join(textPool.ensureDir(), 'filtergraph.txt');
  fs.writeFileSync(graphFile, filterComplex, 'utf8');
  args.push(
    '-filter_complex_script',
    graphFile,
    '-map',
    '[vout]',
    '-an',
    ...encoderArgs(encoder),
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-r',
    String(fps),
    '-t',
    req.durationSeconds.toFixed(3),
    '-progress',
    'pipe:1',
    '-nostats',
    outputPath,
  );

  return { args, width, height, fps, encoder, tmpDir: textPool.tmpDir };
}
