import { invoke } from '@tauri-apps/api/core'
import { Logger } from '../utils/Logger'
import type { DiscordRpcConfig, Game } from '../types/appTypes'
import { getAppConfig } from './ConfigManager'
import { getVersion } from '@tauri-apps/api/app'
import { formatPlaytime, getPlaytime } from './PlaytimeManager'

const DISCORD_APP_ID = import.meta.env.VITE_DISCORD_RPC_APP_ID || "1525914336793596075";
const APP_NAME = 'Game Library'
const APP_URL = 'https://gamelibrary.ezzud.fr'
const APP_ICON_ASSET = 'icons'
const APP_ICON_LARGE_ASSET = 'iconl'

const toTrimmedText = (value?: string | null) => value?.trim() || ''

const normalizeDiscordUrl = (value?: string | null) => {
    const trimmed = toTrimmedText(value)
    if (!trimmed) {
        return ''
    }

    if (trimmed.startsWith('//')) {
        return `https:${trimmed}`
    }

    return trimmed
}

const buildImageKey = (mode: DiscordRpcConfig['largeImage'] | DiscordRpcConfig['smallImage'], size: 'large' | 'small') => {
    if (mode === 'app-icon') {
        return size === 'large' ? APP_ICON_LARGE_ASSET : APP_ICON_ASSET
    }

    return ''
}

const buildImageSource = (mode: DiscordRpcConfig['largeImage'] | DiscordRpcConfig['smallImage'], game?: Game | null) => {
    if (mode !== 'game-icon') {
        return ''
    }

    return normalizeDiscordUrl(game?.coverUrl || game?.thumbnailUrl || '')
}

const buildImageText = async (mode: DiscordRpcConfig['largeImage'] | DiscordRpcConfig['smallImage'], gameName?: string) => {
    const version = await getVersion().catch(() => 'Unknown')

    if (mode === 'game-icon') {
        return toTrimmedText(gameName)
    }

    if (mode === 'app-icon') {
        return `GameLibrary v${version}`
    }

    return ''
}

export const syncDiscordPresence = async (context: {
    activeGame?: Game | null
    isSettingsOpen: boolean
    isHomeActive: boolean
    elapsedStartedAt?: number | null
}) => {
    try {
        if(!DISCORD_APP_ID) {
            Logger.warn('Discord RPC App ID is not set. Skipping Discord RPC presence sync.')
            return
        }

        const config = await getAppConfig()
        const rpc = config.discordRpc
        if (!rpc?.enabled) {
            Logger.info('Stopping Discord RPC.')
            await invoke('discord_rpc_update_presence', {
                payload: { enabled: false, appId: DISCORD_APP_ID },
            })
            return
        }

        const activeGame = context.activeGame || null;
        let state = '';
        if(activeGame) {
            const playtimeMs = await getPlaytime(activeGame.id);
            const playtime = formatPlaytime(playtimeMs);
            state = `Played for ${playtime}`;
        } else {
            if(context.isSettingsOpen) { 
                state = 'Browsing settings'
            } else if(context.isHomeActive || rpc.showWhenNoGamePlayed) {
                state = 'Browsing the library'
            }
        }

        const version = await getVersion().catch(() => 'Unknown')
        const largeImage = buildImageKey(rpc.largeImage, "large") || buildImageSource(rpc.largeImage, activeGame)
        const smallImage = buildImageKey(rpc.smallImage, "small") || buildImageSource(rpc.smallImage, activeGame)
        const [largeText, smallText] = await Promise.all([
            buildImageText(rpc.largeImage, activeGame?.name || `GameLibrary v${version}`),
            buildImageText(rpc.smallImage, activeGame?.name || `GameLibrary v${version}`),
        ])

        const elapsedStartedAt = activeGame && rpc.displayTimeElapsed ? context.elapsedStartedAt ?? Date.now() : null

        Logger.info('Starting Discord RPC presence sync.')
        Logger.info(`Updating Discord RPC: ${state || 'idle'}`)
        if (activeGame) {
            Logger.info(`Discord RPC game: ${activeGame.name}`)
        }
        Logger.info(`Discord RPC large image: ${largeImage || 'none'}`)
        Logger.info(`Discord RPC small image: ${smallImage || 'none'}`)

        await invoke('discord_rpc_update_presence', {
            payload: {
                enabled: true,
                appId: DISCORD_APP_ID,
                name: activeGame?.name || APP_NAME,
                state: state || null,
                largeImage: largeImage || null,
                largeText: largeText || null,
                smallImage: smallImage || null,
                smallText: smallText || null,
                displayTimeElapsed: rpc.displayTimeElapsed,
                showButton: rpc.showButton,
                buttonLabel: rpc.showButton ? APP_NAME : null,
                buttonUrl: rpc.showButton ? normalizeDiscordUrl(APP_URL) : null,
                elapsedStartedAt,
            },
        })
    } catch (error) {
        Logger.error('Failed to sync Discord presence:', error)
    }
}
