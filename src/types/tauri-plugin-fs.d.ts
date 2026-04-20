declare module "@tauri-apps/plugin-fs" {
  export interface DirEntry {
    name: string
    isDirectory?: boolean
  }

  export function exists(path: string): Promise<boolean>
  export function readDir(path: string): Promise<DirEntry[]>
  export function readTextFile(path: string): Promise<string>
  export function writeTextFile(path: string, content: string): Promise<void>
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  export function remove(path: string, options?: { recursive?: boolean }): Promise<void>
}