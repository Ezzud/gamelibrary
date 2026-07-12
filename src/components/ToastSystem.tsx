import { useState } from 'react'
import type { ToastItem, ToastOptions, ToastStackProps } from '../types/appTypes'

export type { ToastItem, ToastOptions }

const getToastProgressBarClass = (style: ToastItem['style']) => {
	if (style === 'success') {
		return 'bg-emerald-400'
	}
	if (style === 'error') {
		return 'bg-red-400'
	}
	if (style === 'warning') {
		return 'bg-amber-400'
	}
	return 'bg-[#6ec1ff]'
}

export const useToastSystem = () => {
	const [toasts, setToasts] = useState<ToastItem[]>([])

	const showToast = (message: string, options?: ToastOptions) => {
		const durationMs = options?.durationMs ?? 3000
		const style = options?.style ?? 'default'
		const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

		setToasts((prev) => [
			{
				id,
				message,
				visible: false,
				started: false,
				durationMs,
				style,
				actionLabel: options?.actionLabel,
				onClick: options?.onClick,
			},
			...prev,
		])

		window.requestAnimationFrame(() => {
			setToasts((prev) =>
				prev.map((toast) => (toast.id === id ? { ...toast, visible: true, started: true } : toast))
			)
		})

		window.setTimeout(() => {
			setToasts((prev) => prev.map((toast) => (toast.id === id ? { ...toast, visible: false } : toast)))
		}, durationMs)

		window.setTimeout(() => {
			setToasts((prev) => prev.filter((toast) => toast.id !== id))
		}, durationMs + 300)
	}

	const dismissToast = (id: string) => {
		setToasts((prev) => prev.filter((toast) => toast.id !== id))
	}

	return {
		toasts,
		showToast,
		dismissToast,
	}
}

const ToastSystem = ({ toasts, onDismiss }: ToastStackProps) => {
	return (
		<div className="fixed top-4 right-4 z-10000 flex flex-col gap-2 pointer-events-none">
			{toasts.map((toast) => (
				<div
					key={toast.id}
					onClick={() => {
						if (!toast.onClick) {
							return
						}
						toast.onClick()
						onDismiss(toast.id)
					}}
					className={`pointer-events-auto w-80 rounded-lg text-white shadow-[0_10px_26px_rgba(0,0,0,0.35)] overflow-hidden transform transition-all duration-300 ${toast.style === 'error' ? 'bg-[#3a1111] border border-[#7d2323]' : 'bg-[#21364f] border border-[#3a5f84]'} ${toast.visible ? 'translate-x-0 opacity-100' : 'translate-x-8 opacity-0'
						} ${toast.onClick ? 'cursor-pointer' : ''}`}
				>
					<div className="px-3 py-2 text-sm">
						<div>{toast.message}</div>
						{toast.actionLabel && <div className="underline mt-1">{toast.actionLabel}</div>}
					</div>
					<div className="h-1 bg-[#325170]/50">
						<div
							className={`h-full ${getToastProgressBarClass(toast.style)}`}
							style={{
								width: toast.started ? '0%' : '100%',
								transition: `width ${toast.durationMs}ms linear`,
							}}
						/>
					</div>
				</div>
			))}
		</div>
	)
}

export default ToastSystem
