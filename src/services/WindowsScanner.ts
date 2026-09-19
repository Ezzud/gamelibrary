import type { ScanProgressCallback } from '../types/appTypes'
import { scannerPaths } from './ScannerPaths'
import { scanGameDirectories } from './PlatformScannerShared'

type RegisterGames = (games: any[], platform: string, onProgress?: ScanProgressCallback) => Promise<void>

const windowsRoots = (paths: readonly string[]) => paths.flatMap((path) => Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ', (drive) => `${drive}:/${path}`))

const scanWindowsRoots = async (roots: string[], platform: string, registerGames: RegisterGames, onProgress?: ScanProgressCallback) => {
	await scanGameDirectories(roots, platform, 'windows', registerGames, onProgress)
}

export const scanWindowsSteamGames = async (registerGames: RegisterGames, onProgress?: ScanProgressCallback) => {
	await scanWindowsRoots([
		...windowsRoots(scannerPaths.steam.roots.windows).map((root) => `${root}/${scannerPaths.steam.common.windows[0]}`),
		...windowsRoots(scannerPaths.steam.libraries.windows),
	], 'Steam', registerGames, onProgress)
}

export const scanWindowsGOGGames = async (registerGames: RegisterGames, onProgress?: ScanProgressCallback) => {
	await scanWindowsRoots([
		...windowsRoots(scannerPaths.gog.galaxyDefault.windows),
		...windowsRoots(scannerPaths.gog.galaxyOther.windows),
		...windowsRoots(scannerPaths.gog.standalone.windows),
	], 'GOG', registerGames, onProgress)
}

export const scanWindowsXboxGames = async (registerGames: RegisterGames, onProgress?: ScanProgressCallback) => {
	await scanWindowsRoots(windowsRoots(scannerPaths.xbox.roots.windows), 'Xbox', registerGames, onProgress)
}

export const scanWindowsEAGames = async (registerGames: RegisterGames, onProgress?: ScanProgressCallback) => {
	await scanWindowsRoots(windowsRoots(scannerPaths.ea.roots.windows), 'EA', registerGames, onProgress)
}

export const scanWindowsEpicGames = async (registerGames: RegisterGames, onProgress?: ScanProgressCallback) => {
	await scanWindowsRoots(windowsRoots(scannerPaths.epic.roots.windows), 'Epic Games', registerGames, onProgress)
}

export const scanWindowsBattleNetGames = async (registerGames: RegisterGames, onProgress?: ScanProgressCallback) => {
	await scanWindowsRoots(windowsRoots(scannerPaths.battlenet.roots.windows), 'Battle.net', registerGames, onProgress)
}
