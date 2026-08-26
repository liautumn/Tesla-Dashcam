export interface FilesMethods {
    save(name: string, buffer: ArrayBuffer): Promise<string | null>
    showItemInFolder(path: string): Promise<void>
    getPathForFile(file: File): string
}
