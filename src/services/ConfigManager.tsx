// Default config path: Appdata/Local/GameLibrary/config.json
import { exists, mkdir, readTextFile, writeTextFile, readDir, remove } from '@tauri-apps/plugin-fs'
import { appDataDir, dirname, join, extname } from '@tauri-apps/api/path'
import { invoke } from '@tauri-apps/api/core'
import { Logger } from '../utils/Logger'
import type { Config, DiscordRpcConfig, GameCacheConfig, GameConfig, GameList, GameListEntry, PlayHistory, IGDBConnectionMode } from '../types/appTypes'

const defaultDiscordRpcConfig: DiscordRpcConfig = {
    enabled: true,
    showWhenNoGamePlayed: false,
    largeImage: 'game-icon',
    smallImage: 'app-icon',
    displayTimeElapsed: true,
    showButton: true,
}

const defaultConfig: Config = {
    customScanFolders: [],
    ignoredFolders: [],
    favorites: [],
    twitchClientId: '',
    twitchClientSecret: '',
    cardHoverEffect: 'zoom',
    theme: 'default',
    discordRpc: defaultDiscordRpcConfig,
    igdbConnectionMode: 'api',
    igdbApiBaseUrl: 'https://gamelibrary.ezzud.fr/api',
    runOnStartup: true,
    runReduced: false,
    reduceWhilePlaying: false,
    reduceWhenClosing: true,
    reduceWhenClosingNoticeShown: false,
    autoDetectGames: true,
    sortField: 'name',
    sortOrder: 'asc'
};
const defaultGameConfig: GameConfig = {
    customArguments: '',
    defaultLaunchFile: undefined,
    allLaunchFiles: undefined,
    lockedLaunchFile: false,
    launchWithSteam: true,
    specialTags: [],
    searchName: '',
    forced_igdb_id: null,
    localCoverPath: undefined,
    localBannerPath: undefined
};
const defaultGameCacheConfig: GameCacheConfig = {
    title: null,
    cover_url: null,
    thumbnail_url: null,
    igdb_id: null,
    id: null,
    platform: null,
    folder: '',
    fetched: false
}
const defaultGameList: GameList = { games: [] };
const defaultPlayHistory: PlayHistory = { plays: [] };

async function ensureParentDir(filePath: string) {
    const parentDir = await dirname(filePath);
    await mkdir(parentDir, { recursive: true });
}

function normalizePathForCompare(value: string) {
    return value.replace(/\\/g, '/').replace(/\/+$/, '').trim().toLowerCase();
}

function normalizeApiBaseUrl(value: string) {
    return value.trim().replace(/\/+$/, '');
}

function resolveInitialIGDBConnectionMode(parsed: any): IGDBConnectionMode {
    const candidate = parsed?.igdbConnectionMode;
    if (candidate === 'api' || candidate === 'twitch') {
        return candidate;
    }

    const hasExistingCredentials =
        typeof parsed?.twitchClientId === 'string' && parsed.twitchClientId.trim().length > 0 &&
        typeof parsed?.twitchClientSecret === 'string' && parsed.twitchClientSecret.trim().length > 0;

    return hasExistingCredentials ? 'twitch' : 'api';
}

function resolveDiscordRpcConfig(parsed: any): DiscordRpcConfig {
    const candidate = parsed?.discordRpc || {}

    return {
        enabled: typeof candidate?.enabled === 'boolean' ? candidate.enabled : true,
        showWhenNoGamePlayed: typeof candidate?.showWhenNoGamePlayed === 'boolean' ? candidate.showWhenNoGamePlayed : false,
        largeImage: candidate?.largeImage === 'app-icon' || candidate?.largeImage === 'game-icon' || candidate?.largeImage === 'none'
            ? candidate.largeImage
            : 'game-icon',
        smallImage: candidate?.smallImage === 'app-icon' || candidate?.smallImage === 'game-icon' || candidate?.smallImage === 'none'
            ? candidate.smallImage
            : 'app-icon',
        displayTimeElapsed: typeof candidate?.displayTimeElapsed === 'boolean' ? candidate.displayTimeElapsed : true,
        showButton: typeof candidate?.showButton === 'boolean' ? candidate.showButton : true,
    }
}


export async function addCustomScanFolder(path: string) {
    Logger.info(`Adding custom scan folder: ${path}`);
    const config = await loadConfig();
    if (!config.customScanFolders.includes(path)) {
        config.customScanFolders.push(path);
        await saveConfig(config);
        Logger.success(`Custom scan folder added: ${path}`);
    } else {
        Logger.warn(`Custom scan folder already exists: ${path}`);
    }
}

