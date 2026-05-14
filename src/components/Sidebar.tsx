import { useEffect, useState } from 'react'
import { Clock3, Gamepad2, Loader2, Play, Home, Settings} from 'lucide-react'
import { getGameCoverPath } from '../services/ConfigManager'

interface LastPlayedCard {
  gameId: string
  name: string
  coverUrl?: string
  playedAt: string
  playtime?: string
}

interface SidebarProps {
  onGoHome: () => void
  onToggleSettings: () => void
  isHomeActive: boolean
  isSettingsActive: boolean
  lastPlayedCards: LastPlayedCard[]
  onPlayLastPlayed: (gameId: string) => void
  launchingGameId: string | null
  runningGameIds?: Set<string>
}

const formatLastPlayed = (playedAt: string) => {
  const playedAtMs = new Date(playedAt).getTime()
  if (Number.isNaN(playedAtMs)) {
    return 'Last played'
  }

  const diffMs = Date.now() - playedAtMs
  if (diffMs < 5 * 60 * 1000) {
    return 'Recently played'
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

  return 'Recently played'
}

/**
 * Sidebar component - navigation and settings controls
 * Params: onGoHome, onToggleSettings - navigation handlers
 * Returns: JSX.Element - sidebar UI
 */
const Sidebar = ({ onGoHome, onToggleSettings, isHomeActive, isSettingsActive, lastPlayedCards, onPlayLastPlayed, launchingGameId, runningGameIds }: SidebarProps) => {
  const [, setRefreshTick] = useState(0)
  const [resolvedCardImages, setResolvedCardImages] = useState<Record<string, string>>({})

  useEffect(() => {
    const loadResolvedImages = async () => {
      const resolved: Record<string, string> = {}
      for (const card of lastPlayedCards) {
        try {
          const coverPath = await getGameCoverPath(card.gameId)
          if (coverPath) {
            let filePath = coverPath.trim().replace(/\\/g, '/')
            if (!filePath.startsWith('file://')) {
              filePath = filePath[1] === ':' ? 'file:///' + filePath : 'file://' + filePath
            }
            resolved[card.gameId] = filePath
          } else if (card.coverUrl) {
            resolved[card.gameId] = card.coverUrl
          }
        } catch (error) {
          if (card.coverUrl) {
            resolved[card.gameId] = card.coverUrl
          }
        }
      }
      setResolvedCardImages(resolved)
    }
    loadResolvedImages()
  }, [lastPlayedCards])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setRefreshTick((prev) => prev + 1)
    }, 15 * 60 * 1000)

    return () => window.clearInterval(intervalId)
  }, [])

  const handleLastPlayedContextMenu = (event: React.MouseEvent<any>, gameId: string) => {
    event.preventDefault()
    event.stopPropagation()

    const targetCard = document.querySelector(`[data-game-id="${CSS.escape(gameId)}"]`) as HTMLElement | null
    if (!targetCard) {
      return
    }

    targetCard.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: event.clientX,
        clientY: event.clientY,
        button: 2,
      })
    )
  }

  return (
    <div className="relative w-64 flex flex-col overflow-hidden bg-steam-900">
      <div className="pointer-events-none absolute right-0 top-1/2 h-[90%] w-px -translate-y-1/2 bg-[#2b4157]" />
      {/* Header */}
      <div className="p-6 space-y-3 bg-steam-800">
        <div className="flex items-center justify-center gap-3">
          <Gamepad2 className="w-8 h-8 text-steam-400" />
          <h1 className="text-xl font-bold">Game Library</h1>
        </div>
      </div>

      <button
          type="button"
          onClick={onGoHome}
          disabled={isHomeActive}
          className={`mt-3 mx-3 px-4 py-2 rounded-lg transition-colors flex items-center justify-center gap-2 ${
          isHomeActive
              ? 'text-[#c8def2] bg-[#1a344b] font-semibold cursor-default'
              : 'text-white bg-[#2f79b1] ring-2 ring-[#86c6ff]/50 hover:bg-[#3a89c5]'
          }`}
      >
          <Home className="w-4 h-4" />
          Home
      </button>

      <div className="flex-1 overflow-auto px-3 py-3 space-y-2">
        {lastPlayedCards.length === 0 ? (
          <div className="rounded-md bg-steam-800/70 px-3 py-3 text-xs text-steam-400">
            No recently played games yet.
          </div>
        ) : (
          lastPlayedCards.map((card) => {
            const isLaunching = launchingGameId === card.gameId
            const isRunning = runningGameIds?.has(card.gameId) ?? false
            return (
              <div
                key={`${card.gameId}-${card.playedAt}`}
                className="group rounded-md bg-steam-800/75 hover:bg-steam-700/75 transition-colors p-2"
                onContextMenu={(event) => handleLastPlayedContextMenu(event, card.gameId)}
              >
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() => onPlayLastPlayed(card.gameId)}
                    disabled={launchingGameId !== null || isRunning}
                    className="relative w-10 h-14 rounded-md overflow-hidden shrink-0 disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#6ec1ff]/60"
                    aria-label={`Play ${card.name}`}
                    title={`Play ${card.name}`}
                  >
                    {resolvedCardImages[card.gameId] ? (
                      <img
                        src={resolvedCardImages[card.gameId]}
                        alt={card.name}
                        className="w-10 h-15 object-cover transition-all duration-200 saturate-75 brightness-90 group-hover:grayscale group-hover:brightness-75"
                      />
                    ) : (
                      <div className="w-10 h-14 bg-steam-700 inline-flex items-center justify-center">
                        <Gamepad2 className="w-4 h-4 text-steam-300" />
                      </div>
                    )}

                    <div className="absolute inset-0 bg-black/25 group-hover:bg-black/40 transition-colors" />
                    <div className="absolute inset-0 inline-flex items-center justify-center">
                      {isLaunching || isRunning ? (
                        <Loader2 className="w-4 h-4 animate-spin text-white" />
                      ) : (
                        <Play className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-150" />
                      )}
                    </div>
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm text-steam-100 truncate">{card.name}</p>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 text-[11px] text-[#4fd673]">
                      <Clock3 className="h-3 w-3" />
                      <span>{isRunning ? 'Currently playing' : formatLastPlayed(card.playedAt)}</span>
                    </div>
                    {card.playtime && (
                      <div className="mt-0.5 flex items-center gap-1 text-[11px] text-[#b1b1b1]">
                        <Gamepad2 className="h-3 w-3" />
                        <span>Total playtime: {card.playtime}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Bottom actions */}
      <div className="p-6 space-y-3 bg-steam-800/90">
        <button
          type="button"
          onClick={onToggleSettings}
          disabled={isSettingsActive}
          className={`w-full px-4 py-2 rounded-lg transition-colors flex items-center justify-center gap-2 ${
            isSettingsActive
              ? 'text-[#c8def2] bg-[#1a344b] font-semibold cursor-default'
              : 'text-white bg-[#2f79b1] ring-2 ring-[#86c6ff]/50 hover:bg-[#3a89c5]'
          }`}
        >
          <Settings className="w-4 h-4" />
          Settings
        </button>
      </div>
    </div>
  )
}

export default Sidebar
