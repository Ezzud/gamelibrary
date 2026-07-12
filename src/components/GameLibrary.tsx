import { useEffect, useRef, useState } from 'react'
import GameCard from './GameCard'
import { ArrowDownNarrowWide, ArrowUpWideNarrow, CheckCircle2, ChevronsUpDown, FolderOpen, Link2, Loader, Play, Plus, RefreshCw, ShieldCheck, Star, Tags, Trash2 } from 'lucide-react'
import { FaGamepad, FaLockOpen, FaMicrochip, FaSteam, FaTwitch, FaUsers, FaVrCardboard, FaXbox } from 'react-icons/fa'
import { SiBattledotnet, SiEpicgames, SiGogdotcom, SiEa } from 'react-icons/si'
import { launchGame, openGameFolder } from '../services/GameLauncher'
import { trackPlaytimeForProcess } from '../services/PlaytimeManager'
import { addCustomScanFolder, addIgnoredFolder, addPlayHistoryEntry, getCustomScanFolders, loadGameConfig, loadGameCache, removeCustomScanFolder, removeGameFromList, saveGameConfig, getAppConfig, getGameCoverPath, setIGDBApiBaseUrl, setIGDBConnectionMode } from '../services/ConfigManager'
import { chooseFolder, fetchCustomGame, registerGames } from '../services/GameScanner'
import { Logger } from '../utils/Logger'
import { testGameLibraryApi } from '../services/GameDataManager'
import LaunchFilePickerModal from './LaunchFilePickerModal'
import type { Game, GameLibraryProps, SortField } from '../types/appTypes'
import { readFile } from '@tauri-apps/plugin-fs'

const SCAN_PLATFORMS = ['Steam', 'Epic Games', 'GOG', 'Xbox', 'EA', 'Battle.net']
const MIN_LAUNCH_LOADING_MS = 5000
const DEFAULT_METADATA_API_URL = 'https://gamelibrary.ezzud.fr/api'
const normalizeApiBaseUrl = (value: string) => value.trim().replace(/\/+$/, '')

const waitForMinimumLaunchLoading = async (startedAt: number) => {
	const elapsed = Date.now() - startedAt
	const remaining = MIN_LAUNCH_LOADING_MS - elapsed
	if (remaining > 0) {
		await new Promise<void>((resolve) => window.setTimeout(resolve, remaining))
	}
}

const parseDateAdded = (value: unknown): number | null => {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value
	}

	if (typeof value === 'string') {
		const trimmed = value.trim()
		if (!trimmed) {
			return null
		}

		const asNumber = Number(trimmed)
		if (Number.isFinite(asNumber)) {
			return asNumber
		}

		const parsed = Date.parse(trimmed)
		return Number.isNaN(parsed) ? null : parsed
	}

	return null
}

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

const getPlatformIcon = (platform: string) => {
	const iconClass = 'w-4 h-4'

	switch (platform) {
		case 'Steam':
			return <FaSteam className={`${iconClass} text-white`} />
		case 'Epic Games':
			return <SiEpicgames className={`${iconClass} text-white`} />
		case 'Battle.net':
			return <SiBattledotnet className={`${iconClass} text-[#1ea7ff]`} />
		case 'GOG':
			return <SiGogdotcom className={`${iconClass} text-[#8d4bbb]`} />
		case 'Xbox':
			return <FaXbox className={`${iconClass} text-[#107c10]`} />
		case 'Custom Folders':
			return <FolderOpen className={`${iconClass} text-steam-200`} />
		case 'EA':
			return <SiEa className={`${iconClass} text-[#ff4747]`} />
		default:
			return <FolderOpen className={`${iconClass} text-steam-300`} />
	}
}

/**
 * GameLibrary component - displays all games as a grid of cards
 * Params: games, onGameSelect, isLoading, scanProgress - data and handlers
 * Returns: JSX.Element - game library grid layout
 */