export async function addIgnoredFolder(path: string) {
    Logger.info(`Adding ignored folder: ${path}`);
    const config = await loadConfig();
    const normalizedTarget = normalizePathForCompare(path);
    if (!normalizedTarget) {
        return;
    }

    const alreadyExists = config.ignoredFolders.some((entry) => normalizePathForCompare(entry) === normalizedTarget);
    if (alreadyExists) {
        Logger.warn(`Ignored folder already exists: ${path}`);
        return;
    }

    config.ignoredFolders.push(path);
    await saveConfig(config);
    Logger.success(`Ignored folder added: ${path}`);
}

export async function addFavorite(gameId: string) {
    Logger.info(`Adding favorite game ID: ${gameId}`);
    const config = await loadConfig();
    const normalizedGameId = gameId.trim();

    if (!normalizedGameId) {
        Logger.warn('Cannot add empty game ID to favorites.');
        return;
    }

    if (!config.favorites.includes(normalizedGameId)) {
        config.favorites.push(normalizedGameId);
        await saveConfig(config);
        Logger.success(`Favorite added: ${normalizedGameId}`);
    } else {
        Logger.warn(`Favorite already exists: ${normalizedGameId}`);
    }
}

export async function deleteGameCache(gameId: string) {
    const cachePath = await getGameCachePath(gameId);
    try {
        const fileExists = await exists(cachePath);
        if (fileExists) {
            const currentConfig = await loadGameCache(gameId);
            let defaultConfig = defaultGameCacheConfig;
            defaultConfig.id = currentConfig?.id || null;
            defaultConfig.platform = currentConfig?.platform || null;
            defaultConfig.folder = currentConfig?.folder || '';
            await writeTextFile(cachePath, JSON.stringify(defaultGameCacheConfig, null, 2));
            Logger.info(`Game cache for game ID ${gameId} reset to default.`);
        } else {
            Logger.warn(`Game cache file not found for game ID ${gameId} at ${cachePath}, cannot reset.`);
        }
    } catch (err) {
        Logger.error(`Error occurred while resetting game cache for game ID ${gameId} at ${cachePath}:`, err);
    }
}

export async function deleteAllGameCaches() {
    try {
        const gameList = await loadGameList();
        for (const game of gameList.games || []) {
            if (game?.id) {
                await deleteGameCache(game.id);
            }
        }
        Logger.info('All game caches have been reset to default.');
    } catch (err) {
        Logger.error('Error occurred while resetting all game caches:', err);
    }
}

export async function deleteAllGamesData() {
    const gameListPath = await getGameListPath();

    try {
        const gameListExists = await exists(gameListPath);
        if (gameListExists) {
            await writeTextFile(gameListPath, JSON.stringify(defaultGameList, null, 2));
            Logger.info(`Game list reset to default at ${gameListPath}.`);
        }

        // Delete all folders in the games folder
        const appDataPath = await appDataDir();
        const gamesFolderPath = await join(appDataPath, 'GameLibrary', 'games');
        const gamesFolderExists = await exists(gamesFolderPath);
        if (gamesFolderExists) {
            const entries = await readDir(gamesFolderPath);
            for (const entry of entries) {
                if (entry.isDirectory && entry.name) {
                    const entryPath = await join(gamesFolderPath, entry.name);
                    await remove(entryPath, { recursive: true });
                    Logger.info(`Deleted game data folder: ${entryPath}`);
                }
            }
        }
    } catch (err) {
        Logger.error('Error occurred while resetting all game data:', err);
    }
}

export async function isLockedLaunchFile(gameId: string) {
    const config = await loadGameConfig(gameId);
    return config ? config.lockedLaunchFile : false;
}

export async function setDefaultLaunchFile(gameId: string, launchFile: string) {
    const config = await loadGameConfig(gameId);
    if (config) {
        if (config.lockedLaunchFile) {
            Logger.warn(`Default launch file for game ID ${gameId} is locked. Skipping update.`);
            return;
        }
        config.defaultLaunchFile = launchFile;
        await saveGameConfig(gameId, config);
        Logger.info(`Default launch file for game ID ${gameId} set to: ${launchFile}`);
    } else {
        Logger.error(`Failed to set default launch file for game ID ${gameId}: Game config not found.`);
    }
}

