import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, FolderOpen, Gamepad2, Loader2, Play, Settings, Star, Trash2, X } from 'lucide-react'
import { readFile } from '@tauri-apps/plugin-fs'
import { formatPlaytime, getPlaytime } from '../services/PlaytimeManager'
import { getGameThumbnailPath } from '../services/ConfigManager'

interface QuickMenuProps {
	isOpen: boolean
	position: { x: number; y: number }
	gameId: string
	gameName: string
	thumbnailUrl?: string
	isPlayLoading?: boolean
	isRunning?: boolean
	isFavorite?: boolean
	onPlay?: () => Promise<void> | void
	onOpenFolder?: () => void
	onGameSettings?: () => void
	onDelete?: () => void
	onToggleFavorite?: () => Promise<void> | void
	onClose: () => void
}

const QuickMenu = ({
	isOpen,
	position,
	gameId,
	gameName,
	thumbnailUrl,
	isPlayLoading = false,
	isRunning = false,
	isFavorite = false,
	onPlay,
	onOpenFolder,
	onGameSettings,
	onDelete,
	onToggleFavorite,
	onClose,
}: QuickMenuProps) => {
	const menuRef = useRef<HTMLDivElement | null>(null)
	const [menuPosition, setMenuPosition] = useState(position)
	const [isPositioned, setIsPositioned] = useState(false)
	const [displayThumbnailUrl, setDisplayThumbnailUrl] = useState<string | undefined>(thumbnailUrl)
	const [totalPlaytime, setTotalPlaytime] = useState('0m')
	const [isDeleteConfirming, setIsDeleteConfirming] = useState(false)

	useEffect(() => {
		if (!isOpen) {
			return
		}

		let cancelled = false
		let localThumbnailUrl: string | undefined

		const loadMenuDetails = async () => {
			setDisplayThumbnailUrl(thumbnailUrl)
			try {
				const thumbnailPath = await getGameThumbnailPath(gameId)
				if (thumbnailPath) {
					const bytes = await readFile(thumbnailPath)
					const blob = new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' })
					localThumbnailUrl = URL.createObjectURL(blob)
					if (!cancelled) {
						setDisplayThumbnailUrl(localThumbnailUrl)
					}
				}
			} catch {}

			try {
				const playtimeMs = await getPlaytime(gameId)
				if (!cancelled) {
					setTotalPlaytime(formatPlaytime(playtimeMs))
				}
			} catch {
				if (!cancelled) {
					setTotalPlaytime('0m')
				}
			}
		}

		void loadMenuDetails()
		return () => {
			cancelled = true
			if (localThumbnailUrl) {
				URL.revokeObjectURL(localThumbnailUrl)
			}
		}
	}, [gameId, isOpen, thumbnailUrl])

	useEffect(() => {
		if (!isOpen) {
			return
		}

		const handleOutsidePointer = (event: MouseEvent | PointerEvent) => {
			const target = event.target as Node
			if (menuRef.current && !menuRef.current.contains(target)) {
				onClose()
			}
		}

		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				onClose()
			}
		}

		window.addEventListener('pointerdown', handleOutsidePointer)
		window.addEventListener('contextmenu', handleOutsidePointer)
		window.addEventListener('keydown', handleEscape)

		return () => {
			window.removeEventListener('pointerdown', handleOutsidePointer)
			window.removeEventListener('contextmenu', handleOutsidePointer)
			window.removeEventListener('keydown', handleEscape)
		}
	}, [isOpen, onClose])

	useLayoutEffect(() => {
		if (!isOpen) {
			return
		}

		const adjustPosition = () => {
			if (!menuRef.current) {
				return
			}

			const rect = menuRef.current.getBoundingClientRect()
			const padding = 12
			const nextX = Math.max(padding, Math.min(position.x, window.innerWidth - rect.width - padding))
			const nextY = Math.max(padding, Math.min(position.y, window.innerHeight - rect.height - padding))

			setMenuPosition({ x: nextX, y: nextY })
			setIsPositioned(true)
		}

		setIsPositioned(false)
		adjustPosition()
		window.addEventListener('resize', adjustPosition)

		return () => {
			window.removeEventListener('resize', adjustPosition)
		}
	}, [isOpen, position])

	if (!isOpen || typeof document === 'undefined') {
		return null
	}

	const handlePlay = async () => {
		if (!onPlay || isPlayLoading || isRunning) {
			return
		}

		await onPlay()
		onClose()
	}

	const handleAction = (action?: () => void) => {
		onClose()
		action?.()
	}

	const handleFavorite = async () => {
		if (!onToggleFavorite) {
			return
		}

		await onToggleFavorite()
	}

	const handleDelete = () => {
		if (!isDeleteConfirming) {
			setIsDeleteConfirming(true)
			return
		}

		onClose()
		onDelete?.()
	}

	return createPortal(
		<div
			ref={menuRef}
			className="fixed z-9999 w-52 rounded-lg bg-steam-800 ring-1 ring-steam-600 shadow-xl overflow-hidden divide-y divide-steam-700"
			style={{ left: `${menuPosition.x}px`, top: `${menuPosition.y}px`, visibility: isPositioned ? 'visible' : 'hidden' }}
		>
			<div className="relative border-b border-[#2a475e] bg-[#1b2838]">
				{displayThumbnailUrl ? (
					<img src={displayThumbnailUrl} alt="" className="block h-16 w-full object-cover" />
				) : (
					<div className="flex h-16 w-full items-center justify-center bg-steam-700 text-steam-400">
						<Gamepad2 className="h-5 w-5" />
					</div>
				)}
				<button
					type="button"
					onClick={() => void handleFavorite()}
					className="absolute right-0.5 top-0.5 inline-flex h-7 w-7 items-center justify-center rounded-md bg-black/15 text-white transition-all duration-150 hover:scale-110 hover:bg-black/25 active:scale-95"
					aria-label={isFavorite ? 'Remove from favorite' : 'Add to favorite'}
					title={isFavorite ? 'Remove from favorite' : 'Add to favorite'}
				>
					<Star className={`h-4 w-4 ${isFavorite ? 'fill-yellow-400 text-yellow-400' : 'text-white'}`} />
				</button>
				<div className="px-3 py-2">
					<p className="truncate text-sm font-semibold text-white" title={gameName}>{gameName}</p>
					<p className="mt-0.5 text-xs text-steam-400">{totalPlaytime} played in total</p>
				</div>
			</div>
			<div className="flex items-center gap-1 p-1">
				<button
					type="button"
					onClick={() => void handlePlay()}
					disabled={isPlayLoading || isRunning}
					className="theme-primary-action min-w-0 flex-[1.25] rounded-md bg-steam-600 px-3 py-2 text-left text-sm font-semibold text-white transition-colors duration-150 hover:bg-steam-500 active:bg-steam-400 disabled:cursor-not-allowed disabled:opacity-60 flex items-center gap-2"
				>
					{isPlayLoading || isRunning ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}
					{isPlayLoading ? 'Launching...' : isRunning ? 'Running' : 'Play'}
				</button>
				<button
					type="button"
					onClick={() => handleAction(onOpenFolder)}
					className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-steam-700 text-white transition-colors duration-150 hover:bg-steam-600 active:bg-steam-500"
					aria-label="Open Folder"
					title="Open Folder"
				>
					<FolderOpen className="h-5 w-5" />
				</button>
				<button
					type="button"
					onClick={() => handleAction(onGameSettings)}
					className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-steam-700 text-white transition-colors duration-150 hover:bg-steam-600 active:bg-steam-500"
					aria-label="Game Settings"
					title="Game Settings"
				>
					<Settings className="h-5 w-5" />
				</button>
			</div>
			<div className="p-1">
			{isDeleteConfirming ? (
				<div className="flex h-9 items-center gap-1 rounded-md bg-steam-700 px-2 text-xs text-red-300">
					<span className="min-w-0 flex-1 whitespace-nowrap">Delete this game?</span>
					<button
						type="button"
						onClick={handleDelete}
						className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-red-700 text-white transition-colors hover:bg-red-600 active:bg-red-500"
						aria-label="Confirm delete"
						title="Confirm delete"
					>
						<Check className="h-4 w-4" />
					</button>
					<button
						type="button"
						onClick={() => setIsDeleteConfirming(false)}
						className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#3a6285] text-white transition-colors hover:bg-[#4d7aa1] active:bg-[#5b8bb2]"
						aria-label="Cancel delete"
						title="Cancel delete"
					>
						<X className="h-4 w-4" />
					</button>
				</div>
			) : (
				<button
					type="button"
					onClick={handleDelete}
					className="w-full rounded-md px-3 py-2 text-left text-sm font-semibold text-red-300 bg-steam-700 hover:bg-steam-600 active:bg-steam-500 transition-colors duration-150 flex items-center gap-2"
				>
					<Trash2 className="h-5 w-5 text-red-400" />
					Delete
				</button>
			)}
			</div>
		</div>,
		document.body,
	)
}

export default QuickMenu
