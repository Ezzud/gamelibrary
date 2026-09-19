import { scanGameDirectories, getPlatformHome } from './PlatformScannerShared'
import { scannerPaths } from './ScannerPaths'
import type { ScanProgressCallback } from '../types/appTypes'

type RegisterGames = Parameters<typeof scanGameDirectories>[3]

export const scanLinuxSteamGames = async (registerGames: RegisterGames, onProgress?: ScanProgressCallback) => {
	const home = await getPlatformHome()
	await scanGameDirectories(scannerPaths.steam.libraries.linux.map((path) => `${home}/${path}`), 'Steam', 'linux', registerGames, onProgress)
}

export const scanLinuxGOGGames = async (registerGames: RegisterGames, onProgress?: ScanProgressCallback) => {
	const home = await getPlatformHome()
	await scanGameDirectories(scannerPaths.gog.standalone.linux.map((path) => `${home}/${path}`), 'GOG', 'linux', registerGames, onProgress)
}

export const scanLinuxEpicGames = async (registerGames: RegisterGames, onProgress?: ScanProgressCallback) => {
	const home = await getPlatformHome()
	await scanGameDirectories(scannerPaths.epic.roots.linux.map((path) => `${home}/${path}`), 'Epic Games', 'linux', registerGames, onProgress)
}

export const scanLinuxEAGames = async (registerGames: RegisterGames, onProgress?: ScanProgressCallback) => {
	const home = await getPlatformHome()
	await scanGameDirectories(scannerPaths.ea.roots.linux.map((path) => `${home}/${path}`), 'EA', 'linux', registerGames, onProgress)
}