export async function setLockedLaunchFile(gameId: string, locked: boolean) {
    const config = await loadGameConfig(gameId);
    if (config) {
        config.lockedLaunchFile = locked;
        await saveGameConfig(gameId, config);
        Logger.info(`Set locked launch file for game ID ${gameId} to ${locked}`);
    }
}

export async function removeCustomScanFolder(path: string) {
    Logger.info(`Removing custom scan folder: ${path}`);
    const config = await loadConfig();
    const index = config.customScanFolders.indexOf(path);
    if (index !== -1) {
        config.customScanFolders.splice(index, 1);
        await saveConfig(config);
        Logger.success(`Custom scan folder removed: ${path}`);
    } else {
        Logger.warn(`Custom scan folder not found: ${path}`);
    }
}

export async function removeIgnoredFolder(path: string) {
    Logger.info(`Removing ignored folder: ${path}`);
    const config = await loadConfig();
    const normalizedTarget = normalizePathForCompare(path);
    const nextIgnoredFolders = config.ignoredFolders.filter(
        (entry) => normalizePathForCompare(entry) !== normalizedTarget
    );

    if (nextIgnoredFolders.length === config.ignoredFolders.length) {
        Logger.warn(`Ignored folder not found: ${path}`);
        return;
    }

    config.ignoredFolders = nextIgnoredFolders;
    await saveConfig(config);
    Logger.success(`Ignored folder removed: ${path}`);
}

export async function removeFavorite(gameId: string) {
    Logger.info(`Removing favorite game ID: ${gameId}`);
    const config = await loadConfig();
    const normalizedGameId = gameId.trim();
    const nextFavorites = config.favorites.filter((favoriteId) => favoriteId !== normalizedGameId);

    if (nextFavorites.length === config.favorites.length) {
        Logger.warn(`Favorite not found: ${normalizedGameId}`);
        return;
    }

    config.favorites = nextFavorites;
    await saveConfig(config);
    Logger.success(`Favorite removed: ${normalizedGameId}`);
}

export async function getGameConfigLaunchFiles(gameId: string) {
    const config = await loadGameConfig(gameId);
    return config ? config.allLaunchFiles || [] : [];
}

export async function getGameConfigDefaultLaunchFile(gameId: string) {
    const config = await loadGameConfig(gameId);
    return config ? config.defaultLaunchFile : undefined;
}

export async function getCustomScanFolders() {
    const config = await loadConfig();
    return config.customScanFolders;
}

export async function getIgnoredFolders() {
    const config = await loadConfig();
    return config.ignoredFolders;
}

export async function getFavoriteIds() {
    const config = await loadConfig();
    return config.favorites;
}

async function loadConfig() {
    const configPath = await getConfigPath();
    try {
        const fileExists = await exists(configPath);
        if (!fileExists) {
            Logger.warn(`Config file not found at ${configPath}, creating default config.`);
            await ensureParentDir(configPath);
            await writeTextFile(configPath, JSON.stringify(defaultConfig, null, 2));
            return defaultConfig;
        }
        const content = await readTextFile(configPath);
        const parsed = JSON.parse(content);
        return {
            ...defaultConfig,
            ...parsed,
            customScanFolders: Array.isArray(parsed?.customScanFolders) ? parsed.customScanFolders : [],
            ignoredFolders: Array.isArray(parsed?.ignoredFolders) ? parsed.ignoredFolders : [],
            favorites: Array.isArray(parsed?.favorites) ? parsed.favorites : [],
            twitchClientId: typeof parsed?.twitchClientId === 'string' ? parsed.twitchClientId : '',
            twitchClientSecret: typeof parsed?.twitchClientSecret === 'string' ? parsed.twitchClientSecret : '',
            cardHoverEffect: typeof parsed?.cardHoverEffect === 'string' ? parsed.cardHoverEffect : 'zoom',
            theme: typeof parsed?.theme === 'string' && parsed.theme.trim().length > 0 ? parsed.theme.trim() : 'default',
            igdbConnectionMode: resolveInitialIGDBConnectionMode(parsed),
            igdbApiBaseUrl: typeof parsed?.igdbApiBaseUrl === 'string' && parsed.igdbApiBaseUrl.trim().length > 0
                ? normalizeApiBaseUrl(parsed.igdbApiBaseUrl)
                : defaultConfig.igdbApiBaseUrl,
            runReduced: typeof parsed?.runReduced === 'boolean' ? parsed.runReduced : false,
            reduceWhilePlaying: typeof parsed?.reduceWhilePlaying === 'boolean' ? parsed.reduceWhilePlaying : false,
            reduceWhenClosing: typeof parsed?.reduceWhenClosing === 'boolean' ? parsed.reduceWhenClosing : true,
            reduceWhenClosingNoticeShown: typeof parsed?.reduceWhenClosingNoticeShown === 'boolean' ? parsed.reduceWhenClosingNoticeShown : false,
            autoDetectGames: typeof parsed?.autoDetectGames === 'boolean' ? parsed.autoDetectGames : true,
            discordRpc: resolveDiscordRpcConfig(parsed),
        } as Config;
    } catch (err) {
        Logger.error(`Error occurred while reading config at ${configPath}:`, err);
        return defaultConfig;
    }
}

