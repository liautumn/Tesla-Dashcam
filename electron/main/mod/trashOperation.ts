import {rm} from 'node:fs/promises';
import type {TrashClipResult, TrashResultCode} from '../../../shared/types';
import {
  isSameValidatedTrashPayload,
  type ValidatedTrashFilesPayload,
  validateTrashFilesPayload,
} from './trashValidation.ts';

type DeleteDirectory = (directoryPath: string) => Promise<void>;

const ERROR_CODES: Partial<Record<string, TrashResultCode>> = {
  EACCES: 'delete-permission-denied',
  EBUSY: 'delete-file-in-use',
  ENOENT: 'source-missing',
  ENOSYS: 'delete-unsupported',
  ENOTSUP: 'delete-unsupported',
  EOPNOTSUPP: 'delete-unsupported',
  EPERM: 'delete-permission-denied',
  EROFS: 'delete-read-only',
  ETXTBSY: 'delete-file-in-use',
};

const readErrorCode = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  return typeof error.code === 'string' ? error.code.toUpperCase() : undefined;
};

export function getDeleteErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = readErrorCode(error);
  return code && !message.toUpperCase().includes(code)
    ? `${code}: ${message}`
    : message;
}

export function classifyDeleteError(error: unknown): TrashResultCode {
  const code = readErrorCode(error);
  if (code && ERROR_CODES[code]) return ERROR_CODES[code];

  const message = getDeleteErrorMessage(error).toLowerCase();
  if (/\b(no such file|not found|does not exist)\b/.test(message)) {
    return 'source-missing';
  }
  if (/\b(busy|in use|being used|used by another process|sharing violation)\b/.test(message)) {
    return 'delete-file-in-use';
  }
  if (/\b(read[ -]only|write[ -]protected)\b/.test(message)) {
    return 'delete-read-only';
  }
  if (/\b(permission denied|operation not permitted|access denied)\b/.test(message)) {
    return 'delete-permission-denied';
  }
  if (/\b(not supported|unsupported|not implemented)\b/.test(message)) {
    return 'delete-unsupported';
  }
  return 'delete-failed';
}

export function getDeleteConfirmationOptions(approved: ValidatedTrashFilesPayload) {
  const zh = approved.locale === 'zh-CN';
  const isRecent = approved.kind === 'recent';
  return {
    type: 'warning' as const,
    title: zh ? '永久删除？' : 'Permanently Delete?',
    message: isRecent
      ? (zh ? '永久删除整个 RecentClips 目录？' : 'Permanently delete the entire RecentClips folder?')
      : (zh ? `永久删除片段目录“${approved.clipName}”？` : `Permanently delete the clip folder “${approved.clipName}”?`),
    detail: zh
      ? `将删除目录内全部 ${approved.files.length} 个视频和 ${approved.otherFileCount} 个附属文件。直接删除，不经过系统废纸篓，此操作不可恢复。\n\n${approved.directory.path}`
      : `All ${approved.files.length} videos and ${approved.otherFileCount} sidecar files in this folder will be permanently deleted. This bypasses the Recycle Bin and cannot be undone.\n\n${approved.directory.path}`,
    buttons: [zh ? '永久删除' : 'Permanently Delete', zh ? '取消' : 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
}

/** Only the explicit destructive-button response authorizes deletion. */
export async function confirmAndDeleteClip(
  approved: ValidatedTrashFilesPayload,
  confirm: (options: ReturnType<typeof getDeleteConfirmationOptions>) => Promise<number>,
  deleteDirectory?: DeleteDirectory,
): Promise<TrashClipResult> {
  const response = await confirm(getDeleteConfirmationOptions(approved));
  if (response !== 0) return {ok: false, canceled: true};
  return deleteClipDirectory(approved, deleteDirectory);
}

/** Revalidate the approved snapshot, then permanently delete the clip and sidecars. */
async function deleteClipDirectory(
  approved: ValidatedTrashFilesPayload,
  deleteDirectory: DeleteDirectory = directoryPath => rm(directoryPath, {recursive: true, force: false}),
): Promise<TrashClipResult> {
  const {directory, files, clipName, locale} = approved;
  const paths = files.map(file => file.path);
  const current = validateTrashFilesPayload({paths, clipName, locale});

  if (!current.ok || !isSameValidatedTrashPayload(approved, current.value)) {
    return {
      ok: false,
      code: 'files-changed',
      error: 'Clip directory changed while awaiting confirmation',
    };
  }

  try {
    await deleteDirectory(directory.path);
  } catch (error) {
    // Recursive deletion is not atomic. Never retry an approved snapshot or
    // reload stale File objects after a possibly partial deletion.
    return {
      ok: false,
      code: classifyDeleteError(error),
      error: getDeleteErrorMessage(error),
      refreshRequired: true,
    };
  }

  return {ok: true, deletedCount: files.length};
}
