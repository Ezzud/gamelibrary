import { useEffect, useState, type ReactElement } from 'react'
import { Gamepad2, LocateOff } from 'lucide-react'
import { exists } from '@tauri-apps/plugin-fs'
import { FaGamepad, FaLockOpen, FaMicrochip, FaUsers, FaVrCardboard, FaXbox } from 'react-icons/fa'
import { SiBattledotnet, SiEa, SiEpicgames, SiGogdotcom, SiSteam } from 'react-icons/si'
import { getGameCoverPath, loadGameConfig } from '../services/ConfigManager'
import type { GameCardProps } from '../types/appTypes'
import { readFile } from '@tauri-apps/plugin-fs';
import QuickMenu from './QuickMenu'

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
const GameCard = ({ game, onClick, onPlay, isPlayLoading = false, isRunning = false, isFavorite = false, onOpenFolder, onGameSettings, onDelete, onToggleFavorite, onSpecialTagsLoaded, cardHoverEffect = 'zoom', displayCover }: GameCardProps) => {
	const [isContextOpen, setIsContextOpen] = useState(false)
	const [contextPosition, setContextPosition] = useState({ x: 0, y: 0 })
	const [specialTags, setSpecialTags] = useState<string[]>([])
	const [displayCoverUrl, setDisplayCoverUrl] = useState<string | undefined>(displayCover || game.coverUrl)
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
				if(displayCover) {
					return;
				}
				const coverPath = await getGameCoverPath(game.id)
				if (!cancelled) {
					if (coverPath) {
						const bytes = await readFile(coverPath);

						const blob = new Blob([new Uint8Array(bytes)], {
							type: 'image/jpeg',
						});
						const url = URL.createObjectURL(blob);
						setDisplayCoverUrl(url);
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

			<QuickMenu
				isOpen={isContextOpen}
				position={contextPosition}
				gameId={game.id}
				gameName={game.name}
				thumbnailUrl={game.thumbnailUrl}
				isPlayLoading={isPlayLoading}
				isRunning={isRunning}
				isFavorite={isFavorite}
				onPlay={onPlay ? () => onPlay(game) : undefined}
				onOpenFolder={() => onOpenFolder?.(game)}
				onGameSettings={() => (onGameSettings || onClick)(game)}
				onDelete={() => onDelete?.(game)}
				onToggleFavorite={onToggleFavorite ? () => onToggleFavorite(game) : undefined}
				onClose={() => setIsContextOpen(false)}
			/>
		</>
	)
}

export default GameCard