export async function getAppConfig() {
    return await loadConfig();
}

export async function setTwitchCredentials(twitchClientId: string, twitchClientSecret: string) {
    const config = await loadConfig();
    const nextConfig: Config = {
        ...config,
        twitchClientId: twitchClientId.trim(),
        twitchClientSecret: twitchClientSecret.trim(),
    };
    await saveConfig(nextConfig);
    Logger.info('Twitch credentials saved to app config.');
}

export async function setCardHoverEffect(cardHoverEffect: string) {
    const config = await loadConfig();
    const nextConfig: Config = {
        ...config,
        cardHoverEffect: cardHoverEffect.trim(),
    };
    await saveConfig(nextConfig);
    Logger.info('Card hover effect saved to app config.');
}

export async function setTheme(theme: string) {
    const config = await loadConfig();
    const nextConfig: Config = {
        ...config,
        theme: theme.trim() || 'default',
    };
    await saveConfig(nextConfig);
    Logger.info(`Theme set to ${nextConfig.theme}`);
}

export async function resetTheme() {
    await setTheme('default');
}

export async function setDiscordRpcConfig(patch: Partial<DiscordRpcConfig>) {
    const config = await loadConfig();
    const currentDiscordRpc = config.discordRpc || defaultConfig.discordRpc;
    const nextConfig: Config = {
        ...config,
        discordRpc: {
            ...defaultDiscordRpcConfig,
            ...currentDiscordRpc,
            ...patch,
        },
    };
    await saveConfig(nextConfig);
    Logger.info('Discord RPC configuration saved to app config.');
}

export async function setRunOnStartup(enable: boolean, reduced = false) {
    const config = await loadConfig();
    const nextConfig: Config = {
        ...config,
        runOnStartup: !!enable,
        runReduced: !!reduced,
    };
    await saveConfig(nextConfig);

    try {
        await invoke('set_run_on_startup', { enable, reduced });
        Logger.info(`Run-on-startup ${enable ? 'enabled' : 'disabled'}`);
    } catch (err) {
        Logger.error('Failed to set run-on-startup via backend:', err);
        throw err;
    }
}

export async function setRunReduced(enable: boolean) {
    const config = await loadConfig();
    const nextConfig: Config = {
        ...config,
        runReduced: !!enable,
    };
    await saveConfig(nextConfig);
    Logger.info(`Run-reduced ${enable ? 'enabled' : 'disabled'}`);
}

export async function getRunOnStartup() {
    try {
        const result = await invoke<boolean>('get_run_on_startup');
        return !!result;
    } catch (err) {
        Logger.error('Failed to query run-on-startup from backend:', err);
        return false;
    }
}

export async function setReduceWhilePlaying(enable: boolean) {
    const config = await loadConfig();
    const nextConfig: Config = {
        ...config,
        reduceWhilePlaying: !!enable,
    };
    await saveConfig(nextConfig);
    Logger.info(`Reduce-while-playing ${enable ? 'enabled' : 'disabled'}`);
}

export async function setReduceWhenClosing(enable: boolean) {
    const config = await loadConfig();
    const nextConfig: Config = {
        ...config,
        reduceWhenClosing: !!enable,
    };
    await saveConfig(nextConfig);
    Logger.info(`Reduce-when-closing ${enable ? 'enabled' : 'disabled'}`);
}

export async function setReduceWhenClosingNoticeShown(shown: boolean) {
    const config = await loadConfig();
    const nextConfig: Config = {
        ...config,
        reduceWhenClosingNoticeShown: !!shown,
    };
    await saveConfig(nextConfig);
    Logger.info(`Reduce-when-closing notice shown flag set to ${shown}`);
}

