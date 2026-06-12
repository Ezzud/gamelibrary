import { appDataDir, join } from '@tauri-apps/api/path'
import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { Logger } from '../utils/Logger'
import { waitForProcessExit } from './GameLauncher'
import type { PlaytimeEntry, PlaytimeStore } from '../types/appTypes'

const defaultStore: PlaytimeStore = { games: {} }
const activeSessions = new Map<string, { exePath: string; startedAtMs: number }>()

const getPlaytimePath = async () => {
	const appDataPath = await appDataDir()
	return join(appDataPath, 'GameLibrary', 'playtime.json')
}

const ensureParentDir = async (filePath: string) => {
	const parts = filePath.split(/[\\/]/)
	parts.pop()
	const parentDir = parts.join('/')
	if (parentDir) {
		await mkdir(parentDir, { recursive: true })
	}
}

const loadStore = async () => {
	const path = await getPlaytimePath()
	const fileExists = await exists(path)
	if (!fileExists) {
		return { ...defaultStore }
	}

	try {
		const raw = await readTextFile(path)
		const parsed = JSON.parse(raw) as PlaytimeStore
		if (!parsed || typeof parsed !== 'object' || !parsed.games) {
			return { ...defaultStore }
		}
		return parsed
	} catch (error) {
		Logger.warn('Failed to read playtime store, using default:', error)
		return { ...defaultStore }
	}
}

const saveStore = async (store: PlaytimeStore) => {
	const path = await getPlaytimePath()
	await ensureParentDir(path)
	await writeTextFile(path, JSON.stringify(store, null, 2))
}

export const getPlaytime = async (gameId: string) => {
	const store = await loadStore()
	return store.games[gameId]?.totalMs ?? 0
}

export const formatPlaytime = (totalMs: number) => {
	if (!Number.isFinite(totalMs) || totalMs <= 0) {
		return '0m'
	}

	const totalMinutes = Math.floor(totalMs / 60000)
	if (totalMinutes < 60) {
		return `${Math.max(1, totalMinutes)}m`
	}

	const totalHours = Math.floor(totalMinutes / 60)
	const remainingMinutes = totalMinutes % 60

	if (totalHours < 10) {
		return remainingMinutes > 0 ? `${totalHours}h ${remainingMinutes}m` : `${totalHours}h`
	}

	return `${totalHours}h`
}

export const addPlaytime = async (gameId: string, durationMs: number, endedAtMs: number) => {
	if (!Number.isFinite(durationMs) || durationMs <= 0) {
		return
	}

	const store = await loadStore()
	const current = store.games[gameId] || { totalMs: 0 }
	const next: PlaytimeEntry = {
		totalMs: current.totalMs + durationMs,
		lastPlayedAt: new Date(endedAtMs).toISOString(),
	}

	store.games[gameId] = next
	await saveStore(store)
}

export const isPlaySessionActive = (gameId: string) => activeSessions.has(gameId)

export const startPlaySession = (gameId: string, exePath: string, startedAtMs: number) => {
	if (activeSessions.has(gameId)) {
		return false
	}

	activeSessions.set(gameId, { exePath, startedAtMs })
	return true
}

export const finishPlaySession = async (gameId: string, endedAtMs: number) => {
	const session = activeSessions.get(gameId)
	if (!session) {
		return null
	}

	activeSessions.delete(gameId)
	const durationMs = Math.max(0, endedAtMs - session.startedAtMs)
	await addPlaytime(gameId, durationMs, endedAtMs)
	return { durationMs, startedAtMs: session.startedAtMs }
}

export const trackPlaytimeForProcess = async (
	gameId: string,
	gamePath: string,
	exePath: string,
	onRunningChange?: (isRunning: boolean) => void
) => {
	if (!exePath) {
		Logger.warn(`Cannot track playtime for game ${gameId} because exePath is empty`)
		return
	}

	const startedAtMs = Date.now()
	if (!startPlaySession(gameId, exePath, startedAtMs)) {
		Logger.warn(`Play session for game ${gameId} is already active, skipping start`)
		return
	}

	onRunningChange?.(true)

	try {
		await waitForProcessExit(exePath, gamePath)
	} catch (error) {
		Logger.warn(`Failed to wait for game process ${exePath}:`, error)
	} finally {
		const endedAtMs = Date.now()
		await finishPlaySession(gameId, endedAtMs)
		onRunningChange?.(false)
	}
}
