import { exists } from '@tauri-apps/plugin-fs'
import { useState, useEffect } from 'react'
import {
	ArrowLeft,
	Play,
	Clock3,
	FolderOpen,
	Settings,
	HardDrive,
	Gamepad2,
	Loader,
	Copy,
	Check,
	Star
} from 'lucide-react'
import { FaGamepad, FaLockOpen, FaMicrochip, FaUsers, FaVrCardboard } from 'react-icons/fa'
import { FaSteam, FaXbox } from 'react-icons/fa'
import { SiEpicgames, SiGogdotcom } from 'react-icons/si'
import GameConfigPanel from './GameConfigPanel'
import { getGameSize as fetchGameSize } from '../services/GameDataManager'
import { launchGame, openGameFolder } from '../services/GameLauncher'
import { formatPlaytime, getPlaytime, trackPlaytimeForProcess } from '../services/PlaytimeManager'
import { addPlayHistoryEntry, getPlayHistory, loadGameCache, loadGameConfig, saveGameConfig, getGameCoverPath, getGameThumbnailPath, loadGameList, saveGameList, saveGameInfoCache } from '../services/ConfigManager'
import { chooseFolder, getAllLaunchFiles } from '../services/GameScanner'
import LaunchFilePickerModal from './LaunchFilePickerModal'
import type { Game, GameDetailViewProps } from '../types/appTypes'
import { readFile } from '@tauri-apps/plugin-fs';

const MIN_LAUNCH_LOADING_MS = 5000

const waitForMinimumLaunchLoading = async (startedAt: number) => {
	const elapsed = Date.now() - startedAt
	const remaining = MIN_LAUNCH_LOADING_MS - elapsed
	if (remaining > 0) {
		await new Promise<void>((resolve) => window.setTimeout(resolve, remaining))
	}
}

