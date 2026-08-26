import type { TrashClipResult } from '../../../shared/types';
import {
  isSameValidatedTrashPayload,
  type ValidatedTrashFilesPayload,
  validateTrashFilesPayload,
} from './trashValidation.ts';

type TrashItem = (filePath: string) => Promise<void>;

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
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      code: 'trash-unavailable',
      error: message,
    };
  }

  return { ok: true, trashedCount: files.length };
}
