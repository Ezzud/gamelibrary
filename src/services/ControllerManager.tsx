import { useEffect, useRef } from 'react'
import { playControllerSound } from './ControllerSounds'
import type { ShowToast } from '../types/appTypes'
import { Logger } from '../utils/Logger'

type ControllerManagerProps = {
	children: React.ReactNode
	onGoHome: () => void
	onShowToast: ShowToast
}

type ControllerButtonState = { pressed: boolean }
type PendingSelection =
	| { type: 'home' }
	| { type: 'game'; gameId: string }
	| { type: 'detail-play' }
	| { type: 'menu-trigger'; menuId: string }

const SELECTABLE_SELECTOR = '[data-controller-selectable="true"]'
const DEAD_ZONE = 0.35

const getSelectableElements = () => {
	const modal = document.querySelector<HTMLElement>('[data-controller-modal="true"]')
	const scope = modal || document
	return Array.from(scope.querySelectorAll<HTMLElement>(SELECTABLE_SELECTOR))
}

const getDirection = (gamepad: Gamepad) => {
	if (gamepad.buttons[12]?.pressed || gamepad.axes[1] < -DEAD_ZONE) return 'up'
	if (gamepad.buttons[13]?.pressed || gamepad.axes[1] > DEAD_ZONE) return 'down'
	if (gamepad.buttons[14]?.pressed || gamepad.axes[0] < -DEAD_ZONE) return 'left'
	if (gamepad.buttons[15]?.pressed || gamepad.axes[0] > DEAD_ZONE) return 'right'
	return null
}

const getControllerDisplayName = (gamepad: Gamepad) => {
	const rawId = gamepad.id.trim()
	const normalizedId = rawId.toLowerCase()

	if (normalizedId.includes('xbox') || normalizedId.includes('045e') || normalizedId.includes('028e')) {
		if (normalizedId.includes('series x') || normalizedId.includes('series s') || normalizedId.includes('0b12') || normalizedId.includes('0b13')) {
			return 'Xbox Series X Controller'
		}
		return 'Xbox Controller'
	}

	if (normalizedId.includes('dualshock') || normalizedId.includes('054c') || normalizedId.includes('sony')) {
		return normalizedId.includes('dualsense') || normalizedId.includes('0ce6')
			? 'PlayStation 5 Controller'
			: 'PlayStation Controller'
	}

	if (normalizedId.includes('switch') || normalizedId.includes('057e') || normalizedId.includes('nintendo')) {
		return 'Nintendo Controller'
	}

	if (normalizedId.includes('steam controller') || normalizedId.includes('28de')) {
		return 'Steam Controller'
	}

	return rawId
}

const distanceForDirection = (current: DOMRect, candidate: DOMRect, direction: string) => {
	const currentX = current.left + current.width / 2
	const currentY = current.top + current.height / 2
	const candidateX = candidate.left + candidate.width / 2
	const candidateY = candidate.top + candidate.height / 2
	const deltaX = candidateX - currentX
	const deltaY = candidateY - currentY

	if (direction === 'up' && deltaY >= -1) return null
	if (direction === 'down' && deltaY <= 1) return null
	if (direction === 'left' && deltaX >= -1) return null
	if (direction === 'right' && deltaX <= 1) return null

	const primary = direction === 'up' || direction === 'down' ? Math.abs(deltaY) : Math.abs(deltaX)
	const secondary = direction === 'up' || direction === 'down' ? Math.abs(deltaX) : Math.abs(deltaY)
	return primary + secondary * 1.8
}

