import { useState, useEffect, useRef } from 'react'
import AppConfig from './components/AppConfig'
import GameLibrary from './components/GameLibrary'
import Sidebar from './components/Sidebar'
import GameDetailView from './components/GameDetailView'
import LaunchFilePickerModal from './components/LaunchFilePickerModal'
import { fetchAllCustomFolderGames, refetchAllSpecialTags, registerGames, removeDuplicateGames, scanAndAddCustomFolderGames, scanAndAddEAGames, scanAndAddGOGGames, scanAndAddSteamGames, scanAndAddXboxGames } from './services/GameScanner'
import { Logger } from './utils/Logger'
import { addPlayHistoryEntry, getAppConfig, getPlayHistory, loadGameCache, loadGameConfig, loadGameList, saveGameConfig, saveGameInfoCache, setTwitchCredentials } from './services/ConfigManager'
import { initIGDB, searchGame } from './services/GameDataManager'
import { launchGame } from './services/GameLauncher'
import { getVersion } from '@tauri-apps/api/app'

interface Game {
    id: string
    name: string
    path: string
    platform: string
    coverUrl?: string
    thumbnailUrl?: string
    size?: number
}

interface LaunchToast {
    id: string
    message: string
    visible: boolean
    started: boolean
    durationMs: number
    actionLabel?: string
    onClick?: () => void
}

interface LastPlayedCard {
    gameId: string
    name: string
    coverUrl?: string
    playedAt: string
}

type IGDBConnectionStatus = 'checking' | 'missing' | 'invalid' | 'connected'
type ConfigCategory = 'General' | 'Library' | 'Scanning' | 'Update'

const MIN_LAUNCH_LOADING_MS = 5000
const GITHUB_REPO_LATEST_RELEASE_API_URL = 'https://api.github.com/repos/Ezzud/gamelibrary/releases/latest'

const waitForMinimumLaunchLoading = async (startedAt: number) => {
    const elapsed = Date.now() - startedAt
    const remaining = MIN_LAUNCH_LOADING_MS - elapsed
    if (remaining > 0) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, remaining))
    }
}

/**
 * Main App component - root of the React application
 * Params: none
 * Returns: JSX.Element - main app layout
 */