const GameLibrary = (props: GameLibraryProps) => {
	const {
		games,
		favoriteGameIds,
		onGameSelect,
		onLaunchError,
		onShowToast,
		onLaunchSuccess,
		onGamesRemoved,
		runningGameIds,
		onGameRunningChange,
		igdbConnectionStatus,
		onConnectIGDB,
		onOpenSettings,
		onRefresh,
		onGamesAdded,
		onScanPlatforms,
		onToggleFavorite,
		isLoading,
		isLoadingGames,
		scanProgress,
		scanStatusMessage,
		searchQuery,
		onSearchQueryChange,
		platformFilter,
		onPlatformFilterChange,
		tagFilter,
		onTagFilterChange,
		sortField,
		onSortFieldChange,
		sortDirection,
		onSortDirectionChange
	} = props
	const [pickerGame, setPickerGame] = useState<Game | null>(null)
	const [pickerLaunchFiles, setPickerLaunchFiles] = useState<string[]>([])
	const [pickerSelectedLaunchFile, setPickerSelectedLaunchFile] = useState('')
	const [pickerPendingConfig, setPickerPendingConfig] = useState<any>(null)
	const [launchingGameId, setLaunchingGameId] = useState<string | null>(null)
	const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set(['Steam']))
	const [twitchClientId, setTwitchClientId] = useState('')
	const [twitchClientSecret, setTwitchClientSecret] = useState('')
	const [igdbConnectionMode, setIgdbConnectionModeState] = useState<'api' | 'twitch'>('api')
	const [gameLibraryApiBaseUrl, setGameLibraryApiBaseUrl] = useState(DEFAULT_METADATA_API_URL)
	const [isConnectingIGDB, setIsConnectingIGDB] = useState(false)
	const [isSavingMetadataSource, setIsSavingMetadataSource] = useState(false)
	const [metadataSourceError, setMetadataSourceError] = useState<string | null>(null)
	const [metadataSourceStatusMessage, setMetadataSourceStatusMessage] = useState<string | null>(null)
	const [metadataSourceStatusTone, setMetadataSourceStatusTone] = useState<'success' | 'error' | null>(null)
	const [igdbConnectError, setIgdbConnectError] = useState<string | null>(null)
	const [isPlatformMenuOpen, setIsPlatformMenuOpen] = useState(false)
	const [isTagMenuOpen, setIsTagMenuOpen] = useState(false)
	const [isSortMenuOpen, setIsSortMenuOpen] = useState(false)
	const [selectedGameIds, setSelectedGameIds] = useState<Set<string>>(new Set())
	const [isDeletingSelected, setIsDeletingSelected] = useState(false)
	const [isAddingCustomFolder, setIsAddingCustomFolder] = useState(false)
	const [customFolders, setCustomFolders] = useState<string[]>([])
	const [removingCustomFolderPath, setRemovingCustomFolderPath] = useState<string | null>(null)
	const [gameTagsById, setGameTagsById] = useState<Record<string, string[]>>({})
	const [gameDateAddedById, setGameDateAddedById] = useState<Record<string, number | null>>({})
	const [gameCoversById, setGameCoversById] = useState<Record<string, string | null>>({})
	const [isAddingManualGame, setIsAddingManualGame] = useState(false)
	const [cardHoverEffect, setCardHoverEffect] = useState('zoom')
	const [showSkipIGDBConfirmation, setShowSkipIGDBConfirmation] = useState(false)
	const [skipIGDBConfirmationSource, setSkipIGDBConfirmationSource] = useState<'api' | 'twitch' | null>(null)
	const [skipIGDBSetup, setSkipIGDBSetup] = useState(false)
	const [dateLoading, setDateLoading] = useState(true)
	const [displayCoverLoading, setDisplayCoverLoading] = useState(true)
	const platformMenuRef = useRef<HTMLDivElement | null>(null)
	const tagMenuRef = useRef<HTMLDivElement | null>(null)
	const sortMenuRef = useRef<HTMLDivElement | null>(null)

	useEffect(() => {
		if (!isPlatformMenuOpen && !isTagMenuOpen && !isSortMenuOpen) {
			return
		}

		const handleAnyOutsideClick = (event: MouseEvent | PointerEvent) => {
			const target = event.target as Node

			if (platformMenuRef.current?.contains(target) || tagMenuRef.current?.contains(target) || sortMenuRef.current?.contains(target)) {
				return
			}

			setIsPlatformMenuOpen(false)
			setIsTagMenuOpen(false)
			setIsSortMenuOpen(false)
		}

		window.addEventListener('pointerdown', handleAnyOutsideClick)
		window.addEventListener('contextmenu', handleAnyOutsideClick)

		return () => {
			window.removeEventListener('pointerdown', handleAnyOutsideClick)
			window.removeEventListener('contextmenu', handleAnyOutsideClick)
		}
	}, [isPlatformMenuOpen, isTagMenuOpen, isSortMenuOpen])

	useEffect(() => {
		const loadCustomFolders = async () => {
			try {
				const folders = await getCustomScanFolders()
				const normalizedFolders = Array.isArray(folders) ? folders.filter(Boolean) : []
				setCustomFolders(normalizedFolders)
				if (normalizedFolders.length > 0) {
					setSelectedPlatforms((prev) => {
						const next = new Set(prev)
						next.add('Custom Folders')
						return next
					})
				}
			} catch (error) {
				Logger.warn('Failed to load custom folders for tutorial scan menu:', error)
			}
		}

		void loadCustomFolders()
	}, [])

	useEffect(() => {
		const loadMetadataSource = async () => {
			try {
				const config = await getAppConfig()
				setIgdbConnectionModeState(config.igdbConnectionMode === 'twitch' ? 'twitch' : 'api')
				setGameLibraryApiBaseUrl((config.igdbApiBaseUrl || DEFAULT_METADATA_API_URL).trim() || DEFAULT_METADATA_API_URL)
				setTwitchClientId((config.twitchClientId || '').trim())
				setTwitchClientSecret((config.twitchClientSecret || '').trim())
			} catch (error) {
				Logger.warn('Failed to load metadata source config for the library empty state:', error)
			}
		}

		void loadMetadataSource()
	}, [])

	useEffect(() => {
		const loadCardHoverEffect = async () => {
			try {
				const config = await getAppConfig()
				setCardHoverEffect(config.cardHoverEffect || 'zoom')
			} catch (error) {
				Logger.warn('Failed to load card hover effect:', error)
				setCardHoverEffect('zoom')
			}
		}

		void loadCardHoverEffect()
	}, [])

	useEffect(() => {
		const loadDateAddedData = async () => {
			if (games.length < 1) {
				setGameTagsById({})
				setGameDateAddedById({})
				setDateLoading(false)
				return
			}

			const pairs = await Promise.all(
				games.map(async (game) => {
					try {
						const config = await loadGameConfig(game.id)
						const dateAdded = parseDateAdded((config as any)?.dateAdded)
						return [game.id, dateAdded] as const
					} catch {
						return [game.id, null] as const
					}
				})
			)

			setGameDateAddedById(Object.fromEntries(pairs))
			setGameTagsById((prev) => {
				const validIds = new Set(games.map((game) => game.id))
				const next = Object.fromEntries(Object.entries(prev).filter(([gameId]) => validIds.has(gameId)))
				return Object.keys(next).length === Object.keys(prev).length ? prev : next
			})
			setDateLoading(false)
		}

		void loadDateAddedData()
	}, [games])

	useEffect(() => {
		const loadDisplayCoverData = async () => {
			if (games.length < 1) {
				setGameTagsById({})
				setGameDateAddedById({})
				setDisplayCoverLoading(false)
				return
			}

			const pairs = await Promise.all(
				games.map(async (game) => {
					try {
						const coverPath = await getGameCoverPath(game.id)
						if (coverPath) {
							const bytes = await readFile(coverPath);
							const blob = new Blob([new Uint8Array(bytes)], {
								type: 'image/jpeg',
							});
							const url = URL.createObjectURL(blob);
							return [game.id, url] as const
						}
						return [game.id, null] as const
					} catch {
						return [game.id, null] as const
					}
				})
			)

			setGameCoversById(Object.fromEntries(pairs))
			setGameTagsById((prev) => {
				const validIds = new Set(games.map((game) => game.id))
				const next = Object.fromEntries(Object.entries(prev).filter(([gameId]) => validIds.has(gameId)))
				return Object.keys(next).length === Object.keys(prev).length ? prev : next
			})
			setDisplayCoverLoading(false)
		}

		void loadDisplayCoverData()
	}, [games])

	const availablePlatforms = Array.from(new Set([...SCAN_PLATFORMS, ...games.map((game) => game.platform)])).filter(Boolean).sort((a, b) => a.localeCompare(b))
	const availableTags = Array.from(
		new Set(
			Object.values(gameTagsById)
				.flat()
				.map((tag) => tag.toLowerCase())
				.filter((tag) => tagVisuals.hasOwnProperty(tag))
		)
	).sort((a, b) => a.localeCompare(b))

	useEffect(() => {
		if (platformFilter !== 'All' && !availablePlatforms.includes(platformFilter)) {
			onPlatformFilterChange('All')
		}

		if (tagFilter !== 'All') {
			const normalizedTag = tagFilter.toLowerCase()
			if (!availableTags.includes(normalizedTag)) {
				onTagFilterChange('All')
			}
		}
	}, [availablePlatforms, availableTags, onPlatformFilterChange, onTagFilterChange, platformFilter, tagFilter])

	const hasActiveFilters = searchQuery.trim().length > 0 || platformFilter !== 'All' || tagFilter !== 'All'

	useEffect(() => {
		setSelectedGameIds((prev) => {
			const validIds = new Set(games.map((game) => game.id))
			const next = new Set(Array.from(prev).filter((id) => validIds.has(id)))
			return next.size === prev.size ? prev : next
		})
	}, [games])



	const displayedGames = dateLoading ? [] : [...games]
		.filter((game) => {
			const normalizedName = game.name.toLowerCase()
			const normalizedPath = game.path.toLowerCase()
			const normalizedSearch = searchQuery.trim().toLowerCase()

			if (normalizedSearch && !normalizedName.includes(normalizedSearch) && !normalizedPath.includes(normalizedSearch)) {
				return false
			}

			if (platformFilter !== 'All') {
				if ((game.platform || '').toLowerCase() !== platformFilter.toLowerCase()) {
					return false
				}
			}

			if (tagFilter !== 'All') {
				const tags = (gameTagsById[game.id] || []).map((tag) => tag.toLowerCase())
				if (!tags.includes(tagFilter.toLowerCase())) {
					return false
				}
			}

			return true
		})
		.sort((a, b) => {
			let result = 0

			if (sortField === 'name') {
				result = a.name.localeCompare(b.name)
			} else if (sortField === 'platform') {
				result = (a.platform || '').localeCompare(b.platform || '') || a.name.localeCompare(b.name)
			} else if (sortField === 'dateAdded') {
				const aDateAdded = gameDateAddedById[a.id] ?? null
				const bDateAdded = gameDateAddedById[b.id] ?? null

				if (aDateAdded !== null && bDateAdded !== null) {
					result = aDateAdded - bDateAdded
				} else if (aDateAdded !== null) {
					result = -1
				} else if (bDateAdded !== null) {
					result = 1
				} else {
					result = a.name.localeCompare(b.name)
				}
			} else {
				const aFirstTag = ((gameTagsById[a.id] || [])[0] || '').toLowerCase()
				const bFirstTag = ((gameTagsById[b.id] || [])[0] || '').toLowerCase()
				result = aFirstTag.localeCompare(bFirstTag) || a.name.localeCompare(b.name)
			}

			return sortDirection === 'asc' ? result : result * -1
		})

	const favoriteGames = displayedGames.filter((game) => favoriteGameIds.has(game.id))
	const regularGames = displayedGames.filter((game) => !favoriteGameIds.has(game.id))

	const handleCardSpecialTagsLoaded = (gameId: string, tags: string[]) => {
		setGameTagsById((prev) => {
			const currentTags = prev[gameId] || []
			const nextTags = tags.map((tag) => tag.toLowerCase())

			if (
				currentTags.length === nextTags.length
				&& currentTags.every((tag, index) => tag === nextTags[index])
			) {
				return prev
			}

			return {
				...prev,
				[gameId]: nextTags,
			}
		})
	}

	const renderGameCards = (gamesToRender: Game[]) => (
		<div className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 ${isDeletingSelected ? 'pointer-events-none opacity-70' : ''}`}>
			{gamesToRender.map((game, index) => {
				const isRunning = runningGameIds?.has(game.id) ?? false
				const isLaunching = launchingGameId === game.id
				return (
					<div
						key={game.id}
						className="game-card-enter relative group"
						style={{ animationDelay: `${Math.min(index * 35, 420)}ms` }}
					>
						<label className={`absolute top-2 left-2 z-20 inline-flex items-center cursor-pointer transition-all duration-200 hover:scale-105 ${selectedGameIds.has(game.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}>
							<input
								type="checkbox"
								checked={selectedGameIds.has(game.id)}
								onChange={(event) => handleToggleGameSelection(game.id, event.target.checked)}
								onClick={(event) => event.stopPropagation()}
								disabled={isDeletingSelected}
								className="h-4 w-4 rounded border border-sky-300/70 bg-steam-900/80 accent-[#6ec1ff] shadow-[0_0_0_1px_rgba(14,116,144,0.35)]"
							/>
						</label>
						<div className={`rounded-lg transition-all duration-200 ${selectedGameIds.has(game.id) ? 'ring-2 ring-sky-400 shadow-[0_0_0_1px_rgba(125,211,252,0.35),0_10px_22px_rgba(30,120,200,0.25)]' : ''}`}>
							<GameCard
								game={game}
								onClick={() => {
									if (selectedGameIds.size > 0) {
										handleToggleGameSelection(game.id, !selectedGameIds.has(game.id))
									} else {
										onGameSelect(game)
									}
								}}
								onPlay={handlePlayGame}
								isPlayLoading={isLaunching}
								isRunning={isRunning}
								isFavorite={favoriteGameIds.has(game.id)}
								onOpenFolder={handleOpenGameFolder}
								onGameSettings={() => onGameSelect(game)}
								onDelete={handleDeleteGame}
								onToggleFavorite={onToggleFavorite}
								onSpecialTagsLoaded={handleCardSpecialTagsLoaded}
								cardHoverEffect={cardHoverEffect}
								displayCover={gameCoversById[game.id] || undefined}
							/>
						</div>
					</div>
				)
			})}
		</div>
	)

	const getSortLabel = (field: SortField) => {
		if (field === 'name') {
			return 'Name'
		}
		if (field === 'platform') {
			return 'Platform'
		}
		if (field === 'dateAdded') {
			return 'Date Added'
		}
		return 'Tag'
	}

	const selectedTagVisual = tagFilter !== 'All' ? tagVisuals[tagFilter.toLowerCase()] : null
	const twitchCredentialsMissing = !twitchClientId.trim() || !twitchClientSecret.trim()
	const credentialWarningMessage = igdbConnectionMode === 'twitch' && twitchCredentialsMissing
		? 'Twitch credentials are missing. Switch to the GameLibrary API or enter valid Twitch credentials.'
		: igdbConnectionMode === 'twitch' && igdbConnectionStatus === 'invalid'
			? 'Your Twitch credentials are invalid'
			: null

	const togglePlatform = (platform: string) => {
		setSelectedPlatforms((prev) => {
			const next = new Set(prev)
			if (next.has(platform)) {
				next.delete(platform)
			} else {
				next.add(platform)
			}
			return next
		})
	}

	const handleBeginScan = async () => {
		const platforms = Array.from(selectedPlatforms)
		if (platforms.length < 1) {
			Logger.warn('No platforms selected for scanning.')
			return
		}

		await onScanPlatforms(platforms)
	}

	const handleClearFilters = () => {
		onSearchQueryChange('')
		onPlatformFilterChange('All')
		onTagFilterChange('All')
		setIsPlatformMenuOpen(false)
		setIsTagMenuOpen(false)
		setIsSortMenuOpen(false)
	}

	const handleConnectIGDB = async () => {
		if (isConnectingIGDB) {
			return
		}

		setIgdbConnectError(null)
		setIsConnectingIGDB(true)
		try {
			const result = await onConnectIGDB(twitchClientId, twitchClientSecret)
			if (!result.success) {
				setIgdbConnectError(result.message || 'Unable to connect to IGDB with these credentials.')
				return
			}

			await setIGDBConnectionMode('twitch')
			setIgdbConnectionModeState('twitch')
			setSkipIGDBSetup(true)
			setMetadataSourceError(null)
		} finally {
			setIsConnectingIGDB(false)
		}
	}

	const handleUseApiSource = async () => {
		if (isSavingMetadataSource) {
			return
		}

		setMetadataSourceError(null)
		setMetadataSourceStatusMessage(null)
		setMetadataSourceStatusTone(null)
		setIsSavingMetadataSource(true)
		try {
			const result = await testGameLibraryApi(gameLibraryApiBaseUrl)
			if (!result.success) {
				setMetadataSourceStatusMessage('Unable to reach the GameLibrary API. Check the URL and try again.')
				setMetadataSourceStatusTone('error')
				return
			}

			const versionText = result.data?.version ? ` version ${result.data.version}` : ''
			const pingText = typeof result.data?.pingMs === 'number' ? ` in ${result.data.pingMs}ms` : ''
			setMetadataSourceStatusMessage(`GameLibrary API is healthy${versionText}${pingText}.`)
			setMetadataSourceStatusTone('success')
		} catch (error) {
			Logger.error('Failed to test GameLibrary API metadata source:', error)
			setMetadataSourceStatusMessage('Unable to reach the GameLibrary API. Please try again.')
			setMetadataSourceStatusTone('error')
		} finally {
			setIsSavingMetadataSource(false)
		}
	}

	const handleResetApiSourceUrl = async () => {
		if (isSavingMetadataSource) {
			return
		}

		setMetadataSourceError(null)
		setMetadataSourceStatusMessage(null)
		setMetadataSourceStatusTone(null)
		setIsSavingMetadataSource(true)
		try {
			await setIGDBApiBaseUrl(DEFAULT_METADATA_API_URL)
			setGameLibraryApiBaseUrl(DEFAULT_METADATA_API_URL)
			setMetadataSourceStatusMessage('GameLibrary API URL reset to the default value.')
			setMetadataSourceStatusTone('success')
		} catch (error) {
			Logger.error('Failed to reset GameLibrary API URL in the empty state tutorial:', error)
			setMetadataSourceStatusMessage('Unable to reset the API URL. Please try again.')
			setMetadataSourceStatusTone('error')
		} finally {
			setIsSavingMetadataSource(false)
		}
	}

	const handleSkipToApiSource = async () => {
		if (isSavingMetadataSource) {
			return
		}

		setMetadataSourceError(null)
		setMetadataSourceStatusMessage(null)
		setMetadataSourceStatusTone(null)
		setIsSavingMetadataSource(true)
		try {
			await setIGDBConnectionMode('api')
			await setIGDBApiBaseUrl(DEFAULT_METADATA_API_URL)
			setIgdbConnectionModeState('api')
			setGameLibraryApiBaseUrl(DEFAULT_METADATA_API_URL)
			setSkipIGDBSetup(true)
			setIgdbConnectError(null)
			setMetadataSourceError(null)
			setMetadataSourceStatusMessage(null)
			setMetadataSourceStatusTone(null)
			onRefresh()
		} catch (error) {
			Logger.error('Failed to skip IGDB setup and switch to the default API source:', error)
			setMetadataSourceError('Unable to switch to the default API source. Please try again.')
		} finally {
			setIsSavingMetadataSource(false)
		}
	}

	const handlePlayGame = async (game: Game) => {
		if (launchingGameId || runningGameIds?.has(game.id)) {
			return
		}

		try {
			const config = await loadGameConfig(game.id)
			const allLaunchFiles = (config?.allLaunchFiles || []).filter((file: string | undefined) => !!file)

			if (!config?.lockedLaunchFile && allLaunchFiles.length > 1) {
				const initialSelection = config?.defaultLaunchFile && allLaunchFiles.includes(config.defaultLaunchFile)
					? config.defaultLaunchFile
					: allLaunchFiles[0]

				setPickerGame(game)
				setPickerPendingConfig(config)
				setPickerLaunchFiles(allLaunchFiles)
				setPickerSelectedLaunchFile(initialSelection)
				return
			}

			setLaunchingGameId(game.id)
			const launchStartedAt = Date.now()
			const launchPath = await launchGame(game.path, game.id)
			try {
				await addPlayHistoryEntry(game.id)
				await onLaunchSuccess()
			} catch (historyError) {
				Logger.warn(`Game launched but failed to update play history for ${game.name}:`, historyError)
			}
			void trackPlaytimeForProcess(game.id, game.path, launchPath, (isRunning) => onGameRunningChange?.(game.id, isRunning))
			await waitForMinimumLaunchLoading(launchStartedAt)
		} catch (error) {
			Logger.error(`Failed to launch game ${game.name}:`, error)
			const message = error instanceof Error ? error.message : String(error)
			onLaunchError(`Failed to launch ${game.name}: ${message}`)
		} finally {
			setLaunchingGameId(null)
		}
	}

	const handleConfirmPlayLaunchFile = async () => {
		if (!pickerGame || !pickerSelectedLaunchFile) {
			return
		}

		if (runningGameIds?.has(pickerGame.id)) {
			return
		}

		try {
			setLaunchingGameId(pickerGame.id)
			const launchStartedAt = Date.now()
			await saveGameConfig(pickerGame.id, {
				...pickerPendingConfig,
				defaultLaunchFile: pickerSelectedLaunchFile,
				lockedLaunchFile: true,
				allLaunchFiles: pickerPendingConfig?.allLaunchFiles || pickerLaunchFiles,
			})

			const launchPath = await launchGame(pickerGame.path, pickerGame.id)
			try {
				await addPlayHistoryEntry(pickerGame.id)
				await onLaunchSuccess()
			} catch (historyError) {
				Logger.warn(`Game launched but failed to update play history for ${pickerGame.name}:`, historyError)
			}
			void trackPlaytimeForProcess(pickerGame.id, pickerGame.path, launchPath, (isRunning) => onGameRunningChange?.(pickerGame.id, isRunning))
			await waitForMinimumLaunchLoading(launchStartedAt)
		} catch (error) {
			Logger.error(`Failed to persist launch file selection for ${pickerGame.name}:`, error)
			const message = error instanceof Error ? error.message : String(error)
			onLaunchError(`Failed to launch ${pickerGame.name}: ${message}`)
		} finally {
			setLaunchingGameId(null)
			setPickerGame(null)
			setPickerPendingConfig(null)
			setPickerLaunchFiles([])
			setPickerSelectedLaunchFile('')
		}
	}

	const handleOpenGameFolder = async (game: Game) => {
		try {
			await openGameFolder(game.path)
		} catch (error) {
			Logger.error(`Failed to open game folder for ${game.name}:`, error)
		}
	}

	const handleDeleteGame = async (game: Game) => {
		const confirmed = window.confirm(`Delete ${game.name} from your library?`)
		if (!confirmed) {
			return
		}

		try {
			await addIgnoredFolder(game.path)
			await removeGameFromList(game.id)
			const folderName = game.path.split(/[\\/]/).filter(Boolean).pop() || game.name
			onShowToast?.(`Folder "${folderName}" is now ignored by GameLibrary`, { durationMs: 4000, style: 'warning' })
			setSelectedGameIds((prev) => {
				const next = new Set(prev)
				next.delete(game.id)
				return next
			})
			onGamesRemoved?.([game.id])
		} catch (error) {
			Logger.error(`Failed to delete game ${game.name}:`, error)
		}
	}

	const handleToggleGameSelection = (gameId: string, isSelected: boolean) => {
		setSelectedGameIds((prev) => {
			const next = new Set(prev)
			if (isSelected) {
				next.add(gameId)
			} else {
				next.delete(gameId)
			}
			return next
		})
	}

	const handleDeleteSelectedGames = async () => {
		if (selectedGameIds.size < 1 || isDeletingSelected) {
			return
		}

		const selectedGames = games.filter((game) => selectedGameIds.has(game.id))
		if (selectedGames.length < 1) {
			return
		}

		const confirmed = window.confirm(`Delete ${selectedGames.length} selected game(s) from your library?`)
		if (!confirmed) {
			return
		}

		setIsDeletingSelected(true)
		try {
			for (const game of selectedGames) {
				await addIgnoredFolder(game.path)
				await removeGameFromList(game.id)
				const folderName = game.path.split(/[\\/]/).filter(Boolean).pop() || game.name
				onShowToast?.(`Folder "${folderName}" is now ignored by GameLibrary`, { durationMs: 4000, style: 'warning' })
			}
			setSelectedGameIds(new Set())
			onGamesRemoved?.(selectedGames.map((game) => game.id))
		} catch (error) {
			Logger.error('Failed to delete selected games:', error)
		} finally {
			setIsDeletingSelected(false)
		}
	}

	const handleAddCustomFolderInEmptyState = async () => {
		if (isAddingCustomFolder) {
			return
		}

		setIsAddingCustomFolder(true)
		try {
			const selectedFolder = await chooseFolder()
			if (!selectedFolder) {
				return
			}

			await addCustomScanFolder(selectedFolder)
			setCustomFolders((prev) => {
				if (prev.includes(selectedFolder)) {
					return prev
				}
				return [...prev, selectedFolder]
			})
			setSelectedPlatforms((prev) => {
				const next = new Set(prev)
				next.add('Custom Folders')
				return next
			})
			onShowToast?.('Custom folder added to scan configuration.', { durationMs: 4000, style: 'success' })
		} catch (error) {
			Logger.error('Failed to add custom folder from scan menu:', error)
			onShowToast?.('Failed to add custom folder.', { durationMs: 4000, style: 'error' })
		} finally {
			setIsAddingCustomFolder(false)
		}
	}

	const handleRemoveCustomFolderInEmptyState = async (folderPath: string) => {
		if (removingCustomFolderPath) {
			return
		}

		setRemovingCustomFolderPath(folderPath)
		try {
			await removeCustomScanFolder(folderPath)
			setCustomFolders((prev) => prev.filter((folder) => folder !== folderPath))
			onShowToast?.('Custom folder removed from scan configuration.', { durationMs: 4000, style: 'success' })
		} catch (error) {
			Logger.error('Failed to remove custom folder from scan menu:', error)
			onShowToast?.('Failed to remove custom folder.', { durationMs: 4000, style: 'error' })
		} finally {
			setRemovingCustomFolderPath(null)
		}
	}

	const handleAddManualGame = async () => {
		if (isAddingManualGame) {
			return
		}

		setIsAddingManualGame(true)
		try {
			const selectedFolder = await chooseFolder()
			if (!selectedFolder) {
				return
			}

			// Fetch game info from the selected folder (treating it as a game folder itself)
			const detectedGames = await fetchCustomGame(selectedFolder)

			if (!detectedGames || detectedGames.length === 0) {
				onShowToast?.('Error: The folder is not a game folder, or is not recognized as a game folder', { durationMs: 5000, style: 'error' })
				return
			}

			// Register the detected game(s)
			try {
				await registerGames(detectedGames, 'Custom Folders')

				// registerGames mutates the passed game objects and assigns `id` to those actually registered.
				const registeredGames = detectedGames.filter((g: any) => g && g.id)

				if (registeredGames.length > 0) {
					const mapped = await Promise.all(
						registeredGames.map(async (g: any) => {
							const cache = await loadGameCache(g.id).catch(() => null)
							return {
								id: g.id,
								name: g.name,
								path: g.path,
								platform: (cache?.platform as string) || 'Custom Folders',
								coverUrl: (cache as any)?.cover_url || undefined,
								thumbnailUrl: (cache as any)?.thumbnail_url || undefined,
							}
						})
					)

					onGamesAdded?.(mapped)
				}

				const gameNames = registeredGames.map((game) => game.name).join(', ')
				onShowToast?.(`Successfully added ${gameNames}`, { durationMs: 4000, style: 'success' })
			} catch (registrationError) {
				Logger.error('Failed to register manually added game:', registrationError)
				const errorMessage = registrationError instanceof Error ? registrationError.message : String(registrationError)
				onShowToast?.(`An error occurred: ${errorMessage}`, { durationMs: 5000, style: 'error' })
			}
		} catch (error) {
			Logger.error('Failed to add manual game:', error)
			const errorMessage = error instanceof Error ? error.message : String(error)
			onShowToast?.(`An error occurred: ${errorMessage}`, { durationMs: 5000, style: 'error' })
		} finally {
			setIsAddingManualGame(false)
		}
	}

	return (
		<div className="flex-1 overflow-auto">
			<LaunchFilePickerModal
				isOpen={!!pickerGame}
				gameName={pickerGame?.name || ''}
				launchFiles={pickerLaunchFiles}
				selectedLaunchFile={pickerSelectedLaunchFile}
				onSelect={setPickerSelectedLaunchFile}
				onConfirm={handleConfirmPlayLaunchFile}
				onCancel={() => {
					setPickerGame(null)
					setPickerPendingConfig(null)
					setPickerLaunchFiles([])
					setPickerSelectedLaunchFile('')
				}}
			/>

			{/* Header */}
			<div className="sticky top-0 z-10 bg-steam-900/95 p-6 backdrop-blur-sm">
				<div className="flex items-center justify-between">
					<div>
						<div className="flex items-baseline gap-2">
							<h2 className="text-2xl font-bold">My Games ({games.length === displayedGames.length ? games.length : `${displayedGames.length}/${games.length}`})</h2>
						</div>
					</div>
					{isLoading && (
						<div className="flex items-center gap-3">
							<div className="flex flex-col items-end text-right w-64">
								<span className="text-sm text-steam-300">Scanning... {scanProgress}%</span>
								<span className="text-xs text-steam-400 truncate w-full" title={scanStatusMessage}>{scanStatusMessage}</span>
							</div>
							<Loader className="w-5 h-5 animate-spin text-steam-400" />
						</div>
					)}
				</div>

				{games.length > 0 && (
					<div className="mt-4">
						<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[minmax(0,2.3fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,1fr)] gap-3">
							<div className="flex items-center gap-2">
								<button
									type="button"
									onClick={onRefresh}
									disabled={isLoading || isLoadingGames}
									className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-steam-600 bg-steam-700 hover:bg-steam-600 hover:border-steam-500 focus:outline-none disabled:opacity-50 transition-colors shrink-0"
									aria-label="Refresh game library"
									title="Refresh game library"
								>
									<RefreshCw className={`w-4 h-4 ${isLoadingGames ? 'animate-spin' : ''}`} />
								</button>
								<button
									type="button"
									onClick={() => void handleAddManualGame()}
									disabled={isLoading || isAddingManualGame}
									className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-steam-600 bg-steam-700 hover:bg-steam-600 hover:border-steam-500 focus:outline-none disabled:opacity-50 transition-colors shrink-0"
									aria-label="Add game manually"
									title="Add game manually"
								>
									{isAddingManualGame ? <Loader className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
								</button>
								<input
									type="text"
									value={searchQuery}
									onChange={(event) => onSearchQueryChange(event.target.value)}
									placeholder={`Search by name or path`}
									className="w-full rounded-lg bg-steam-700 border border-steam-600 px-3 py-2 text-sm text-white placeholder:text-steam-400 focus:outline-none focus:ring-2 focus:ring-steam-400/50"
								/>
							</div>

							<div className="w-full relative" ref={platformMenuRef}>
								<button
									type="button"
									onClick={(event) => {
										event.stopPropagation()
										setIsPlatformMenuOpen((prev) => !prev)
										setIsTagMenuOpen(false)
										setIsSortMenuOpen(false)
									}}
									className="w-full inline-flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-steam-600 text-sm text-steam-300 hover:text-white hover:bg-steam-600 transition-colors"
									title="Choose platform filter"
									aria-label="Choose platform filter"
								>
									<span className="inline-flex items-center gap-2">
										{platformFilter !== 'All' && getPlatformIcon(platformFilter)}
										<span>{platformFilter === 'All' ? 'All platforms' : platformFilter}</span>
									</span>
									<ChevronsUpDown className="w-4 h-4" />
								</button>

								{isPlatformMenuOpen && (
									<div
										className="absolute left-0 top-11 z-20 min-w-40 w-full rounded-lg border border-steam-600/90 bg-linear-to-b from-[#203349] to-[#172636] ring-1 ring-steam-700/70 p-1"
										onClick={(event) => event.stopPropagation()}
										onContextMenu={(event) => event.stopPropagation()}
									>
										<button
											type="button"
											onClick={() => {
												onPlatformFilterChange('All')
												setIsPlatformMenuOpen(false)
											}}
											className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${platformFilter === 'All' ? 'bg-steam-700 text-white hover:bg-steam-600' : 'text-steam-300 hover:bg-steam-600 hover:text-white'}`}
										>
											All platforms
										</button>
										{availablePlatforms.map((platform) => (
											<button
												key={platform}
												type="button"
												onClick={() => {
													onPlatformFilterChange(platform)
													setIsPlatformMenuOpen(false)
												}}
												className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${platformFilter === platform ? 'bg-steam-700 text-white hover:bg-steam-600' : 'text-steam-300 hover:bg-steam-600 hover:text-white'}`}
											>
												<span className="inline-flex items-center gap-2">
													{getPlatformIcon(platform)}
													<span>{platform}</span>
												</span>
											</button>
										))}
									</div>
								)}
							</div>

							<div className="w-full relative" ref={tagMenuRef}>
								<button
									type="button"
									onClick={(event) => {
										event.stopPropagation()
										setIsTagMenuOpen((prev) => !prev)
										setIsPlatformMenuOpen(false)
										setIsSortMenuOpen(false)
									}}
									className="w-full inline-flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-steam-600 text-sm text-steam-300 hover:text-white hover:bg-steam-600 transition-colors"
									title="Choose tag filter"
									aria-label="Choose tag filter"
								>
									<span className="inline-flex items-center gap-2">
										{selectedTagVisual && (
											<span className={`w-5 h-5 rounded-md inline-flex items-center justify-center ${selectedTagVisual.className}`}>
												{selectedTagVisual.icon}
											</span>
										)}
										<span>{tagFilter === 'All' ? 'All tags' : (selectedTagVisual?.label || tagFilter.toUpperCase())}</span>
									</span>
									<ChevronsUpDown className="w-4 h-4" />
								</button>

								{isTagMenuOpen && (
									<div
										className="absolute left-0 top-11 z-20 min-w-40 w-full rounded-lg border border-steam-600/90 bg-linear-to-b from-[#203349] to-[#172636] ring-1 ring-steam-700/70 p-1 max-h-64 overflow-auto"
										onClick={(event) => event.stopPropagation()}
										onContextMenu={(event) => event.stopPropagation()}
									>
										<button
											type="button"
											onClick={() => {
												onTagFilterChange('All')
												setIsTagMenuOpen(false)
											}}
											className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${tagFilter === 'All' ? 'bg-steam-700 text-white hover:bg-steam-600' : 'text-steam-300 hover:bg-steam-600 hover:text-white'}`}
										>
											All tags
										</button>
										{availableTags.map((tag) => (
											<button
												key={tag}
												type="button"
												onClick={() => {
													onTagFilterChange(tag)
													setIsTagMenuOpen(false)
												}}
												className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${tagFilter === tag ? 'bg-steam-700 text-white hover:bg-steam-600' : 'text-steam-300 hover:bg-steam-600 hover:text-white'}`}
											>
												<span className="inline-flex items-center gap-2">
													{tagVisuals[tag] ? (
														<span className={`w-5 h-5 rounded-md inline-flex items-center justify-center ${tagVisuals[tag].className}`}>
															{tagVisuals[tag].icon}
														</span>
													) : (
														<Tags className="w-4 h-4 text-steam-300" />
													)}
													<span>{tagVisuals[tag]?.label || tag.toUpperCase()}</span>
												</span>
											</button>
										))}
									</div>
								)}
							</div>

							<div className="w-full flex items-center justify-end gap-2 relative" ref={sortMenuRef}>
								<button
									type="button"
									onClick={(event) => {
										event.stopPropagation()
										setIsSortMenuOpen((prev) => !prev)
										setIsPlatformMenuOpen(false)
										setIsTagMenuOpen(false)
									}}
									className="inline-flex items-center gap-2 px-2 py-2 rounded-md border border-steam-600 text-sm text-steam-300 hover:text-white hover:bg-steam-600 transition-colors"
									title="Choose sorting field"
									aria-label="Choose sorting field"
								>
									<ChevronsUpDown className="w-4 h-4" />
									<span>Sort: {getSortLabel(sortField)}</span>
								</button>

								{isSortMenuOpen && (
									<div
										className="absolute right-0 top-11 z-20 min-w-40 rounded-lg border border-steam-600/90 bg-linear-to-b from-[#203349] to-[#172636] ring-1 ring-steam-700/70 p-1"
										onClick={(event) => event.stopPropagation()}
										onContextMenu={(event) => event.stopPropagation()}
									>
										<button
											type="button"
											onClick={() => {
												onSortFieldChange('name')
												setIsSortMenuOpen(false)
											}}
											className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${sortField === 'name' ? 'bg-steam-700 text-white hover:bg-steam-600' : 'text-steam-300 hover:bg-steam-600 hover:text-white'}`}
										>
											Name
										</button>
										<button
											type="button"
											onClick={() => {
												onSortFieldChange('platform')
												setIsSortMenuOpen(false)
											}}
											className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${sortField === 'platform' ? 'bg-steam-700 text-white hover:bg-steam-600' : 'text-steam-300 hover:bg-steam-600 hover:text-white'}`}
										>
											Platform
										</button>
										<button
											type="button"
											onClick={() => {
												onSortFieldChange('tag')
												setIsSortMenuOpen(false)
											}}
											className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${sortField === 'tag' ? 'bg-steam-700 text-white hover:bg-steam-600' : 'text-steam-300 hover:bg-steam-600 hover:text-white'}`}
										>
											Tag
										</button>
										<button
											type="button"
											onClick={() => {
												onSortFieldChange('dateAdded')
												setIsSortMenuOpen(false)
											}}
											className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${sortField === 'dateAdded' ? 'bg-steam-700 text-white hover:bg-steam-600' : 'text-steam-300 hover:bg-steam-600 hover:text-white'}`}
										>
											Date Added
										</button>
									</div>
								)}

								<button
									type="button"
									onClick={() => onSortDirectionChange(sortDirection === 'asc' ? 'desc' : 'asc')}
									className="inline-flex items-center justify-center w-9 h-9 rounded-md text-steam-300 hover:text-white hover:bg-steam-600 transition-colors"
									title={sortDirection === 'asc' ? 'Ascending order' : 'Descending order'}
									aria-label={sortDirection === 'asc' ? 'Ascending order' : 'Descending order'}
								>
									{sortDirection === 'asc' ? <ArrowDownNarrowWide className="w-4 h-4" /> : <ArrowUpWideNarrow className="w-4 h-4" />}
								</button>
							</div>
						</div>

						<div className="mt-2 flex items-center gap-2 text-xs text-steam-300 w-full min-h-8">
							{hasActiveFilters && (
								<div className="ml-1 inline-flex h-8 items-center gap-2 rounded-md bg-[#facc15] px-2 py-1 text-[#1f2937] font-medium whitespace-nowrap">
									<span>Filters are applied</span>
									<button
										type="button"
										onClick={handleClearFilters}
										className="inline-flex h-6 items-center rounded-md bg-[#0f172a] px-2 py-1 text-[#f8fafc] hover:bg-[#1e293b] transition-colors"
									>
										Clear filters
									</button>
								</div>
							)}

							{credentialWarningMessage && (
								<div className="inline-flex h-8 items-center gap-2 rounded-md border border-[#8f1d1d] bg-[#7f1d1d] px-2 py-1 text-white font-medium whitespace-nowrap">
									<span>{credentialWarningMessage}</span>
									<span>Go to</span>
									<button
										type="button"
										onClick={onOpenSettings}
										className="inline-flex h-6 items-center rounded-md border border-[#6c1b1b] bg-red-950/30 px-2 py-1 text-white hover:bg-red-900/40 transition-colors"
									>
										Settings
									</button>
									<span>to update it.</span>
								</div>
							)}

							{selectedGameIds.size > 0 && (
								<button
									type="button"
									onClick={() => void handleDeleteSelectedGames()}
									disabled={isDeletingSelected}
									className="inline-flex h-8 items-center gap-2 rounded-md border border-red-700/70 bg-red-900/65 px-2 py-1 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-red-800/75 transition-colors ml-auto"
									title="Delete selected games"
									aria-label="Delete selected games"
								>
									<Trash2 className="w-3.5 h-3.5" />
									<span>{isDeletingSelected ? 'Deleting...' : `Delete games (${selectedGameIds.size})`}</span>
								</button>
							)}
						</div>
					</div>
				)}

				<div className="absolute bottom-0 left-1/2 h-px w-[90%] -translate-x-1/2 bg-[#2b4157]" />
			</div>

			{/* Skip IGDB Confirmation Modal */}
			{showSkipIGDBConfirmation && skipIGDBConfirmationSource && (
				<div className="fixed inset-0 z-9999 flex items-center justify-center bg-black/50 backdrop-blur-sm">
					<div className="bg-steam-800 border border-sky-500 rounded-xl shadow-2xl max-w-md w-full mx-4">
						<div className="px-6 py-4">
							<h3 className="text-lg font-semibold text-white">Skip {skipIGDBConfirmationSource === 'api' ? 'API setup' : 'Twitch credentials'}?</h3>
						</div>
						<div className="px-6 py-4 space-y-3">
							<p className="text-sm text-steam-300">
								Are you sure you want to skip {skipIGDBConfirmationSource === 'api' ? 'the API health check' : 'the Twitch credentials setup'}? Game covers and thumbnails may be limited.
							</p>
							<p className="text-xs text-steam-400">
								You can always update this later in the settings.
							</p>
						</div>
						<div className="px-6 py-4 flex items-center gap-2 justify-end">
							<button
								type="button"
								onClick={() => {
									setShowSkipIGDBConfirmation(false)
									setSkipIGDBConfirmationSource(null)
								}}
								className="px-4 py-2 rounded-lg bg-steam-700 hover:bg-steam-600 text-white transition-colors"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={() => {
									setShowSkipIGDBConfirmation(false)
										setSkipIGDBConfirmationSource(null)
									void handleSkipToApiSource()
								}}
								className="px-4 py-2 rounded-lg bg-red-700/70 hover:bg-red-600 text-white transition-colors"
							>
								Skip
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Games Grid */}
			<div className="p-6">
				{(isLoadingGames || dateLoading || displayCoverLoading) ? (
					<div className="flex flex-col items-center justify-center h-96 text-center gap-3">
						<Loader className="w-10 h-10 animate-spin text-steam-400" />
						<p className="text-steam-300">Loading games...</p>
					</div>
				) : games.length === 0 ? (
					igdbConnectionStatus !== 'connected' && !skipIGDBSetup ? (
						<div className="min-h-[60vh] flex items-center">
							<div className="max-w-3xl mx-auto w-full rounded-xl bg-linear-to-b from-steam-800/75 to-steam-900/75 px-5 py-6 shadow-[0_16px_34px_rgba(0,0,0,0.24)]">
								<div className="text-center mb-5">
									<p className="text-steam-200 text-xl font-semibold inline-flex items-center gap-2">
										<ShieldCheck className="w-5 h-5 text-sky-300" />
										Choose your metadata source
									</p>
									<p className="text-steam-400 text-sm mt-2">Pick the source you want GameLibrary to use before you scan your first games.</p>
								</div>

								<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
									<button
										type="button"
										onClick={() => setIgdbConnectionModeState('api')}
										className={`rounded-xl px-4 py-4 text-left transition-colors shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] ${igdbConnectionMode === 'api' ? 'bg-steam-600 ring-2 ring-sky-400/40' : 'bg-steam-700/55 hover:bg-steam-700'}`}
									>
										<div className="flex items-start gap-3">
											<div className="mt-1 rounded-md bg-steam-900/45 p-2 text-sky-300">
												<Link2 className="w-4 h-4" />
											</div>
											<div>
												<p className="text-sm font-semibold text-white">GameLibrary API</p>
												<p className="text-xs text-steam-300 mt-1">No Twitch credentials required</p>
											</div>
										</div>
									</button>

									<button
										type="button"
										onClick={() => setIgdbConnectionModeState('twitch')}
										className={`rounded-xl px-4 py-4 text-left transition-colors shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] ${igdbConnectionMode === 'twitch' ? 'bg-steam-600 ring-2 ring-sky-400/40' : 'bg-steam-700/55 hover:bg-steam-700'}`}
									>
										<div className="flex items-start gap-3">
											<div className="mt-1 rounded-md bg-steam-900/45 p-2 text-[#9146FF]">
												<FaTwitch className="w-4 h-4" />
											</div>
											<div>
												<p className="text-sm font-semibold text-white">Twitch credentials</p>
												<p className="text-xs text-steam-300 mt-1">Use your own IGDB client credentials</p>
											</div>
										</div>
									</button>
								</div>

								{igdbConnectionMode === 'api' ? (
									<div className="mt-4 space-y-3">
										<div className="rounded-lg bg-steam-900/55 px-4 py-4 space-y-3">
											<div>
												<p className="text-sm text-steam-200 font-medium">API setup</p>
												<p className="text-xs text-steam-400 mt-1">The default GameLibrary API works out of the box, but you can point this app at your own deployment.</p>
											</div>
											<div className="relative">
												<input
													type="text"
													value={gameLibraryApiBaseUrl}
													onChange={(event) => setGameLibraryApiBaseUrl(event.target.value)}
													disabled={isSavingMetadataSource}
													placeholder="https://gamelibrary.ezzud.fr/api"
													className="w-full rounded-lg bg-steam-700 border border-steam-600 px-3 py-2 pr-48 text-sm text-sky-200 placeholder:text-steam-400 focus:outline-none focus:ring-2 focus:ring-steam-400/50 disabled:opacity-60"
												/>
												<div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
													{normalizeApiBaseUrl(gameLibraryApiBaseUrl) !== normalizeApiBaseUrl(DEFAULT_METADATA_API_URL) && (
														<button
															type="button"
															onClick={() => void handleResetApiSourceUrl()}
															disabled={isSavingMetadataSource}
															className="inline-flex items-center rounded-md bg-red-950/35 px-2 py-1 text-xs text-red-100 transition-colors hover:bg-red-900/45 disabled:opacity-50"
															aria-label="Reset GameLibrary API URL"
															title="Reset to default GameLibrary API"
														>
															Reset
														</button>
													)}
													<button
														type="button"
														onClick={() => void handleUseApiSource()}
														disabled={isSavingMetadataSource || !gameLibraryApiBaseUrl.trim()}
														className="inline-flex items-center gap-1 rounded-md bg-[#2a4f75] px-2 py-1 text-xs text-white transition-colors hover:bg-[#36648f] disabled:opacity-50"
														aria-label="Use GameLibrary API"
														title="Use GameLibrary API"
													>
														<Link2 className="w-4 h-4" />
														{isSavingMetadataSource ? 'Testing...' : 'Test'}
													</button>
												</div>
											</div>
											<p className="text-xs text-steam-400">Selecting the API source will save it to your settings immediately.</p>
										</div>
										{metadataSourceStatusMessage && (
											<p className={`text-xs ${metadataSourceStatusTone === 'error' ? 'text-red-300' : 'text-emerald-300'}`}>{metadataSourceStatusMessage}</p>
										)}
										{metadataSourceError && (
											<p className="text-xs text-red-300">{metadataSourceError}</p>
										)}
										<div className="flex items-center gap-2">
											<button
												type="button"
												onClick={() => void handleUseApiSource()}
												disabled={isSavingMetadataSource}
												className="flex-1 px-4 py-2 rounded-lg bg-steam-600 hover:bg-steam-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-2"
											>
												{isSavingMetadataSource ? <Loader className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
												{isSavingMetadataSource ? 'Testing...' : 'Next'}
											</button>
											<button
												type="button"
												onClick={() => {
													setSkipIGDBConfirmationSource('api')
													setShowSkipIGDBConfirmation(true)
												}}
												disabled={isSavingMetadataSource}
												className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-white hover:text-white font-medium hover:shadow-lg"
												title="Skip API setup"
											>
												Skip
											</button>
										</div>
									</div>
								) : (
									<div className="mt-4 space-y-3">
										<div className="rounded-lg bg-steam-900/55 px-4 py-4 space-y-2">
											<p className="text-sm text-steam-200 font-medium">Twitch developer setup</p>
											<ol className="text-xs text-steam-400 space-y-1 list-decimal pl-4">
												<li>Open the Twitch developer console and create an application.</li>
												<li>Use <span className="text-sky-300">https://localhost</span> as the redirect URL.</li>
												<li>Paste your Client ID and Client Secret below.</li>
											</ol>
										</div>

										<input
											type="text"
											value={twitchClientId}
											onChange={(event) => setTwitchClientId(event.target.value)}
											disabled={isConnectingIGDB}
											placeholder="Twitch Client ID"
											className="w-full rounded-lg bg-steam-700 border border-steam-600 px-3 py-2 text-sm text-white placeholder:text-steam-400 focus:outline-none focus:ring-2 focus:ring-steam-400/50 disabled:opacity-60"
										/>
										<input
											type="password"
											value={twitchClientSecret}
											onChange={(event) => setTwitchClientSecret(event.target.value)}
											disabled={isConnectingIGDB}
											placeholder="Twitch Client Secret"
											className="w-full rounded-lg bg-steam-700 border border-steam-600 px-3 py-2 text-sm text-white placeholder:text-steam-400 focus:outline-none focus:ring-2 focus:ring-steam-400/50 disabled:opacity-60"
										/>
										<p className="text-xs text-steam-400">
											Need help getting Twitch credentials? Read the{' '}
											<a
												href="https://api-docs.igdb.com/#getting-started"
												target="_blank"
												rel="noreferrer"
												className="text-sky-300 hover:text-sky-200 underline"
											>
												IGDB getting started guide
											</a>
											, for the credential setup steps.
										</p>

										{igdbConnectionStatus === 'invalid' && !igdbConnectError && (
											<p className="text-xs text-red-300">Saved credentials are invalid. Please update and reconnect.</p>
										)}

										{igdbConnectError && (
											<p className="text-xs text-red-300">{igdbConnectError}</p>
										)}

										<div className="flex items-center gap-2">
											<button
												type="button"
												onClick={() => void handleConnectIGDB()}
												disabled={isConnectingIGDB || !twitchClientId.trim() || !twitchClientSecret.trim() || igdbConnectionStatus === 'checking'}
												className="flex-1 px-4 py-2 rounded-lg bg-steam-600 hover:bg-steam-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-2"
											>
												{isConnectingIGDB ? <Loader className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
												{isConnectingIGDB ? 'Connecting...' : 'Connect'}
											</button>
											<button
												type="button"
												onClick={() => {
													setSkipIGDBConfirmationSource('twitch')
													setShowSkipIGDBConfirmation(true)
												}}
												disabled={isConnectingIGDB}
												className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-white hover:text-white font-medium hover:shadow-lg"
												title="Skip Twitch setup"
											>
												Skip
											</button>
										</div>
									</div>
								)}
							</div>
						</div>
					) : (
						<div className="min-h-[60vh] flex items-center">
							<div className="max-w-2xl mx-auto w-full rounded-xl bg-linear-to-b from-steam-800/75 to-steam-900/75 px-4 py-6 shadow-[0_16px_34px_rgba(0,0,0,0.24)]">
								<div className="text-center mb-4">
									<p className="text-steam-200 text-xl font-semibold">Start adding games</p>
									<p className="text-steam-400 text-sm mt-2">Select one or more sources and run a scan.</p>
								</div>

								<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
									{SCAN_PLATFORMS.map((platform) => {
										const checked = selectedPlatforms.has(platform)
										return (
											<label
												key={platform}
												className={`flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-colors ${checked
													? 'border border-[#2f5f86] bg-steam-700/45 ring-1 ring-[#244b69]'
													: 'border border-steam-700/70 bg-steam-900/40 hover:bg-steam-900/70'
													}`}
											>
												<input
													type="checkbox"
													checked={checked}
													onChange={() => togglePlatform(platform)}
													className="sr-only"
												/>
												<span className="inline-flex items-center gap-2 text-sm flex-1">
													{getPlatformIcon(platform)}
													<span>{platform}</span>
												</span>
												{checked && <CheckCircle2 className="w-4 h-4 text-steam-300" />}
											</label>
										)
									})}
								</div>

								<div className="mt-3 rounded-lg bg-steam-900/50 px-3 py-3">
									<p className="text-xs text-steam-400 mb-2">Custom folder source</p>
									<button
										type="button"
										onClick={() => void handleAddCustomFolderInEmptyState()}
										disabled={isAddingCustomFolder || isLoading}
										className="w-full px-3 py-2 rounded-lg bg-steam-600 hover:bg-steam-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 hover:scale-[1.02] inline-flex items-center justify-center gap-2"
									>
										{isAddingCustomFolder ? <Loader className="w-4 h-4 animate-spin" /> : <FolderOpen className="w-4 h-4" />}
										{isAddingCustomFolder ? 'Adding folder...' : 'Add Custom Folder'}
									</button>

									{customFolders.length > 0 && (
										<div className="mt-3 space-y-2">
											<p className="text-xs text-steam-400">Configured custom folders</p>
											<ul className="space-y-1.5 max-h-36 overflow-auto pr-1">
												{customFolders.map((folder) => (
													<li
														key={folder}
														className="group rounded-md bg-steam-900/55 px-2.5 py-2 flex items-center gap-2"
														title={folder}
													>
														<FolderOpen className="w-3.5 h-3.5 text-steam-300 shrink-0" />
														<span className="text-xs text-steam-200 truncate flex-1">{folder}</span>
														<button
															type="button"
															onClick={() => void handleRemoveCustomFolderInEmptyState(folder)}
															disabled={isLoading || removingCustomFolderPath === folder}
															className="w-6 h-6 rounded-md bg-red-700/70 hover:bg-red-600 text-white inline-flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
															aria-label={`Remove custom folder ${folder}`}
															title="Remove custom folder"
														>
															{removingCustomFolderPath === folder ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
														</button>
													</li>
												))}
											</ul>
										</div>
									)}
								</div>

								<div className="mt-4 flex justify-center">
									<button
										type="button"
										onClick={handleBeginScan}
										disabled={isLoading || selectedPlatforms.size < 1}
										className="px-4 py-2 rounded-lg bg-steam-600 hover:bg-steam-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 hover:scale-[1.02] inline-flex items-center gap-2"
									>
										<Play className="w-4 h-4" />
										{isLoading ? 'Scanning...' : 'Begin Scan'}
									</button>
								</div>
							</div>
						</div>
					)
				) : displayedGames.length === 0 ? dateLoading ? (
					<div className="flex flex-col items-center justify-center h-96 text-center">
						<p className="text-steam-300 text-lg">Loading games...</p>
					</div>
				) : (
					<div className="flex flex-col items-center justify-center h-96 text-center">
						<p className="text-steam-300 text-lg">No games match your filters</p>
						<p className="text-steam-500 text-sm mt-2">Try clearing search text or selecting different platform/tag options.</p>
					</div>
				) : (
					<div className="space-y-6">
						{favoriteGames.length > 0 && (
							<section className="space-y-3">
								<div className="flex items-center gap-2 text-lg font-semibold text-white">
									<Star className="w-5 h-5 text-yellow-400 fill-yellow-400" />
									<span>Favorites</span>
								</div>
								{renderGameCards(favoriteGames)}
							</section>
						)}

						<section className="space-y-3">
							<div className="flex items-center gap-2 text-lg font-semibold text-white">
								<span>All Games</span>
							</div>
							{regularGames.length > 0 ? renderGameCards(regularGames) : (
								<div className="text-sm text-steam-400">No additional games to show.</div>
							)}
						</section>
					</div>
				)}
			</div>
		</div>
	)
}

export default GameLibrary
