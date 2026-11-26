import { useEffect, useState } from 'react'
import { Clock3, Gamepad2, Loader2, Play, Home, Settings } from 'lucide-react'
import { getGameCoverPath } from '../services/ConfigManager'
import type { SidebarProps } from '../types/appTypes'
import { readFile } from '@tauri-apps/plugin-fs'
import { useLanguage } from '../lang/LanguageContext'

const formatLastPlayed = (playedAt: string, t: (key: string) => string) => {
	const playedAtMs = new Date(playedAt).getTime()
	if (Number.isNaN(playedAtMs)) {
		return t('playtime.lastPlayed')
	}

	const diffMs = Date.now() - playedAtMs
	if (diffMs < 5 * 60 * 1000) {
		return t('playtime.recentlyPlayed')
	}

	const units = [
		{ label: 'years', ms: 365 * 24 * 60 * 60 * 1000 },
		{ label: 'months', ms: 30 * 24 * 60 * 60 * 1000 },
		{ label: 'weeks', ms: 7 * 24 * 60 * 60 * 1000 },
		{ label: 'days', ms: 24 * 60 * 60 * 1000 },
		{ label: 'hours', ms: 60 * 60 * 1000 },
		{ label: 'minutes', ms: 60 * 1000 },
	]

	for (const unit of units) {
		if (diffMs >= unit.ms) {
			const value = Math.floor(diffMs / unit.ms)
			return t('playtime.lastPlayedAgo').replace('{value}', String(value)).replace('{unit}', t(`playtime.${unit.label}`)).replace('{plural}', value > 1 ? 's' : '')
		}
	}

	return t('playtime.recentlyPlayed')
}

/**
 * Sidebar component - navigation and settings controls
 * Params: onGoHome, onToggleSettings - navigation handlers
 * Returns: JSX.Element - sidebar UI
 */
const Sidebar = ({ onGoHome, onToggleSettings, isHomeActive, isSettingsActive, lastPlayedCards, onPlayLastPlayed, launchingGameId, runningGameIds }: SidebarProps) => {
	const { t } = useLanguage()
	const [, setRefreshTick] = useState(0)
	const [resolvedCardImages, setResolvedCardImages] = useState<Record<string, string>>({})

	useEffect(() => {
		const loadResolvedImages = async () => {
			const resolved: Record<string, string> = {}
			for (const card of lastPlayedCards) {
				try {
					const coverPath = await getGameCoverPath(card.gameId)
					if (coverPath) {
						const bytes = await readFile(coverPath);

						const blob = new Blob([new Uint8Array(bytes)], {
							type: 'image/jpeg',
						});
						const url = URL.createObjectURL(blob);
						resolved[card.gameId] = url
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
			<div className="p-6 space-y-3 bg-steam-900">
				<div className="flex items-center justify-center gap-3">
					<Gamepad2 className="w-8 h-8 text-steam-400" />
					<h1 className="text-xl font-bold">{t('sidebar.gameLibrary')}</h1>
				</div>
			</div>

			<button
				type="button"
				onClick={onGoHome}
				disabled={isHomeActive}
				data-controller-selectable="true"
				data-controller-home="true"
				data-controller-action="home"
				className={`${!isHomeActive ? 'theme-primary-action font-semibold' : ''} mt-3 mx-3 px-4 py-2 rounded-lg transition-colors flex items-center justify-center gap-2 ${isHomeActive
						? 'text-[#c8def2] bg-[#1a344b] font-semibold cursor-default'
						: 'text-white bg-[#2f79b1] ring-2 ring-[#86c6ff]/50 hover:bg-[#3a89c5]'
					}`}
			>
				<Home className="w-4 h-4" />
				{t('sidebar.home')}
			</button>

			<div className="flex-1 overflow-auto px-3 py-3 space-y-2">
				{lastPlayedCards.length === 0 ? (
					<div className="rounded-md bg-steam-800/70 px-3 py-3 text-xs text-steam-400">
						{t('sidebar.noRecentGames')}
					</div>
				) : (
					lastPlayedCards.map((card) => {
						const isLaunching = launchingGameId === card.gameId
						const isRunning = runningGameIds?.has(card.gameId) ?? false
						return (
							<div
								key={`${card.gameId}-${card.playedAt}`}
										className="theme-secondary-surface group rounded-md bg-steam-800/75 hover:bg-steam-700/75 transition-colors p-2"
									data-controller-selectable="true"
									data-controller-action="launch"
									data-controller-sidebar-card="true"
									onClick={(event) => {
										if (event.target === event.currentTarget) {
											onPlayLastPlayed(card.gameId)
										}
									}}
								onContextMenu={(event) => handleLastPlayedContextMenu(event, card.gameId)}
							>
								<div className="flex items-start gap-2">
									<button
										type="button"
										onClick={() => onPlayLastPlayed(card.gameId)}
										disabled={launchingGameId !== null || isRunning}
										className="relative w-10 h-14 rounded-md overflow-hidden shrink-0 disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#6ec1ff]/60"
										aria-label={t('sidebar.playGame').replace('{game}', card.name)}
										title={t('sidebar.playGame').replace('{game}', card.name)}
									>
										{resolvedCardImages[card.gameId] ? (
											<img
												src={resolvedCardImages[card.gameId]}
												alt={card.name}
														className="controller-selection-sidebar-image w-10 h-15 object-cover transition-all duration-200 saturate-75 brightness-90 group-hover:grayscale group-hover:brightness-75"
											/>
										) : (
											<div className="w-10 h-14 bg-steam-700 inline-flex items-center justify-center">
												<Gamepad2 className="w-4 h-4 text-steam-300" />
											</div>
										)}

										<div className="controller-selection-sidebar-overlay absolute inset-0 bg-black/25 group-hover:bg-black/40 transition-colors" />
										<div className="absolute inset-0 inline-flex items-center justify-center">
											{isLaunching || isRunning ? (
												<Loader2 className="w-4 h-4 animate-spin text-white" />
											) : (
														<Play className="controller-selection-sidebar-play w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-150" />
											)}
										</div>
									</button>

									<div className="min-w-0 flex-1">
										<div className="flex items-center justify-between gap-2">
											<p className="text-sm text-steam-100 truncate">{card.name}</p>
										</div>
										<div className="mt-0.5 flex items-center gap-1 text-[11px] text-[#4fd673]">
											<Clock3 className="h-3 w-3" />
											<span>{isRunning ? t('playtime.currentlyPlaying') : formatLastPlayed(card.playedAt, t)}</span>
										</div>
										{card.playtime && (
											<div className="mt-0.5 flex items-center gap-1 text-[11px] text-[#b1b1b1]">
												<Gamepad2 className="h-3 w-3" />
												<span>{t('playtime.totalPlaytime').replace('{playtime}', card.playtime)}</span>
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
					className={`${!isSettingsActive ? 'theme-primary-action font-semibold' : ''} w-full px-4 py-2 rounded-lg transition-colors flex items-center justify-center gap-2 ${isSettingsActive
							? 'text-[#c8def2] bg-[#1a344b] font-semibold cursor-default'
							: 'text-white bg-[#2f79b1] ring-2 ring-[#86c6ff]/50 hover:bg-[#3a89c5]'
						}`}
				>
					<Settings className="w-4 h-4" />
					{t('common.settings')}
				</button>
			</div>
		</div>
	)
}

export default Sidebar
