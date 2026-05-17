import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { appDataDir, appLocalDataDir } from '@tauri-apps/api/path'
import {
  Check,
  AlertCircle,
  Info,
  Database,
  CheckCircle2,
  FolderPlus,
  FolderOpen,
  Folders,
  Eye,
  EyeOff,
  Loader2,
  Play,
  RefreshCw,
  ScanSearch,
  Settings2,
  Star,
  Sparkles,
  Tags,
  Trash2,
  X,
  Wrench,
  Maximize2,
  Expand,
  RotateCw
} from 'lucide-react'
import { FaSteam, FaXbox } from 'react-icons/fa'
import { SiBattledotnet, SiEpicgames, SiGogdotcom, SiEa } from 'react-icons/si'
import {
  addCustomScanFolder,
  addIgnoredFolder,
  clearPlayHistory,
  deleteAllGameCaches,
  deleteAllGamesData,
  getAppConfig,
  getCustomScanFolders,
  getIgnoredFolders,
  loadGameCache,
  loadGameList,
  removeIgnoredFolder,
  removeCustomScanFolder,
  setCardHoverEffect,
  setRunOnStartup,
  setReduceWhilePlaying
} from '../services/ConfigManager'
import { chooseFolder } from '../services/GameScanner'
import { Logger } from '../utils/Logger'
import { getVersion } from '@tauri-apps/api/app'
import type { AppConfigProps, ConfigCategory, UpdateCheckStatus } from '../types/appTypes'

const SCAN_PLATFORMS = ['Steam', 'Custom Folders', 'Epic Games', 'GOG', 'Xbox', 'EA', 'Battle.net']
const GITHUB_REPO_URL = 'https://github.com/Ezzud/gamelibrary'
const REPO_BRANCH = 'master'
const APP_NAME = 'gamelibrary'
const APP_AUTHOR = 'Ezzud'

const delay = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

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