export async function setAutoDetectGames(enable: boolean) {
    const config = await loadConfig();
    const nextConfig: Config = {
        ...config,
        autoDetectGames: !!enable,
    };
    await saveConfig(nextConfig);
    Logger.info(`Auto-detect-games ${enable ? 'enabled' : 'disabled'}`);
}

export async function setIGDBConnectionMode(mode: IGDBConnectionMode) {
    const config = await loadConfig();
    const nextConfig: Config = {
        ...config,
        igdbConnectionMode: mode,
    };
    await saveConfig(nextConfig);
    Logger.info(`IGDB connection mode set to ${mode}`);
}

export async function setIGDBApiBaseUrl(baseUrl: string) {
    const config = await loadConfig();
    const nextConfig: Config = {
        ...config,
        igdbApiBaseUrl: normalizeApiBaseUrl(baseUrl) || defaultConfig.igdbApiBaseUrl,
    };
    await saveConfig(nextConfig);
    Logger.info(`IGDB API base URL saved to ${nextConfig.igdbApiBaseUrl}`);
}

export async function ensureRunOnStartupAppliedOnLaunch() {
    const config = await loadConfig();
    if (config.runOnStartup === null || config.runOnStartup === undefined) {
        try {
            await setRunOnStartup(true, config.runReduced === true);
            Logger.info('Run-on-startup was enabled in config and re-applied on launch.');
        } catch (err) {
            Logger.error('Failed to re-apply run-on-startup during launch sync:', err);
        }
        return;
    }

    if (!config.runOnStartup) {
        return;
    }

    const currentlyEnabled = await getRunOnStartup();
    if (currentlyEnabled) {
        return;
    }

    try {
        await setRunOnStartup(true, config.runReduced === true);
        Logger.info('Run-on-startup was enabled in config but missing in OS startup list. Re-applied on launch.');
    } catch (err) {
        Logger.error('Failed to re-apply run-on-startup during launch sync:', err);
    }
}

export async function saveConfig(config: Config) {
    const configPath = await getConfigPath();
    await ensureParentDir(configPath);
    await writeTextFile(configPath, JSON.stringify(config, null, 2));
    Logger.info(`Configuration saved to ${configPath}`);
}

export async function getConfigPath() {
    const appDataPath = await appDataDir();
    return await join(appDataPath, 'GameLibrary', 'config.json');
}

export async function getGameConfigPath(gameId: string) {
    const appDataPath = await appDataDir();
    return await join(appDataPath, 'GameLibrary', 'games', `${gameId}`, 'config.json');
}

export async function saveGameConfig(gameId: string, config: GameConfig) {
    const configPath = await getGameConfigPath(gameId);
    await ensureParentDir(configPath);
    await writeTextFile(configPath, JSON.stringify(config, null, 2));
    Logger.info(`Game configuration for ${gameId} saved to ${configPath}`);
}

export async function loadGameConfig(gameId: string) {
    const configPath = await getGameConfigPath(gameId);
    try {
        const fileExists = await exists(configPath);
        if (!fileExists) {
            Logger.warn(`Game config file not found for game ID ${gameId} at ${configPath}, creating default game config.`);
            await ensureParentDir(configPath);
            await writeTextFile(configPath, JSON.stringify(defaultGameConfig, null, 2));
            return defaultGameConfig;
        }
        const content = await readTextFile(configPath);
        return JSON.parse(content);
    } catch (err) {
        Logger.error(`Error occurred while reading game config for game ID ${gameId} at ${configPath}:`, err);
        return null;
    }
}

export async function getGameCachePath(gameId: string) {
    const appDataPath = await appDataDir();
    return await join(appDataPath, 'GameLibrary', 'games', `${gameId}`, 'cache', 'info.json');
}

export async function loadGameCache(gameId: string) {
    const cachePath = await getGameCachePath(gameId);
    try {
        const fileExists = await exists(cachePath);
        if (!fileExists) {
            Logger.warn(`Game cache file not found for game ID ${gameId} at ${cachePath}, creating default game cache.`);
            await ensureParentDir(cachePath);
            await writeTextFile(cachePath, JSON.stringify(defaultGameCacheConfig, null, 2));
            return defaultGameCacheConfig;
        }
        const content = await readTextFile(cachePath);
        return JSON.parse(content);
    } catch (err) {
        Logger.error(`Error occurred while reading game cache for game ID ${gameId} at ${cachePath}:`, err);
        return null;
    }
}

