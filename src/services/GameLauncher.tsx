import { invoke } from '@tauri-apps/api/core'
import { Logger } from '../utils/Logger'

export const launchGame = async (gamePath: string, gameId: string) => {
	try {
		const launchPath = await invoke<string>('launch_game', { gamePath, gameId })
		return launchPath
	} catch (err) {
		Logger.error(`Error occurred while launching game at ${gamePath}:`, err)
		throw err
	}
}

export const waitForProcessExit = async (exePath: string, pollIntervalMs?: number) => {
	try {
		Logger.info(`Waiting for process with executable path ${exePath} to exit...`)
		await invoke('wait_for_process_exit', { exePath: exePath, poll_interval_ms: pollIntervalMs })
	} catch (err) {
		Logger.error(`Error occurred while waiting for process ${exePath} to exit:`, err)
		throw err
	}
}

export const openGameFolder = async (gamePath: string) => {
	try {
		await invoke('open_game_folder', { path: gamePath })
	} catch (err) {
		Logger.error(`Error occurred while opening game folder at ${gamePath}:`, err)
		throw err
	}
}
