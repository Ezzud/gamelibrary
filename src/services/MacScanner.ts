import { scanGameDirectories, getPlatformHome } from './PlatformScannerShared'
import { scannerPaths } from './ScannerPaths'
import type { ScanProgressCallback } from '../types/appTypes'

type RegisterGames = Parameters<typeof scanGameDirectories>[3]

export const scanMacSteamGames = async (registerGames: RegisterGames, onProgress?: ScanProgressCallback) => {
	const home = await getPlatformHome()
	await scanGameDirectories(scannerPaths.steam.libraries.mac.map((path) => `${home}/${path}`), 'Steam', 'mac', registerGames, onProgress)
}

export const scanMacGOGGames = async (registerGames: RegisterGames, onProgress?: ScanProgressCallback) => {
	const home = await getPlatformHome()
	await scanGameDirectories([
		...scannerPaths.gog.galaxyOther.mac,
		...scannerPaths.gog.standalone.mac,
	].map((path) => `${home}/${path}`), 'GOG', 'mac', registerGames, onProgress)
}

export const scanMacEpicGames = async (registerGames: RegisterGames, onProgress?: ScanProgressCallback) => {
	const home = await getPlatformHome()
	await scanGameDirectories(scannerPaths.epic.roots.mac.map((path) => `${home}/${path}`), 'Epic Games', 'mac', registerGames, onProgress)
}

export const scanMacEAGames = async (registerGames: RegisterGames, onProgress?: ScanProgressCallback) => {
	const home = await getPlatformHome()
	await scanGameDirectories(scannerPaths.ea.roots.mac.map((path) => `${home}/${path}`), 'EA', 'mac', registerGames, onProgress)
}

export const scanMacBattleNetGames = async (registerGames: RegisterGames, onProgress?: ScanProgressCallback) => {
	const home = await getPlatformHome()
	await scanGameDirectories(scannerPaths.battlenet.roots.mac.map((path) => `${home}/${path}`), 'Battle.net', 'mac', registerGames, onProgress)
}