export async function saveGameInfoCache(gameId: string, info: GameCacheConfig) {
    const cachePath = await getGameCachePath(gameId);
    await ensureParentDir(cachePath);
    await writeTextFile(cachePath, JSON.stringify(info, null, 2));
    Logger.info(`Game info cache for ${gameId} saved to ${cachePath}`);
}

export async function setGameArguments(gameId: string, args: string) {
    const config = await loadGameConfig(gameId);
    config.customArguments = args;
    await saveGameConfig(gameId, config);
    Logger.info(`Custom arguments for game ID ${gameId} set to: ${args}`);
}

export async function getGameArguments(gameId: string) {
    const config = await loadGameConfig(gameId);
    return config.customArguments;
}

export async function getGameListPath() {
    const appDataPath = await appDataDir();
    return await join(appDataPath, 'GameLibrary', 'games.json');
}

export async function getPlayHistoryPath() {
    const appDataPath = await appDataDir();
    return await join(appDataPath, 'GameLibrary', 'plays.json');
}

export async function loadPlayHistory() {
    const playHistoryPath = await getPlayHistoryPath();
    try {
        const fileExists = await exists(playHistoryPath);
        if (!fileExists) {
            Logger.warn(`Play history file not found at ${playHistoryPath}, creating default play history.`);
            await ensureParentDir(playHistoryPath);
            await writeTextFile(playHistoryPath, JSON.stringify(defaultPlayHistory, null, 2));
            return defaultPlayHistory;
        }
        const content = await readTextFile(playHistoryPath);
        const parsed = JSON.parse(content);
        if (!Array.isArray(parsed?.plays)) {
            return defaultPlayHistory;
        }
        return parsed as PlayHistory;
    } catch (err) {
        Logger.error(`Error occurred while reading play history at ${playHistoryPath}:`, err);
        return defaultPlayHistory;
    }
}

export async function savePlayHistory(playHistory: PlayHistory) {
    const playHistoryPath = await getPlayHistoryPath();
    await ensureParentDir(playHistoryPath);
    await writeTextFile(playHistoryPath, JSON.stringify(playHistory, null, 2));
    Logger.info(`Play history saved to ${playHistoryPath}`);
}

