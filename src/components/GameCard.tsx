import { useEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { FolderOpen, Gamepad2, Loader2, Play, Settings, Trash2 } from 'lucide-react'
import { FaGamepad, FaLockOpen, FaMicrochip, FaUsers, FaVrCardboard } from 'react-icons/fa'
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
  onOpenFolder?: (game: Game) => void
  onGameSettings?: (game: Game) => void
  onDelete?: (game: Game) => void
}

/**
 * GameCard component - displays a single game card with cover art
 * Params: game, onClick - game data and click handler
 * Returns: JSX.Element - card UI
 */
const GameCard = ({ game, onClick, onPlay, isPlayLoading = false, onOpenFolder, onGameSettings, onDelete }: GameCardProps) => {
  const [isContextOpen, setIsContextOpen] = useState(false)
  const [contextPosition, setContextPosition] = useState({ x: 0, y: 0 })
  const [specialTags, setSpecialTags] = useState<string[]>([])
  const menuRef = useRef<HTMLDivElement | null>(null)

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
    if (!onPlay || isPlayLoading) {
      return
    }

    await onPlay(game)
    setIsContextOpen(false)
  }

  return (
    <>
      <button
        onClick={onClick}
        onContextMenu={handleContextMenu}
        className="group relative w-full aspect-[2/3] rounded-lg overflow-hidden bg-steam-800 ring-1 ring-inset ring-steam-600/35 shadow-[0_6px_18px_rgba(0,0,0,0.28)] transition-all duration-200 hover:ring-steam-400/55 hover:shadow-[0_10px_28px_rgba(58,98,133,0.28)] cursor-pointer"
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
        {game.coverUrl ? (
          <img
            src={game.coverUrl}
            alt={game.name}
            onError={handleImageError}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-steam-700 to-steam-800 flex items-center justify-center">
            <Gamepad2 className="w-12 h-12 text-steam-500" />
          </div>
        )}

        {/* Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col justify-end p-3">
          <p className="text-white font-semibold text-sm line-clamp-2">{game.name}</p>
        </div>
      </button>

      {isContextOpen && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[9999] w-52 rounded-lg !bg-[#1b2838] border border-[#2a475e] shadow-xl overflow-hidden divide-y divide-[#2a475e]"
          style={{ left: `${contextPosition.x}px`, top: `${contextPosition.y}px` }}
        >
          <button
            type="button"
            onClick={() => void handlePlayAction()}
            disabled={isPlayLoading}
            className="w-full block px-3 py-2 text-left text-sm text-white !bg-[#2a475e] hover:!bg-[#3a6285] active:!bg-[#4d7aa1] disabled:opacity-60 disabled:cursor-not-allowed transition-colors duration-150 flex items-center gap-2"
          >
            {isPlayLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {isPlayLoading ? 'Launching...' : 'Play'}
          </button>
          <button
            type="button"
            onClick={() => handleAction(onOpenFolder)}
            className="w-full block px-3 py-2 text-left text-sm text-white !bg-[#2a475e] hover:!bg-[#3a6285] active:!bg-[#4d7aa1] transition-colors duration-150 flex items-center gap-2"
          >
            <FolderOpen className="w-4 h-4" />
            Open Folder
          </button>
          <button
            type="button"
            onClick={() => handleAction(onGameSettings || onClick)}
            className="w-full block px-3 py-2 text-left text-sm text-white !bg-[#2a475e] hover:!bg-[#3a6285] active:!bg-[#4d7aa1] transition-colors duration-150 flex items-center gap-2"
          >
            <Settings className="w-4 h-4" />
            Game Settings
          </button>
          <button
            type="button"
            onClick={() => handleAction(onDelete)}
            className="w-full block px-3 py-2 text-left text-sm text-white !bg-[#8b1f1f] hover:!bg-[#a62d2d] active:!bg-[#c94343] transition-colors duration-150 flex items-center gap-2"
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
