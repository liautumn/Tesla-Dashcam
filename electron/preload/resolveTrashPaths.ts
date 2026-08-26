/**
 * Resolve every browser File before sending a delete request to the main
 * process. Returning null keeps path resolution all-or-nothing.
 */
export function resolveTrashPaths(
  files: File[],
  getPathForFile: (file: File) => string,
): string[] | null {
  if (!Array.isArray(files) || files.length === 0) return null;

  try {
    const paths = files.map((file) => getPathForFile(file));
    return paths.every(Boolean) ? paths : null;
  } catch {
    return null;
  }
}

