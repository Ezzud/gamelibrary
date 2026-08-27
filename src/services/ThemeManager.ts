import catpuccinThemeUrl from '../themes/catpuccin.css?url'
import defaultThemeUrl from '../themes/default.css?url'
import ezzudFavoriteThemeUrl from '../themes/ezzud-favorite.css?url'
import { resetTheme } from './ConfigManager'
import { Logger } from '../utils/Logger'

const DEFAULT_THEME = 'default'
const THEME_LINK_ATTRIBUTE = 'data-gamelibrary-theme'

const themeUrls: Record<string, string> = {
	default: defaultThemeUrl,
	catpuccin: catpuccinThemeUrl,
	'ezzud-favorite': ezzudFavoriteThemeUrl,
}

const normalizeThemeName = (themeName: string | null | undefined) => {
	const normalized = (themeName || DEFAULT_THEME).trim().toLowerCase()
	return normalized || DEFAULT_THEME
}

const removeAppliedTheme = () => {
	document.querySelector(`link[${THEME_LINK_ATTRIBUTE}]`)?.remove()
}

export const getAvailableThemes = () => [DEFAULT_THEME, ...Object.keys(themeUrls).filter((theme) => theme !== DEFAULT_THEME)]

export const applyTheme = async (themeName?: string) => {
	if (typeof document === 'undefined') {
		return DEFAULT_THEME
	}

	const normalizedThemeName = normalizeThemeName(themeName)
	const themeUrl = themeUrls[normalizedThemeName]
	if (!themeUrl) {
		Logger.warn(`Theme stylesheet "${normalizedThemeName}" was not found. Reverting to default.`)
		removeAppliedTheme()
		try {
			await resetTheme()
		} catch (error) {
			Logger.warn('Failed to persist the default theme after a missing theme was detected:', error)
		}
		return DEFAULT_THEME
	}

	removeAppliedTheme()
	if (normalizedThemeName === DEFAULT_THEME) {
		return DEFAULT_THEME
	}

	const link = document.createElement('link')
	link.rel = 'stylesheet'
	link.href = themeUrl
	link.setAttribute(THEME_LINK_ATTRIBUTE, normalizedThemeName)
	document.head.appendChild(link)
	return normalizedThemeName
}

export { DEFAULT_THEME }