const ControllerManager = ({ children, onGoHome, onShowToast }: ControllerManagerProps) => {
	const selectedIndexRef = useRef(0)
	const selectedElementRef = useRef<HTMLElement | null>(null)
	const onGoHomeRef = useRef(onGoHome)
	const onShowToastRef = useRef(onShowToast)
	const previousButtonsRef = useRef<ControllerButtonState[]>([])
	const previousDirectionRef = useRef<string | null>(null)
	const connectedGamepadsRef = useRef(new Set<string>())
	const frameRef = useRef<number | null>(null)
	const handlingStartedRef = useRef(false)
	const pendingSelectionRef = useRef<PendingSelection | null>(null)
	const modalSourceRef = useRef<PendingSelection | null>(null)
	const controllerNamesRef = useRef(new Map<string, string>())

	useEffect(() => {
		onGoHomeRef.current = onGoHome
		onShowToastRef.current = onShowToast
	}, [onGoHome, onShowToast])

	useEffect(() => {
		const getScrollParent = (element: HTMLElement) => {
			let parent = element.parentElement
			while (parent && parent !== document.body) {
				const style = window.getComputedStyle(parent)
				if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && parent.scrollHeight > parent.clientHeight) {
					return parent
				}
				parent = parent.parentElement
			}
			return document.scrollingElement as HTMLElement | null
		}

		const scrollSelectionIntoView = (element: HTMLElement, direction?: string) => {
			const parent = getScrollParent(element)
			if (!parent) return
			const elementRect = element.getBoundingClientRect()
			const parentRect = parent === document.scrollingElement
				? { top: 0, bottom: window.innerHeight }
				: parent.getBoundingClientRect()
			const toolbarBottom = Array.from(document.querySelectorAll<HTMLElement>('[data-controller-top="true"]'))
				.filter((topElement) => getScrollParent(topElement) === parent)
				.reduce((bottom, topElement) => Math.max(bottom, topElement.getBoundingClientRect().bottom), parentRect.top)
			const visibleTop = Math.max(parentRect.top, toolbarBottom)
			const gameCards = Array.from(document.querySelectorAll<HTMLElement>('[data-controller-selectable="true"][data-game-id]'))
			const sidebarCards = Array.from(document.querySelectorAll<HTMLElement>('[data-controller-sidebar-card="true"]'))
			const firstGameRow = element.dataset.gameId && gameCards.length > 0 && gameCards.every((card) => card.getBoundingClientRect().top >= elementRect.top - 12)
			const firstSidebarCard = element.dataset.controllerSidebarCard === 'true' && sidebarCards[0] === element

			if (firstSidebarCard) {
				parent.scrollTo({ top: 0, behavior: 'smooth' })
				return
			}

			if (firstGameRow && direction === 'up') {
				parent.scrollTo({ top: 0, behavior: 'smooth' })
				return
			}

			const padding = direction === 'down' ? 36 : direction === 'up' ? 82 : 16
			const topOverflow = elementRect.top - (visibleTop + padding)
			const bottomOverflow = elementRect.bottom - (parentRect.bottom - padding)
			if (topOverflow < 0) {
				parent.scrollBy({ top: topOverflow, behavior: 'smooth' })
			} else if (bottomOverflow > 0) {
				parent.scrollBy({ top: bottomOverflow, behavior: 'smooth' })
			}
		}

		const setSelected = (nextIndex: number, playSound = true, direction?: string) => {
			const elements = getSelectableElements()
			if (elements.length === 0) return
			const index = Math.max(0, Math.min(nextIndex, elements.length - 1))
			elements.forEach((element, elementIndex) => {
				element.classList.toggle('controller-selected', elementIndex === index)
			})
			selectedElementRef.current = elements[index]
			selectedIndexRef.current = index
			scrollSelectionIntoView(elements[index], direction)
			if (playSound) playControllerSound('selection')
		}

		const selectDefault = () => {
			const elements = getSelectableElements()
			const homeIndex = elements.findIndex((element) => element.dataset.controllerHome === 'true')
			setSelected(homeIndex >= 0 ? homeIndex : 0, false)
		}

		const selectPendingTarget = () => {
			const pending = pendingSelectionRef.current
			if (!pending) return false

			const target = pending.type === 'home'
				? document.querySelector<HTMLElement>('[data-controller-home="true"]')
				: pending.type === 'game'
					? document.querySelector<HTMLElement>(`[data-game-id="${CSS.escape(pending.gameId)}"]`)
					: pending.type === 'detail-play'
						? document.querySelector<HTMLElement>('[data-controller-detail-play="true"]')
						: document.querySelector<HTMLElement>(`[data-controller-menu-trigger="${CSS.escape(pending.menuId)}"]`)
			if (!target) return false

			const elements = getSelectableElements()
			const targetIndex = elements.indexOf(target)
			if (targetIndex < 0) return false
			setSelected(targetIndex, false)
			pendingSelectionRef.current = null
			return true
		}

		const clearSelection = () => {
			if (document.body.classList.contains('controller-mode-active')) {
				Logger.info('Controller input system deactivated.')
			}
			getSelectableElements().forEach((element) => element.classList.remove('controller-selected'))
			selectedElementRef.current = null
			document.body.classList.remove('controller-mode-active')
			handlingStartedRef.current = false
		}

		const activateControllerMode = () => {
			if (!handlingStartedRef.current) {
				handlingStartedRef.current = true
				document.body.classList.add('controller-mode-active')
				Logger.info('Controller input system activated.')
				selectDefault()
			}
		}

		const hasControllerInput = (gamepad: Gamepad) => {
			return gamepad.buttons.some((button) => button.pressed) || gamepad.axes.some((axis) => Math.abs(axis) > DEAD_ZONE)
		}

		const getVisibleElements = (selector: string) => Array.from(document.querySelectorAll<HTMLElement>(selector)).filter((element) => {
			const rect = element.getBoundingClientRect()
			return rect.width > 0 && rect.height > 0
		})

		const selectDirectionalItem = (items: HTMLElement[], current: HTMLElement, direction: string) => {
			const currentIndex = items.indexOf(current)
			if (currentIndex < 0) return false
			const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
			if (nextIndex < 0 || nextIndex >= items.length) return false
			const elements = getSelectableElements()
			const targetIndex = elements.indexOf(items[nextIndex])
			if (targetIndex < 0) return false
			setSelected(targetIndex, true, direction)
			return true
		}

		const moveGameCard = (current: HTMLElement, direction: string) => {
			const cards = getVisibleElements('[data-controller-selectable="true"][data-game-id]')
			const currentRect = current.getBoundingClientRect()
			const rows: HTMLElement[][] = []
			cards.sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top || left.getBoundingClientRect().left - right.getBoundingClientRect().left)
			cards.forEach((card) => {
				const cardTop = card.getBoundingClientRect().top
				const row = rows.find((candidateRow) => Math.abs(candidateRow[0].getBoundingClientRect().top - cardTop) < 12)
				if (row) row.push(card)
				else rows.push([card])
			})
			rows.forEach((row) => row.sort((left, right) => left.getBoundingClientRect().left - right.getBoundingClientRect().left))
			const rowIndex = rows.findIndex((row) => row.includes(current))
			if (rowIndex < 0) return true
			const row = rows[rowIndex]
			const columnIndex = row.indexOf(current)

			if (direction === 'left' || direction === 'right') {
				const nextColumn = columnIndex + (direction === 'left' ? -1 : 1)
				if (nextColumn >= 0 && nextColumn < row.length) {
					const targetIndex = getSelectableElements().indexOf(row[nextColumn])
					if (targetIndex >= 0) setSelected(targetIndex, true, direction)
					return true
				}
				if (direction === 'left' && nextColumn < 0) {
					const sidebarCards = getVisibleElements('[data-controller-sidebar-card="true"]')
					const currentCenterY = (currentRect.top + currentRect.height / 2)
					const target = sidebarCards
						.sort((left, right) => {
							const leftRect = left.getBoundingClientRect()
							const rightRect = right.getBoundingClientRect()
							const leftDistance = Math.abs((leftRect.top + leftRect.height / 2) - currentCenterY)
							const rightDistance = Math.abs((rightRect.top + rightRect.height / 2) - currentCenterY)
							return leftDistance - rightDistance
						})[0]
					const targetIndex = target ? getSelectableElements().indexOf(target) : -1
					if (targetIndex >= 0) setSelected(targetIndex, true, direction)
				}
				return true
			}

			const targetRowIndex = rowIndex + (direction === 'up' ? -1 : 1)
			if (targetRowIndex < 0 || targetRowIndex >= rows.length) {
				if (direction === 'up' && rowIndex === 0) {
					const topElements = getVisibleElements('[data-controller-top="true"]')
					const target = topElements
						.map((element) => ({ element, distance: distanceForDirection(currentRect, element.getBoundingClientRect(), 'up') }))
						.filter((item): item is { element: HTMLElement; distance: number } => item.distance !== null)
						.sort((left, right) => left.distance - right.distance)[0]?.element
					const targetIndex = target ? getSelectableElements().indexOf(target) : -1
					if (targetIndex >= 0) setSelected(targetIndex, true, direction)
				}
				return true
			}

			const targetRow = rows[targetRowIndex]
			const target = targetRow.reduce((best, candidate) => {
				const bestDistance = Math.abs(best.getBoundingClientRect().left - currentRect.left)
				const candidateDistance = Math.abs(candidate.getBoundingClientRect().left - currentRect.left)
				return candidateDistance < bestDistance ? candidate : best
			})
			const targetIndex = getSelectableElements().indexOf(target)
			if (targetIndex >= 0) setSelected(targetIndex, true, direction)
			return true
		}

		const moveSelection = (direction: string) => {
			const elements = getSelectableElements()
			const current = elements[selectedIndexRef.current]
			if (!current) {
				selectDefault()
				return
			}
			if (direction === 'right' && (current.dataset.controllerHome === 'true' || current.dataset.controllerSidebarCard === 'true')) {
				const detailPlay = document.querySelector<HTMLElement>('[data-controller-detail-play="true"]')
				const detailPlayIndex = detailPlay ? elements.indexOf(detailPlay) : -1
				if (detailPlayIndex >= 0) {
					setSelected(detailPlayIndex, true, direction)
					return
				}
			}

			if (current.dataset.gameId) {
				moveGameCard(current, direction)
				return
			}
			if (current.dataset.controllerSidebarCard === 'true') {
				const sidebarCards = getVisibleElements('[data-controller-sidebar-card="true"]')
				if (direction === 'right') {
					const currentRect = current.getBoundingClientRect()
					const gameCards = getVisibleElements('[data-controller-selectable="true"][data-game-id]')
					const rows: HTMLElement[][] = []
					gameCards
						.sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top || left.getBoundingClientRect().left - right.getBoundingClientRect().left)
						.forEach((card) => {
							const cardTop = card.getBoundingClientRect().top
							const row = rows.find((candidateRow) => Math.abs(candidateRow[0].getBoundingClientRect().top - cardTop) < 12)
							if (row) row.push(card)
							else rows.push([card])
						})
					const currentCenterY = currentRect.top + currentRect.height / 2
					const targetRow = rows.sort((left, right) => {
						const leftTop = left[0].getBoundingClientRect()
						const rightTop = right[0].getBoundingClientRect()
						return Math.abs(leftTop.top + leftTop.height / 2 - currentCenterY) - Math.abs(rightTop.top + rightTop.height / 2 - currentCenterY)
					})[0]
					const target = targetRow?.sort((left, right) => left.getBoundingClientRect().left - right.getBoundingClientRect().left)[0]
					const targetIndex = target ? elements.indexOf(target) : -1
					if (targetIndex >= 0) setSelected(targetIndex, true, direction)
					return
				}
				if (direction === 'up' || direction === 'down') {
					if (direction === 'up' && sidebarCards[0] === current) {
						const home = document.querySelector<HTMLElement>('[data-controller-home="true"]')
						const homeIndex = home ? elements.indexOf(home) : -1
						if (homeIndex >= 0) setSelected(homeIndex, true, direction)
						return
					}
					selectDirectionalItem(sidebarCards, current, direction)
				}
				return
			}
			if (current.dataset.controllerHome === 'true' && direction === 'right') {
				const firstGameCard = getVisibleElements('[data-controller-selectable="true"][data-game-id]')
					.sort((left, right) => {
						const leftRect = left.getBoundingClientRect()
						const rightRect = right.getBoundingClientRect()
						return leftRect.top - rightRect.top || leftRect.left - rightRect.left
					})[0]
				const targetIndex = firstGameCard ? elements.indexOf(firstGameCard) : -1
				if (targetIndex >= 0) setSelected(targetIndex)
				return
			}
			if (current.dataset.controllerHome === 'true' && direction === 'up') return

			const currentRect = current.getBoundingClientRect()
			const stayWithinGameCards = Boolean(current.dataset.gameId)
			let bestIndex = -1
			let bestDistance = Number.POSITIVE_INFINITY
			elements.forEach((candidate, index) => {
				if (index === selectedIndexRef.current) return
				if (stayWithinGameCards && !candidate.dataset.gameId) return
				const candidateRect = candidate.getBoundingClientRect()
				if (candidateRect.width === 0 || candidateRect.height === 0) return
				const distance = distanceForDirection(currentRect, candidateRect, direction)
				if (distance !== null && distance < bestDistance) {
					bestDistance = distance
					bestIndex = index
				}
			})

			if (bestIndex >= 0) {
				setSelected(bestIndex)
				return
			}

			if (direction === 'up' && current.dataset.gameId) {
				const upperCardCandidates = elements.map((candidate, index) => {
					if (index === selectedIndexRef.current || !candidate.dataset.gameId) return false
					const candidateRect = candidate.getBoundingClientRect()
					if (candidateRect.width === 0 || candidateRect.height === 0 || candidateRect.bottom > currentRect.top + 4) return false
					const currentCenterX = currentRect.left + currentRect.width / 2
					const candidateCenterX = candidateRect.left + candidateRect.width / 2
					return {
						index,
						distance: Math.abs(currentRect.top - candidateRect.bottom) + Math.abs(currentCenterX - candidateCenterX) * 1.8,
					}
				}).filter((candidate): candidate is { index: number; distance: number } => candidate !== false)
					.sort((left, right) => left.distance - right.distance)
				if (upperCardCandidates[0]) {
					setSelected(upperCardCandidates[0].index)
					return
				}

				const toolbarCandidates = elements
					.map((candidate, index) => ({ candidate, index }))
					.filter(({ candidate }) => {
						const rect = candidate.getBoundingClientRect()
						return !candidate.dataset.gameId && rect.width > 0 && rect.height > 0
					})
					.map(({ candidate, index }) => ({
						index,
						distance: distanceForDirection(currentRect, candidate.getBoundingClientRect(), direction),
					}))
					.filter((candidate): candidate is { index: number; distance: number } => candidate.distance !== null)
					.sort((left, right) => left.distance - right.distance)
				if (toolbarCandidates[0]) {
					setSelected(toolbarCandidates[0].index)
					return
				}
				current.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' })
			}
		}

		const activate = () => {
			const element = getSelectableElements()[selectedIndexRef.current]
			if (!element || (element as HTMLButtonElement).disabled) return
			const action = element.dataset.controllerAction || 'action'
			if (action === 'launch') {
				Logger.info(`Game launch requested through controller input on ${element.getAttribute('aria-label') || element.textContent?.trim() || 'launch control'}.`)
				window.dispatchEvent(new CustomEvent('gamelibrary:controller-launch'))
			}
			playControllerSound(action === 'detail' ? 'detail' : action === 'launch' ? 'launch' : 'action')
			element.click()
			window.setTimeout(() => {
				const refreshed = getSelectableElements()
				const refreshedIndex = refreshed.indexOf(element)
				if (refreshedIndex >= 0) setSelected(refreshedIndex, false)
			}, 0)
		}

		const goBack = () => {
			const openMenu = document.querySelector<HTMLElement>('[data-controller-menu="true"][data-controller-menu-open="true"]')
			if (openMenu) {
				const menuId = openMenu.dataset.controllerMenuId
				const trigger = menuId ? document.querySelector<HTMLElement>(`[data-controller-menu-trigger="${CSS.escape(menuId)}"]`) : null
				if (menuId && trigger) {
					pendingSelectionRef.current = { type: 'menu-trigger', menuId }
					trigger.click()
				}
				return
			}
			const modal = document.querySelector<HTMLElement>('[data-controller-modal="true"]')
			if (modal) {
				modal.querySelector<HTMLElement>('[data-controller-modal-cancel="true"]')?.click()
				return
			}
			const detail = document.querySelector<HTMLElement>('[data-controller-detail="true"]')
			if (detail) {
				const gameId = detail.dataset.controllerDetailGameId
				if (gameId) pendingSelectionRef.current = { type: 'game', gameId }
				playControllerSound('back')
				onGoHomeRef.current()
			}
		}

		const handleConnected = (event: GamepadEvent) => {
			if (connectedGamepadsRef.current.has(event.gamepad.id)) return
			connectedGamepadsRef.current.add(event.gamepad.id)
			const displayName = getControllerDisplayName(event.gamepad)
			controllerNamesRef.current.set(event.gamepad.id, displayName)
			Logger.info(`Controller connected: ${displayName} (${event.gamepad.id})`)
			onShowToastRef.current(`Controller connected: ${displayName}`, { durationMs: 4000, style: 'success' })
			if (frameRef.current === null) {
				frameRef.current = window.requestAnimationFrame(poll)
			}
		}

		const handleDisconnected = (event: GamepadEvent) => {
			connectedGamepadsRef.current.delete(event.gamepad.id)
			const displayName = controllerNamesRef.current.get(event.gamepad.id) || getControllerDisplayName(event.gamepad)
			controllerNamesRef.current.delete(event.gamepad.id)
			Logger.info(`Controller disconnected: ${displayName} (${event.gamepad.id})`)
			onShowToastRef.current(`Controller disconnected: ${displayName}`, { durationMs: 4000, style: 'warning' })
			if (connectedGamepadsRef.current.size === 0) {
				handlingStartedRef.current = false
				previousButtonsRef.current = []
				previousDirectionRef.current = null
				clearSelection()
				if (frameRef.current !== null) {
					window.cancelAnimationFrame(frameRef.current)
					frameRef.current = null
				}
			}
		}

		const poll = () => {
			const gamepads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) as Gamepad[] : []
			const gamepad = gamepads[0]
			if (!gamepad || connectedGamepadsRef.current.size === 0) {
				if (gamepads.length === 0 && connectedGamepadsRef.current.size > 0) {
					connectedGamepadsRef.current.clear()
					handlingStartedRef.current = false
					previousButtonsRef.current = []
					previousDirectionRef.current = null
					clearSelection()
				}
				frameRef.current = null
				return
			}
			if (!document.hasFocus()) {
				previousButtonsRef.current = []
				previousDirectionRef.current = null
				frameRef.current = window.requestAnimationFrame(poll)
				return
			}

			if (!handlingStartedRef.current && hasControllerInput(gamepad)) {
				activateControllerMode()
			}

			if (handlingStartedRef.current) {
				const direction = getDirection(gamepad)
				if (direction && previousDirectionRef.current !== direction) moveSelection(direction)
				previousDirectionRef.current = direction

				const buttons = gamepad.buttons.map((button) => ({ pressed: button.pressed }))
				const wasPressed = (index: number) => Boolean(previousButtonsRef.current[index]?.pressed)
				if (buttons[0]?.pressed && !wasPressed(0)) activate()
				if (buttons[1]?.pressed && !wasPressed(1)) goBack()
				if (buttons[3]?.pressed && !wasPressed(3)) {
					document.querySelector<HTMLElement>('[data-controller-modal="true"] [data-controller-modal-cancel="true"]')?.click()
					pendingSelectionRef.current = { type: 'home' }
					playControllerSound('home')
					onGoHomeRef.current()
				}
				previousButtonsRef.current = buttons
			}

			frameRef.current = window.requestAnimationFrame(poll)
		}

		const initiallyConnected = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) as Gamepad[] : []
		initiallyConnected.forEach((gamepad) => {
			connectedGamepadsRef.current.add(gamepad.id)
			const displayName = getControllerDisplayName(gamepad)
			controllerNamesRef.current.set(gamepad.id, displayName)
			Logger.info(`Controller connected: ${displayName} (${gamepad.id})`)
			onShowToastRef.current(`Controller connected: ${displayName}`, { durationMs: 4000, style: 'success' })
		})
		window.addEventListener('gamepadconnected', handleConnected)
		window.addEventListener('gamepaddisconnected', handleDisconnected)
		if (connectedGamepadsRef.current.size > 0) {
			frameRef.current = window.requestAnimationFrame(poll)
		}
		const observer = new MutationObserver(() => {
			if (!handlingStartedRef.current) return
			const elements = getSelectableElements()
			if (elements.length === 0) return
			const modal = document.querySelector<HTMLElement>('[data-controller-modal="true"]')
			if (modal) {
				if (!modalSourceRef.current && selectedElementRef.current) {
					const source = selectedElementRef.current
					modalSourceRef.current = source.dataset.controllerDetailPlay === 'true'
						? { type: 'detail-play' }
						: source.dataset.gameId ? { type: 'game', gameId: source.dataset.gameId } : null
				}
				const checkedOption = modal.querySelector<HTMLElement>('[data-controller-launch-file-selected="true"]')
				const modalTarget = checkedOption || elements[0]
				const modalIndex = elements.indexOf(modalTarget)
				if (modalIndex >= 0 && selectedElementRef.current !== modalTarget) setSelected(modalIndex, false)
				return
			}
			if (modalSourceRef.current) {
				pendingSelectionRef.current = modalSourceRef.current
				modalSourceRef.current = null
				if (selectPendingTarget()) return
			}
			const detailPlay = document.querySelector<HTMLElement>('[data-controller-detail-play="true"]')
			if (detailPlay) {
				const detailPlayIndex = elements.indexOf(detailPlay)
				if (detailPlayIndex >= 0 && selectedElementRef.current !== detailPlay) {
					setSelected(detailPlayIndex, false)
				}
				return
			}
			if (selectPendingTarget()) return
			if (!selectedElementRef.current || !elements.includes(selectedElementRef.current)) selectDefault()
		})
		observer.observe(document.body, { childList: true, subtree: true })

		return () => {
			window.removeEventListener('gamepadconnected', handleConnected)
			window.removeEventListener('gamepaddisconnected', handleDisconnected)
			observer.disconnect()
			clearSelection()
			if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
		}
	}, [])
	return children
}

export default ControllerManager