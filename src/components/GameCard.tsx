import { useEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { FolderOpen, Gamepad2, Loader2, Play, Settings, Star, Trash2, LocateOff } from 'lucide-react'
import { exists } from '@tauri-apps/plugin-fs'
import { FaGamepad, FaLockOpen, FaMicrochip, FaUsers, FaVrCardboard, FaXbox } from 'react-icons/fa'
import { SiBattledotnet, SiEa, SiEpicgames, SiGogdotcom, SiSteam } from 'react-icons/si'
import { loadGameConfig } from '../services/ConfigManager'

interface Game {
  id: string
  name: string
  path: string
  platform: string
  coverUrl?: string
  thumbnailUrl?: string
  size?: number
}

interface GameCardProps {
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
  cardHoverEffect?: string
}

/**
 * GameCard component - displays a single game card with cover art
 * Params: game, onClick - game data and click handler
 * Returns: JSX.Element - card UI
 */
const GameCard = ({ game, onClick, onPlay, isPlayLoading = false, isRunning = false, isFavorite = false, onOpenFolder, onGameSettings, onDelete, onToggleFavorite, cardHoverEffect = 'zoom' }: GameCardProps) => {
  const [isContextOpen, setIsContextOpen] = useState(false)
  const [contextPosition, setContextPosition] = useState({ x: 0, y: 0 })
  const [specialTags, setSpecialTags] = useState<string[]>([])
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [isMissing, setIsMissing] = useState<boolean>(false)

  const getHoverEffectClasses = () => {
    switch (cardHoverEffect) {
      case 'grow':
        return 'group-hover:scale-[1.15] origin-center'
      case 'shine':
        return 'shine-card'
      case 'spin':
        return 'spin-card'
      case 'zoom':
      default:
        return ''
    }
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


  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.target as HTMLImageElement
    img.style.display = 'none'
  }

  useEffect(() => {
    if (!isContextOpen) {
      return
    }

    const handleOutsidePointer = (event: MouseEvent | PointerEvent) => {
      const target = event.target as Node
      if (menuRef.current && !menuRef.current.contains(target)) {
        setIsContextOpen(false)
      }
    }

    const handleOutsideRightClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (menuRef.current && !menuRef.current.contains(target)) {
        setIsContextOpen(false)
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsContextOpen(false)
      }
    }

    window.addEventListener('pointerdown', handleOutsidePointer)
    window.addEventListener('contextmenu', handleOutsideRightClick)
    window.addEventListener('keydown', handleEscape)

    return () => {
      window.removeEventListener('pointerdown', handleOutsidePointer)
      window.removeEventListener('contextmenu', handleOutsideRightClick)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [isContextOpen])

  useEffect(() => {
    if (!isContextOpen) {
      return
    }

    const adjustPosition = () => {
      if (!menuRef.current) {
        return
      }

      const rect = menuRef.current.getBoundingClientRect()
      const padding = 12

      setContextPosition((prev) => {
        let nextX = prev.x
        let nextY = prev.y

        if (nextX + rect.width > window.innerWidth - padding) {
          nextX = Math.max(padding, window.innerWidth - rect.width - padding)
        }

        if (nextY + rect.height > window.innerHeight - padding) {
          nextY = Math.max(padding, window.innerHeight - rect.height - padding)
        }

        if (nextX === prev.x && nextY === prev.y) {
          return prev
        }

        return { x: nextX, y: nextY }
      })
    }

    const frame = window.requestAnimationFrame(adjustPosition)
    window.addEventListener('resize', adjustPosition)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', adjustPosition)
    }
  }, [isContextOpen])

  useEffect(() => {
    const loadSpecialTags = async () => {
      try {
        const config = await loadGameConfig(game.id)
        const tags = Array.isArray((config as any)?.specialTags) ? (config as any).specialTags : []
        setSpecialTags(tags.filter((tag: unknown) => typeof tag === 'string'))
      } catch {
        setSpecialTags([])
      }
    }

    void loadSpecialTags()
  }, [game.id])

  const tagVisuals: Record<string, { label: string; className: string; icon: ReactElement }> = {
    steam: {
      label: 'STEAM',
      className: 'bg-[#1d3961] text-white',
      icon: <SiSteam className="w-3.5 h-3.5" />,
    },
    gog: {
      label: 'GOG',
      className: 'bg-[#86328a] text-white',
      icon: <SiGogdotcom className="w-3.5 h-3.5" />,
    },
    epic: {
      label: 'EPIC GAMES',
      className: 'bg-black text-white',
      icon: <SiEpicgames className="w-3.5 h-3.5" />,
    },
    'battle.net': {
      label: 'BATTLE.NET',
      className: 'bg-[#0b2b4a] text-white',
      icon: <SiBattledotnet className="w-3.5 h-3.5" />,
    },
    ea: {
      label: 'EA',
      className: 'bg-[#ff4747] text-white',
      icon: <SiEa className="w-3.5 h-3.5" />,
    },
    xbox: {
      label: 'XBOX',
      className: 'bg-[#107c10] text-white',
      icon: <FaXbox className="w-3.5 h-3.5" />,
    },
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

  const visibleTags = specialTags.filter((tag) => tagVisuals[tag])

  const handleContextMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()

    setContextPosition({
      x: event.clientX,
      y: event.clientY,
    })
    setIsContextOpen(true)
  }

  const handleAction = (action?: (selectedGame: Game) => void) => {
    setIsContextOpen(false)
    action?.(game)
  }

  const handlePlayAction = async () => {
    if (!onPlay || isPlayLoading || isRunning) {
      return
    }

    await onPlay(game)
    setIsContextOpen(false)
  }

  const handleFavoriteAction = async () => {
    if (!onToggleFavorite) {
      return
    }

    await onToggleFavorite(game)
    setIsContextOpen(false)
  }

  return (
    <>
      <button
        onClick={onClick}
        onContextMenu={handleContextMenu}
        data-game-id={game.id}
        className={`group relative w-full aspect-2/3 rounded-lg overflow-hidden bg-steam-800 ring-1 ring-inset ring-steam-600/35 shadow-[0_6px_18px_rgba(0,0,0,0.28)] transition-all duration-200 hover:ring-steam-400/55 hover:shadow-[0_10px_28px_rgba(58,98,133,0.28)] cursor-pointer ${getHoverEffectClasses()}`}
      >
        {visibleTags.length > 0 && (
          <div className="absolute top-2 right-2 z-10 flex items-center justify-end gap-1">
            {visibleTags.map((tag) => {
              const visual = tagVisuals[tag]
              return (
                <span
                  key={tag}
                  className={`w-6 h-6 rounded-md inline-flex items-center justify-center shadow-md ${visual.className}`}
                  title={visual.label}
                  aria-label={visual.label}
                >
                  {visual.icon}
                </span>
              )
            })}
          </div>
        )}

        {/* Cover Art */}

        <div className="relative w-full h-full">
          {game.coverUrl ? (
            <img
              src={game.coverUrl}
              alt={game.name}
              onError={handleImageError}
              className={`w-full h-full object-cover transition-transform duration-200 ${cardHoverEffect === 'zoom' || cardHoverEffect === 'shine' ? 'group-hover:scale-105' : ''} ${isMissing ? 'grayscale opacity-60' : ''}`}
            />
          ) : (
            <div className={`w-full h-full bg-linear-to-br from-steam-700 to-steam-800 flex items-center justify-center ${isMissing ? 'grayscale opacity-60' : ''}`}>
              <Gamepad2 className="w-12 h-12 text-steam-500" />
            </div>
          )}
          {isMissing && (
            <>
              <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
                <LocateOff className="w-10 h-10 text-steam-400 drop-shadow-lg" />
              </div>
            </>
          )}
        </div>

        {/* Overlay */}
        <div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col justify-end p-3">
          <p className="text-white font-semibold text-sm line-clamp-2">{game.name}</p>
        </div>
      </button>

      {isContextOpen && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          className="fixed z-9999 w-52 rounded-lg bg-[#1b2838]! border border-[#2a475e] shadow-xl overflow-hidden divide-y divide-[#2a475e]"
          style={{ left: `${contextPosition.x}px`, top: `${contextPosition.y}px` }}
        >
          <button
            type="button"
            onClick={() => void handlePlayAction()}
            disabled={isPlayLoading || isRunning}
            className="w-full px-3 py-2 text-left text-sm text-white bg-[#2a475e]! hover:bg-[#3a6285]! active:bg-[#4d7aa1]! disabled:opacity-60 disabled:cursor-not-allowed transition-colors duration-150 flex items-center gap-2"
          >
            {isPlayLoading || isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {isPlayLoading ? 'Launching...' : isRunning ? 'Running' : 'Play'}
          </button>
          <button
            type="button"
            onClick={() => handleAction(onOpenFolder)}
            className="w-full px-3 py-2 text-left text-sm text-white bg-[#2a475e]! hover:bg-[#3a6285]! active:bg-[#4d7aa1]! transition-colors duration-150 flex items-center gap-2"
          >
            <FolderOpen className="w-4 h-4" />
            Open Folder
          </button>
          <button
            type="button"
            onClick={() => handleAction(onGameSettings || onClick)}
            className="w-full px-3 py-2 text-left text-sm text-white bg-[#2a475e]! hover:bg-[#3a6285]! active:bg-[#4d7aa1]! transition-colors duration-150 flex items-center gap-2"
          >
            <Settings className="w-4 h-4" />
            Game Settings
          </button>
          <button
            type="button"
            onClick={() => void handleFavoriteAction()}
            className="w-full px-3 py-2 text-left text-sm text-white bg-[#2a475e]! hover:bg-[#3a6285]! active:bg-[#4d7aa1]! transition-colors duration-150 flex items-center gap-2"
          >
            <Star className={`w-4 h-4 ${isFavorite ? 'text-yellow-400 fill-yellow-400' : 'text-steam-400'}`} />
            {isFavorite ? 'Remove from favorite' : 'Add to favorite'}
          </button>
          <button
            type="button"
            onClick={() => handleAction(onDelete)}
            className="w-full px-3 py-2 text-left text-sm text-white bg-[#8b1f1f]! hover:bg-[#a62d2d]! active:bg-[#c94343]! transition-colors duration-150 flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        </div>
      , document.body)}
    </>
  )
}

export default GameCard
