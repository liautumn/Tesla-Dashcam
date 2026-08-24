# Repository Instructions

## Type Ownership

- Put contracts shared by the Electron main process, preload, and renderer in `shared/types`.
- Import shared contracts directly from `shared/types`; never duplicate them in `src/types`.
- Keep `src/types` only for types used exclusively inside the renderer application.
