// Default config path: Appdata/Local/GameLibrary/config.json
import { exists, mkdir, readTextFile, writeTextFile, readDir, remove } from '@tauri-apps/plugin-fs'
import { appDataDir, dirname, join } from '@tauri-apps/api/path'
import { Logger } from '../utils/Logger'

interface Config {
    customScanFolders: string[]
    twitchClientId: string
    twitchClientSecret: string
}


interface GameConfig {
    customArguments: string
    defaultLaunchFile?: string
    allLaunchFiles?: string[],
    lockedLaunchFile?: boolean,
    specialTags?: string[]
}
interface GameCacheConfig {
    title: string | null
    cover_url: string | null
    thumbnail_url?: string | null
    igdb_id: number | null
    id: string | null
    platform: string | null
    folder: string
    fetched: boolean
}
interface GameListEntry {
    id: string
    name: string
    path: string
    launchFile: string
    platform: string
}
interface GameList {
    games: GameListEntry[]
}

interface PlayHistoryEntry {
    id: string
    gameId: string
    playedAt: string
}

interface PlayHistory {
    plays: PlayHistoryEntry[]
}


const defaultConfig: Config = {
    customScanFolders: [],
    twitchClientId: '',
    twitchClientSecret: '',
};
const defaultGameConfig: GameConfig = {
    customArguments: '',
    defaultLaunchFile: undefined,
    allLaunchFiles: undefined,
    lockedLaunchFile: false,
    specialTags: []
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

export async function deleteGameCache(gameId: string) {
    const cachePath = await getGameCachePath(gameId);
    try {
        const fileExists = await exists(cachePath);
        if (fileExists) {
            const currentConfig = await loadGameCache(gameId);
            let defaultConfig = defaultGameCacheConfig;
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
            twitchClientId: typeof parsed?.twitchClientId === 'string' ? parsed.twitchClientId : '',
            twitchClientSecret: typeof parsed?.twitchClientSecret === 'string' ? parsed.twitchClientSecret : '',
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
    let addedCount = 0;
    for (const game of games) {
        let existingGame = gameList.games.find((g: GameListEntry) => g.id === game.id);
        if (!existingGame) {
            gameList.games.push(game);
            Logger.info(`Game added to list: ${game.name} (ID: ${game.id})`);
            addedCount++;
        } else {
            Logger.warn(`Game already exists in list, skipping: ${game.name} (ID: ${game.id})`);
        }
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

export type { GameListEntry, GameCacheConfig, GameConfig, Config, PlayHistoryEntry, PlayHistory };