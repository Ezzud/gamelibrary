const soundPaths = {
	selection: '/sounds/controller-selection.wav',
	detail: '/sounds/controller-detail.wav',
	launch: '/sounds/controller-launch.wav',
	action: '/sounds/controller-action.wav',
	back: '/sounds/controller-back.wav',
	home: '/sounds/controller-home.wav',
} as const

export const CONTROLLER_SOUND_VOLUME = 0.3
export const CONTROLLER_SELECTION_SOUND_VOLUME = 0.18

type ControllerSound = keyof typeof soundPaths

const audioCache = new Map<ControllerSound, HTMLAudioElement>()

export const playControllerSound = (sound: ControllerSound) => {
	if (typeof window === 'undefined') {
		return
	}

	let audio = audioCache.get(sound)
	if (!audio) {
		audio = new Audio(soundPaths[sound])
		audio.preload = 'auto'
		audioCache.set(sound, audio)
	}

	audio.volume = sound === 'selection' ? CONTROLLER_SELECTION_SOUND_VOLUME : CONTROLLER_SOUND_VOLUME
	audio.currentTime = 0
	void audio.play().catch(() => undefined)
}