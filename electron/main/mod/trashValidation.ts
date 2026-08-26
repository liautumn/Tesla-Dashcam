import fs from 'node:fs';
import path from 'node:path';

import { isTeslaCameraVideoName } from '../../../shared/teslaCamera.ts';

export const MAX_TRASH_FILES = 5000;
export const MAX_TRASH_DIRECTORY_ENTRIES = 10000;

export type TrashLocale = 'zh-CN' | 'en';

export type TrashFileIdentity = {
  device: number;
  inode: number;
  size: number;
  modifiedAt: number;
  changedAt: number;
};

export type ValidatedTrashFile = {
  path: string;
  identity: TrashFileIdentity;
};

export type ValidatedTrashFilesPayload = {
  directory: ValidatedTrashFile;
  entries: ValidatedTrashFile[];
  files: ValidatedTrashFile[];
  kind: 'event' | 'recent';
  otherFileCount: number;
  clipName: string;
  locale: TrashLocale;
};

export type TrashValidationResult =
  | { ok: true; value: ValidatedTrashFilesPayload }
  | { ok: false; error: string };

const RECENT_CLIPS_DIRECTORY = 'RecentClips';

function failure(error: string): TrashValidationResult {
  return { ok: false, error };
}

function fileIdentity(stat: fs.Stats): TrashFileIdentity {
  return {
    device: stat.dev,
    inode: stat.ino,
    size: stat.size,
    modifiedAt: stat.mtimeMs,
    changedAt: stat.ctimeMs,
  };
}

export function isSameValidatedTrashFile(
  expected: ValidatedTrashFile,
  current: ValidatedTrashFile,
): boolean {
  return (
    expected.path === current.path &&
    expected.identity.device === current.identity.device &&
    expected.identity.inode === current.identity.inode &&
    expected.identity.size === current.identity.size &&
    expected.identity.modifiedAt === current.identity.modifiedAt &&
    expected.identity.changedAt === current.identity.changedAt
  );
}

export function isSameValidatedTrashFileList(
  expected: ValidatedTrashFile[],
  current: ValidatedTrashFile[],
): boolean {
  return (
    expected.length === current.length &&
    expected.every((file, index) =>
      isSameValidatedTrashFile(file, current[index]),
    )
  );
}

export function isSameValidatedTrashPayload(
  expected: ValidatedTrashFilesPayload,
  current: ValidatedTrashFilesPayload,
): boolean {
  return (
    isSameValidatedTrashFile(expected.directory, current.directory) &&
    isSameValidatedTrashFileList(expected.entries, current.entries) &&
    isSameValidatedTrashFileList(expected.files, current.files)
  );
}

function containsUnsafeClipNameCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) as number;
    if (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0x2028 && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    ) {
      return true;
    }
  }
  return false;
}

export function normalizeTrashLocale(locale?: string): TrashLocale {
  const normalized = locale?.trim().replaceAll('_', '-').toLowerCase();
  return normalized === 'zh' || normalized?.startsWith('zh-') ? 'zh-CN' : 'en';
}

