import type {ComposeViewType} from '../../shared/types'

/**
 * Export geometry for the canvas paths (screenshot + RGBA video fallback).
 *
 * Two things went wrong here before and both are encoded as invariants:
 *
 * 1. Grid layouts multiplied the *native* source size by the grid shape with no
 *    ceiling. Real HW4 footage is 2896x1876, so a 6-grid screenshot allocated
 *    8688x3812 — 33 megapixels, a 132 MB backing store, ~1.0 s just to JPEG
 *    encode, and 431 ms per getImageData in the video path. Capping the width
 *    brings that to 7 MP / 28 MB / 88 ms with no visible loss (the FFmpeg
 *    compose export, the primary path, only outputs 2880x1140).
 *
 * 2. The bottom info bar was a fixed 60 px while every element inside it scaled
 *    with width/1280. At export scale the timestamp was 190 px inside that
 *    60 px bar, so it was drawn over the video, and the
 *    brand line landed past the bottom edge of the image entirely. The bar is
 *    now derived from its own contents, so it fits by construction.
 */

/** Widest canvas we will allocate for any export. */
export const EXPORT_MAX_WIDTH = 3840;

/** Overlay type sizes are authored against this width. */
export const OVERLAY_BASE_WIDTH = 1280;

function even(n: number): number {
  const r = Math.max(2, Math.round(n));
  return r % 2 === 0 ? r : r + 1;
}

/** Columns / rows of source-sized cells for a layout. */
export function gridShape(viewType: ComposeViewType): { cols: number; rows: number } {
  switch (viewType) {
    case 'grid6':
      return { cols: 3, rows: 2 };
    case 'grid4':
      return { cols: 2, rows: 2 };
    case 'grid4old':
      return { cols: 3, rows: 2 };
    default:
      return { cols: 1, rows: 1 };
  }
}

export type OverlayBarLayout = {
  padding: number;
  brandSize: number;
  titleSize: number;
  subSize: number;
  gap: number;
  /** Height the bar needs so its contents fit with even padding. */
  barHeight: number;
};

export type OverlayBarContent = {
  showTime: boolean;
  showLocation: boolean;
  showDriveData: boolean;
};

/**
 * Bottom-bar metrics for a given overlay scale. The height is derived from the
 * enabled header, timestamp, and telemetry rows rather than fixed, which keeps
 * every row outside the camera image and removes the bar when all are disabled.
 */
export function resolveOverlayBarLayout(
  scale: number,
  content: OverlayBarContent = {showTime: true, showLocation: true, showDriveData: true},
): OverlayBarLayout {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const padding = Math.max(4, Math.round(6 * s));
  const brandSize = Math.max(8, Math.round(9 * s));
  const titleSize = Math.max(15, Math.round(22 * s));
  const subSize = Math.max(10, Math.round(12 * s));
  const gap = Math.max(2, Math.round(3 * s));
  const rows: number[] = [];
  if (content.showTime || content.showLocation) {
    rows.push(Math.max(content.showTime ? brandSize : 0, content.showLocation ? subSize : 0));
  }
  if (content.showTime) rows.push(titleSize);
  if (content.showDriveData) rows.push(subSize);
  return {
    padding,
    brandSize,
    titleSize,
    subSize,
    gap,
    barHeight: rows.length
      ? even(padding * 2 + rows.reduce((sum, row) => sum + row, 0) + gap * (rows.length - 1))
      : 0,
  };
}

export type ExportCanvasSize = {
  width: number;
  height: number;
  /** Height of the video grid area; the bar occupies the remainder. */
  videoHeight: number;
  barHeight: number;
  /** Overlay scale factor relative to OVERLAY_BASE_WIDTH. */
  scale: number;
};

/**
 * Canvas size for exporting `viewType` from a source of the given dimensions.
 * All returned values are even — H.264 rejects odd dimensions.
 */
export function resolveExportCanvasSize(params: {
  viewType: ComposeViewType;
  sourceWidth: number;
  sourceHeight: number;
  maxWidth?: number;
  includeOverlayBar?: boolean;
  overlay?: OverlayBarContent;
}): ExportCanvasSize {
  const maxWidth = params.maxWidth ?? EXPORT_MAX_WIDTH;
  const srcW = params.sourceWidth > 0 ? params.sourceWidth : 1280;
  const srcH = params.sourceHeight > 0 ? params.sourceHeight : 720;
  const { cols, rows } = gridShape(params.viewType);

  let width = srcW * cols;
  let videoHeight = srcH * rows;
  if (width > maxWidth) {
    videoHeight = (videoHeight * maxWidth) / width;
    width = maxWidth;
  }
  width = even(width);
  videoHeight = even(videoHeight);

  const scale = width / OVERLAY_BASE_WIDTH;
  const barHeight = params.includeOverlayBar === false
    ? 0
    : resolveOverlayBarLayout(scale, params.overlay).barHeight;

  return {
    width,
    height: even(videoHeight + barHeight),
    videoHeight,
    barHeight,
    scale,
  };
}

/**
 * Segments that overlap [start, start + duration).
 *
 * The compose export used to hand the main process every segment of the clip.
 * For a RecentClips folder that is 174 segments / 1044 absolute paths, each of
 * which the main process stats for validation, to encode a window that touches
 * one or two of them.
 */
export function selectSegmentsInRange<
  T extends { startSeconds: number; duration: number },
>(segments: T[], start: number, duration: number): T[] {
  const end = start + duration;
  return segments.filter((seg) => {
    const segEnd = seg.startSeconds + seg.duration;
    // Match the main-process timeline builder: ignore tiny overlap slivers.
    return Math.min(end, segEnd) - Math.max(start, seg.startSeconds) > 0.01;
  });
}