const AppConfig = ({
  isScanning = false,
  isRefetchingTags = false,
  scanProgress = 0,
  scanStatusMessage = 'Idle',
  initialCategory = 'General',
  onScanPlatforms,
  onCustomFolderAdded,
  onRefreshGames,
  onRefetchSpecialTags,
  onRemoveDuplicates,
  onConnectIGDB,
  onConfigChanged,
  onShowToast,
}: AppConfigProps) => {
  const [activeCategory, setActiveCategory] = useState<ConfigCategory>(initialCategory)
  const [customFolders, setCustomFolders] = useState<string[]>([])
  const [ignoredFolders, setIgnoredFolders] = useState<string[]>([])
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set(['Steam']))
  const [isClearingCache, setIsClearingCache] = useState(false)
  const [isClearingPlayHistory, setIsClearingPlayHistory] = useState(false)
  const [isRemovingLibrary, setIsRemovingLibrary] = useState(false)
  const [isRemovingDuplicates, setIsRemovingDuplicates] = useState(false)
  const [confirmAction, setConfirmAction] = useState<'clear-cache' | 'clear-play-history' | 'remove-library' | null>(null)
  const [maintenanceStatus, setMaintenanceStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [credentialsClientId, setCredentialsClientId] = useState('')
  const [credentialsClientSecret, setCredentialsClientSecret] = useState('')
  const [showClientSecret, setShowClientSecret] = useState(false)
  const [isConnectingCredentials, setIsConnectingCredentials] = useState(false)
  const [credentialsStatus, setCredentialsStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [cardHoverEffect, setCardHoverEffectState] = useState('zoom')
  const [runOnStartup, setRunOnStartupState] = useState(false)
  const [reduceWhilePlaying, setReduceWhilePlayingState] = useState(true)
  const [isUpdatingRunOnStartup, setIsUpdatingRunOnStartup] = useState(false)
  const [isUpdatingReduceWhilePlaying, setIsUpdatingReduceWhilePlaying] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<UpdateCheckStatus>('idle')
  const [currentVersion, setCurrentVersion] = useState('Unknown')
  const [latestVersion, setLatestVersion] = useState<string | null>(null)
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false)
  const [currentReleaseNotes, setCurrentReleaseNotes] = useState<string | null>(null)
  const [isLoadingReleaseNotes, setIsLoadingReleaseNotes] = useState(false)
  const [updateDownloadProgress, setUpdateDownloadProgress] = useState<number | null>(null)
  const [aboutAppLocation, setAboutAppLocation] = useState<string>('Loading...')
  const [aboutDataLocation, setAboutDataLocation] = useState<string>('Loading...')
  const isAnyMaintenanceActionRunning = isClearingCache || isClearingPlayHistory || isRemovingLibrary || isRemovingDuplicates

  const categories = useMemo(
    () => [
      { key: 'General' as const, label: 'General', icon: Settings2 },
      { key: 'Library' as const, label: 'Library', icon: Wrench },
      { key: 'Scanning' as const, label: 'Scanning', icon: ScanSearch },
      { key: 'Update' as const, label: 'Update', icon: RefreshCw },
      { key: 'About' as const, label: 'About', icon: Info }
    ],
    []
  )

  const checkForUpdates = async () => {
    setUpdateStatus('checking')
    try {
      const localVersion = await getVersion()
      setCurrentVersion(localVersion)

      const result = await invoke<string | null>('check_for_updates_cmd')
      if (result) {
        const repoVersion = result.trim().replace(/^v/i, '')
        setLatestVersion(repoVersion)
        const comparison = compareSemver(localVersion, repoVersion)
        setUpdateStatus(comparison < 1 ? 'up-to-date' : 'update-available')
      } else {
        setLatestVersion(null)
        setUpdateStatus('up-to-date')
      }
    } catch (error) {
      Logger.error('Failed to check for updates:', error)
      setLatestVersion(null)
      setUpdateStatus('error')
    }
  }

  const fetchReleaseNotesForVersion = async (version: string) => {
    const normalizedVersion = version.trim().replace(/^v/i, '')
    if (!normalizedVersion) {
      setCurrentReleaseNotes(null)
      return
    }

    setIsLoadingReleaseNotes(true)
    try {
      const response = await fetch(`https://api.github.com/repos/Ezzud/gamelibrary/releases/tags/v${normalizedVersion}?t=${Date.now()}`)
      if (!response.ok) {
        throw new Error(`GitHub release fetch failed with status ${response.status}`)
      }

      const data = await response.json() as { body?: string }
      const notes = (data.body || '').trim()
      setCurrentReleaseNotes(notes || null)
    } catch (error) {
      Logger.warn('Failed to load current release notes:', error)
      setCurrentReleaseNotes(null)
    } finally {
      setIsLoadingReleaseNotes(false)
    }
  }

  const refreshCustomFolders = async () => {
    const folders = await getCustomScanFolders()
    setCustomFolders(folders || [])
  }

  const refreshIgnoredFolders = async () => {
    const folders = await getIgnoredFolders()
    setIgnoredFolders(folders || [])
  }

  useEffect(() => {
    void refreshCustomFolders()
    void refreshIgnoredFolders()
  }, [])

  useEffect(() => {
    const loadCredentials = async () => {
      const config = await getAppConfig()
      setCredentialsClientId(config.twitchClientId || '')
      setCredentialsClientSecret(config.twitchClientSecret || '')
      setCardHoverEffectState(config.cardHoverEffect || 'zoom')
      setRunOnStartupState(!!config.runOnStartup)
      setReduceWhilePlayingState(config.reduceWhilePlaying !== false)
    }

    void loadCredentials()
  }, [])

  useEffect(() => {
    const loadAboutPaths = async () => {
      try {
        const [localPath, appDataPath] = await Promise.all([appLocalDataDir(), appDataDir()])
        const normalizedLocalPath = localPath.replace(/[\\/]+$/, '')
        const normalizedAppDataPath = appDataPath.replace(/[\\/]+$/, '')

        setAboutAppLocation(`${normalizedLocalPath}`)
        setAboutDataLocation(`${normalizedAppDataPath}\\GameLibrary`)
      } catch (error) {
        Logger.warn('Failed to load About paths:', error)
        setAboutAppLocation('Unavailable')
        setAboutDataLocation('Unavailable')
      }
    }

    const loadCurrentVersion = async () => {
      try {
        const localVersion = await getVersion()
        setCurrentVersion(localVersion)
      } catch (error) {
        Logger.warn('Failed to load app version for About section:', error)
      }
    }

    void loadAboutPaths()
    void loadCurrentVersion()
  }, [])

  useEffect(() => {
    setActiveCategory(initialCategory)
  }, [initialCategory])

  useEffect(() => {
    if (activeCategory !== 'Update' || updateStatus === 'checking') {
      return
    }

    if (updateStatus === 'idle') {
      void checkForUpdates()
    }
  }, [activeCategory, updateStatus])

  useEffect(() => {
    // Listen for updater events emitted by the backend commands
    let unlistenProgress: any | null = null
    let unlistenFinished: any | null = null

    const startListeners = async () => {
      try {
        unlistenProgress = await listen('updater:progress', (event) => {
          // payload: { downloaded, content_length }
          const payload: any = (event as any).payload || {}
          const downloaded = Number(payload.downloaded || 0)
          const contentLength = Number(payload.content_length || 0)
          if (contentLength > 0) {
            setUpdateDownloadProgress(Math.round((downloaded / contentLength) * 100))
          } else {
            setUpdateDownloadProgress(null)
          }
          setIsInstallingUpdate(true)
        })

        unlistenFinished = await listen('updater:finished', () => {
          setIsInstallingUpdate(false)
          setUpdateDownloadProgress(null)
          setUpdateStatus('up-to-date')
        })
      } catch (err) {
        // ignore if event registration fails in non-tauri environments
      }
    }

    void startListeners()

    return () => {
      if (unlistenProgress) {
        unlistenProgress.then((f: any) => f())
      }
      if (unlistenFinished) {
        unlistenFinished.then((f: any) => f())
      }
    }
  }, [])

  useEffect(() => {
    if (activeCategory !== 'Update') {
      return
    }

    if (currentVersion && currentVersion !== 'Unknown') {
      void fetchReleaseNotesForVersion(currentVersion)
    }
  }, [activeCategory, currentVersion])

  useEffect(() => {
    if (activeCategory !== 'Scanning') {
      return
    }

    const loadScanningDefaults = async () => {
      try {
        const config = await getAppConfig()
        const gameList = await loadGameList()
        const games = Array.isArray(gameList?.games) ? gameList.games : []

        const platforms = await Promise.all(
          games.map(async (game: { id?: string }) => {
            if (!game?.id) {
              return ''
            }
            const cache = await loadGameCache(game.id)
            return (cache?.platform || '').toString().toLowerCase()
          })
        )

        const defaults = new Set<string>()
        if (platforms.some((platform) => platform === 'steam')) {
          defaults.add('Steam')
        }
        if (platforms.some((platform) => platform === 'gog')) {
          defaults.add('GOG')
        }
        if(platforms.some((platform) => platform === 'xbox')) {
          defaults.add('Xbox')
        }
        if(platforms.some((platform) => platform === 'ea')) {
          defaults.add('EA')
        }
        if (platforms.some((platform) => platform === 'epic games')) {
          defaults.add('Epic Games')
        }
        if (platforms.some((platform) => platform === 'battle.net')) {
          defaults.add('Battle.net')
        }
        if (Array.isArray(config?.customScanFolders) && config.customScanFolders.length > 0) {
          defaults.add('Custom Folders')
        }

        setSelectedPlatforms(defaults)
      } catch (error) {
        Logger.warn('Failed to load scanning defaults:', error)
      }
    }

    void loadScanningDefaults()
  }, [activeCategory])

  useEffect(() => {
    if (activeCategory !== 'Scanning') {
      return
    }

    setSelectedPlatforms((prev) => {
      const next = new Set(prev)
      if (customFolders.length > 0) {
        next.add('Custom Folders')
      }
      return next
    })
  }, [activeCategory, customFolders])

  useEffect(() => {
    if (!maintenanceStatus) {
      return
    }

    const timer = window.setTimeout(() => {
      setMaintenanceStatus(null)
    }, 3000)

    return () => window.clearTimeout(timer)
  }, [maintenanceStatus])

  const handleAddCustomFolder = async () => {
    const selectedFolder = await chooseFolder()
    if (!selectedFolder) {
      return
    }

    await addCustomScanFolder(selectedFolder)
    await refreshCustomFolders()
    await onCustomFolderAdded(selectedFolder)
  }

  const handleRemoveCustomFolder = async (path: string) => {
    await removeCustomScanFolder(path)
    await refreshCustomFolders()
  }

  const handleAddIgnoredFolder = async () => {
    const selectedFolder = await chooseFolder()
    if (!selectedFolder) {
      return
    }

    await addIgnoredFolder(selectedFolder)
    await refreshIgnoredFolders()
  }

  const handleRemoveIgnoredFolder = async (path: string) => {
    await removeIgnoredFolder(path)
    await refreshIgnoredFolders()
  }

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

  const handleClearGamesCache = async () => {
    setMaintenanceStatus(null)
    setConfirmAction('clear-cache')
    setIsClearingCache(true)
    try {
      await deleteAllGameCaches()
      await onRefreshGames()
      await delay(1000)
      Logger.success('All game cache data has been cleared.')
      setMaintenanceStatus({ type: 'success', message: 'Game cache data cleared successfully.' })
    } catch (error) {
      await delay(1000)
      Logger.error('Failed to clear game caches:', error)
      setMaintenanceStatus({ type: 'error', message: 'Failed to clear game cache data.' })
    } finally {
      setIsClearingCache(false)
      setConfirmAction(null)
    }
  }

  const handleRemoveAllFromLibrary = async () => {
    setMaintenanceStatus(null)
    setConfirmAction('remove-library')
    setIsRemovingLibrary(true)
    try {
      await deleteAllGamesData()
      await onRefreshGames()
      await delay(1000)
      Logger.success('All games have been removed from the library.')
      setMaintenanceStatus({ type: 'success', message: 'All games removed from the library.' })
    } catch (error) {
      await delay(1000)
      Logger.error('Failed to remove all games from library:', error)
      setMaintenanceStatus({ type: 'error', message: 'Failed to remove games from the library.' })
    } finally {
      setIsRemovingLibrary(false)
      setConfirmAction(null)
    }
  }

  const handleClearPlayHistory = async () => {
    setMaintenanceStatus(null)
    setConfirmAction('clear-play-history')
    setIsClearingPlayHistory(true)
    try {
      await clearPlayHistory()
      await delay(1000)
      Logger.success('Play history has been cleared.')
      setMaintenanceStatus({ type: 'success', message: 'Play history cleared successfully.' })
    } catch (error) {
      await delay(1000)
      Logger.error('Failed to clear play history:', error)
      setMaintenanceStatus({ type: 'error', message: 'Failed to clear play history.' })
    } finally {
      setIsClearingPlayHistory(false)
      setConfirmAction(null)
    }
  }

  const handleRefetchTagsInSettings = async () => {
    if (isScanning || isRefetchingTags || isAnyMaintenanceActionRunning) {
      return
    }

    setMaintenanceStatus(null)
    try {
      await onRefetchSpecialTags()
      setMaintenanceStatus({ type: 'success', message: 'Special tags refetched successfully.' })
    } catch (error) {
      Logger.error('Failed to refetch special tags:', error)
      setMaintenanceStatus({ type: 'error', message: 'Failed to refetch special tags.' })
    }
  }

  const handleRemoveDuplicatesInSettings = async () => {
    if (isScanning || isAnyMaintenanceActionRunning) {
      return
    }

    setMaintenanceStatus(null)
    setIsRemovingDuplicates(true)
    try {
      await onRemoveDuplicates()
      setMaintenanceStatus({ type: 'success', message: 'Duplicate games removed successfully.' })
    } catch (error) {
      Logger.error('Failed to remove duplicate games:', error)
      setMaintenanceStatus({ type: 'error', message: 'Failed to remove duplicate games.' })
    } finally {
      setIsRemovingDuplicates(false)
    }
  }

  const handleConnectCredentials = async () => {
    if (isConnectingCredentials) {
      return
    }

    setCredentialsStatus(null)
    setIsConnectingCredentials(true)
    try {
      const result = await onConnectIGDB(credentialsClientId, credentialsClientSecret)
      if (result.success) {
        setCredentialsStatus({ type: 'success', message: 'Credentials connected successfully.' })
      } else {
        setCredentialsStatus({ type: 'error', message: result.message || 'Invalid credentials.' })
      }
    } catch (error) {
      Logger.error('Failed to validate credentials from settings:', error)
      setCredentialsStatus({ type: 'error', message: 'Failed to validate credentials.' })
    } finally {
      setIsConnectingCredentials(false)
    }
  }

  const handleSetCardHoverEffect = async (effect: string) => {
    setCardHoverEffectState(effect)
    try {
      await setCardHoverEffect(effect)
      Logger.info(`Card hover effect changed to: ${effect}`)
    } catch (error) {
      Logger.error('Failed to save card hover effect:', error)
    }
  }

  const handleToggleRunOnStartup = async () => {
    if (isUpdatingRunOnStartup) {
      return
    }

    const next = !runOnStartup
    setIsUpdatingRunOnStartup(true)
    try {
      await setRunOnStartup(next)
      setRunOnStartupState(next)
      await onConfigChanged?.()
      onShowToast?.(next ? 'Enabled run on startup' : 'Disabled run on startup', { durationMs: 3000, style: 'success' })
    } catch (err) {
      Logger.error('Failed to toggle run on startup:', err)
      onShowToast?.('Failed to change run-on-startup setting', { durationMs: 5000, style: 'error' })
    } finally {
      setIsUpdatingRunOnStartup(false)
    }
  }

  const handleToggleReduceWhilePlaying = async () => {
    if (isUpdatingReduceWhilePlaying) {
      return
    }

    const next = !reduceWhilePlaying
    setIsUpdatingReduceWhilePlaying(true)
    try {
      await setReduceWhilePlaying(next)
      setReduceWhilePlayingState(next)
      await onConfigChanged?.()
      onShowToast?.(next ? 'Enabled reduce while playing' : 'Disabled reduce while playing', { durationMs: 3000, style: 'success' })
    } catch (err) {
      Logger.error('Failed to toggle reduce while playing:', err)
      onShowToast?.('Failed to change reduce-while-playing setting', { durationMs: 5000, style: 'error' })
    } finally {
      setIsUpdatingReduceWhilePlaying(false)
    }
  }

  const getHoverEffectIcon = (effect: string) => {
    switch (effect) {
      case 'zoom':
        return <Maximize2 className="w-4 h-4" />
      case 'grow':
        return <Expand className="w-4 h-4" />
      case 'shine':
        return <Sparkles className="w-4 h-4" />
      case 'spin':
        return <RotateCw className="w-4 h-4" />
      default:
        return null
    }
  }

  const hoverEffectOptions = [
    { value: 'zoom', label: 'Small Zoom' },
    { value: 'grow', label: 'Grow' },
    { value: 'shine', label: 'Shine' },
    { value: 'spin', label: 'Spin' }
  ]

  const handleInstallUpdate = async () => {
    if (isInstallingUpdate || !latestVersion) {
      return
    }

    setIsInstallingUpdate(true)
    try {
      await invoke('install_update_cmd')
      Logger.success(`Update install started for v${latestVersion}`)
      onShowToast?.(`Update started for v${latestVersion}. Download progress will be shown in Settings.`, { durationMs: 5000, style: 'success' })
    } catch (error) {
      Logger.error('Failed to download or launch update installer:', error)
      const rawErrorMessage = error instanceof Error ? error.message : String(error)
      const errorCode = rawErrorMessage.match(/\b([45]\d{2})\b/)?.[1]
      const normalizedMessage = rawErrorMessage
        .replace(/^Error invoking command ['"]download_and_launch_installer['"]:\s*/i, '')
        .replace(/^error:\s*/i, '')
        .trim()

      onShowToast?.(
        errorCode
          ? `Update install failed (HTTP ${errorCode}): ${normalizedMessage || 'Unknown error'}`
          : `Update install failed: ${normalizedMessage || 'Unknown error'}`,
        { durationMs: 7000, style: 'error' }
      )
    } finally {
      setIsInstallingUpdate(false)
    }
  }

  const handleOpenDirectory = async (path: string) => {
    if (!path || path === 'Unavailable' || path === 'Loading...') {
      return
    }

    try {
      await invoke('open_game_folder', { path })
    } catch (error) {
      Logger.error(`Failed to open folder ${path}:`, error)
      onShowToast?.('Failed to open folder.', { durationMs: 5000, style: 'error' })
    }
  }

  return (
    <div className="h-full flex bg-steam-900 text-white">
      <aside className="w-72 bg-steam-800 p-4 shadow-[6px_0_20px_rgba(0,0,0,0.25)]">
        <div className="mb-4 rounded-xl bg-linear-to-br from-steam-700 to-steam-800 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_8px_24px_rgba(0,0,0,0.2)]">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-steam-300" />
            App Config
          </h2>
          <p className="text-xs text-steam-300 mt-1">Control folders, platforms, and scan behavior.</p>
        </div>
        <nav className="space-y-2">
          {categories.map((category) => {
            const Icon = category.icon
            const isActive = activeCategory === category.key
            return (
              <button
                key={category.key}
                type="button"
                onClick={() => setActiveCategory(category.key)}
                className={`w-full px-3 py-2 rounded-lg flex items-center gap-2 text-left transition-colors ${
                  isActive
                    ? 'bg-steam-600 text-white shadow-[0_6px_18px_rgba(0,0,0,0.22)]'
                    : 'bg-steam-700/60 hover:bg-steam-700 text-steam-200'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{category.label}</span>
              </button>
            )
          })}
        </nav>
      </aside>

      <section className="flex-1 p-6 overflow-auto">
        <div className="mb-6 rounded-xl bg-steam-800/60 px-4 py-3 flex items-center justify-between shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_10px_25px_rgba(0,0,0,0.18)]">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-steam-300" />
            <p className="text-sm text-steam-200">Active category: {activeCategory}</p>
          </div>
          <div className="text-right">
            <div className="text-xs text-steam-400">Scanning: {isScanning ? `${scanProgress}%` : 'Idle'}</div>
            <div className="text-xs text-steam-500">{scanStatusMessage}</div>
          </div>
        </div>

        {activeCategory === 'General' && (
          <div className="rounded-xl bg-steam-800 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_14px_30px_rgba(0,0,0,0.2)]">
            <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-steam-300" />
              General
            </h3>

            <div className="mt-4 rounded-lg bg-steam-900/45 px-4 py-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
              <p className="text-sm text-steam-100 mb-3">Credentials</p>
              <div className="space-y-3">
                <input
                  type="text"
                  value={credentialsClientId}
                  onChange={(event) => setCredentialsClientId(event.target.value)}
                  disabled={isConnectingCredentials}
                  placeholder="Twitch Client ID"
                  className="w-full rounded-lg bg-steam-700 border border-steam-600 px-3 py-2 text-sm text-white placeholder:text-steam-400 focus:outline-none focus:ring-2 focus:ring-steam-400/50 disabled:opacity-60"
                />

                <div className="relative">
                  <input
                    type={showClientSecret ? 'text' : 'password'}
                    value={credentialsClientSecret}
                    onChange={(event) => setCredentialsClientSecret(event.target.value)}
                    disabled={isConnectingCredentials}
                    placeholder="Twitch Client Secret"
                    className="w-full rounded-lg bg-steam-700 border border-steam-600 px-3 py-2 pr-20 text-sm text-sky-200 placeholder:text-steam-400 focus:outline-none focus:ring-2 focus:ring-steam-400/50 disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() => setShowClientSecret((prev) => !prev)}
                    disabled={isConnectingCredentials}
                    className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 rounded-md bg-[#2a4f75] hover:bg-[#36648f] disabled:opacity-50 text-xs text-white transition-colors"
                    aria-label={showClientSecret ? 'Hide client secret' : 'Show client secret'}
                    title={showClientSecret ? 'Hide client secret' : 'Show client secret'}
                  >
                    {showClientSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => void handleConnectCredentials()}
                  disabled={isConnectingCredentials || !credentialsClientId.trim() || !credentialsClientSecret.trim()}
                  className="px-4 py-2 rounded-lg bg-steam-600 hover:bg-steam-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
                >
                  {isConnectingCredentials ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  {isConnectingCredentials ? 'Connecting...' : 'Connect'}
                </button>
              </div>

              {credentialsStatus && (
                <div
                  className={`mt-3 rounded-md px-3 py-2 text-sm ${
                    credentialsStatus.type === 'success'
                      ? 'bg-emerald-700/30 text-emerald-200 border border-emerald-500/40'
                      : 'bg-red-700/30 text-red-200 border border-red-500/40'
                  }`}
                >
                  {credentialsStatus.message}
                </div>
              )}
            </div>

            <div className="mt-4 rounded-lg bg-steam-900/45 px-4 py-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
              <p className="text-sm text-steam-100 mb-3">Card Hover Effect</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {hoverEffectOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => void handleSetCardHoverEffect(option.value)}
                    className={`px-3 py-2 rounded-lg flex flex-col items-center gap-1.5 transition-all ${
                      option.value === 'zoom' ? 'hover:scale-105' : 
                      option.value === 'grow' ? 'hover:scale-[1.15] origin-center' : 
                      option.value === 'shine' ? 'shine-card-preview' : 
                      option.value === 'spin' ? 'spin-card-preview' : ''
                    } ${
                      cardHoverEffect === option.value
                        ? 'bg-steam-600 ring-2 ring-steam-400 shadow-[0_4px_12px_rgba(100,200,255,0.2)]'
                        : 'bg-steam-700/60 hover:bg-steam-700'
                    }`}
                    title={option.label}
                  >
                    <span className={`${
                      option.value === 'zoom' ? 'text-sky-400' :
                      option.value === 'grow' ? 'text-emerald-400' :
                      option.value === 'shine' ? 'text-amber-400' :
                      option.value === 'spin' ? 'text-violet-400' :
                      'text-steam-300'
                    }`}>{getHoverEffectIcon(option.value)}</span>
                    <span className="text-xs text-steam-200">{option.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 rounded-lg bg-steam-900/45 px-4 py-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
              <p className="text-sm text-steam-100 mb-3">Startup</p>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-steam-100">Run when computer starts</p>
                  <p className="text-xs text-steam-400">Automatically launch GameLibrary on user login</p>
                </div>
                <div className="flex items-center mr-2">
                  <div
                    role="switch"
                    tabIndex={0}
                    aria-checked={runOnStartup}
                    aria-disabled={isUpdatingRunOnStartup}
                    aria-busy={isUpdatingRunOnStartup}
                    onKeyDown={async (e) => {
                      if (isUpdatingRunOnStartup) {
                        return
                      }

                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        void handleToggleRunOnStartup()
                      }
                    }}
                    onClick={() => void handleToggleRunOnStartup()}
                    className={`relative inline-flex h-8 w-16 items-center select-none rounded-md p-1 transition-all duration-300 focus:outline-none ${
                      isUpdatingRunOnStartup
                        ? 'cursor-not-allowed opacity-50 grayscale bg-zinc-600'
                        : 'cursor-pointer '
                    } ${runOnStartup ? 'bg-sky-400' : 'bg-zinc-700'}`}
                  >
                    <div
                      className={`h-6 w-6 bg-white rounded-md shadow transform transition-all duration-400 ${
                        runOnStartup ? 'translate-x-8 rotate-90' : 'translate-x-0 rotate-0'
                      } ${isUpdatingRunOnStartup ? 'opacity-80' : ''}`}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-steam-100">Reduce when running a game</p>
                  <p className="text-xs text-steam-400">Hide the main window while a game is active, then bring it back when playtime tracking stops.</p>
                </div>
                <div className="flex items-center mr-2">
                  <div
                    role="switch"
                    tabIndex={0}
                    aria-checked={reduceWhilePlaying}
                    aria-disabled={isUpdatingReduceWhilePlaying}
                    aria-busy={isUpdatingReduceWhilePlaying}
                    onKeyDown={async (e) => {
                      if (isUpdatingReduceWhilePlaying) {
                        return
                      }

                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        void handleToggleReduceWhilePlaying()
                      }
                    }}
                    onClick={() => void handleToggleReduceWhilePlaying()}
                    className={`relative inline-flex h-8 w-16 items-center select-none rounded-md p-1 transition-all duration-300 focus:outline-none ${
                      isUpdatingReduceWhilePlaying
                        ? 'cursor-not-allowed opacity-50 grayscale bg-zinc-600'
                        : 'cursor-pointer '
                    } ${reduceWhilePlaying ? 'bg-sky-400' : 'bg-zinc-700'}`}
                  >
                    <div
                      className={`h-6 w-6 bg-white rounded-md shadow transform transition-all duration-400 ${
                        reduceWhilePlaying ? 'translate-x-8 rotate-90' : 'translate-x-0 rotate-0'
                      } ${isUpdatingReduceWhilePlaying ? 'opacity-80' : ''}`}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-lg bg-steam-900/45 px-4 py-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
              <p className="text-sm text-steam-100 mb-3">Maintenance</p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void handleRefetchTagsInSettings()}
                  disabled={isScanning || isRefetchingTags || isAnyMaintenanceActionRunning}
                  className="px-3 py-2 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2 bg-[#1f3a56] hover:bg-[#2a4f75] text-[#eaf4ff]"
                >
                  <Tags className="w-4 h-4" />
                  <span>{isRefetchingTags ? 'Refetching Tags...' : 'Refetch Special Tags'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleRemoveDuplicatesInSettings()}
                  disabled={isScanning || isAnyMaintenanceActionRunning}
                  className="px-3 py-2 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2 bg-[#1f3a56] hover:bg-[#2a4f75] text-[#eaf4ff]"
                >
                  {isRemovingDuplicates ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  <span>{isRemovingDuplicates ? 'Removing Duplicates...' : 'Remove Duplicates'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setConfirmAction('clear-cache')}
                  disabled={isScanning || isAnyMaintenanceActionRunning}
                  className="px-3 py-2 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2 bg-[#1f3a56] hover:bg-[#2a4f75] text-[#eaf4ff]"
                >
                  <Database className="w-4 h-4" />
                  <span>{isClearingCache ? 'Clearing Cache...' : 'Clear Games Cache'}</span>
                  {confirmAction === 'clear-cache' && (
                    <span className="inline-flex items-center gap-1 ml-1">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          void handleClearGamesCache()
                        }}
                        disabled={isScanning || isAnyMaintenanceActionRunning}
                        className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-emerald-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label="Confirm clear cache"
                        title="Confirm"
                      >
                        {isClearingCache ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          setConfirmAction(null)
                        }}
                        disabled={isScanning || isAnyMaintenanceActionRunning}
                        className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-red-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label="Cancel clear cache"
                        title="Cancel"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setConfirmAction('clear-play-history')}
                  disabled={isScanning || isAnyMaintenanceActionRunning}
                  className="px-3 py-2 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2 bg-[#1f3a56] hover:bg-[#2a4f75] text-[#eaf4ff]"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>{isClearingPlayHistory ? 'Clearing Play History...' : 'Clear Play History'}</span>
                  {confirmAction === 'clear-play-history' && (
                    <span className="inline-flex items-center gap-1 ml-1">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          void handleClearPlayHistory()
                        }}
                        disabled={isScanning || isAnyMaintenanceActionRunning}
                        className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-emerald-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label="Confirm clear play history"
                        title="Confirm"
                      >
                        {isClearingPlayHistory ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          setConfirmAction(null)
                        }}
                        disabled={isScanning || isAnyMaintenanceActionRunning}
                        className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-red-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label="Cancel clear play history"
                        title="Cancel"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setConfirmAction('remove-library')}
                  disabled={isScanning || isAnyMaintenanceActionRunning}
                  className="px-3 py-2 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2 bg-red-700 hover:bg-red-600"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>{isRemovingLibrary ? 'Removing...' : 'Remove all from Library'}</span>
                  {confirmAction === 'remove-library' && (
                    <span className="inline-flex items-center gap-1 ml-1">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          void handleRemoveAllFromLibrary()
                        }}
                        disabled={isScanning || isAnyMaintenanceActionRunning}
                        className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-emerald-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label="Confirm remove all"
                        title="Confirm"
                      >
                        {isRemovingLibrary ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          setConfirmAction(null)
                        }}
                        disabled={isScanning || isAnyMaintenanceActionRunning}
                        className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-red-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label="Cancel remove all"
                        title="Cancel"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  )}
                </button>
              </div>

              {maintenanceStatus && (
                <div
                  className={`mt-3 rounded-md px-3 py-2 text-sm ${
                    maintenanceStatus.type === 'success'
                      ? 'bg-emerald-700/30 text-emerald-200 border border-emerald-500/40'
                      : 'bg-red-700/30 text-red-200 border border-red-500/40'
                  }`}
                >
                  {maintenanceStatus.message}
                </div>
              )}
            </div>
          </div>
        )}

        {activeCategory === 'Library' && (
          <div className="rounded-xl bg-steam-800 p-4 space-y-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_14px_30px_rgba(0,0,0,0.2)]">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Folders className="w-4 h-4 text-steam-300" />
                  Custom Scan Folders
                </h3>
                <p className="text-xs text-steam-400 mt-1">Games in these folders are included when scanning Custom Folders.</p>
              </div>
              <button
                type="button"
                onClick={handleAddCustomFolder}
                disabled={isScanning}
                className="px-3 py-2 rounded-lg bg-steam-600 hover:bg-steam-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
              >
                <FolderPlus className="w-4 h-4" />
                Add Folder
              </button>
            </div>

            {customFolders.length === 0 ? (
              <div className="rounded-lg bg-steam-900/35 px-4 py-6 text-center shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
                <p className="text-sm text-steam-300">No custom folders added yet.</p>
                <p className="text-xs text-steam-500 mt-1">Use Add Folder to include non-Steam locations.</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {customFolders.map((folder) => (
                  <li key={folder} className="rounded-lg bg-steam-900/45 px-3 py-2 flex items-center justify-between gap-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]">
                    <div className="min-w-0">
                      <span className="text-sm text-steam-100 truncate block" title={folder}>{folder}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveCustomFolder(folder)}
                      className="w-8 h-8 rounded-md bg-red-600/80 hover:bg-red-500 text-white inline-flex items-center justify-center transition-colors"
                      aria-label={`Remove folder ${folder}`}
                      title="Remove folder"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="pt-3 border-t border-steam-700/60">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <FolderOpen className="w-4 h-4 text-steam-300" />
                    Ignored Folders
                  </h3>
                  <p className="text-xs text-steam-400 mt-1">Folders listed here are excluded from all scans and game detection.</p>
                </div>
                <button
                  type="button"
                  onClick={handleAddIgnoredFolder}
                  disabled={isScanning}
                  className="px-3 py-2 rounded-lg bg-steam-600 hover:bg-steam-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
                >
                  <FolderPlus className="w-4 h-4" />
                  Add Folder
                </button>
              </div>

              {ignoredFolders.length === 0 ? (
                <div className="mt-3 rounded-lg bg-steam-900/35 px-4 py-4 text-center shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
                  <p className="text-sm text-steam-300">No ignored folders configured.</p>
                </div>
              ) : (
                <ul className="mt-3 space-y-2">
                  {ignoredFolders.map((folder) => (
                    <li key={folder} className="rounded-lg bg-steam-900/45 px-3 py-2 flex items-center justify-between gap-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]">
                      <div className="min-w-0">
                        <span className="text-sm text-steam-100 truncate block" title={folder}>{folder}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleRemoveIgnoredFolder(folder)}
                        className="w-8 h-8 rounded-md bg-red-600/80 hover:bg-red-500 text-white inline-flex items-center justify-center transition-colors"
                        aria-label={`Remove ignored folder ${folder}`}
                        title="Remove ignored folder"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {activeCategory === 'Scanning' && (
          <div className="rounded-xl bg-steam-800 p-4 space-y-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_14px_30px_rgba(0,0,0,0.2)]">
            <div>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <ScanSearch className="w-4 h-4 text-steam-300" />
                Platforms
              </h3>
              <p className="text-xs text-steam-400 mt-1">Select one or more sources, then run a combined scan.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {SCAN_PLATFORMS.map((platform) => {
                const checked = selectedPlatforms.has(platform)
                return (
                  <label
                    key={platform}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-colors ${
                      checked
                        ? 'bg-steam-700/45 shadow-[inset_0_0_0_1px_rgba(125,211,252,0.45)]'
                        : 'bg-steam-900/40 hover:bg-steam-900/70 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]'
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

            <button
              type="button"
              onClick={handleBeginScan}
              disabled={isScanning || selectedPlatforms.size < 1}
              className="px-4 py-2 rounded-lg bg-steam-600 hover:bg-steam-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
            >
              <Play className="w-4 h-4" />
              {isScanning ? 'Scanning...' : 'Begin Scan'}
            </button>
          </div>
        )}

        {activeCategory === 'Update' && (
          <div className="rounded-xl bg-steam-800 p-5 space-y-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_14px_30px_rgba(0,0,0,0.2)]">
            <div>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-steam-300" />
                Update
              </h3>
              <p className="text-xs text-steam-400 mt-1">Check for new versions from github.com/Ezzud/gamelibrary.</p>
            </div>

            <div className="rounded-lg bg-steam-900/45 px-4 py-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] space-y-3">
              <div className="text-sm text-steam-200">Current version: <span className="text-steam-100 font-medium">{currentVersion}</span></div>

              <div className="flex items-center gap-3">
                <div className="min-h-9 flex items-center">
                  {updateStatus === 'checking' && (
                    <div className="inline-flex items-center gap-2 text-steam-200">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Checking for updates...</span>
                    </div>
                  )}

                  {updateStatus === 'update-available' && (
                    <div className="inline-flex items-center gap-2 text-orange-300">
                      <Star className="w-4 h-4" />
                      <span>A new update is available ({latestVersion})</span>
                    </div>
                  )}

                  {updateStatus === 'error' && (
                    <div className="inline-flex items-center gap-2 text-red-300">
                      <AlertCircle className="w-4 h-4" />
                      <span>Unable to fetch version</span>
                    </div>
                  )}

                  {updateStatus === 'up-to-date' && (
                    <div className="inline-flex items-center gap-2 text-emerald-300">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>You are up-to-date ({currentVersion})</span>
                    </div>
                  )}
                </div>
                
                <div className="ml-auto flex items-center gap-2">
                  {updateStatus === 'update-available' && (
                    <button
                      type="button"
                      onClick={() => void handleInstallUpdate()}
                      disabled={isInstallingUpdate}
                      className="px-4 py-2 rounded-lg bg-[#8a4f16] hover:bg-[#9f5d1e] disabled:opacity-50 disabled:cursor-not-allowed text-[#fff1dc] transition-colors inline-flex items-center gap-2"
                    >
                      {isInstallingUpdate ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                      {isInstallingUpdate ? 'Installing...' : 'Update now'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void checkForUpdates()}
                    disabled={updateStatus === 'checking'}
                    className="px-4 py-2 rounded-lg bg-steam-600 hover:bg-steam-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
                  >
                    {updateStatus === 'checking' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    Check Update
                  </button>
                </div>
              </div>

              <div className="rounded-md bg-steam-900/60 px-3 py-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]">
                {isLoadingReleaseNotes ? (
                  <div className="mt-2 inline-flex items-center gap-2 text-steam-200 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Loading release notes...</span>
                  </div>
                ) : currentReleaseNotes ? (
                  <pre className="mt-2 whitespace-pre-wrap text-sm text-steam-100 bg-steam-900/40 rounded-md px-3 py-2">
                    {currentReleaseNotes}
                  </pre>
                ) : (
                  <div className="mt-2 text-sm text-steam-400">No release notes found for this version.</div>
                )}
                {isInstallingUpdate && updateDownloadProgress !== null && (
                  <div className="mt-3 w-full">
                    <div className="text-xs text-steam-400 mb-1">Download progress: {updateDownloadProgress}%</div>
                    <div className="w-full bg-steam-700 rounded-md h-2 overflow-hidden">
                      <div className="bg-steam-500 h-2" style={{ width: `${updateDownloadProgress}%` }} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeCategory === 'About' && (
          <div className="rounded-xl bg-steam-800 p-5 space-y-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_14px_30px_rgba(0,0,0,0.2)]">
            <div>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Info className="w-4 h-4 text-steam-300" />
                About
              </h3>
              <p className="text-xs text-steam-400 mt-1">App identity, versioning and storage locations.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-lg bg-linear-to-br from-steam-900/70 to-steam-800/40 px-4 py-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
                <p className="text-xs uppercase tracking-wide text-steam-400 mb-3">Identity</p>
                <div className="space-y-2 text-sm">
                  <div className="rounded-md bg-steam-900/45 px-3 py-2">
                    <p className="text-steam-400 text-xs">App name</p>
                    <p className="text-white font-semibold tracking-wide">{APP_NAME}</p>
                  </div>
                  <div className="rounded-md bg-steam-900/45 px-3 py-2">
                    <p className="text-steam-400 text-xs">Author</p>
                    <p className="text-white font-semibold tracking-wide">{APP_AUTHOR}</p>
                  </div>
                  <div className="rounded-md bg-steam-900/45 px-3 py-2">
                    <p className="text-steam-400 text-xs">App version</p>
                    <p className="text-white font-semibold tracking-wide">{currentVersion}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-lg bg-linear-to-br from-steam-900/70 to-steam-800/40 px-4 py-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
                <p className="text-xs uppercase tracking-wide text-steam-400 mb-3">Repository</p>
                <div className="space-y-2 text-sm">
                  <div className="rounded-md bg-steam-900/45 px-3 py-2">
                    <p className="text-steam-400 text-xs">Branch followed</p>
                    <p className="text-white font-semibold tracking-wide">{REPO_BRANCH}</p>
                  </div>
                  <div className="rounded-md bg-steam-900/45 px-3 py-2">
                    <p className="text-steam-400 text-xs">Repository URL</p>
                    <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer" className="inline-flex text-sky-300 hover:text-sky-200 underline break-all">{GITHUB_REPO_URL}</a>
                  </div>
                </div>
              </div>

              <div className="rounded-lg bg-linear-to-br from-steam-900/70 to-steam-800/40 px-4 py-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] lg:col-span-2 space-y-3">
                <p className="text-xs uppercase tracking-wide text-steam-400">Locations</p>
                <div className="text-sm text-steam-200 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-steam-400">App location</p>
                    <p className="truncate text-white font-medium" title={aboutAppLocation}>{aboutAppLocation}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleOpenDirectory(aboutAppLocation)}
                    className="w-8 h-8 shrink-0 rounded-md bg-steam-600 hover:bg-steam-500 transition-colors inline-flex items-center justify-center"
                    aria-label="Open app location"
                    title="Open app location"
                  >
                    <FolderOpen className="w-4 h-4" />
                  </button>
                </div>

                <div className="text-sm text-steam-200 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-steam-400">Data location</p>
                    <p className="truncate text-white font-medium" title={aboutDataLocation}>{aboutDataLocation}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleOpenDirectory(aboutDataLocation)}
                    className="w-8 h-8 shrink-0 rounded-md bg-steam-600 hover:bg-steam-500 transition-colors inline-flex items-center justify-center"
                    aria-label="Open data location"
                    title="Open data location"
                  >
                    <FolderOpen className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

export default AppConfig