/** Validate and canonicalize the renderer-controlled trash IPC payload. */
export function validateTrashFilesPayload(
  payload: unknown,
): TrashValidationResult {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return failure('Invalid delete request');
  }

  const request = payload as Record<string, unknown>;
  const rawClipName = request.clipName;
  if (typeof rawClipName !== 'string') {
    return failure('Invalid clip name');
  }
  const clipName = rawClipName.trim();
  if (
    clipName.length === 0 ||
    clipName.length > 255 ||
    clipName === '.' ||
    clipName === '..' ||
    clipName.includes('/') ||
    clipName.includes('\\') ||
    clipName.includes('"') ||
    containsUnsafeClipNameCharacter(clipName)
  ) {
    return failure('Invalid clip name');
  }

  const rawLocale = request.locale;
  if (
    rawLocale !== undefined &&
    (typeof rawLocale !== 'string' || rawLocale.trim().length === 0)
  ) {
    return failure('Invalid locale');
  }
  const locale = normalizeTrashLocale(rawLocale as string | undefined);

  const rawPaths = request.paths;
  if (!Array.isArray(rawPaths)) {
    return failure('Invalid file list');
  }
  if (rawPaths.length === 0) {
    return failure('No files to delete');
  }
  if (rawPaths.length > MAX_TRASH_FILES) {
    return failure('Too many files to delete');
  }

  const files: ValidatedTrashFile[] = [];
  const seenPaths = new Set<string>();
  let parentDirectory: string | undefined;

  for (const rawPath of rawPaths) {
    if (
      typeof rawPath !== 'string' ||
      rawPath.length === 0 ||
      rawPath.includes('\0') ||
      !path.isAbsolute(rawPath)
    ) {
      return failure('Invalid file path');
    }

    const normalizedPath = path.normalize(rawPath);
    if (!isTeslaCameraVideoName(path.basename(normalizedPath))) {
      return failure('Only Tesla camera MP4 files can be deleted');
    }

    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(normalizedPath);
    } catch {
      return failure('File not found or inaccessible');
    }
    if (stat.isSymbolicLink()) {
      return failure('Symbolic links cannot be deleted');
    }
    if (!stat.isFile()) {
      return failure('Source must be a regular file');
    }

    let canonicalPath: string;
    try {
      canonicalPath = fs.realpathSync.native(normalizedPath);
    } catch {
      return failure('File not found or inaccessible');
    }
    if (seenPaths.has(canonicalPath)) {
      return failure('Duplicate file path');
    }

    const currentParent = path.dirname(canonicalPath);
    if (parentDirectory !== undefined && currentParent !== parentDirectory) {
      return failure('Files must be in the same directory');
    }

    parentDirectory = currentParent;
    seenPaths.add(canonicalPath);
    files.push({ path: canonicalPath, identity: fileIdentity(stat) });
  }

  const sourceDirectory = parentDirectory as string;
  const sourceDirectoryName = path.basename(sourceDirectory);
  const collectionDirectoryName = path.basename(path.dirname(sourceDirectory));
  let kind: 'event' | 'recent';
  if (sourceDirectoryName === RECENT_CLIPS_DIRECTORY) {
    if (collectionDirectoryName.toLowerCase() !== 'teslacam') {
      return failure('RecentClips must be inside TeslaCam');
    }
    kind = 'recent';
  } else {
    if (sourceDirectoryName !== clipName) {
      return failure('Clip name does not match source directory');
    }
    if (
      collectionDirectoryName !== 'SavedClips' &&
      collectionDirectoryName !== 'SentryClips'
    ) {
      return failure('Clip directory must be inside SavedClips or SentryClips');
    }
    kind = 'event';
  }

  let directoryStat: fs.Stats;
  let directoryEntries: fs.Dirent[];
  try {
    directoryStat = fs.lstatSync(sourceDirectory);
    directoryEntries = fs.readdirSync(sourceDirectory, {
      withFileTypes: true,
    });
  } catch {
    return failure('Clip directory not found or inaccessible');
  }
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
    return failure('Clip source must be a regular directory');
  }
  if (directoryEntries.length > MAX_TRASH_DIRECTORY_ENTRIES) {
    return failure('Too many files in clip directory');
  }

  const requestedPaths = new Set(files.map((file) => file.path));
  const entries: ValidatedTrashFile[] = [];
  const directoryVideoPaths: string[] = [];
  for (const entry of directoryEntries) {
    if (!entry.isFile()) {
      return failure('Clip directory contains a non-file entry');
    }
    try {
      const entryPath = path.join(sourceDirectory, entry.name);
      const entryStat = fs.lstatSync(entryPath);
      if (entryStat.isSymbolicLink() || !entryStat.isFile()) {
        return failure('Clip directory contains an unsupported entry');
      }
      const canonicalEntryPath = fs.realpathSync.native(entryPath);
      if (path.dirname(canonicalEntryPath) !== sourceDirectory) {
        return failure('Clip directory entry resolves outside the clip');
      }
      entries.push({
        path: canonicalEntryPath,
        identity: fileIdentity(entryStat),
      });
      if (isTeslaCameraVideoName(entry.name)) {
        directoryVideoPaths.push(canonicalEntryPath);
      }
    } catch {
      return failure('Clip directory contains an inaccessible entry');
    }
  }
  if (
    directoryVideoPaths.length !== requestedPaths.size ||
    directoryVideoPaths.some((filePath) => !requestedPaths.has(filePath))
  ) {
    return failure('Delete request must include every video in the clip');
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));

  try {
    directoryStat = fs.lstatSync(sourceDirectory);
  } catch {
    return failure('Clip directory changed during validation');
  }
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
    return failure('Clip source must be a regular directory');
  }

  return {
    ok: true,
    value: {
      directory: {
        path: sourceDirectory,
        identity: fileIdentity(directoryStat),
      },
      entries,
      files,
      kind,
      otherFileCount: entries.length - directoryVideoPaths.length,
      clipName,
      locale,
    },
  };
}
