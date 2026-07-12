export interface Game {
  id: string
  name: string
  path: string
  platform: string
  coverUrl?: string
  thumbnailUrl?: string
  size?: number
}

export interface LastPlayedCard {
  gameId: string
  name: string
  coverUrl?: string
  playedAt: string
  playtime?: string
}

export type IGDBConnectionStatus = 'checking' | 'missing' | 'invalid' | 'connected'
export type IGDBConnectionMode = 'api' | 'twitch'
export type ConfigCategory = 'General' | 'Library' | 'Scanning' | 'Update' | 'About'
export type UpdateCheckStatus = 'idle' | 'checking' | 'up-to-date' | 'update-available' | 'error'
export type SortField = 'name' | 'platform' | 'tag' | 'dateAdded'

export interface IGDBConnectResult {
  success: boolean
  message?: string
}

export type ToastStyle = 'default' | 'success' | 'error' | 'warning'

export interface ToastOptions {
  durationMs?: number
  style?: ToastStyle
  actionLabel?: string
  onClick?: () => void
}

export type ShowToast = (message: string, options?: ToastOptions) => void

export interface LaunchFilePickerModalProps {
  isOpen: boolean
  gameName: string
  launchFiles: string[]
  selectedLaunchFile: string
  onSelect: (launchFile: string) => void
  onConfirm: () => void
  onCancel: () => void
}

export interface AppConfigProps {
  isScanning?: boolean
  isRefetchingTags?: boolean
  scanProgress?: number
  scanStatusMessage?: string
  initialCategory?: ConfigCategory
  onConfigChanged?: () => Promise<void> | void
  onScanPlatforms: (platforms: string[]) => Promise<void> | void
  onCustomFolderAdded: (folderPath: string) => Promise<void> | void
  onRefreshGames: () => Promise<void> | void
  onRefetchSpecialTags: () => Promise<void> | void
  onRemoveDuplicates: () => Promise<void> | void
  onConnectIGDB: (clientId: string, clientSecret: string) => Promise<IGDBConnectResult>
  onShowToast?: ShowToast
}

export interface GameCardProps {
  game: Game
  onClick: () => void
  onPlay?: (game: Game) => Promise<void> | void
  isPlayLoading?: boolean
  isRunning?: boolean
  isFavorite?: boolean
  onOpenFolder?: (game: Game) => void
  onGameSettings?: (game: Game) => void
  onDelete?: (game: Game) => void
  onToggleFavorite?: (game: Game) => Promise<void> | void
  onSpecialTagsLoaded?: (gameId: string, tags: string[]) => void
  cardHoverEffect?: string
  displayCover?: string | null
}

export interface GameLibraryProps {
  games: Game[]
  favoriteGameIds: Set<string>
  onGameSelect: (game: Game) => void
  onLaunchError: (message: string) => void
  onShowToast?: ShowToast
  onLaunchSuccess: () => Promise<void> | void
  onGamesRemoved?: (gameIds: string[]) => void
  runningGameIds?: Set<string>
  onGameRunningChange?: (gameId: string, isRunning: boolean) => void
  igdbConnectionStatus: IGDBConnectionStatus
  onConnectIGDB: (clientId: string, clientSecret: string) => Promise<IGDBConnectResult>
  onOpenSettings: () => void
  onRefresh: () => void
  onGamesAdded?: (games: Game[]) => void
  onScanPlatforms: (platforms: string[]) => Promise<void> | void
  onToggleFavorite: (game: Game) => Promise<void> | void
  isLoading: boolean
  isLoadingGames: boolean
  scanProgress: number
  scanStatusMessage: string
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  platformFilter: string
  onPlatformFilterChange: (value: string) => void
  tagFilter: string
  onTagFilterChange: (value: string) => void
  sortField: SortField
  onSortFieldChange: (value: SortField) => void
  sortDirection: 'asc' | 'desc'
  onSortDirectionChange: (value: 'asc' | 'desc') => void
  settingsLoaded: boolean
}

export interface GameDetailViewProps {
  game: Game
  onBack: () => void
  onGameUpdated?: () => void
  onLaunchError: (message: string) => void
  onShowToast?: ShowToast
  onLaunchSuccess: () => Promise<void> | void
  isGameRunning?: boolean
  onGameRunningChange?: (gameId: string, isRunning: boolean) => void
  isFavorite?: boolean
  onToggleFavorite?: () => void
}

export interface GameConfigPanelProps {
  game: Game
  onBack: () => void
  onConfigSaved?: () => void
  onShowToast?: ShowToast
}

export interface SidebarProps {
  onGoHome: () => void
  onToggleSettings: () => void
  isHomeActive: boolean
  isSettingsActive: boolean
  lastPlayedCards: LastPlayedCard[]
  onPlayLastPlayed: (gameId: string) => void
  launchingGameId: string | null
  runningGameIds?: Set<string>
}

export interface ToastItem {
  id: string
  message: string
  visible: boolean
  started: boolean
  durationMs: number
  style: ToastStyle
  actionLabel?: string
  onClick?: () => void
}

export interface ToastStackProps {
  toasts: ToastItem[]
  onDismiss: (id: string) => void
}

export interface Config {
  customScanFolders: string[]
  ignoredFolders: string[]
  favorites: string[]
  twitchClientId: string
  twitchClientSecret: string
  cardHoverEffect: string
  igdbConnectionMode?: IGDBConnectionMode
  igdbApiBaseUrl?: string
  runOnStartup?: boolean
  runReduced?: boolean
  reduceWhilePlaying?: boolean
  reduceWhenClosing?: boolean
  reduceWhenClosingNoticeShown?: boolean
  autoDetectGames?: boolean
  sortField?: SortField
  sortOrder?: 'asc' | 'desc'
}

export interface GameConfig {
  customArguments: string
  defaultLaunchFile?: string
  allLaunchFiles?: string[]
  lockedLaunchFile?: boolean
  specialTags?: string[]
  searchName?: string
  forced_igdb_id?: number | null
  localCoverPath?: string
  localBannerPath?: string
  dateAdded?: number
}

export interface GameCacheConfig {
  title: string | null
  cover_url: string | null
  thumbnail_url?: string | null
  igdb_id: number | null
  id: string | null
  platform: string | null
  folder: string
  fetched: boolean
}

export interface GameListEntry {
  id: string
  name: string
  path: string
  launchFile: string
  platform: string
}

export interface GameList {
  games: GameListEntry[]
}

export interface PlayHistoryEntry {
  id: string
  gameId: string
  playedAt: string
}

export interface PlayHistory {
  plays: PlayHistoryEntry[]
}

export interface ScanProgressUpdate {
  percent: number
  message: string
}

export type ScanProgressCallback = (update: ScanProgressUpdate) => void

export interface IGDBCredentials {
  clientId: string
  clientSecret: string
}

export interface PlaytimeEntry {
  totalMs: number
  lastPlayedAt?: string
}

export interface PlaytimeStore {
  games: Record<string, PlaytimeEntry>
}