export async function addPlayHistoryEntry(gameId: string, playedAt?: string) {
    const playHistory = await loadPlayHistory();
    const timestamp = playedAt || new Date().toISOString();

    playHistory.plays.push({
        id: `${gameId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        gameId,
        playedAt: timestamp,
    });

    await savePlayHistory(playHistory);
    Logger.info(`Play history entry added for game ID ${gameId} at ${timestamp}`);
}

export async function updateLatestPlayHistoryEntry(gameId: string) {
    const playHistory = await loadPlayHistory();
    const entriesForGame = playHistory.plays.filter((entry) => entry.gameId === gameId);
    if (entriesForGame.length === 0) {
        Logger.warn(`No play history entries found for game ID ${gameId} to update.`);
        return;
    }
    const latestEntry = entriesForGame.reduce((latest, entry) => {
        return new Date(entry.playedAt) > new Date(latest.playedAt) ? entry : latest;
    }, entriesForGame[0]);

    latestEntry.playedAt = new Date().toISOString();
    await savePlayHistory(playHistory);
    Logger.info(`Latest play history entry for game ID ${gameId} updated to current timestamp.`);
}

export async function getPlayHistory(gameId?: string) {
    const playHistory = await loadPlayHistory();
    const allPlays = playHistory.plays || [];

    if (!gameId) {
        return allPlays;
    }

    return allPlays.filter((entry) => entry.gameId === gameId);
}

export async function getLatestPlayHistory(limit = 10, gameId?: string) {
    const plays = await getPlayHistory(gameId);
    return [...plays]
        .sort((a, b) => new Date(b.playedAt).getTime() - new Date(a.playedAt).getTime())
        .slice(0, Math.max(0, limit));
}

export async function removePlayHistoryEntry(entryId: string) {
    const playHistory = await loadPlayHistory();
    const nextEntries = playHistory.plays.filter((entry) => entry.id !== entryId);

    if (nextEntries.length === playHistory.plays.length) {
        Logger.warn(`Play history entry not found for removal: ${entryId}`);
        return;
    }

    await savePlayHistory({ plays: nextEntries });
    Logger.info(`Play history entry removed: ${entryId}`);
}

export async function clearPlayHistory() {
    await savePlayHistory(defaultPlayHistory);
    Logger.info('Play history has been cleared.');
}

export async function loadGameList() {
    const gameListPath = await getGameListPath();
    try {
        const fileExists = await exists(gameListPath);
        if (!fileExists) {
            Logger.warn(`Game list file not found at ${gameListPath}, creating default game list.`);
            await ensureParentDir(gameListPath);
            await writeTextFile(gameListPath, JSON.stringify(defaultGameList, null, 2));
            return defaultGameList;
        }
        const content = await readTextFile(gameListPath);
        return JSON.parse(content);
    } catch (err) {
        Logger.error(`Error occurred while reading game list at ${gameListPath}:`, err);
        return defaultGameList;
    }
}

export async function saveGameList(gameList: GameList) {
    const gameListPath = await getGameListPath();
    await ensureParentDir(gameListPath);
    await writeTextFile(gameListPath, JSON.stringify(gameList, null, 2));
    Logger.info(`Game list saved to ${gameListPath}`);
}

export async function addGameToList(game: GameListEntry) {
    const gameList = await loadGameList();
    if (!gameList.games.find((g: GameListEntry) => g.id === game.id)) {
        gameList.games.push(game);
        await saveGameList(gameList);
        Logger.success(`Game added to list: ${game.name} (ID: ${game.id})`);
    } else {
        Logger.warn(`Game already exists in list: ${game.name} (ID: ${game.id})`);
    }
}

export async function addGamesToList(games: GameListEntry[]) {
    const gameList = await loadGameList();
    const existingPaths = new Set(gameList.games.map((g: GameListEntry) => normalizePathForCompare(g.path)));
    const seenIncomingPaths = new Set<string>();
    let addedCount = 0;

    for (const game of games) {
        const normalizedPath = normalizePathForCompare(game.path);
        if (!normalizedPath) {
            Logger.warn(`Skipping game with invalid path while adding to list: ${game.name} (ID: ${game.id})`);
            continue;
        }

        if (seenIncomingPaths.has(normalizedPath)) {
            Logger.warn(`Skipping duplicate incoming game path: ${game.name} at ${game.path}`);
            continue;
        }

        seenIncomingPaths.add(normalizedPath);

        if (existingPaths.has(normalizedPath)) {
            Logger.warn(`Game path already exists in list, skipping: ${game.name} at ${game.path}`);
            continue;
        }

        gameList.games.push(game);
        existingPaths.add(normalizedPath);
        Logger.info(`Game added to list: ${game.name} (ID: ${game.id})`);
        addedCount++;
    }

    if (addedCount > 0) {
        await saveGameList(gameList);
        Logger.success(`Added ${addedCount} new games to the list.`);
    } else {
        Logger.warn('No new games were added to the list.');
    }
}

export async function setCacheFetched(gameId: string, fetched: boolean) {
    const cacheData = await loadGameCache(gameId);
    if (cacheData) {
        cacheData.fetched = fetched;
        await saveGameInfoCache(gameId, cacheData);
        Logger.info(`Set cache fetched status for game ID ${gameId} to ${fetched}`);
    } else {
        Logger.warn(`Cannot set cache fetched status, game cache not found for game ID ${gameId}`);
    }
}

export async function removeGameFromList(gameId: string) {
    const gameList = await loadGameList();
    const index = gameList.games.findIndex((g: GameListEntry) => g.id === gameId);
    if (index !== -1) {
        const removedGame = gameList.games.splice(index, 1)[0];
        await saveGameList(gameList);
        Logger.success(`Game removed from list: ${removedGame.name} (ID: ${removedGame.id})`);
    } else {
        Logger.warn(`Game not found in list, cannot remove: ID ${gameId}`);
    }
}

export async function getGameList() {
    const gameList = await loadGameList();
    return gameList.games;
}

/**
 * Converts a local file path to a file:// URL
 * Params: filePath (string) - local file path
 * Returns: string - file:// URL
 */
function convertFilePathToUrl(filePath: string): string {
    // Remove leading/trailing whitespace
    filePath = filePath.trim()
    
    // Convert backslashes to forward slashes (for Windows paths)
    filePath = filePath.replace(/\\/g, '/')
    
    // Add file:// prefix if not already present
    if (!filePath.startsWith('file://')) {
        // For Windows paths like C:/..., add file:///
        // For Unix paths like /home/..., add file://
        if (filePath[1] === ':') {
            // Windows absolute path
            filePath = 'file:///' + filePath
        } else {
            // Unix absolute path
            filePath = 'file://' + filePath
        }
    }
    
    return filePath
}

/**
 * Resolves image URLs for a game, preferring local paths if set
 * Params: config (GameConfig), cacheData (GameCacheConfig)
 * Returns: Object with coverUrl and thumbnailUrl
 */
export function resolveGameImageUrls(config: GameConfig | null, cacheData: GameCacheConfig | null) {
    const localCoverPath = config?.localCoverPath
    const localBannerPath = config?.localBannerPath
    
    return {
        coverUrl: localCoverPath ? convertFilePathToUrl(localCoverPath) : (cacheData?.cover_url || undefined),
        thumbnailUrl: localBannerPath ? convertFilePathToUrl(localBannerPath) : (cacheData?.thumbnail_url || undefined),
    };
}

/**
 * Get the cache style directory for a game
 * Params: gameId (string)
 * Returns: string - path to style folder
 */
export async function getGameStyleDir(gameId: string) {
    const appDataPath = await appDataDir();
    return await join(appDataPath, 'GameLibrary', 'games', `${gameId}`, 'cache', 'style');
}

/**
 * Get the cover image path for a game
 * Params: gameId (string)
 * Returns: string - path to cover.{ext} file
 */
export async function getGameCoverPath(gameId: string): Promise<string | null> {
    const styleDir = await getGameStyleDir(gameId);
    const styleExists = await exists(styleDir);
    
    if (!styleExists) {
        return null;
    }
    
    try {
        const entries = await readDir(styleDir);
        const coverEntry = entries.find(entry => entry.name?.startsWith('cover.'));
        if (coverEntry && coverEntry.name) {
            return await join(styleDir, coverEntry.name);
        }
    } catch (err) {
        Logger.warn(`Failed to find cover file for game ${gameId}:`, err);
    }
    
    return null;
}

/**
 * Get the thumbnail image path for a game
 * Params: gameId (string)
 * Returns: string - path to thumbnail.{ext} file
 */
export async function getGameThumbnailPath(gameId: string): Promise<string | null> {
    const styleDir = await getGameStyleDir(gameId);
    const styleExists = await exists(styleDir);
    
    if (!styleExists) {
        return null;
    }
    
    try {
        const entries = await readDir(styleDir);
        const thumbnailEntry = entries.find(entry => entry.name?.startsWith('thumbnail.'));
        if (thumbnailEntry && thumbnailEntry.name) {
            return await join(styleDir, thumbnailEntry.name);
        }
    } catch (err) {
        Logger.warn(`Failed to find thumbnail file for game ${gameId}:`, err);
    }
    
    return null;
}

/**
 * Copy a file to the game's style cache directory with the specified name
 * Params: gameId (string), sourceFilePath (string), fileName ('cover' or 'thumbnail')
 * Returns: string - path to copied file
 */
export async function copyFileToGameCache(gameId: string, sourceFilePath: string, fileName: 'cover' | 'thumbnail'): Promise<string> {
    const styleDir = await getGameStyleDir(gameId);
    
    // Ensure style directory exists
    await mkdir(styleDir, { recursive: true });
    
    // Get file extension from source
    const ext = await extname(sourceFilePath);
    const destFileName = `${fileName}.${ext}`;
    const destFilePath = await join(styleDir, destFileName);
    
    // Remove existing file if it exists
    if (await exists(destFilePath)) {
        await remove(destFilePath);
    }
    
    // Copy file using Rust backend
    try {
        await invoke('copy_file', { 
            source: sourceFilePath,
            destination: destFilePath 
        });
        Logger.info(`Copied ${fileName} file to game cache: ${destFilePath}`);
        return destFilePath;
    } catch (err) {
        Logger.error(`Failed to copy file to game cache: ${err}`);
        throw new Error(`Failed to copy ${fileName} file: ${err}`);
    }
}

export async function setConfigSortField(field: string) {
    const config = await loadConfig();
    const nextConfig: Config = {
        ...config,
        sortField: field as any,
    };
    await saveConfig(nextConfig);
    Logger.info(`Sort field set to ${field}`);
}

export async function setConfigSortOrder(order: 'asc' | 'desc') {
    const config = await loadConfig();
    const nextConfig: Config = {
        ...config,
        sortOrder: order,
    };
    await saveConfig(nextConfig);
    Logger.info(`Sort order set to ${order}`);
}

export type { GameListEntry, GameCacheConfig, GameConfig, Config, PlayHistoryEntry, PlayHistory } from '../types/appTypes';