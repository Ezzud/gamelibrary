import { useState, useEffect, useRef } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { listen } from '@tauri-apps/api/event'
import AppConfig from './components/AppConfig'
import GameLibrary from './components/GameLibrary'
import Sidebar from './components/Sidebar'
import GameDetailView from './components/GameDetailView'
import LaunchFilePickerModal from './components/LaunchFilePickerModal'
import ToastSystem, { useToastSystem } from './components/ToastSystem'
import {
    fetchAllCustomFolderGames,
    refetchAllSpecialTags,
    registerGames,
    removeDuplicateGames,
    scanAndAddCustomFolderGames,
    scanAndAddEAGames,
    scanAndAddEpicGames,
    scanAndAddBattleNetGames,
    scanAndAddGOGGames,
    scanAndAddSteamGames,
    scanAndAddXboxGames,
} from './services/GameScanner'
import { Logger } from './utils/Logger'
import {
    addPlayHistoryEntry,
    addFavorite,
    ensureRunOnStartupAppliedOnLaunch,
    getAppConfig,
    getFavoriteIds,
    getPlayHistory,
    loadGameCache,
    loadGameConfig,
    loadGameList,
    saveGameConfig,
    saveGameInfoCache,
    removeFavorite,
    setTwitchCredentials,
    updateLatestPlayHistoryEntry,
} from './services/ConfigManager'
import { initIGDB, searchGame, getGameDetails } from './services/GameDataManager'
import { launchGame } from './services/GameLauncher'
import { formatPlaytime, getPlaytime, trackPlaytimeForProcess } from './services/PlaytimeManager'
import { getVersion } from '@tauri-apps/api/app'
import type { ConfigCategory, Game, IGDBConnectionStatus, LastPlayedCard, SortField } from './types/appTypes'

const MIN_LAUNCH_LOADING_MS = 5000
const GITHUB_REPO_LATEST_RELEASE_API_URL = 'https://api.github.com/repos/Ezzud/gamelibrary/releases/latest'

const waitForMinimumLaunchLoading = async (startedAt: number) => {
    const elapsed = Date.now() - startedAt
    const remaining = MIN_LAUNCH_LOADING_MS - elapsed
    if (remaining > 0) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, remaining))
    }
}

const reduceAppWindow = async () => {
    try {
        const currentWindow = getCurrentWindow()
        await currentWindow.minimize()
        await currentWindow.hide()
    } catch (error) {
        Logger.warn('Failed to reduce the main window while a game is running:', error)
    }
}

const restoreAppWindow = async () => {
    try {
        const currentWindow = getCurrentWindow()
        if(!(await currentWindow.isVisible())) {
            await currentWindow.show()
        }
        if(await currentWindow.isMinimized()) {
            await currentWindow.unminimize()
        }
        if(!(await currentWindow.isFocused())) {
            await currentWindow.setFocus()
        }
    } catch (error) {
        Logger.warn('Failed to restore the main window after game exit:', error)
    }
}

/**
 * Main App component - root of the React application
 * Params: none
 * Returns: JSX.Element - main app layout
 */
