import { exists, readDir } from '@tauri-apps/plugin-fs'
import { homeDir } from '@tauri-apps/api/path'
import { Logger } from '../utils/Logger'
import { getIgnoredFolders } from './ConfigManager'
import type { ScanProgressCallback } from '../types/appTypes'

export type DiscoveredGame = {
	name: string
	path: string
	defaultLaunchFile: string | null
	allLaunchFiles: string[] | null
}

export type ScannerOperatingSystem = 'windows' | 'mac' | 'linux'

type RegisterGames = (games: DiscoveredGame[], platform: string, onProgress?: ScanProgressCallback) => Promise<void>

const isLaunchFile = (name: string, operatingSystem: ScannerOperatingSystem) => {
	if (operatingSystem === 'windows') return /\.(exe|bat)$/i.test(name)
	if (operatingSystem === 'mac') return /\.sh$/i.test(name)
	return /\.(exe|sh|appimage)$/i.test(name)
}
const blacklistedGames = new Set(['steam controller configs', 'steamvr', 'steamvr home', 'steamvr performance test', 'steamvrperformancetest', 'steamvr workshop tools', 'wallpaper_engine', 'steam360videoplayer', 'steamworks shared', 'unreal development kit', 'desktopplus', 'soundpad'])

const findLaunchFiles = async (gamePath: string, operatingSystem: ScannerOperatingSystem, maxDepth = 3): Promise<string[]> => {
	if (maxDepth < 0) return []
	const launchFiles: string[] = []
	try {
		for (const entry of await readDir(gamePath)) {
			const entryPath = `${gamePath}/${entry.name}`
			if (!entry.isDirectory && isLaunchFile(entry.name, operatingSystem)) {
				launchFiles.push(entry.name)
				continue
			}
			if (entry.isDirectory && (maxDepth > 0 || entry.name.endsWith('.app'))) {
				if (entry.name.endsWith('.app')) {
					launchFiles.push(entry.name)
				} else {
					const nestedFiles = await findLaunchFiles(entryPath, operatingSystem, maxDepth - 1)
					launchFiles.push(...nestedFiles.map((file) => `${entry.name}/${file}`))
				}
			}
		}
	} catch (error) {
		Logger.warn(`Unable to inspect game directory ${gamePath}:`, error)
	}
	return launchFiles
}

export const getPlatformHome = async () => (await homeDir()).replace(/[\\/]$/, '')

export const scanGameDirectories = async (
	roots: string[],
	platform: string,
	operatingSystem: ScannerOperatingSystem,
	registerGames: RegisterGames,
	onProgress?: ScanProgressCallback,
) => {
	const games: DiscoveredGame[] = []
	const seenPaths = new Set<string>()
	const seenNames = new Set<string>()
	const ignoredFolders = (await getIgnoredFolders()).map((folder) => folder.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase())

	for (const root of roots) {
		if (!(await exists(root))) continue
		try {
			for (const entry of await readDir(root)) {
				if (!entry.isDirectory) continue
				if (blacklistedGames.has(entry.name.trim().toLowerCase())) continue
				const gamePath = `${root}/${entry.name}`
				const normalizedPath = gamePath.replace(/\\/g, '/').toLowerCase()
				if (ignoredFolders.some((folder) => normalizedPath === folder || normalizedPath.startsWith(`${folder}/`))) continue
				const normalizedName = entry.name.trim().toLowerCase()
				if (seenPaths.has(normalizedPath) || seenNames.has(normalizedName)) continue
				const launchFiles = await findLaunchFiles(gamePath, operatingSystem)
				if (launchFiles.length < 1) continue
				seenPaths.add(normalizedPath)
				seenNames.add(normalizedName)
				games.push({
					name: entry.name,
					path: gamePath,
					defaultLaunchFile: launchFiles[0],
					allLaunchFiles: launchFiles,
				})
			}
		} catch (error) {
			Logger.warn(`Unable to scan ${platform} root ${root}:`, error)
		}
	}

	Logger.info(`Found ${games.length} ${platform} games.`)
	await registerGames(games, platform, onProgress)
}