function App() {
    const didRunStartupScanRef = useRef(false)
    const [games, setGames] = useState<Game[]>([])
    const [selectedGame, setSelectedGame] = useState<Game | null>(null)
    const [isSettingsOpen, setIsSettingsOpen] = useState(false)
    const [isScanning, setIsScanning] = useState(false)
    const [isLoadingGames, setIsLoadingGames] = useState(false)
    const [isRefetchingTags, setIsRefetchingTags] = useState(false)
    const [scanProgress, setScanProgress] = useState(0)
    const [scanStatusMessage, setScanStatusMessage] = useState('Idle')
    const [launchToasts, setLaunchToasts] = useState<LaunchToast[]>([])
    const [lastPlayedCards, setLastPlayedCards] = useState<LastPlayedCard[]>([])
    const [launchingGameId, setLaunchingGameId] = useState<string | null>(null)
    const [pickerGame, setPickerGame] = useState<Game | null>(null)
    const [pickerLaunchFiles, setPickerLaunchFiles] = useState<string[]>([])
    const [pickerSelectedLaunchFile, setPickerSelectedLaunchFile] = useState('')
    const [pickerPendingConfig, setPickerPendingConfig] = useState<any>(null)
    const [igdbConnectionStatus, setIgdbConnectionStatus] = useState<IGDBConnectionStatus>('checking')
    const [settingsInitialCategory, setSettingsInitialCategory] = useState<ConfigCategory>('General')

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
        }
    }

    const showLaunchToast = (
        message: string,
        options?: { durationMs?: number; actionLabel?: string; onClick?: () => void }
    ) => {
        const durationMs = options?.durationMs ?? 3000
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        setLaunchToasts((prev) => [{
            id,
            message,
            visible: false,
            started: false,
            durationMs,
            actionLabel: options?.actionLabel,
            onClick: options?.onClick,
        }, ...prev])

        window.requestAnimationFrame(() => {
            setLaunchToasts((prev) => prev.map((toast) =>
                toast.id === id ? { ...toast, visible: true, started: true } : toast
            ))
        })

        window.setTimeout(() => {
            setLaunchToasts((prev) => prev.map((toast) =>
                toast.id === id ? { ...toast, visible: false } : toast
            ))
        }, durationMs)

        window.setTimeout(() => {
            setLaunchToasts((prev) => prev.filter((toast) => toast.id !== id))
        }, durationMs + 300)
    }

    const checkForStartupUpdateNotice = async () => {
        try {
            const localVersion = await getVersion()
            const response = await fetch(`${GITHUB_REPO_LATEST_RELEASE_API_URL}?t=${Date.now()}`)
            if (!response.ok) {
                throw new Error(`GitHub latest release fetch failed with status ${response.status}`)
            }

            const data = await response.json() as { tag_name?: string }
            const latestVersion = (data.tag_name || '').trim().replace(/^v/i, '')
            if (!latestVersion) {
                return
            }

            if (compareSemver(localVersion, latestVersion) > 0) {
                showLaunchToast(`An update is available (${latestVersion})`, {
                    durationMs: 10000,
                    actionLabel: 'Update now',
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
            .slice(0, 10)

        const cards = uniqueLatestByGame
            .map((entry: any) => {
                const game = byId.get(entry.gameId)
                if (!game) {
                    return null
                }

                return {
                    gameId: entry.gameId,
                    name: game.name,
                    coverUrl: game.coverUrl,
                    playedAt: entry.playedAt,
                } as LastPlayedCard
            })
            .filter((entry): entry is LastPlayedCard => entry !== null)

        setLastPlayedCards(cards);
    }

    const handleLaunchSuccess = async () => {
        await refreshLastPlayedCards()
    }

    const handlePlayLastPlayed = async (gameId: string) => {
        if (launchingGameId) {
            return
        }

        const game = games.find((item) => item.id === gameId)
        if (!game) {
            showLaunchToast('Unable to find this game in your library.')
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
            await launchGame(game.path, game.id)
            try {
                await addPlayHistoryEntry(game.id)
                await refreshLastPlayedCards()
            } catch (historyError) {
                Logger.warn(`Game launched but failed to update play history for ${game.name}:`, historyError)
            }
            await waitForMinimumLaunchLoading(launchStartedAt)
        } catch (error) {
            Logger.error(`Failed to launch game ${game.name}:`, error)
            const message = error instanceof Error ? error.message : String(error)
            showLaunchToast(`Failed to launch ${game.name}: ${message}`)
        } finally {
            setLaunchingGameId(null)
        }
    }

    const handleConfirmSidebarLaunchFile = async () => {
        if (!pickerGame || !pickerSelectedLaunchFile) {
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

            await launchGame(pickerGame.path, pickerGame.id)
            try {
                await addPlayHistoryEntry(pickerGame.id)
                await refreshLastPlayedCards()
            } catch (historyError) {
                Logger.warn(`Game launched but failed to update play history for ${pickerGame.name}:`, historyError)
            }
            await waitForMinimumLaunchLoading(launchStartedAt)
        } catch (error) {
            Logger.error(`Failed to persist launch file selection for ${pickerGame.name}:`, error)
            const message = error instanceof Error ? error.message : String(error)
            showLaunchToast(`Failed to launch ${pickerGame.name}: ${message}`)
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

    useEffect(() => {
        void checkForStartupUpdateNotice()
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

                setIsScanning(true)
                setScanProgress(0)
                setScanStatusMessage('Scanning all custom folders...')

                await scanAndAddCustomFolderGames((update) => {
                    const mappedPercent = Math.round(update.percent * 0.6)
                    setScanProgress(mappedPercent)
                    setScanStatusMessage(`${update.message}`)
                })

                const cachedGames = await loadGameList()
                const scanCandidates = (cachedGames?.games || []) as Array<{ id: string; platform?: string }>
                const { hasSteamGames, hasGOGGames, hasXboxGames } = await detectPlatformsFromCache(scanCandidates)

                const optionalScans: Array<'Steam' | 'GOG' | 'Xbox'> = []
                if (hasSteamGames) {
                    optionalScans.push('Steam')
                }
                if (hasGOGGames) {
                    optionalScans.push('GOG')
                }
                if (hasXboxGames) {
                    optionalScans.push('Xbox')
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
                    } else if(platform === 'Xbox') {
                        await scanAndAddXboxGames((update) => {
                            const mappedPercent = Math.round(rangeStart + ((rangeEnd - rangeStart) * update.percent) / 100)
                            setScanProgress(mappedPercent)
                            setScanStatusMessage(`${update.message}`)
                        });
                    } else if(platform === 'EA') {
                        await scanAndAddEAGames((update) => {
                            const mappedPercent = Math.round(rangeStart + ((rangeEnd - rangeStart) * update.percent) / 100)
                            setScanProgress(mappedPercent)
                            setScanStatusMessage(`${update.message}`)
                        });
                    }
                }

                await loadGames()
                Logger.info('Initial game loading complete.');
            } finally {
                setIsScanning(false)
            }
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
            if(cachedGames) {
                const allGames = cachedGames.games || []
                for(const game of allGames) {
                    const cacheData = await loadGameCache(game.id)
                    if (cacheData) {
                        game.name = cacheData.title || game.name
                        if(!game.coverUrl && !cacheData.cover_url) {
                            if(cacheData.fetched) {
                                Logger.warn(`Game ${game.name} (ID: ${game.id}) was previously fetched but has no cover URL, skipping IGDB fetch.`)
                            } else {
                                Logger.warn(`No cover URL in cache for game ${game.name} (ID: ${game.id}), fetching from IGDB...`)
                                try {
                                    const igdbData = await searchGame(game.name)
                                    if (igdbData.success && igdbData.data) {
                                        game.coverUrl = igdbData.data.cover_url || undefined
                                        game.thumbnailUrl = igdbData.data.thumbnail_url || undefined
                                        game.name = igdbData.data.title || game.name
                                        await saveGameInfoCache(game.id, {
                                            title: game.name,
                                            cover_url: game.coverUrl || null,
                                            thumbnail_url: igdbData.data.thumbnail_url || null,
                                            igdb_id: igdbData.data.id || null,
                                            id: game.id,
                                            platform: game.platform || null,
                                            folder: game.path || '',
                                            fetched: true,
                                        });
                                    }
                                } catch (error) {
                                    Logger.error(`Error fetching IGDB data for game ${game.name}:`, error)
                                }
                            }  
                        } else {
                            game.coverUrl = cacheData.cover_url || game.coverUrl
                            game.thumbnailUrl = cacheData.thumbnail_url || game.thumbnailUrl
                            game.platform = cacheData.platform || game.platform
                        }
                    } else {
                        try {
                            const igdbData = await searchGame(game.name)
                            if (igdbData.success && igdbData.data) {
                                game.coverUrl = igdbData.data.cover_url || undefined
                                game.name = igdbData.data.title || game.name
                                game.thumbnailUrl = igdbData.data.thumbnail_url || undefined
                                await saveGameInfoCache(game.id, {
                                    title: game.name,
                                    cover_url: game.coverUrl || null,
                                    thumbnail_url: igdbData.data.thumbnail_url || null,
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

            const { hasSteamGames, hasGOGGames, hasXboxGames } = await detectPlatformsFromCache(games)

            const optionalScans: Array<'Steam' | 'GOG' | 'Xbox'> = []
            if (hasSteamGames) {
                optionalScans.push('Steam')
            }
            if (hasGOGGames) {
                optionalScans.push('GOG')
            }
            if (hasXboxGames) {
                optionalScans.push('Xbox')
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
                } else if(platform === 'GOG') {
                    await scanAndAddGOGGames((update) => {
                        const mappedPercent = Math.round(rangeStart + ((rangeEnd - rangeStart) * update.percent) / 100)
                        setScanProgress(mappedPercent)
                        setScanStatusMessage(`${update.message}`)
                    })
                } else if(platform === 'Xbox') {
                    await scanAndAddXboxGames((update) => {
                        const mappedPercent = Math.round(rangeStart + ((rangeEnd - rangeStart) * update.percent) / 100)
                        setScanProgress(mappedPercent)
                        setScanStatusMessage(`${update.message}`)
                    })
                } else if(platform === 'EA') {
                    await scanAndAddEAGames((update) => {
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
            <div className="fixed top-4 right-4 z-[10000] flex flex-col gap-2 pointer-events-none">
                {launchToasts.map((toast) => (
                    <div
                        key={toast.id}
                        onClick={() => {
                            if (!toast.onClick) {
                                return
                            }
                            toast.onClick()
                            setLaunchToasts((prev) => prev.filter((item) => item.id !== toast.id))
                        }}
                        className={`pointer-events-auto w-80 rounded-lg bg-[#21364f] border border-[#3a5f84] text-white shadow-[0_10px_26px_rgba(0,0,0,0.35)] overflow-hidden transform transition-all duration-300 ${
                            toast.visible ? 'translate-x-0 opacity-100' : 'translate-x-8 opacity-0'
                        } ${toast.onClick ? 'cursor-pointer' : ''}`}
                    >
                        <div className="px-3 py-2 text-sm">
                            <div>{toast.message}</div>
                            {toast.actionLabel && <div className="underline mt-1">{toast.actionLabel}</div>}
                        </div>
                        <div className="h-1 bg-[#325170]/50">
                            <div
                                className="h-full bg-[#6ec1ff]"
                                style={{
                                    width: toast.started ? '0%' : '100%',
                                    transition: `width ${toast.durationMs}ms linear`,
                                }}
                            />
                        </div>
                    </div>
                ))}
            </div>

            <Sidebar
                onGoHome={handleGoHome}
                onToggleSettings={handleToggleSettings}
                isHomeActive={!isSettingsOpen && !selectedGame}
                isSettingsActive={isSettingsOpen}
                lastPlayedCards={lastPlayedCards}
                onPlayLastPlayed={handlePlayLastPlayed}
                launchingGameId={launchingGameId}
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
                    />
                ) : (
                    <GameLibrary
                        games={games}
                        onGameSelect={setSelectedGame}
                        onLaunchError={showLaunchToast}
                        onShowToast={showLaunchToast}
                        onLaunchSuccess={handleLaunchSuccess}
                        igdbConnectionStatus={igdbConnectionStatus}
                        onConnectIGDB={handleConnectIGDB}
                        onOpenSettings={handleOpenSettings}
                        onRefresh={handleRefreshLibrary}
                        onScanPlatforms={handleScanPlatforms}
                        isLoading={isScanning}
                        isLoadingGames={isLoadingGames}
                        scanProgress={scanProgress}
                        scanStatusMessage={scanStatusMessage}
                    />
                )}
            </div>
        </div>
    )
}

export default App