function App() {
    const didRunStartupScanRef = useRef(false)
    const appWindowReducedRef = useRef(false)
    const [games, setGames] = useState<Game[]>([])
    const [selectedGame, setSelectedGame] = useState<Game | null>(null)
    const [isSettingsOpen, setIsSettingsOpen] = useState(false)
    const [isScanning, setIsScanning] = useState(false)
    const [isLoadingGames, setIsLoadingGames] = useState(false)
    const [isRefetchingTags, setIsRefetchingTags] = useState(false)
    const [scanProgress, setScanProgress] = useState(0)
    const [scanStatusMessage, setScanStatusMessage] = useState('Idle')
    const { toasts: launchToasts, showToast: showLaunchToast, dismissToast } = useToastSystem()
    const [lastPlayedCards, setLastPlayedCards] = useState<LastPlayedCard[]>([])
    const [favoriteGameIds, setFavoriteGameIds] = useState<Set<string>>(new Set())
    const [launchingGameId, setLaunchingGameId] = useState<string | null>(null)
    const [runningGameIds, setRunningGameIds] = useState<Set<string>>(new Set())
    const [pickerGame, setPickerGame] = useState<Game | null>(null)
    const [pickerLaunchFiles, setPickerLaunchFiles] = useState<string[]>([])
    const [pickerSelectedLaunchFile, setPickerSelectedLaunchFile] = useState('')
    const [pickerPendingConfig, setPickerPendingConfig] = useState<any>(null)
    const [igdbConnectionStatus, setIgdbConnectionStatus] = useState<IGDBConnectionStatus>('checking')
    const [settingsInitialCategory, setSettingsInitialCategory] = useState<ConfigCategory>('General')
    const [reduceWhilePlaying, setReduceWhilePlaying] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')
    const [platformFilter, setPlatformFilter] = useState('All')
    const [tagFilter, setTagFilter] = useState('All')
    const [sortField, setSortField] = useState<SortField>('name')
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

    const compareSemver = (currentVersion: string, latestVersion: string) => {
        const normalize = (version: string) =>
            version
                .replace(/^v/i, '')
                .split('.')
                .map((part) => {
                    const numericPart = part.match(/^\d+/)?.[0]
                    return numericPart ? Number.parseInt(numericPart, 10) : 0
                })

        const current = normalize(currentVersion)
        const latest = normalize(latestVersion)
        const length = Math.max(current.length, latest.length)

        for (let index = 0; index < length; index++) {
            const currentPart = current[index] ?? 0
            const latestPart = latest[index] ?? 0

            if (latestPart > currentPart) {
                return 1
            }

            if (latestPart < currentPart) {
                return -1
            }
        }

        return 0
    }

    const detectPlatformsFromCache = async (gamesToCheck: Array<{ id: string; platform?: string }>) => {
        const cacheEntries = await Promise.all(
            gamesToCheck.map(async (game) => {
                const cache = await loadGameCache(game.id)
                const platform = (cache?.platform || game.platform || '').trim().toLowerCase()
                return platform
            })
        )

        return {
            hasSteamGames: cacheEntries.some((platform) => platform === 'steam'),
            hasGOGGames: cacheEntries.some((platform) => platform === 'gog'),
            hasXboxGames: cacheEntries.some((platform) => platform === 'xbox'),
            hasEAGames: cacheEntries.some((platform) => platform === 'ea'),
            hasEpicGames: cacheEntries.some((platform) => platform === 'epic games'),
            hasBattleNetGames: cacheEntries.some((platform) => platform === 'battle.net'),
        }
    }

    const checkForStartupUpdateNotice = async () => {
        try {
            const localVersion = await getVersion()
            const response = await fetch(`${GITHUB_REPO_LATEST_RELEASE_API_URL}?t=${Date.now()}`)
            if (!response.ok) {
                throw new Error(`GitHub latest release fetch failed with status ${response.status}`)
            }

            const data = (await response.json()) as { tag_name?: string }
            const latestVersion = (data.tag_name || '').trim().replace(/^v/i, '')
            if (!latestVersion) {
                return
            }

            if (compareSemver(localVersion, latestVersion) > 0) {
                showLaunchToast(`An update is available (${latestVersion})`, {
                    durationMs: 10000,
                    actionLabel: 'Update now',
                    style: 'warning',
                    onClick: () => {
                        setSettingsInitialCategory('Update')
                        setIsSettingsOpen(true)
                        setSelectedGame(null)
                    },
                })
            }
        } catch (error) {
            Logger.warn('Startup update check failed:', error)
        }
    }

    const refreshLastPlayedCards = async (gamesForLookup?: Game[]) => {
        const lookupGames = gamesForLookup ?? games
        const byId = new Map(lookupGames.map((game) => [game.id, game]))
        const allPlays = await getPlayHistory()
        const uniqueLatestByGame = [...allPlays]
            .sort((a: any, b: any) => new Date(b.playedAt).getTime() - new Date(a.playedAt).getTime())
            .reduce((acc: any[], entry: any) => {
                if (acc.some((item) => item.gameId === entry.gameId)) {
                    return acc
                }
                acc.push(entry)
                return acc
            }, [])
            .slice(0, 7)

        const cardsPromises = uniqueLatestByGame
            .map(async (entry: any) => {
                const game = byId.get(entry.gameId)
                if (!game) {
                    return null
                }

                const playtimeMs = await getPlaytime(entry.gameId)
                const playtime = formatPlaytime(playtimeMs)

                return {
                    gameId: entry.gameId,
                    name: game.name,
                    coverUrl: game.coverUrl,
                    playedAt: entry.playedAt,
                    playtime: playtime,
                } as LastPlayedCard | null
            })

        const cardsResolved = await Promise.all(cardsPromises)
        const cards = cardsResolved.filter((entry): entry is LastPlayedCard => entry !== null)

        setLastPlayedCards(cards)
    }

    const loadFavoriteGameIds = async () => {
        const favoriteIds = await getFavoriteIds()
        setFavoriteGameIds(new Set(favoriteIds.filter((gameId): gameId is string => typeof gameId === 'string' && gameId.trim().length > 0)))
    }

    const loadAppSettings = async () => {
        try {
            const config = await getAppConfig()
            setReduceWhilePlaying(config.reduceWhilePlaying !== false)
        } catch (error) {
            Logger.warn('Failed to load app settings:', error)
            setReduceWhilePlaying(true)
        }
    }

    const handleLaunchSuccess = async () => {
        await refreshLastPlayedCards()
    }

    const handleGameRunningChange = (gameId: string, isRunning: boolean) => {
        let nextRunningCount = 0
        setRunningGameIds((prev) => {
            const next = new Set(prev)
            if (isRunning) {
                next.add(gameId)
            } else {
                next.delete(gameId)
                updateLatestPlayHistoryEntry(gameId)
                .catch((error) => {
                    Logger.error(`Failed to update play history for game ID ${gameId}:`, error)
                })
                .then(() => {
                    refreshLastPlayedCards().catch((error) => {
                        Logger.error('Failed to refresh last played cards after play history update:', error)
                    })
                })
            }
            nextRunningCount = next.size
            return next
        })

        if (!reduceWhilePlaying) {
            return
        }

        if (isRunning) {
            if (!appWindowReducedRef.current) {
                appWindowReducedRef.current = true
                setTimeout(() => {
                    void reduceAppWindow()
                }, 3000)
            }
            return
        }

        if (nextRunningCount === 0 && appWindowReducedRef.current) {
            appWindowReducedRef.current = false
            void restoreAppWindow()
        }
    }

    const handlePlayLastPlayed = async (gameId: string) => {
        if (launchingGameId || runningGameIds.has(gameId)) {
            return
        }

        const game = games.find((item) => item.id === gameId)
        if (!game) {
            showLaunchToast('Unable to find this game in your library.', { style: 'warning' })
            return
        }

        try {
            const config = await loadGameConfig(game.id)
            const allLaunchFiles = (config?.allLaunchFiles || []).filter((file: string | undefined) => !!file)

            if (!config?.lockedLaunchFile && allLaunchFiles.length > 1) {
                const initialSelection =
                    config?.defaultLaunchFile && allLaunchFiles.includes(config.defaultLaunchFile)
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
            const pid = await launchGame(game.path, game.id)
            try {
                await addPlayHistoryEntry(game.id)
                await refreshLastPlayedCards()
            } catch (historyError) {
                Logger.warn(`Game launched but failed to update play history for ${game.name}:`, historyError)
            }
            void trackPlaytimeForProcess(game.id, pid, (isRunning) => handleGameRunningChange(game.id, isRunning))
            await waitForMinimumLaunchLoading(launchStartedAt)
        } catch (error) {
            Logger.error(`Failed to launch game ${game.name}:`, error)
            const message = error instanceof Error ? error.message : String(error)
            showLaunchToast(`Failed to launch ${game.name}: ${message}`, { style: 'error' })
        } finally {
            setLaunchingGameId(null)
        }
    }

    const handleConfirmSidebarLaunchFile = async () => {
        if (!pickerGame || !pickerSelectedLaunchFile) {
            return
        }

        if (runningGameIds.has(pickerGame.id)) {
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

            const pid = await launchGame(pickerGame.path, pickerGame.id)
            try {
                await addPlayHistoryEntry(pickerGame.id)
                await refreshLastPlayedCards()
            } catch (historyError) {
                Logger.warn(`Game launched but failed to update play history for ${pickerGame.name}:`, historyError)
            }
            void trackPlaytimeForProcess(pickerGame.id, pid, (isRunning) => handleGameRunningChange(pickerGame.id, isRunning))
            await waitForMinimumLaunchLoading(launchStartedAt)
        } catch (error) {
            Logger.error(`Failed to persist launch file selection for ${pickerGame.name}:`, error)
            const message = error instanceof Error ? error.message : String(error)
            showLaunchToast(`Failed to launch ${pickerGame.name}: ${message}`, { style: 'error' })
        } finally {
            setLaunchingGameId(null)
            setPickerGame(null)
            setPickerPendingConfig(null)
            setPickerLaunchFiles([])
            setPickerSelectedLaunchFile('')
        }
    }

    const validateIGDBCredentialsFromConfig = async () => {
        const config = await getAppConfig()
        const clientId = (config.twitchClientId || '').trim()
        const clientSecret = (config.twitchClientSecret || '').trim()

        if (!clientId || !clientSecret) {
            setIgdbConnectionStatus('missing')
            return false
        }

        const valid = await initIGDB({ clientId, clientSecret })
        setIgdbConnectionStatus(valid ? 'connected' : 'invalid')
        return valid
    }

    const handleConnectIGDB = async (clientId: string, clientSecret: string) => {
        const trimmedClientId = clientId.trim()
        const trimmedClientSecret = clientSecret.trim()

        if (!trimmedClientId || !trimmedClientSecret) {
            setIgdbConnectionStatus('missing')
            return { success: false, message: 'Client ID and Client Secret are required.' }
        }

        const valid = await initIGDB({ clientId: trimmedClientId, clientSecret: trimmedClientSecret })
        if (!valid) {
            setIgdbConnectionStatus('invalid')
            return { success: false, message: 'Invalid Twitch credentials. Please verify both values.' }
        }

        await setTwitchCredentials(trimmedClientId, trimmedClientSecret)
        setIgdbConnectionStatus('connected')
        await loadGames()
        return { success: true }
    }

    const handleToggleFavorite = async (game: Game) => {
        if (favoriteGameIds.has(game.id)) {
            await removeFavorite(game.id)
            setFavoriteGameIds((prev) => {
                const next = new Set(prev)
                next.delete(game.id)
                return next
            })
            return
        }

        await addFavorite(game.id)
        setFavoriteGameIds((prev) => {
            const next = new Set(prev)
            next.add(game.id)
            return next
        })
    }

    useEffect(() => {
        void checkForStartupUpdateNotice()
    }, [])

    useEffect(() => {
        let unlisten: (() => void) | undefined

        const registerTrayRestoreListener = async () => {
            unlisten = await listen('restore-app-window', () => {
                void restoreAppWindow()
            })
        }

        void registerTrayRestoreListener()

        return () => {
            unlisten?.()
        }
    }, [])

    useEffect(() => {
        if (didRunStartupScanRef.current) {
            return
        }
        didRunStartupScanRef.current = true

        const bootstrap = async () => {
            Logger.info('App mounted, loading games...')
            setIsLoadingGames(true)
            try {
                await validateIGDBCredentialsFromConfig()
                await loadFavoriteGameIds()
                await loadAppSettings()
                await loadGames()
                Logger.info('Initial game loading complete.')
            } finally {
                setIsLoadingGames(false)
            }
            void ensureRunOnStartupAppliedOnLaunch().catch((err) => {
                Logger.error('Failed to sync run-on-startup on launch:', err)
            })
            void (async () => {
                
                setIsScanning(true)
                setScanProgress(0)
                setScanStatusMessage('Scanning all custom folders...')

                const beforeList = await loadGameList()
                const beforeIds = new Set((beforeList?.games || []).map((game: { id: string }) => game.id))

                try {
                    await scanAndAddCustomFolderGames((update) => {
                        const mappedPercent = Math.round(update.percent * 0.6)
                        setScanProgress(mappedPercent)
                        setScanStatusMessage(`${update.message}`)
                    })

                    const cachedGames = await loadGameList()
                    const scanCandidates = (cachedGames?.games || []) as Array<{ id: string; platform?: string }>
                    const { hasSteamGames, hasGOGGames, hasXboxGames, hasEAGames, hasEpicGames, hasBattleNetGames } =
                        await detectPlatformsFromCache(scanCandidates)

                    const optionalScans: Array<'Steam' | 'GOG' | 'Xbox' | 'EA' | 'Epic Games' | 'Battle.net'> = []
                    if (hasSteamGames) {
                        optionalScans.push('Steam')
                    }
                    if (hasGOGGames) {
                        optionalScans.push('GOG')
                    }
                    if (hasXboxGames) {
                        optionalScans.push('Xbox')
                    }
                    if (hasEAGames) {
                        optionalScans.push('EA')
                    }
                    if (hasEpicGames) {
                        optionalScans.push('Epic Games')
                    }
                    if (hasBattleNetGames) {
                        optionalScans.push('Battle.net')
                    }

                    if (optionalScans.length < 1) {
                        setScanProgress(100)
                        setScanStatusMessage('Load scan complete')
                    }

                    for (let index = 0; index < optionalScans.length; index++) {
                        const platform = optionalScans[index]
                        const rangeStart = Math.round(60 + (index / optionalScans.length) * 40)
                        const rangeEnd = Math.round(60 + ((index + 1) / optionalScans.length) * 40)

                        setScanStatusMessage(`Scanning ${platform} games...`)
                        if (platform === 'Steam') {
                            await scanAndAddSteamGames((update) => {
                                const mappedPercent = Math.round(rangeStart + ((rangeEnd - rangeStart) * update.percent) / 100)
                                setScanProgress(mappedPercent)
                                setScanStatusMessage(`${update.message}`)
                            })
                        } else if (platform === 'GOG') {
                            await scanAndAddGOGGames((update) => {
                                const mappedPercent = Math.round(rangeStart + ((rangeEnd - rangeStart) * update.percent) / 100)
                                setScanProgress(mappedPercent)
                                setScanStatusMessage(`${update.message}`)
                            })
                        } else if (platform === 'Xbox') {
                            await scanAndAddXboxGames((update) => {
                                const mappedPercent = Math.round(rangeStart + ((rangeEnd - rangeStart) * update.percent) / 100)
                                setScanProgress(mappedPercent)
                                setScanStatusMessage(`${update.message}`)
                            })
                        } else if (platform === 'EA') {
                            await scanAndAddEAGames((update) => {
                                const mappedPercent = Math.round(rangeStart + ((rangeEnd - rangeStart) * update.percent) / 100)
                                setScanProgress(mappedPercent)
                                setScanStatusMessage(`${update.message}`)
                            })
                        } else if (platform === 'Epic Games') {
                            await scanAndAddEpicGames((update) => {
                                const mappedPercent = Math.round(rangeStart + ((rangeEnd - rangeStart) * update.percent) / 100)
                                setScanProgress(mappedPercent)
                                setScanStatusMessage(`${update.message}`)
                            })
                        } else if (platform === 'Battle.net') {
                            await scanAndAddBattleNetGames((update) => {
                                const mappedPercent = Math.round(rangeStart + ((rangeEnd - rangeStart) * update.percent) / 100)
                                setScanProgress(mappedPercent)
                                setScanStatusMessage(`${update.message}`)
                            })
                        }
                    }
                } finally {
                    const afterList = await loadGameList()
                    const afterIds = new Set((afterList?.games || []).map((game: { id: string }) => game.id))
                    const hasNewGames = [...afterIds].some((id) => !beforeIds.has(id))
                    if (hasNewGames) {
                        await loadGames()
                    }
                    setIsScanning(false)
                }
            })()
        }

        void bootstrap()
    }, [])

    /**
     * Loads games from the database with cache enrichment
     * First loads from cache, then fetches missing data from IGDB
     * Params: none
     * Returns: Promise<void>
     */
    const loadGames = async () => {
        Logger.info('Loading games from database...')
        setIsLoadingGames(true)
        try {
            const cachedGames = await loadGameList()
            if (cachedGames) {
                const allGames = cachedGames.games || []

                const getFolderName = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || ''
                const resolveSearchName = async (gameId: string, fallbackName: string, gamePath: string) => {
                    const config = await loadGameConfig(gameId)
                    const configured = typeof config?.searchName === 'string' ? config.searchName.trim() : ''
                    if (configured) {
                        return configured
                    }

                    const folderName = getFolderName(gamePath)
                    const nextSearchName = folderName || fallbackName
                    await saveGameConfig(gameId, {
                        ...config,
                        searchName: nextSearchName,
                    })
                    return nextSearchName
                }


                for (const game of allGames) {
                    const cacheData = await loadGameCache(game.id)
                    if (cacheData) {
                        game.name = cacheData.title || game.name
                        game.platform = cacheData.platform || game.platform
                        if (!game.coverUrl && !cacheData.cover_url) {
                            if (cacheData.fetched) {
                                Logger.warn(
                                    `Game ${game.name} (ID: ${game.id}) was previously fetched but has no cover URL, skipping IGDB fetch.`
                                )
                            } else {
                                Logger.warn(
                                    `No cover URL in cache for game ${game.name} (ID: ${game.id}), fetching from IGDB...`
                                )
                                try {
                                    const config = await loadGameConfig(game.id)
                                    const forcedIGDBId = (config as any)?.forced_igdb_id
                                    let igdbData: any = null
                                    
                                    if (forcedIGDBId && typeof forcedIGDBId === 'number') {
                                        const gameDetails = await getGameDetails(forcedIGDBId)
                                        if (gameDetails) {
                                            igdbData = { success: true, data: { ...gameDetails, id: forcedIGDBId } }
                                        }
                                    } else {
                                        const searchName = await resolveSearchName(game.id, game.name, game.path)
                                        igdbData = await searchGame(searchName)
                                    }
                                    
                                    if (igdbData.success && igdbData.data) {
                                        game.coverUrl = igdbData.data.cover_url || undefined
                                        game.thumbnailUrl = igdbData.data.thumbnail_url || undefined
                                        game.name = igdbData.data.title || game.name
                                        await saveGameInfoCache(game.id, {
                                            title: game.name,
                                            cover_url: game.coverUrl || null,
                                            thumbnail_url: game.thumbnailUrl || null,
                                            igdb_id: igdbData.data.id || null,
                                            id: game.id,
                                            platform: game.platform || null,
                                            folder: game.path || '',
                                            fetched: true,
                                        })
                                    }
                                } catch (error) {
                                    Logger.error(`Error fetching IGDB data for game ${game.name}:`, error)
                                }
                            }
                        } else {
                            game.coverUrl = cacheData.cover_url || game.coverUrl
                            game.thumbnailUrl = cacheData.thumbnail_url || game.thumbnailUrl
                        }

                        const config = await loadGameConfig(game.id)
                        if(!config.dateAdded) {
                            config.dateAdded = Date.now()
                            await saveGameConfig(game.id, config)
                        }
                    } else {
                        try {
                            const config = await loadGameConfig(game.id)
                            const forcedIGDBId = (config as any)?.forced_igdb_id
                            let igdbData: any = null

                            if(!config.dateAdded) {
                                config.dateAdded = Date.now()
                                await saveGameConfig(game.id, config)
                            }
                            
                            if (forcedIGDBId && typeof forcedIGDBId === 'number') {
                                const gameDetails = await getGameDetails(forcedIGDBId)
                                if (gameDetails) {
                                    igdbData = { success: true, data: { ...gameDetails, id: forcedIGDBId } }
                                }
                            } else {
                                const searchName = await resolveSearchName(game.id, game.name, game.path)
                                igdbData = await searchGame(searchName)
                            }
                            
                            if (igdbData.success && igdbData.data) {
                                game.coverUrl = igdbData.data.cover_url || undefined
                                game.name = igdbData.data.title || game.name
                                game.thumbnailUrl = igdbData.data.thumbnail_url || undefined
                                await saveGameInfoCache(game.id, {
                                    title: game.name,
                                    cover_url: game.coverUrl || null,
                                    thumbnail_url: game.thumbnailUrl || null,
                                    igdb_id: igdbData.data.id || null,
                                    id: game.id,
                                    platform: game.platform || null,
                                    folder: game.path || '',
                                    fetched: true,
                                })
                            }
                        } catch (error) {
                            Logger.error(`Error fetching IGDB data for game ${game.name}:`, error)
                        }
                    }
                }

                setGames(allGames)
                if (selectedGame) {
                    const refreshedSelectedGame = allGames.find((item: Game) => item.id === selectedGame.id) || null
                    setSelectedGame(refreshedSelectedGame)
                }
                await refreshLastPlayedCards(allGames)
            } else {
                Logger.warn('No cached games found, starting with empty library.')
                setGames([])
                setLastPlayedCards([])
            }

            Logger.info(`Loaded ${cachedGames.games?.length || 0} games from cache.`)
        } finally {
            setIsLoadingGames(false)
        }
    }

    const handleRemoveDuplicates = async () => {
        Logger.info('Removing duplicate games from library...')
        await removeDuplicateGames()
        await loadGames()
        Logger.info('Duplicate removal complete.')
    }

    const handleRefetchSpecialTags = async () => {
        if (isRefetchingTags || isScanning) {
            return
        }

        setIsRefetchingTags(true)
        setIsScanning(true)
        setScanProgress(0)
        setScanStatusMessage('Refetching special tags...')

        try {
            await refetchAllSpecialTags((update) => {
                setScanProgress(update.percent)
                setScanStatusMessage(update.message)
            })

            await loadGames()
            setScanProgress(100)
            setScanStatusMessage('Special tags refetch complete.')
        } finally {
            setIsRefetchingTags(false)
            setIsScanning(false)
        }
    }

    const handleScanPlatforms = async (platforms: string[]) => {
        setIsScanning(true)
        setScanProgress(0)
        setScanStatusMessage(`Preparing scan for ${platforms.length} platform(s)...`)
        Logger.info(`Starting multi-platform scan: ${platforms.join(', ')}`)

        try {
            for (let index = 0; index < platforms.length; index++) {
                const platform = platforms[index]
                const rangeStart = Math.round((index / platforms.length) * 100)
                const rangeEnd = Math.round(((index + 1) / platforms.length) * 100)

                switch (platform) {
                    case 'Steam':
                        await scanAndAddSteamGames((update) => {
                            const mappedPercent = Math.round(rangeStart + ((rangeEnd - rangeStart) * update.percent) / 100)
                            setScanProgress(mappedPercent)
                            setScanStatusMessage(`[${index + 1}/${platforms.length}] ${update.message}`)
                        })
                        break
                    case 'Custom Folders':
                        await scanAndAddCustomFolderGames((update) => {
                            const mappedPercent = Math.round(rangeStart + ((rangeEnd - rangeStart) * update.percent) / 100)
                            setScanProgress(mappedPercent)
                            setScanStatusMessage(`[${index + 1}/${platforms.length}] ${update.message}`)
                        })
                        break
                    case 'GOG':
                        await scanAndAddGOGGames((update) => {
                            const mappedPercent = Math.round(rangeStart + ((rangeEnd - rangeStart) * update.percent) / 100)
                            setScanProgress(mappedPercent)
                            setScanStatusMessage(`[${index + 1}/${platforms.length}] ${update.message}`)
                        })
                        break
                    case 'Xbox':
                        await scanAndAddXboxGames((update) => {
                            const mappedPercent = Math.round(rangeStart + ((rangeEnd - rangeStart) * update.percent) / 100)
                            setScanProgress(mappedPercent)
                            setScanStatusMessage(`[${index + 1}/${platforms.length}] ${update.message}`)
                        })
                        break
                    case 'EA':
                        await scanAndAddEAGames((update) => {
                            const mappedPercent = Math.round(rangeStart + ((rangeEnd - rangeStart) * update.percent) / 100)
                            setScanProgress(mappedPercent)
                            setScanStatusMessage(`[${index + 1}/${platforms.length}] ${update.message}`)
                        })
                        break
                    case 'Epic Games':
                        await scanAndAddEpicGames((update) => {
                            const mappedPercent = Math.round(rangeStart + ((rangeEnd - rangeStart) * update.percent) / 100)
                            setScanProgress(mappedPercent)
                            setScanStatusMessage(`[${index + 1}/${platforms.length}] ${update.message}`)
                        })
                        break
                    case 'Battle.net':
                        await scanAndAddBattleNetGames((update) => {
                            const mappedPercent = Math.round(rangeStart + ((rangeEnd - rangeStart) * update.percent) / 100)
                            setScanProgress(mappedPercent)
                            setScanStatusMessage(`[${index + 1}/${platforms.length}] ${update.message}`)
                        })
                        break
                    default:
                        Logger.warn(`Scanning for platform ${platform} is not implemented yet.`)
                        setScanStatusMessage(`Skipping ${platform}: not implemented.`)
                        setScanProgress(rangeEnd)
                        break
                }
            }

            await loadGames()
            Logger.info('Multi-platform scan complete.')
            setScanProgress(100)
            setScanStatusMessage('Scan complete.')
        } finally {
            setIsScanning(false)
        }
    }

    const handleCustomFolderAdded = async (folderPath: string) => {
        setIsScanning(true)
        setScanProgress(0)
        setScanStatusMessage(`Scanning new custom folder: ${folderPath}`)

        try {
            setScanProgress(20)
            const games = await fetchAllCustomFolderGames(folderPath)
            setScanStatusMessage(`Found ${games.length} games. Registering...`)

            await registerGames(games, 'Custom', (update) => {
                const mappedPercent = Math.round(20 + (update.percent * 70) / 100)
                setScanProgress(mappedPercent)
                setScanStatusMessage(update.message)
            })

            await loadGames()
            setScanProgress(100)
            setScanStatusMessage('Custom folder scan complete.')
        } catch (error) {
            Logger.error(`Failed to scan newly added custom folder ${folderPath}:`, error)
            setScanStatusMessage('Custom folder scan failed.')
        } finally {
            setIsScanning(false)
        }
    }

    const handleGamesRemoved = (gameIds: string[]) => {
        if (gameIds.length < 1) {
            return
        }

        const removedIds = new Set(gameIds)
        if (selectedGame && removedIds.has(selectedGame.id)) {
            setSelectedGame(null)
        }

        setRunningGameIds((prev) => {
            const next = new Set(prev)
            for (const id of removedIds) {
                next.delete(id)
            }
            return next
        })

        setGames((prev) => {
            const next = prev.filter((game) => !removedIds.has(game.id))
            void refreshLastPlayedCards(next)
            return next
        })
    }

    const handleGamesAdded = (newGames: Game[]) => {
        if (!Array.isArray(newGames) || newGames.length < 1) {
            return
        }

        setGames((prev) => {
            const existingPaths = new Set(prev.map((g) => g.path.replace(/[\\/]+$/, '').toLowerCase()))
            const filtered = newGames.filter((g) => !existingPaths.has(g.path.replace(/[\\/]+$/, '').toLowerCase()))
            if (filtered.length < 1) {
                return prev
            }
            const next = [...prev, ...filtered]
            void refreshLastPlayedCards(next)
            return next
        })
    }

    const handleRefreshLibrary = async () => {
        if (isScanning || isLoadingGames) {
            return
        }

        setIsScanning(true)
        setScanProgress(0)
        setScanStatusMessage('Refreshing library: scanning custom folders...')

        try {
            await scanAndAddCustomFolderGames((update) => {
                const mappedPercent = Math.round(update.percent * 0.6)
                setScanProgress(mappedPercent)
                setScanStatusMessage(`${update.message}`)
            })

            const { hasSteamGames, hasGOGGames, hasXboxGames, hasEAGames, hasEpicGames, hasBattleNetGames } =
                await detectPlatformsFromCache(games)

            const optionalScans: Array<'Steam' | 'GOG' | 'Xbox' | 'EA' | 'Epic Games' | 'Battle.net'> = []
            if (hasSteamGames) {
                optionalScans.push('Steam')
            }
            if (hasGOGGames) {
                optionalScans.push('GOG')
            }
            if (hasXboxGames) {
                optionalScans.push('Xbox')
            }
            if (hasEAGames) {
                optionalScans.push('EA')
            }
            if (hasEpicGames) {
                optionalScans.push('Epic Games')
            }
            if (hasBattleNetGames) {
                optionalScans.push('Battle.net')
            }

            if (optionalScans.length < 1) {
                setScanProgress(100)
                setScanStatusMessage('Refresh scan complete')
            }

            for (let index = 0; index < optionalScans.length; index++) {
                const platform = optionalScans[index]
                const rangeStart = Math.round(60 + (index / optionalScans.length) * 40)
                const rangeEnd = Math.round(60 + ((index + 1) / optionalScans.length) * 40)

                setScanStatusMessage(`Refreshing library: scanning ${platform} games...`)
                if (platform === 'Steam') {
                    await scanAndAddSteamGames((update) => {
                        const mappedPercent = Math.round(rangeStart + ((rangeEnd - rangeStart) * update.percent) / 100)
                        setScanProgress(mappedPercent)
                        setScanStatusMessage(`${update.message}`)
                    })
                } else if (platform === 'GOG') {
                    await scanAndAddGOGGames((update) => {
                        const mappedPercent = Math.round(rangeStart + ((rangeEnd - rangeStart) * update.percent) / 100)
                        setScanProgress(mappedPercent)
                        setScanStatusMessage(`${update.message}`)
                    })
                } else if (platform === 'Xbox') {
                    await scanAndAddXboxGames((update) => {
                        const mappedPercent = Math.round(rangeStart + ((rangeEnd - rangeStart) * update.percent) / 100)
                        setScanProgress(mappedPercent)
                        setScanStatusMessage(`${update.message}`)
                    })
                } else if (platform === 'EA') {
                    await scanAndAddEAGames((update) => {
                        const mappedPercent = Math.round(rangeStart + ((rangeEnd - rangeStart) * update.percent) / 100)
                        setScanProgress(mappedPercent)
                        setScanStatusMessage(`${update.message}`)
                    })
                } else if (platform === 'Epic Games') {
                    await scanAndAddEpicGames((update) => {
                        const mappedPercent = Math.round(rangeStart + ((rangeEnd - rangeStart) * update.percent) / 100)
                        setScanProgress(mappedPercent)
                        setScanStatusMessage(`${update.message}`)
                    })
                } else if (platform === 'Battle.net') {
                    await scanAndAddBattleNetGames((update) => {
                        const mappedPercent = Math.round(rangeStart + ((rangeEnd - rangeStart) * update.percent) / 100)
                        setScanProgress(mappedPercent)
                        setScanStatusMessage(`${update.message}`)
                    })
                }
            }

            await loadGames()
        } finally {
            setIsScanning(false)
        }
    }

    const handleToggleSettings = () => {
        setIsSettingsOpen((prev) => !prev)
        setSelectedGame(null)
    }

    const handleOpenSettings = () => {
        setSettingsInitialCategory('General')
        setIsSettingsOpen(true)
        setSelectedGame(null)
    }

    const handleGoHome = () => {
        setIsSettingsOpen(false)
        setSelectedGame(null)
    }

    return (
        <div className="flex h-screen bg-steam-900 text-white overflow-hidden">
            <ToastSystem toasts={launchToasts} onDismiss={dismissToast} />

            <Sidebar
                onGoHome={handleGoHome}
                onToggleSettings={handleToggleSettings}
                isHomeActive={!isSettingsOpen && !selectedGame}
                isSettingsActive={isSettingsOpen}
                lastPlayedCards={lastPlayedCards}
                onPlayLastPlayed={handlePlayLastPlayed}
                launchingGameId={launchingGameId}
                runningGameIds={runningGameIds}
            />

            <LaunchFilePickerModal
                isOpen={!!pickerGame}
                gameName={pickerGame?.name || ''}
                launchFiles={pickerLaunchFiles}
                selectedLaunchFile={pickerSelectedLaunchFile}
                onSelect={setPickerSelectedLaunchFile}
                onConfirm={handleConfirmSidebarLaunchFile}
                onCancel={() => {
                    setPickerGame(null)
                    setPickerPendingConfig(null)
                    setPickerLaunchFiles([])
                    setPickerSelectedLaunchFile('')
                }}
            />

            <div className="flex-1 flex flex-col relative">
                {isSettingsOpen ? (
                    <AppConfig
                        isScanning={isScanning}
                        isRefetchingTags={isRefetchingTags}
                        scanProgress={scanProgress}
                        scanStatusMessage={scanStatusMessage}
                        initialCategory={settingsInitialCategory}
                        onConfigChanged={loadAppSettings}
                        onScanPlatforms={handleScanPlatforms}
                        onCustomFolderAdded={handleCustomFolderAdded}
                        onRefreshGames={loadGames}
                        onRefetchSpecialTags={handleRefetchSpecialTags}
                        onRemoveDuplicates={handleRemoveDuplicates}
                        onConnectIGDB={handleConnectIGDB}
                        onShowToast={showLaunchToast}
                    />
                ) : selectedGame ? (
                    <GameDetailView
                        game={selectedGame}
                        onBack={() => setSelectedGame(null)}
                        onGameUpdated={loadGames}
                        onLaunchError={showLaunchToast}
                        onShowToast={showLaunchToast}
                        onLaunchSuccess={handleLaunchSuccess}
                        isGameRunning={runningGameIds.has(selectedGame.id)}
                        onGameRunningChange={handleGameRunningChange}
                        isFavorite={favoriteGameIds.has(selectedGame.id)}
                        onToggleFavorite={() => handleToggleFavorite(selectedGame)}
                    />
                ) : (
                    <GameLibrary
                        games={games}
                        favoriteGameIds={favoriteGameIds}
                        onGameSelect={setSelectedGame}
                        onLaunchError={showLaunchToast}
                        onShowToast={showLaunchToast}
                        onLaunchSuccess={handleLaunchSuccess}
                        onGamesRemoved={handleGamesRemoved}
                        onGamesAdded={handleGamesAdded}
                        runningGameIds={runningGameIds}
                        onGameRunningChange={handleGameRunningChange}
                        igdbConnectionStatus={igdbConnectionStatus}
                        onConnectIGDB={handleConnectIGDB}
                        onOpenSettings={handleOpenSettings}
                        onRefresh={handleRefreshLibrary}
                        onScanPlatforms={handleScanPlatforms}
                        onToggleFavorite={handleToggleFavorite}
                        isLoading={isScanning}
                        isLoadingGames={isLoadingGames}
                        scanProgress={scanProgress}
                        scanStatusMessage={scanStatusMessage}
                        searchQuery={searchQuery}
                        onSearchQueryChange={setSearchQuery}
                        platformFilter={platformFilter}
                        onPlatformFilterChange={setPlatformFilter}
                        tagFilter={tagFilter}
                        onTagFilterChange={setTagFilter}
                        sortField={sortField}
                        onSortFieldChange={setSortField}
                        sortDirection={sortDirection}
                        onSortDirectionChange={setSortDirection}
                    />
                )}
            </div>
        </div>
    )
}

export default App