const formatLastPlayed = (playedAt?: string | null) => {
	if (!playedAt) {
		return 'Not played yet'
	}

	const playedAtMs = new Date(playedAt).getTime()
	if (Number.isNaN(playedAtMs)) {
		return 'Not played yet'
	}

	const diffMs = Date.now() - playedAtMs
	if (diffMs < 15 * 60 * 1000) {
		return 'Last played recently'
	}

	const units = [
		{ label: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
		{ label: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
		{ label: 'week', ms: 7 * 24 * 60 * 60 * 1000 },
		{ label: 'day', ms: 24 * 60 * 60 * 1000 },
		{ label: 'hour', ms: 60 * 60 * 1000 },
		{ label: 'minute', ms: 60 * 1000 },
	]

	for (const unit of units) {
		if (diffMs >= unit.ms) {
			const value = Math.floor(diffMs / unit.ms)
			return `Last played ${value} ${unit.label}${value > 1 ? 's' : ''} ago`
		}
	}

	return 'Last played recently'
}

/**
 * GameDetailView component - displays detailed information about a selected game
 * Params: game, onBack, onGameUpdated - game data and handlers
 * Returns: JSX.Element - detail view layout
 */
const GameDetailView = ({ game, onBack, onGameUpdated, onLaunchError, onShowToast, onLaunchSuccess, isGameRunning = false, onGameRunningChange, isFavorite = false, onToggleFavorite }: GameDetailViewProps) => {
	const [isLaunching, setIsLaunching] = useState(false)
	const [showConfig, setShowConfig] = useState(false)
	const [showLaunchFilePicker, setShowLaunchFilePicker] = useState(false)
	const [availableLaunchFiles, setAvailableLaunchFiles] = useState<string[]>([])
	const [selectedLaunchFile, setSelectedLaunchFile] = useState('')
	const [pendingLaunchConfig, setPendingLaunchConfig] = useState<any>(null)
	const [gameSize, setGameSize] = useState<string>('')
	const [loadingSize, setLoadingSize] = useState(true)
	const [gameCache, setGameCache] = useState<Game | null>(null)
	const [specialTags, setSpecialTags] = useState<string[]>([])
	const [lastPlayedAt, setLastPlayedAt] = useState<string | null>(null)
	const [copiedPath, setCopiedPath] = useState(false)
	const [isMissing, setIsMissing] = useState(false)
	const [isRelocatingGameFolder, setIsRelocatingGameFolder] = useState(false)
	const [gamePlaytime, setGamePlaytime] = useState<string>('')
	const [displayCoverUrl, setDisplayCoverUrl] = useState<string | undefined>(game.coverUrl)
	const [displayThumbnailUrl, setDisplayThumbnailUrl] = useState<string | undefined>(game.thumbnailUrl)
	const [imageRefreshTrigger, setImageRefreshTrigger] = useState(0)
	const backgroundThumbnailUrl = displayThumbnailUrl || (displayCoverUrl ? displayCoverUrl.replace('t_cover_big', 't_thumb') : '')

	const tagVisuals: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
		hypervisor: {
			label: 'HYPERVISOR',
			className: 'bg-[#8b1f1f] text-white',
			icon: <FaMicrochip className="w-3.5 h-3.5" />,
		},
		onlinefixed: {
			label: 'ONLINEFIXED',
			className: 'bg-[#1f8f4e] text-white',
			icon: <FaUsers className="w-3.5 h-3.5" />,
		},
		cracked: {
			label: 'CRACKED',
			className: 'bg-black text-white',
			icon: <FaLockOpen className="w-3.5 h-3.5" />,
		},
		nonpc: {
			label: 'NONPC',
			className: 'bg-[#c8a227] text-[#1b2838]',
			icon: <FaGamepad className="w-3.5 h-3.5" />,
		},
		vr: {
			label: 'VR',
			className: 'bg-[#2a70c9] text-white',
			icon: <FaVrCardboard className="w-3.5 h-3.5" />,
		},
	}

	useEffect(() => {
		let cancelled = false
		async function checkPath() {
			try {
				const gameExists = await exists(game.path)
				if (!cancelled) setIsMissing(!gameExists)
			} catch {
				if (!cancelled) setIsMissing(true)
			}
		}
		checkPath()
		return () => { cancelled = true }
	}, [game.path])

	useEffect(() => {
		getGameSize()
		getGameCache()
		getGameSpecialTags()
		getGamePlayHistory()
		getGamePlaytime()
		resolveImageUrls()
	}, [game.id, imageRefreshTrigger])

	useEffect(() => {
		const intervalId = window.setInterval(() => {
			getGamePlayHistory()
		}, 15 * 60 * 1000)

		return () => window.clearInterval(intervalId)
	}, [game.id])

	const getGameCache = async () => {
		if (game.id) {
			let cache = await loadGameCache(game.id)
			if (cache) {
				setGameCache(cache)
			}
		}
	}

	const getGameSpecialTags = async () => {
		try {
			const config = await loadGameConfig(game.id)
			const tags = Array.isArray((config as any)?.specialTags) ? (config as any).specialTags : []
			setSpecialTags(tags.filter((tag: unknown) => typeof tag === 'string'))
		} catch (error) {
			console.error('Failed to load game special tags:', error)
			setSpecialTags([])
		}
	}

	const getGamePlayHistory = async () => {
		try {
			const plays = await getPlayHistory(game.id)
			if (!Array.isArray(plays) || plays.length < 1) {
				setLastPlayedAt(null)
				return
			}

			const sortedPlays = [...plays].sort(
				(a: any, b: any) => new Date(a.playedAt).getTime() - new Date(b.playedAt).getTime()
			)

			setLastPlayedAt(sortedPlays[sortedPlays.length - 1]?.playedAt || null)
		} catch (error) {
			console.error('Failed to load game play history:', error)
			setLastPlayedAt(null)
		}
	}

	const getGamePlaytime = async () => {
		try {
			const playtimeMs = await getPlaytime(game.id)
			const playtime = formatPlaytime(playtimeMs)
			setGamePlaytime(playtime)
		} catch (error) {
			console.error('Failed to load game playtime:', error)
			setGamePlaytime('Unknown')
		}
	}

	const resolveImageUrls = async () => {
		try {
			let coverUrl = game.coverUrl
			let thumbnailUrl = game.thumbnailUrl

			const coverPath = await getGameCoverPath(game.id)
			if (coverPath) {
				const bytes = await readFile(coverPath);

				const blob = new Blob([new Uint8Array(bytes)], {
					type: 'image/jpeg',
				});
				const url = URL.createObjectURL(blob);
				coverUrl = url
			}

			const thumbnailPath = await getGameThumbnailPath(game.id)
			if (thumbnailPath) {
				const bytes = await readFile(thumbnailPath);

				const blob = new Blob([new Uint8Array(bytes)], {
					type: 'image/jpeg',
				});
				const url = URL.createObjectURL(blob);
				thumbnailUrl = url
			}

			setDisplayCoverUrl(coverUrl)
			setDisplayThumbnailUrl(thumbnailUrl)
		} catch (error) {
			console.error('Failed to resolve image URLs:', error)
			setDisplayCoverUrl(game.coverUrl)
			setDisplayThumbnailUrl(game.thumbnailUrl)
		}
	}


	const getGameSize = async () => {
		try {
			const size = await fetchGameSize(game.path)
			const sizeGB = (size / 1024 / 1024 / 1024).toFixed(2)
			setGameSize(`${sizeGB} GB`)
		} catch (error) {
			console.error('Failed to get game size:', error)
			setGameSize('Unknown')
		} finally {
			setLoadingSize(false)
		}
	}

	/**
	 * Handles launching the game
	 * Params: none
	 * Returns: Promise<void>
	 */
	const handleLaunch = async () => {
		if (isLaunching || isGameRunning) {
			return
		}

		const config = await loadGameConfig(game.id)
		const allLaunchFiles = (config?.allLaunchFiles || []).filter((file: string | undefined) => !!file)

		if (!config?.lockedLaunchFile && allLaunchFiles.length > 1) {
			const initialSelection = config?.defaultLaunchFile && allLaunchFiles.includes(config.defaultLaunchFile)
				? config.defaultLaunchFile
				: allLaunchFiles[0]

			setPendingLaunchConfig(config)
			setAvailableLaunchFiles(allLaunchFiles)
			setSelectedLaunchFile(initialSelection)
			setShowLaunchFilePicker(true)
			return
		}

		setIsLaunching(true)
		const launchStartedAt = Date.now()
		try {
			const launchPath = await launchGame(game.path, game.id)
			try {
				await addPlayHistoryEntry(game.id)
				await onLaunchSuccess()
				await getGamePlayHistory()
			} catch (historyError) {
				console.warn('Game launched but failed to update play history:', historyError)
			}
			void trackPlaytimeForProcess(game.id, launchPath, (running) => onGameRunningChange?.(game.id, running))
		} catch (error) {
			console.error('Failed to launch game:', error)
			const message = error instanceof Error ? error.message : String(error)
			onLaunchError(`Failed to launch ${game.name}: ${message}`)
		} finally {
			await waitForMinimumLaunchLoading(launchStartedAt)
			setIsLaunching(false)
		}
	}

	const handleConfirmLaunchFile = async () => {
		if (!selectedLaunchFile) {
			return
		}

		if (isGameRunning) {
			return
		}

		setShowLaunchFilePicker(false)
		setIsLaunching(true)
		const launchStartedAt = Date.now()

		try {
			await saveGameConfig(game.id, {
				...pendingLaunchConfig,
				defaultLaunchFile: selectedLaunchFile,
				lockedLaunchFile: true,
				allLaunchFiles: pendingLaunchConfig?.allLaunchFiles || availableLaunchFiles,
			})

			const launchPath = await launchGame(game.path, game.id)
			try {
				await addPlayHistoryEntry(game.id)
				await onLaunchSuccess()
				await getGamePlayHistory()
			} catch (historyError) {
				console.warn('Game launched but failed to update play history:', historyError)
			}
			void trackPlaytimeForProcess(game.id, launchPath, (running) => onGameRunningChange?.(game.id, running))
		} catch (error) {
			console.error('Failed to save launch file preference or launch game:', error)
			const message = error instanceof Error ? error.message : String(error)
			onLaunchError(`Failed to launch ${game.name}: ${message}`)
		} finally {
			await waitForMinimumLaunchLoading(launchStartedAt)
			setIsLaunching(false)
			setPendingLaunchConfig(null)
			setAvailableLaunchFiles([])
		}
	}

	/**
	 * Handles opening the game folder
	 * Params: none
	 * Returns: Promise<void>
	 */
	const handleOpenFolder = async () => {
		try {
			await openGameFolder(game.path)
		} catch (error) {
			console.error('Failed to open folder:', error)
		}
	}

	const handleCopyPath = async () => {
		try {
			await navigator.clipboard.writeText(game.path)
			setCopiedPath(true)
			window.setTimeout(() => setCopiedPath(false), 1600)
		} catch (error) {
			console.error('Failed to copy game path:', error)
		}
	}

	const handleSelectNewGameFolder = async () => {
		if (isRelocatingGameFolder) {
			return
		}

		setIsRelocatingGameFolder(true)
		try {
			const selectedFolder = await chooseFolder()
			if (!selectedFolder) {
				return
			}

			const launchFiles = await getAllLaunchFiles(selectedFolder)
			if (!Array.isArray(launchFiles) || launchFiles.length < 1) {
				onShowToast?.("This folder doesn't appear to be a valid game.", { durationMs: 5000, style: 'warning' })
				return
			}

			const gameList = await loadGameList()
			const gameIndex = gameList.games.findIndex((entry: any) => entry.id === game.id)

			if (gameIndex < 0) {
				onShowToast?.('Could not update game location because the game is not in the library list.', { durationMs: 5000, style: 'error' })
				return
			}

			gameList.games[gameIndex] = {
				...gameList.games[gameIndex],
				path: selectedFolder,
			}
			await saveGameList(gameList)

			const cacheData = await loadGameCache(game.id)
			await saveGameInfoCache(game.id, {
				...cacheData,
				title: cacheData?.title ?? game.name,
				cover_url: cacheData?.cover_url ?? null,
				thumbnail_url: cacheData?.thumbnail_url ?? null,
				igdb_id: cacheData?.igdb_id ?? null,
				id: cacheData?.id ?? game.id,
				platform: cacheData?.platform ?? game.platform,
				folder: selectedFolder,
				fetched: cacheData?.fetched ?? false,
			})

			onShowToast?.('Game folder updated successfully.', { durationMs: 3000, style: 'success' })
			await onGameUpdated?.()
		} catch (error) {
			console.error('Failed to update game folder:', error)
			const message = error instanceof Error ? error.message : String(error)
			onShowToast?.(`Failed to update game folder: ${message}`, { durationMs: 5000, style: 'error' })
		} finally {
			setIsRelocatingGameFolder(false)
		}
	}

	/**
	 * Gets the platform icon component
	 * Params: platform - platform name
	 * Returns: JSX.Element - icon component
	 */
	const getPlatformIcon = (platform: string) => {
		const iconClass = 'w-6 h-6'
		switch (platform) {
			case 'Steam':
				return <FaSteam className={`${iconClass} text-white`} />
			case 'Epic Games':
				return <SiEpicgames className={`${iconClass} text-white`} />
			case 'GOG':
				return <SiGogdotcom className={`${iconClass} text-[#8d4bbb]`} />
			case 'Xbox':
				return <FaXbox className={`${iconClass} text-[#107c10]`} />
			default:
				return <Gamepad2 className={iconClass} />
		}
	}

	if (showConfig) {
		const handleConfigSaved = () => {
			// Trigger image refresh
			setImageRefreshTrigger(prev => prev + 1)
			// Call the original onGameUpdated callback
			onGameUpdated?.()
		}

		return (
			<GameConfigPanel
				game={game}
				onBack={() => setShowConfig(false)}
				onConfigSaved={handleConfigSaved}
				onShowToast={onShowToast}
			/>
		)
	}

	return (
		<>
			<LaunchFilePickerModal
				isOpen={showLaunchFilePicker}
				gameName={game.name}
				launchFiles={availableLaunchFiles}
				selectedLaunchFile={selectedLaunchFile}
				onSelect={setSelectedLaunchFile}
				onConfirm={handleConfirmLaunchFile}
				onCancel={() => {
					setShowLaunchFilePicker(false)
					setPendingLaunchConfig(null)
					setAvailableLaunchFiles([])
				}}
			/>

			<div className="flex-1 overflow-auto flex flex-col bg-linear-to-br from-steam-900 via-[#0e1725] to-[#18263b] relative">
				{backgroundThumbnailUrl && (
					<div
						className="pointer-events-none absolute inset-x-0 top-0 h-[56vh] bg-cover bg-center opacity-30"
						style={{
							backgroundImage: `url(${backgroundThumbnailUrl.replace('t_thumb', 't_1080p')})`,
							WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.95) 50%, rgba(0,0,0,0) 100%)',
							maskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.95) 50%, rgba(0,0,0,0) 100%)',
						}}
					/>
				)}

				{/* Header with Back Button */}
				<div className="relative z-10 p-6 bg-linear-to-r from-steam-800/95 via-[#1a2b43]/95 to-steam-800/95 shadow-[0_16px_34px_rgba(0,0,0,0.24)]">
					<button
						onClick={onBack}
						className="flex items-center gap-2 text-steam-300 hover:text-white transition-all duration-200 hover:-translate-x-0.5 mb-4"
					>
						<ArrowLeft className="w-5 h-5" />
						Back to Library
					</button>
					<h2 className="text-3xl font-bold bg-linear-to-r from-white via-steam-100 to-steam-300 bg-clip-text text-transparent">{game.name}</h2>
				</div>

				{/* Main Content */}
				<div className="relative z-10 flex-1 p-6 flex flex-col lg:flex-row gap-6 items-start">
					{/* Cover Art */}
					<div className="w-full lg:w-60 lg:shrink-0">
						<div className="w-full max-w-60 rounded-xl overflow-hidden bg-steam-800/85 aspect-2/3 shadow-[0_18px_34px_rgba(0,0,0,0.28)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_22px_42px_rgba(0,0,0,0.34)]">
							{displayCoverUrl ? (
								<img
									src={displayCoverUrl}
									alt={game.name}
									className="w-full h-full object-cover transition-transform duration-500 hover:scale-[1.03]"
								/>
							) : (
								<div className="w-full h-full bg-linear-to-br from-steam-700 to-steam-800 flex items-center justify-center">
									<Gamepad2 className="w-24 h-24 text-steam-500" />
								</div>
							)}
						</div>
					</div>

					{/* Game Info and Actions */}
					<div className="w-full flex-1 flex flex-col">
						{/* Info Cards */}
						<div className="grid grid-cols-2 gap-4 mb-6">
							{/* Platform */}
							<div className="bg-[#16263b]/85 rounded-xl p-4 shadow-[0_12px_24px_rgba(0,0,0,0.22)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_16px_28px_rgba(0,0,0,0.3)]">
								<p className="text-steam-400 text-sm mb-2">PLATFORM</p>
								<div className="flex items-center gap-2">
									{getPlatformIcon(gameCache?.platform || game.platform)}
									<span className="font-semibold">{gameCache?.platform || game.platform}</span>
								</div>
							</div>

							{/* Size */}
							<div className="bg-[#13253b]/85 rounded-xl p-4 shadow-[0_12px_24px_rgba(0,0,0,0.22)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_16px_28px_rgba(0,0,0,0.3)]">
								<p className="text-steam-400 text-sm mb-2">SIZE</p>
								<div className="flex items-center gap-2">
									{loadingSize ? (
										<Loader className="w-5 h-5 animate-spin" />
									) : (
										<>
											<HardDrive className="w-5 h-5" />
											<span className="font-semibold">{gameSize}</span>
										</>
									)}
								</div>
							</div>

							{/* Location */}
							<div className="bg-[#112033]/85 rounded-xl p-4 col-span-2 shadow-[0_12px_24px_rgba(0,0,0,0.22)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_16px_28px_rgba(0,0,0,0.3)]">
								<p className="text-steam-400 text-sm mb-2">LOCATION</p>
								<div className="flex items-center justify-between gap-3">
									<p className="font-mono text-sm truncate text-steam-100 flex-1">{game.path}</p>
									<div className="flex items-center gap-2 shrink-0">
										<button
											onClick={handleCopyPath}
											className="w-8 h-8 rounded-md bg-[#2f4f70] hover:bg-[#3a648d] text-steam-100 transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.03] active:scale-[0.97] inline-flex items-center justify-center"
											title={copiedPath ? 'Copied' : 'Copy path'}
											aria-label={copiedPath ? 'Copied' : 'Copy path'}
										>
											{copiedPath ? <Check className="w-4 h-4 text-green-300" /> : <Copy className="w-4 h-4" />}
										</button>
										<button
											onClick={handleOpenFolder}
											className="w-8 h-8 rounded-md bg-[#2f4f70] hover:bg-[#3a648d] text-steam-100 transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.03] active:scale-[0.97] inline-flex items-center justify-center"
											title="Open folder"
											aria-label="Open folder"
										>
											<FolderOpen className="w-4 h-4" />
										</button>
									</div>
								</div>
							</div>

							{/* Play History */}
							<div className="bg-[#13263a]/85 rounded-xl p-4 col-span-2 shadow-[0_12px_24px_rgba(0,0,0,0.22)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_16px_28px_rgba(0,0,0,0.3)]">
								<p className="text-steam-400 text-sm mb-3">PLAY HISTORY</p>
								<div className="text-sm">
									<div className="flex items-center gap-2 text-[#4fd673]">
										<Gamepad2 className="w-4 h-4" />
										<span>{gamePlaytime}</span>
										<div className="mx-10 text-steam-600">|</div>
										<Clock3 className="w-4 h-4" />
										<span>{formatLastPlayed(lastPlayedAt)}</span>
									</div>
								</div>
							</div>
						</div>

						{/* Action Buttons */}
						<div className="flex flex-wrap justify-between items-end gap-4 mt-auto w-full">
							<div className="flex flex-wrap items-center gap-2 min-h-12">
								{specialTags
									.filter((tag) => tagVisuals[tag])
									.map((tag) => {
										const visual = tagVisuals[tag]
										return (
											<span
												key={tag}
												className={`px-2.5 py-1.5 rounded-md text-[11px] font-semibold tracking-wide inline-flex items-center gap-1.5 ${visual.className}`}
												title={visual.label}
											>
												{visual.icon}
												{visual.label}
											</span>
										)
									})}
							</div>

							<div className="flex items-center gap-4">
								<button
									onClick={handleLaunch}
									disabled={isLaunching || isMissing || isGameRunning}
									className="w-65 bg-[#1f8f4e] hover:bg-[#27a45a] disabled:opacity-50 text-white font-semibold py-3 px-4 rounded-lg transition-all duration-200 flex items-center justify-center gap-2 hover:-translate-y-0.5 hover:scale-[1.02] active:scale-[0.98] shadow-[0_10px_20px_rgba(0,0,0,0.22)]"
								>
									{isLaunching || isGameRunning ? (
										<Loader className="w-5 h-5 animate-spin" />
									) : (
										<Play className="w-5 h-5" />
									)}
									{isLaunching ? 'Launching...' : isGameRunning ? 'Running' : 'Play'}
								</button>

								<button
									onClick={onToggleFavorite}
									className="w-12 h-12 p-0 bg-[#2f455f] hover:bg-[#3c5978] text-white font-semibold rounded-lg transition-all duration-200 flex items-center justify-center hover:-translate-y-0.5 hover:scale-[1.02] active:scale-[0.98] shadow-[0_10px_20px_rgba(0,0,0,0.2)]"
									title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
									aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
								>
									<Star className={`w-5 h-5 ${isFavorite ? 'fill-[#ffd700] text-[#ffd700]' : 'text-[#a8a8a8]'}`} />
								</button>

								<button
									onClick={() => setShowConfig(true)}
									className="w-12 h-12 p-0 bg-[#2f455f] hover:bg-[#3c5978] text-white font-semibold rounded-lg transition-all duration-200 flex items-center justify-center hover:-translate-y-0.5 hover:scale-[1.02] active:scale-[0.98] shadow-[0_10px_20px_rgba(0,0,0,0.2)]"
									title="Settings"
									aria-label="Settings"
								>
									<Settings className="w-5 h-5" />
								</button>
							</div>
						</div>
						{isMissing && (
							<div className="w-full mt-4">
								<div className="bg-[#8b1f1f]/90 border border-[#c94343] text-[#ffdada] rounded-lg px-4 py-3 text-center text-base font-semibold shadow-md">
									<span>Game not found: The game folder has been moved or deleted. </span>
									<button
										type="button"
										onClick={() => void handleSelectNewGameFolder()}
										disabled={isRelocatingGameFolder}
										className="inline-flex items-center gap-2 rounded-md bg-red-950/55 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-900/70 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
									>
										{isRelocatingGameFolder && <Loader className="w-4 h-4 animate-spin" />}
										<span>{isRelocatingGameFolder ? 'Selecting...' : 'Select a new game folder'}</span>
									</button>
								</div>
							</div>
						)}
					</div>

				</div>
			</div>
		</>
	)
}

export default GameDetailView
