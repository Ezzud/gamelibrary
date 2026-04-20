import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  AlertCircle,
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
  Wrench
} from 'lucide-react'
import { FaSteam, FaXbox } from 'react-icons/fa'
import { SiEpicgames, SiGogdotcom } from 'react-icons/si'
import {
  addCustomScanFolder,
  clearPlayHistory,
  deleteAllGameCaches,
  deleteAllGamesData,
  getAppConfig,
  getCustomScanFolders,
  removeCustomScanFolder
} from '../services/ConfigManager'
import { chooseFolder } from '../services/GameScanner'
import { Logger } from '../utils/Logger'
import { getVersion } from '@tauri-apps/api/app'

type ConfigCategory = 'General' | 'Library' | 'Scanning' | 'Update'

interface AppConfigProps {
  isScanning?: boolean
  isRefetchingTags?: boolean
  scanProgress?: number
  scanStatusMessage?: string
  onScanPlatforms: (platforms: string[]) => Promise<void> | void
  onCustomFolderAdded: (folderPath: string) => Promise<void> | void
  onRefreshGames: () => Promise<void> | void
  onRefetchSpecialTags: () => Promise<void> | void
  onRemoveDuplicates: () => Promise<void> | void
  onConnectIGDB: (clientId: string, clientSecret: string) => Promise<{ success: boolean; message?: string }>
}

const SCAN_PLATFORMS = ['Steam', 'Custom Folders', 'Epic Games', 'GOG', 'Xbox']
const GITHUB_REPO_PACKAGE_JSON_URL = 'https://raw.githubusercontent.com/Ezzud/gamelibrary/main/package.json'
const GITHUB_REPO_RELEASES_URL = 'https://github.com/Ezzud/gamelibrary/releases/latest'

type UpdateCheckStatus = 'idle' | 'checking' | 'up-to-date' | 'update-available' | 'error'

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
    case 'GOG':
      return <SiGogdotcom className={`${iconClass} text-[#8d4bbb]`} />
    case 'Xbox':
      return <FaXbox className={`${iconClass} text-[#107c10]`} />
    case 'Custom Folders':
      return <FolderOpen className={`${iconClass} text-steam-200`} />
    default:
      return <FolderOpen className={`${iconClass} text-steam-300`} />
  }
}

const AppConfig = ({
  isScanning = false,
  isRefetchingTags = false,
  scanProgress = 0,
  scanStatusMessage = 'Idle',
  onScanPlatforms,
  onCustomFolderAdded,
  onRefreshGames,
  onRefetchSpecialTags,
  onRemoveDuplicates,
  onConnectIGDB
}: AppConfigProps) => {
  const [activeCategory, setActiveCategory] = useState<ConfigCategory>('General')
  const [customFolders, setCustomFolders] = useState<string[]>([])
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
  const [updateStatus, setUpdateStatus] = useState<UpdateCheckStatus>('idle')
  const [currentVersion, setCurrentVersion] = useState('Unknown')
  const [latestVersion, setLatestVersion] = useState<string | null>(null)
  const isAnyMaintenanceActionRunning = isClearingCache || isClearingPlayHistory || isRemovingLibrary || isRemovingDuplicates

  const categories = useMemo(
    () => [
      { key: 'General' as const, label: 'General', icon: Settings2 },
      { key: 'Library' as const, label: 'Library', icon: Wrench },
      { key: 'Scanning' as const, label: 'Scanning', icon: ScanSearch },
      { key: 'Update' as const, label: 'Update', icon: RefreshCw }
    ],
    []
  )

  const checkForUpdates = async () => {
    setUpdateStatus('checking')
    const checkStartedAt = Date.now()

    try {
      const localVersion = await getVersion()
      setCurrentVersion(localVersion)

      const response = await fetch(`${GITHUB_REPO_PACKAGE_JSON_URL}?t=${Date.now()}`)
      if (!response.ok) {
        throw new Error(`GitHub version fetch failed with status ${response.status}`)
      }

      const data = await response.json() as { version?: string }
      const repoVersion = (data.version || '').trim()

      if (!repoVersion) {
        throw new Error('GitHub version is missing in package.json')
      }

      setLatestVersion(repoVersion)

      const comparison = compareSemver(localVersion, repoVersion)
      const elapsed = Date.now() - checkStartedAt
      if (elapsed < 1000) {
        await delay(1000 - elapsed)
      }
      setUpdateStatus(comparison < 1 ? 'up-to-date' : 'update-available')
    } catch (error) {
      Logger.error('Failed to check for updates:', error)
      setLatestVersion(null)
      const elapsed = Date.now() - checkStartedAt
      if (elapsed < 1000) {
        await delay(1000 - elapsed)
      }
      setUpdateStatus('error')
    }
  }

  const refreshCustomFolders = async () => {
    const folders = await getCustomScanFolders()
    setCustomFolders(folders || [])
  }

  useEffect(() => {
    void refreshCustomFolders()
  }, [])

  useEffect(() => {
    const loadCredentials = async () => {
      const config = await getAppConfig()
      setCredentialsClientId(config.twitchClientId || '')
      setCredentialsClientSecret(config.twitchClientSecret || '')
    }

    void loadCredentials()
  }, [])

  useEffect(() => {
    if (activeCategory !== 'Update' || updateStatus === 'checking') {
      return
    }

    if (updateStatus === 'idle') {
      void checkForUpdates()
    }
  }, [activeCategory, updateStatus])

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

  return (
    <div className="h-full flex bg-steam-900 text-white">
      <aside className="w-72 bg-steam-800 p-4 shadow-[6px_0_20px_rgba(0,0,0,0.25)]">
        <div className="mb-4 rounded-xl bg-gradient-to-br from-steam-700 to-steam-800 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_8px_24px_rgba(0,0,0,0.2)]">
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

            <div className="rounded-lg bg-steam-900/45 px-3 py-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
              <p className="text-xs text-steam-400">Selected platforms</p>
              <p className="text-sm text-steam-100 mt-1">{Array.from(selectedPlatforms).join(', ') || 'None'}</p>
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

              <div className="flex items-center justify-between gap-3">
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

              {updateStatus === 'update-available' && (
                <div>
                  <button
                    type="button"
                    onClick={() => window.open(GITHUB_REPO_RELEASES_URL, '_blank', 'noopener,noreferrer')}
                    className="px-4 py-2 rounded-lg bg-[#8a4f16] hover:bg-[#9f5d1e] text-[#fff1dc] transition-colors inline-flex items-center gap-2"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Update now
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

export default AppConfig
