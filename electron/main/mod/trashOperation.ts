import type { TrashClipResult, TrashResultCode } from '../../../shared/types';
import {
  isSameValidatedTrashPayload,
  type ValidatedTrashFilesPayload,
  validateTrashFilesPayload,
} from './trashValidation.ts';

type TrashItem = (filePath: string) => Promise<void>;

const ERROR_CODES: Partial<Record<string, TrashResultCode>> = {
  EACCES: 'trash-permission-denied',
  EBUSY: 'trash-file-in-use',
  ENOENT: 'source-missing',
  ENOSYS: 'trash-unsupported',
  ENOTSUP: 'trash-unsupported',
  EOPNOTSUPP: 'trash-unsupported',
  EPERM: 'trash-permission-denied',
  EROFS: 'trash-read-only',
  ETXTBSY: 'trash-file-in-use',
};

const readErrorCode = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  return typeof error.code === 'string' ? error.code.toUpperCase() : undefined;
};

export function getTrashErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = readErrorCode(error);
  return code && !message.toUpperCase().includes(code)
    ? `${code}: ${message}`
    : message;
}

export function classifyTrashError(error: unknown): TrashResultCode {
  const code = readErrorCode(error);
  if (code && ERROR_CODES[code]) return ERROR_CODES[code];

  const message = getTrashErrorMessage(error).toLowerCase();
  if (/\b(no such file|not found|does not exist)\b/.test(message)) {
    return 'source-missing';
  }
  if (/\b(busy|in use|being used|used by another process|sharing violation)\b/.test(message)) {
    return 'trash-file-in-use';
  }
  if (/\b(read[ -]only|write[ -]protected)\b/.test(message)) {
    return 'trash-read-only';
  }
  if (/\b(permission denied|operation not permitted|access denied)\b/.test(message)) {
    return 'trash-permission-denied';
  }
  if (/\b(not supported|unsupported|not implemented)\b/.test(message)) {
    return 'trash-unsupported';
  }
  return 'trash-unavailable';
}

/**
 * Move the approved clip directory to the system Trash as one operation.
 * Sidecars such as event.json and thumb.png therefore stay with the videos.
 */
export async function moveClipDirectoryToSystemTrash(
  approved: ValidatedTrashFilesPayload,
  trashItem: TrashItem,
): Promise<TrashClipResult> {
  const { directory, files, clipName, locale } = approved;
  const paths = files.map((file) => file.path);
  const current = validateTrashFilesPayload({ paths, clipName, locale });

  if (!current.ok || !isSameValidatedTrashPayload(approved, current.value)) {
    return {
      ok: false,
      code: 'files-changed',
      error: 'Clip directory changed while awaiting confirmation',
    };
  }

  try {
    await trashItem(directory.path);
  } catch (error) {
    return {
      ok: false,
      code: classifyTrashError(error),
      error: getTrashErrorMessage(error),
    };
  }

  return { ok: true, trashedCount: files.length };
}
