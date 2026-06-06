import { useEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { FolderOpen, Gamepad2, Loader2, Play, Settings, Star, Trash2, LocateOff } from 'lucide-react'
import { exists } from '@tauri-apps/plugin-fs'
import { FaGamepad, FaLockOpen, FaMicrochip, FaUsers, FaVrCardboard, FaXbox } from 'react-icons/fa'
import { SiBattledotnet, SiEa, SiEpicgames, SiGogdotcom, SiSteam } from 'react-icons/si'
import { getGameCoverPath, loadGameConfig } from '../services/ConfigManager'
import type { Game, GameCardProps } from '../types/appTypes'
import { readFile } from '@tauri-apps/plugin-fs';

const specialTagsCache = new Map<string, string[]>()
const pendingTagSubscribers = new Map<string, Set<(tags: string[]) => void>>()
const pendingTagQueue: string[] = []
let activeTagLoads = 0
const MAX_CONCURRENT_TAG_LOADS = 4

const normalizeSpecialTags = (value: unknown): string[] => {
	if (!Array.isArray(value)) {
		return []
	}

	return value.filter((tag): tag is string => typeof tag === 'string')
}

const processSpecialTagQueue = () => {
	while (activeTagLoads < MAX_CONCURRENT_TAG_LOADS && pendingTagQueue.length > 0) {
		const nextGameId = pendingTagQueue.shift()
		if (!nextGameId) {
			continue
		}

		if (specialTagsCache.has(nextGameId)) {
			const cached = specialTagsCache.get(nextGameId) || []
			pendingTagSubscribers.get(nextGameId)?.forEach((listener) => listener(cached))
			pendingTagSubscribers.delete(nextGameId)
			continue
		}

		activeTagLoads += 1

		window.setTimeout(() => {
			void (async () => {
				try {
					const config = await loadGameConfig(nextGameId)
					const tags = normalizeSpecialTags((config as any)?.specialTags)
					specialTagsCache.set(nextGameId, tags)
					pendingTagSubscribers.get(nextGameId)?.forEach((listener) => listener(tags))
				} catch {
					specialTagsCache.set(nextGameId, [])
					pendingTagSubscribers.get(nextGameId)?.forEach((listener) => listener([]))
				} finally {
					pendingTagSubscribers.delete(nextGameId)
					activeTagLoads = Math.max(0, activeTagLoads - 1)
					processSpecialTagQueue()
				}
			})()
		}, 0)
	}
}

const subscribeToSpecialTags = (gameId: string, listener: (tags: string[]) => void) => {
	const cachedTags = specialTagsCache.get(gameId)
	if (cachedTags) {
		listener(cachedTags)
		return () => undefined
	}

	const existingListeners = pendingTagSubscribers.get(gameId)
	if (existingListeners) {
		existingListeners.add(listener)
	} else {
		pendingTagSubscribers.set(gameId, new Set([listener]))
		pendingTagQueue.push(gameId)
		processSpecialTagQueue()
	}

	return () => {
		const listeners = pendingTagSubscribers.get(gameId)
		if (!listeners) {
			return
		}

		listeners.delete(listener)
		if (listeners.size < 1) {
			pendingTagSubscribers.delete(gameId)
		}
	}
}

/**
 * GameCard component - displays a single game card with cover art
 * Params: game, onClick - game data and click handler
 * Returns: JSX.Element - card UI
 */
const GameCard = ({ game, onClick, onPlay, isPlayLoading = false, isRunning = false, isFavorite = false, onOpenFolder, onGameSettings, onDelete, onToggleFavorite, onSpecialTagsLoaded, cardHoverEffect = 'zoom' }: GameCardProps) => {
	const [isContextOpen, setIsContextOpen] = useState(false)
	const [contextPosition, setContextPosition] = useState({ x: 0, y: 0 })
	const [specialTags, setSpecialTags] = useState<string[]>([])
	const [displayCoverUrl, setDisplayCoverUrl] = useState<string | undefined>(game.coverUrl)
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

	useEffect(() => {
		let cancelled = false
		async function loadConfigAndResolveCover() {
			try {
				const coverPath = await getGameCoverPath(game.id)
				if (!cancelled) {
					if (coverPath) {
						setDisplayCoverUrl(coverPath);
					} else {
						setDisplayCoverUrl(game.coverUrl)
					}
				}
			} catch (error) {
				if (!cancelled) setDisplayCoverUrl(game.coverUrl)
			}
		}
		loadConfigAndResolveCover()
		return () => { cancelled = true }
	}, [game.id, game.coverUrl])


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
		return subscribeToSpecialTags(game.id, (tags) => {
			setSpecialTags(tags)
			onSpecialTagsLoaded?.(game.id, tags)
		})
	}, [game.id, onSpecialTagsLoaded])

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
					{displayCoverUrl ? (
						<img
							src={displayCoverUrl}
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
				<div className="absolute inset-0 z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none group-hover:scale-[1.025]">
					<div className="absolute inset-x-0 bottom-0 h-28 bg-linear-to-t from-black/85 via-black/35 to-transparent" />
					<div className="relative z-10 flex h-full flex-col justify-end p-3">
						<p className="text-white font-semibold text-sm line-clamp-2 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">{game.name}</p>
					</div>
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
