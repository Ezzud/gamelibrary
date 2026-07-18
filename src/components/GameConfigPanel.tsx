import { useState, useEffect } from 'react'
import { ArrowLeft, Save, Loader, FolderOpen, TerminalSquare, FolderCog, FileCog, Info, Rocket, X, RefreshCw, Image as ImageIcon, Dock, RectangleEllipsis } from 'lucide-react'
import { dirname } from '@tauri-apps/api/path'
import { open } from '@tauri-apps/plugin-dialog'
import { loadGameConfig, saveGameConfig, getGameCachePath, copyFileToGameCache, getGameCoverPath, getGameThumbnailPath } from '../services/ConfigManager'
import { openGameFolder } from '../services/GameLauncher'
import { resetAndRefetchGameIGDBData } from '../services/GameDataManager'
import { getAllLaunchFiles } from '../services/GameScanner'
import type { GameConfigPanelProps } from '../types/appTypes'
import { readFile, remove } from '@tauri-apps/plugin-fs'

/**
 * GameConfigPanel component - allows configuration of game launch settings
 * Params: game, onBack, onConfigSaved - game data and handlers
 * Returns: JSX.Element - configuration panel UI
 */
const GameConfigPanel = ({ game, onBack, onConfigSaved, onShowToast }: GameConfigPanelProps) => {
	const [launchArgs, setLaunchArgs] = useState('')
	const [workingDirectory, setWorkingDirectory] = useState(game.path)
	const [searchName, setSearchName] = useState('')
	const [defaultLaunchFile, setDefaultLaunchFile] = useState('')
	const [allLaunchFiles, setAllLaunchFiles] = useState<string[]>([])
	const [cachePath, setCachePath] = useState('')
	const [forcedIGDBId, setForcedIGDBId] = useState('')
	const [steamId, setSteamId] = useState<string | null>(null)
	const [launchWithSteam, setLaunchWithSteam] = useState(true)
	const [saveMessage, setSaveMessage] = useState('')
	const [isSaving, setIsSaving] = useState(false)
	const [isResettingIGDBData, setIsResettingIGDBData] = useState(false)
	const [isRefreshingLaunchFiles, setIsRefreshingLaunchFiles] = useState(false)
	const [isLoading, setIsLoading] = useState(true)
	const [localCoverPath, setLocalCoverPath] = useState<string | null>(null)
	const [localBannerPath, setLocalBannerPath] = useState<string | null>(null)

	const getFolderName = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || ''
	const folderName = getFolderName(game.path)

	useEffect(() => {
		loadCurrentGameConfig()
	}, [game.id])

	/**
	 * Loads game configuration from database
	 * Params: none
	 * Returns: Promise<void>
	 */
	const loadCurrentGameConfig = async () => {
		try {
			const config = await loadGameConfig(game.id)
			const cacheFilePath = await getGameCachePath(game.id)
			const cacheDirectoryPath = await dirname(cacheFilePath)

			setCachePath(cacheDirectoryPath)

			// Load local image paths
			const coverPath = await getGameCoverPath(game.id)
			const thumbnailPath = await getGameThumbnailPath(game.id)
			if (coverPath) {
				const bytes = await readFile(coverPath);
				const blob = new Blob([new Uint8Array(bytes)], {
					type: 'image/jpeg',
				});
				const url = URL.createObjectURL(blob);
				setLocalCoverPath(url);
			}
			if (thumbnailPath) {
				const bytes = await readFile(thumbnailPath);
				const blob = new Blob([new Uint8Array(bytes)], {
					type: 'image/jpeg',
				});
				const url = URL.createObjectURL(blob);
				setLocalBannerPath(url);
			}

			if (config) {
				setLaunchArgs(config.customArguments || '')
				setWorkingDirectory(game.path)
				setDefaultLaunchFile(config.defaultLaunchFile || '')
				setAllLaunchFiles(config.allLaunchFiles || [])
				const hasSearchName = typeof config.searchName === 'string'
				setSearchName(hasSearchName ? config.searchName : folderName)

				// Load forced_igdb_id from config
				if (config.forced_igdb_id) {
					setForcedIGDBId(String(config.forced_igdb_id))
				} else {
					setForcedIGDBId('')
				}

				// Load steam_id from config
				if (config.steamId) {
					setSteamId(config.steamId)
				} else {
					setSteamId(null)
				}

				// Load launchWithSteam from config
				setLaunchWithSteam(!!config.launchWithSteam)
			} else {
				setSearchName(folderName)
			}
		} catch (error) {
			console.error('Failed to load config:', error)
		} finally {
			setIsLoading(false)
		}
	}

	/**
	 * Saves game configuration to database
	 * Params: none
	 * Returns: Promise<void>
	 */
	const handleSaveConfig = async () => {
		setIsSaving(true)
		try {
			const currentConfig = await loadGameConfig(game.id)
			const trimmedSearchName = searchName.trim()

			// Prepare forced_igdb_id value
			let forcedId: number | null = null
			if (forcedIGDBId.trim()) {
				const parsed = parseInt(forcedIGDBId.trim(), 10)
				if (!isNaN(parsed)) {
					forcedId = parsed
				}
			}

			await saveGameConfig(game.id, {
				...currentConfig,
				customArguments: launchArgs,
				searchName: trimmedSearchName || folderName || game.name,
				forced_igdb_id: forcedId,
				steamId: steamId,
				launchWithSteam: launchWithSteam,
			})

			setSaveMessage('Configuration saved successfully!')
			setTimeout(() => setSaveMessage(''), 3000)
			onConfigSaved?.()
		} catch (error) {
			console.error('Failed to save config:', error)
			setSaveMessage('Failed to save configuration')
			setTimeout(() => setSaveMessage(''), 3000)
		} finally {
			setIsSaving(false)
		}
	}

	const handleSetLaunchWithSteam = async (value: boolean) => {
		setIsSaving(true)
		try {
			const currentConfig = await loadGameConfig(game.id)
			await saveGameConfig(game.id, {
				...currentConfig,
				launchWithSteam: value,
			})
			setSaveMessage(`Launch with Steam set to ${value ? 'enabled' : 'disabled'}`)
			setTimeout(() => setSaveMessage(''), 3000)
			onConfigSaved?.()
		} catch (error) {
			console.error('Failed to update launchWithSteam:', error)
			setSaveMessage('Failed to save configuration')
			setTimeout(() => setSaveMessage(''), 3000)
		} finally {
			setIsSaving(false)
		}
		setLaunchWithSteam(value)
	}

	const handleClearForcedIGDBId = async () => {
		setIsSaving(true)
		try {
			const config = await loadGameConfig(game.id)
			await saveGameConfig(game.id, {
				...config,
				forced_igdb_id: null,
			})
			setForcedIGDBId('')
			setSaveMessage('Forced IGDB ID cleared successfully!')
			setTimeout(() => setSaveMessage(''), 3000)
			onConfigSaved?.()
		} catch (error) {
			console.error('Failed to clear forced IGDB ID:', error)
			setSaveMessage('Failed to clear forced IGDB ID')
			setTimeout(() => setSaveMessage(''), 3000)
		} finally {
			setIsSaving(false)
		}
	}

	const handleSetDefaultLaunchFile = async (launchFile: string) => {
		setIsSaving(true)
		try {
			const currentConfig = await loadGameConfig(game.id)
			await saveGameConfig(game.id, {
				...currentConfig,
				defaultLaunchFile: launchFile,
			})

			setDefaultLaunchFile(launchFile)
			setSaveMessage(`Default launch file updated to ${launchFile}`)
			setTimeout(() => setSaveMessage(''), 3000)
			onConfigSaved?.()
		} catch (error) {
			console.error('Failed to update default launch file:', error)
			setSaveMessage('Failed to update default launch file')
			setTimeout(() => setSaveMessage(''), 3000)
		} finally {
			setIsSaving(false)
		}
	}


	const handleOpenCachePath = async () => {
		if (!cachePath) {
			return
		}

		try {
			await openGameFolder(cachePath)
		} catch (error) {
			console.error('Failed to open cache path:', error)
			setSaveMessage('Failed to open cache path')
			setTimeout(() => setSaveMessage(''), 3000)
		}
	}

	const handleResetIGDBData = async () => {
		if (isResettingIGDBData) {
			return
		}

		setIsResettingIGDBData(true)
		try {
			await resetAndRefetchGameIGDBData(game.id, game.name)

			await onConfigSaved?.()
			await loadCurrentGameConfig()

			onShowToast?.('IGDB data reset and refetched successfully.', { durationMs: 3000, style: 'success' })
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			onShowToast?.(`Failed to reset IGDB data: ${message}`, { durationMs: 5000, style: 'error' })
		} finally {
			setIsResettingIGDBData(false)
		}
	}

	const handleRefreshLaunchFiles = async () => {
		if (isRefreshingLaunchFiles) {
			return
		}

		setIsRefreshingLaunchFiles(true)
		try {
			const launchFiles = await getAllLaunchFiles(game.path)
			setAllLaunchFiles(launchFiles || [])

			// Save updated launch files to config
			const currentConfig = await loadGameConfig(game.id)
			await saveGameConfig(game.id, {
				...currentConfig,
				allLaunchFiles: launchFiles || [],
			})

			onShowToast?.('Launch files refreshed successfully.', { durationMs: 2000, style: 'success' })
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			onShowToast?.(`Failed to refresh launch files: ${message}`, { durationMs: 3000, style: 'error' })
		} finally {
			setIsRefreshingLaunchFiles(false)
		}
	}

	const handleSetLocalImage = async (imageType: 'cover' | 'banner') => {
		try {
			const selectedFile = await open({
				filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif'] }],
				multiple: false,
				directory: false,
			}) as string | null

			if (!selectedFile) return;

			// Copy file to game cache style folder
			const cachedFilePath = await copyFileToGameCache(game.id, selectedFile, imageType === 'cover' ? 'cover' : 'thumbnail')
			const bytes = await readFile(cachedFilePath);
			const blob = new Blob([new Uint8Array(bytes)], {
				type: 'image/jpeg',
			});
			const url = URL.createObjectURL(blob);

			// Save cached file path to config
			const currentConfig = await loadGameConfig(game.id)
			const configKey = imageType === 'cover' ? 'localCoverPath' : 'localBannerPath'

			await saveGameConfig(game.id, {
				...currentConfig,
				[configKey]: cachedFilePath,
			})

			// Update local state
			if (imageType === 'cover') {
				setLocalCoverPath(url)
			} else {
				setLocalBannerPath(url)
			}

			const imageName = imageType === 'cover' ? 'Cover' : 'Banner'
			onShowToast?.(`${imageName} image updated successfully.`, { durationMs: 2000, style: 'success' })
			onConfigSaved?.()
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			onShowToast?.(`Failed to set ${imageType}: ${message}`, { durationMs: 3000, style: 'error' })
		}
	}

	const handleClearLocalImage = async (imageType: 'cover' | 'banner') => {
		try {
			const currentConfig = await loadGameConfig(game.id)
			const configKey = imageType === 'cover' ? 'localCoverPath' : 'localBannerPath'

			await saveGameConfig(game.id, {
				...currentConfig,
				[configKey]: undefined,
			})

			let imgPath = currentConfig[configKey];
			if(!imgPath) {
				imgPath = imageType === 'cover' ? localCoverPath : localBannerPath
				if(!imgPath) {
					imgPath = imageType === 'cover' ? await getGameCoverPath(game.id) : await getGameThumbnailPath(game.id)
				}
			}

			// Delete cached image file
			const cachedFilePath = imgPath || (imageType === 'cover' ? localCoverPath : localBannerPath);
			if (cachedFilePath) {
				try {
					await remove(cachedFilePath)
				} catch (error) {
					console.error(`Failed to delete cached ${imageType} image:`, error)
				}
			}

			// Update local state
			if (imageType === 'cover') {
				setLocalCoverPath(null)
			} else {
				setLocalBannerPath(null)
			}

			const imageName = imageType === 'cover' ? 'Cover' : 'Banner'
			onShowToast?.(`${imageName} image cleared successfully.`, { durationMs: 2000, style: 'success' })
			onConfigSaved?.()
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			onShowToast?.(`Failed to clear ${imageType}: ${message}`, { durationMs: 3000, style: 'error' })
		}
	}

	return (
		<div className="flex-1 overflow-auto flex flex-col bg-linear-to-r from-steam-900 via-[#0f1b2a] to-[#172437]">
			{/* Header */}
			<div className="p-6 bg-linear-to-r from-steam-800/95 via-[#1d3047]/95 to-steam-800/95 shadow-[0_14px_28px_rgba(0,0,0,0.28)]">
				<button
					onClick={onBack}
					className="flex items-center gap-2 text-steam-300 hover:text-white transition-all duration-200 hover:-translate-x-0.5 mb-4"
				>
					<ArrowLeft className="w-5 h-5" />
					Back
				</button>
				<h2 className="text-3xl font-bold bg-linear-to-r from-white via-steam-100 to-steam-300 bg-clip-text text-transparent">{game.name} - Properties</h2>
			</div>

			{/* Configuration Form */}
			<div className="flex-1 p-6">
				{isLoading ? (
					<div className="flex items-center justify-center h-96">
						<Loader className="w-8 h-8 animate-spin text-steam-400" />
					</div>
				) : (
					<div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)] gap-8 items-start">
						<div className="bg-[#16263b]/88 rounded-xl p-6 shadow-[0_14px_28px_rgba(0,0,0,0.24)]">
							{steamId && (
								<div className="mb-6 flex items-center justify-between gap-4">
									<div className="flex-1">
									<label className="flex items-center gap-2 text-steam-300 font-semibold mb-2">
										<Dock className="w-4 h-4 text-steam-300" />
										Launch With Steam (Recommended)
									</label>

									<p className="text-steam-400 text-sm">
										Launches the game using the Steam client. 
										<br />
										Disable this if you want to use custom launch arguments or if the game
										doesn't work with Steam launch. Multiple games with Anti-Cheat won't load without this enabled.
									</p>
									</div>

									<div
									role="switch"
									tabIndex={0}
									aria-checked={launchWithSteam}
									onKeyDown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault()
										handleSetLaunchWithSteam(!launchWithSteam)
										}
									}}
									onClick={() => handleSetLaunchWithSteam(!launchWithSteam)}
									className={`relative inline-flex h-8 w-16 shrink-0 items-center rounded-md p-1 transition-all duration-300 cursor-pointer ${
										launchWithSteam ? 'bg-sky-400' : 'bg-zinc-700'
									}`}
									>
									<div
										className={`h-6 w-6 rounded-md bg-white shadow transition-all duration-300 ${
										launchWithSteam ? 'translate-x-8' : 'translate-x-0'
										}`}
									/>
									</div>
								</div>
								)}
							
							{/* Launch Arguments */}
							<div className="mb-6">
								<label
									className={`flex items-center gap-2 font-semibold mb-2 transition-colors ${
									launchWithSteam ? 'text-steam-500' : 'text-steam-300'
									}`}
								>
									<TerminalSquare
									className={`w-4 h-4 ${
										launchWithSteam ? 'text-steam-500' : 'text-steam-300'
									}`}
									/>
									Launch Arguments
								</label>

								<p
									className={`text-sm mb-3 transition-colors ${
									launchWithSteam ? 'text-steam-400' : 'text-steam-400'
									}`}
								>
									Additional command-line arguments to pass when launching the game
								</p>

								<textarea
									value={launchArgs}
									onChange={(e) => setLaunchArgs(e.target.value)}
									disabled={launchWithSteam}
									placeholder="e.g., -windowed -high -quality ultra"
									className={`w-full rounded-lg p-3 font-mono text-sm resize-none h-24 transition-all
									${
										launchWithSteam
										? 'bg-[#0f1a2a]/60 text-steam-500 cursor-not-allowed opacity-60'
										: 'bg-[#0f1a2a]/95 text-white focus:outline-none focus:ring-2 focus:ring-steam-500/70'
									}
									shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]`}
								/>
							</div>

							{/* Working Directory */}
							<div className="mb-6">
								<label className="flex items-center gap-2 text-steam-300 font-semibold mb-2">
									<FolderCog className="w-4 h-4 text-steam-300" />
									Working Directory
								</label>
								<p className="text-steam-400 text-sm mb-3">
									Directory where the game executable will be launched from
								</p>
								<input
									type="text"
									value={workingDirectory}
									onChange={(e) => setWorkingDirectory(e.target.value)}
									className="w-full bg-[#0f1a2a]/95 text-white rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-steam-500/70 font-mono text-sm shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
								/>
							</div>

							<div className="mb-6">
								<label className="flex items-center gap-2 text-steam-300 font-semibold mb-2">
									<RectangleEllipsis className="w-4 h-4 text-steam-300" />
									Search Name
								</label>
								<p className="text-steam-400 text-sm mb-3">
									Used for IGDB search. Leave blank to use the game name. Default: {folderName || 'game folder'}.
								</p>
								<input
									type="text"
									value={searchName}
									onChange={(e) => setSearchName(e.target.value)}
									placeholder={folderName || 'Enter search name'}
									className="w-full bg-[#0f1a2a]/95 text-white rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-steam-500/70 font-mono text-sm shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
								/>
							</div>

							<div className="mb-6">
								<label className="flex items-center gap-2 text-steam-300 font-semibold mb-2">
									<Info className="w-4 h-4 text-steam-300" />
									Forced IGDB ID
								</label>
								<p className="text-steam-400 text-sm mb-3">
									Directly fetch game details by IGDB ID. When set, IGDB searches will use this ID instead of searching by name.
								</p>
								<div className="w-full bg-[#0f1a2a]/95 text-white rounded-lg p-3 font-mono text-sm flex items-center gap-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
									<input
										type="number"
										value={forcedIGDBId}
										onChange={(e) => setForcedIGDBId(e.target.value)}
										placeholder="Enter IGDB ID (optional)"
										className="flex-1 bg-transparent text-white focus:outline-none"
									/>
									{forcedIGDBId && (
										<button
											type="button"
											onClick={() => void handleClearForcedIGDBId()}
											disabled={isSaving}
											className="shrink-0 w-9 h-9 rounded-md bg-[#8b1f1f] hover:bg-[#a82a2a] disabled:opacity-50 disabled:cursor-not-allowed text-white inline-flex items-center justify-center transition-colors"
											title="Clear forced IGDB ID"
											aria-label="Clear forced IGDB ID"
										>
											<X className="w-4 h-4" />
										</button>
									)}
								</div>
							</div>

							<div className="mb-6">
								<label className="flex items-center gap-2 text-steam-300 font-semibold mb-2">
									<FileCog className="w-4 h-4 text-steam-300" />
									Cache Path
								</label>
								<p className="text-steam-400 text-sm mb-3">
									Location of this game's metadata cache files.
								</p>
								<div className="w-full bg-[#0f1a2a]/95 text-white rounded-lg p-3 font-mono text-sm flex items-center gap-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
									<span className="flex-1 break-all">{cachePath || 'Unavailable'}</span>
									<button
										type="button"
										onClick={handleOpenCachePath}
										disabled={!cachePath}
										className="shrink-0 w-9 h-9 rounded-md bg-[#2f4f70] hover:bg-[#3a648d] disabled:opacity-50 disabled:cursor-not-allowed text-white inline-flex items-center justify-center transition-colors"
										title="Open cache path in Explorer"
										aria-label="Open cache path in Explorer"
									>
										<FolderOpen className="w-4 h-4" />
									</button>
								</div>
							</div>

							{/* Success Message */}
							{saveMessage && (
								<div className={`mb-6 p-3 rounded-lg flex items-center gap-2 ${saveMessage.includes('successfully') ? 'bg-green-900/30 text-green-300 shadow-[inset_0_0_0_1px_rgba(34,197,94,0.45)]' : 'bg-red-900/30 text-red-300 shadow-[inset_0_0_0_1px_rgba(239,68,68,0.45)]'}`}>
									<Info className="w-4 h-4" />
									{saveMessage}
								</div>
							)}

							{/* Save Button */}
							<button
								onClick={handleSaveConfig}
								disabled={isSaving}
								className="w-full bg-[#2f5f8d] hover:bg-[#3a73aa] disabled:opacity-50 text-white font-semibold py-3 px-4 rounded-lg transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.99] flex items-center justify-center gap-2 shadow-[0_10px_20px_rgba(0,0,0,0.22)]"
							>
								{isSaving ? (
									<Loader className="w-5 h-5 animate-spin" />
								) : (
									<Save className="w-5 h-5" />
								)}
								Save Configuration
							</button>

							{/* Actions Section */}
							<div className="bg-[#27181c]/86 rounded-xl p-6 shadow-[0_14px_28px_rgba(0,0,0,0.22)] mt-6">
								<h3 className="text-red-300 font-semibold mb-3 flex items-center gap-2">
									<Info className="w-4 h-4" />
									Actions
								</h3>
								<p className="text-red-200/90 text-sm mb-4">
									Reset cached IGDB fields for this game and refetch fresh metadata.
								</p>
								<button
									type="button"
									onClick={() => void handleResetIGDBData()}
									disabled={isResettingIGDBData || isSaving}
									className="w-full bg-red-700 hover:bg-red-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3 px-4 rounded-lg transition-all duration-200 flex items-center justify-center gap-2"
								>
									{isResettingIGDBData ? <Loader className="w-5 h-5 animate-spin" /> : <Info className="w-5 h-5" />}
									{isResettingIGDBData ? 'Resetting...' : 'Reset IGDB Data'}
								</button>
							</div>
						</div>

						<div className="space-y-8">
							{/* Info Section */}
							<div className="bg-[#182a41]/86 rounded-xl p-6 shadow-[0_14px_28px_rgba(0,0,0,0.22)]">
								<h3 className="text-steam-300 font-semibold mb-3 flex items-center gap-2">
									<Info className="w-4 h-4" />
									Game Information
								</h3>
								<div className="space-y-2 text-sm">
									<div>
										<span className="text-steam-400">Path:</span>
										<p className="text-white font-mono mt-1">{game.path}</p>
									</div>
									<div className="mt-4">
										<span className="text-steam-400">Platform:</span>
										<p className="text-white mt-1">{game.platform}</p>
									</div>
								</div>
							</div>

							{/* Launch Files Section */}
							<div className="bg-[#15263b]/86 rounded-xl p-6 shadow-[0_14px_28px_rgba(0,0,0,0.22)]">
								<div className="flex items-center justify-between mb-3">
									<h3 className="text-steam-300 font-semibold flex items-center gap-2">
										<Rocket className="w-4 h-4" />
										Launch Files
									</h3>
									<button
										type="button"
										onClick={() => void handleRefreshLaunchFiles()}
										disabled={isRefreshingLaunchFiles}
										className="p-2 bg-transparent hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-all duration-200"
										title="Refresh launch files"
										aria-label="Refresh launch files"
									>
										<RefreshCw className={`w-4 h-4 transition-transform duration-500 ${isRefreshingLaunchFiles ? 'animate-spin' : ''}`} />
									</button>
								</div>

								<div className="mb-6">
									<label className="block text-steam-300 font-semibold mb-2">
										Default Launch File
									</label>
									<p className="text-steam-400 text-sm mb-3">
										This executable is used by default when launching the game.
									</p>
									<div className="w-full bg-[#0f1a2a]/95 text-white rounded-lg p-3 font-mono text-sm shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
										{defaultLaunchFile || 'No default launch file set'}
									</div>
								</div>

								<div>
									<label className="block text-steam-300 font-semibold mb-2">
										All Launch Files
									</label>
									<p className="text-steam-400 text-sm mb-3">
										Hover a launch file and set it as default.
									</p>

									{allLaunchFiles.length < 1 ? (
										<div className="w-full bg-[#0f1a2a]/95 text-steam-400 rounded-lg p-3 text-sm shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
											No launch files available.
										</div>
									) : (
										<div className="space-y-2">
											{allLaunchFiles.map((launchFile) => {
												const isDefault = launchFile === defaultLaunchFile
												return (
													<div
														key={launchFile}
														className="group w-full bg-[#0f1a2a]/95 text-white rounded-lg p-3 font-mono text-sm flex items-center justify-between gap-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
													>
														<span className="truncate">{launchFile}</span>
														{isDefault ? (
															<span className="text-xs px-2 py-1 rounded bg-steam-600 text-white whitespace-nowrap">Default</span>
														) : (
															<button
																type="button"
																onClick={() => handleSetDefaultLaunchFile(launchFile)}
																disabled={isSaving}
																className="opacity-0 group-hover:opacity-100 transition-opacity text-xs px-2 py-1 rounded bg-steam-600 hover:bg-steam-500 disabled:opacity-50 text-white whitespace-nowrap"
															>
																Set as default
															</button>
														)}
													</div>
												)
											})}
										</div>
									)}
								</div>
							</div>

							{/* Style Section */}
							<div className="bg-[#1a2d42]/86 rounded-xl p-6 shadow-[0_14px_28px_rgba(0,0,0,0.22)]">
								<h3 className="text-steam-300 font-semibold mb-4 flex items-center gap-2">
									<ImageIcon className="w-4 h-4" />
									Style
								</h3>
								<div className="space-y-6">
									{/* Game Cover Card */}
									<div>
										<p className="text-steam-300 font-semibold text-sm mb-1">Game Cover</p>
										<p className="text-steam-500 text-xs mb-3">Recommended: 264x352px (3:4 aspect ratio)</p>
										<div className="relative inline-block">
											<button
												type="button"
												onClick={() => void handleSetLocalImage('cover')}
												className="group relative w-24 aspect-2/3 rounded-lg overflow-hidden bg-[#0f1a2a]/95 hover:bg-[#172a3d] transition-colors shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] flex items-center justify-center"
												title="Click to select a custom cover image"
											>
												{localCoverPath || game.coverUrl ? (
													<>
														<img
															src={localCoverPath ? localCoverPath : game.coverUrl}
															alt={game.name}
															className="w-full h-full object-cover"
														/>
														<div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
															<ImageIcon className="w-8 h-8 text-white" />
														</div>
													</>
												) : (
													<div className="flex flex-col items-center gap-2 text-steam-400 group-hover:text-steam-300 transition-colors">
														<ImageIcon className="w-10 h-10" />
														<span className="text-xs">Choose Cover</span>
													</div>
												)}
											</button>
											{localCoverPath && (
												<button
													type="button"
													onClick={() => void handleClearLocalImage('cover')}
													className="absolute -top-2 -right-2 w-6 h-6 bg-red-600 hover:bg-red-700 rounded-full flex items-center justify-center text-white shadow-lg transition-colors"
													title="Clear custom cover image"
													aria-label="Clear custom cover image"
												>
													<X className="w-3.5 h-3.5" />
												</button>
											)}
										</div>
									</div>

									{/* Game Banner Card */}
									<div>
										<p className="text-steam-300 font-semibold text-sm mb-1">Game Banner</p>
										<p className="text-steam-500 text-xs mb-3">Recommended: 1080x1080px or wider</p>
										<div className="relative inline-block w-full">
											<button
												type="button"
												onClick={() => void handleSetLocalImage('banner')}
												className="group relative w-full max-w-xs aspect-video rounded-lg overflow-hidden bg-[#0f1a2a]/95 hover:bg-[#172a3d] transition-colors shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] flex items-center justify-center"
												title="Click to select a custom banner image"
											>
												{localBannerPath || game.thumbnailUrl ? (
													<>
														<img
															src={localBannerPath ? localBannerPath : game.thumbnailUrl}
															alt={`${game.name} banner`}
															className="w-full h-full object-cover"
														/>
														<div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
															<ImageIcon className="w-8 h-8 text-white" />
														</div>
													</>
												) : (
													<div className="flex flex-col items-center gap-2 text-steam-400 group-hover:text-steam-300 transition-colors">
														<ImageIcon className="w-10 h-10" />
														<span className="text-xs">Choose Banner</span>
													</div>
												)}
											</button>
											{localBannerPath && (
												<button
													type="button"
													onClick={() => void handleClearLocalImage('banner')}
													className="absolute -top-2 -right-2 w-6 h-6 bg-red-600 hover:bg-red-700 rounded-full flex items-center justify-center text-white shadow-lg transition-colors"
													title="Clear custom banner image"
													aria-label="Clear custom banner image"
												>
													<X className="w-3.5 h-3.5" />
												</button>
											)}
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	)
}

export default GameConfigPanel
