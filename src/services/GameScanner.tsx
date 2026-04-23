import { exists, readDir } from "@tauri-apps/plugin-fs";
import { open } from "@tauri-apps/plugin-dialog";
import { appDataDir } from "@tauri-apps/api/path";
import { Logger } from "../utils/Logger";
import { searchGame } from "./GameDataManager";
import { addGamesToList, saveGameConfig, saveGameInfoCache, loadGameList, loadGameConfig, removeGameFromList, getCustomScanFolders, getIgnoredFolders, loadGameCache } from "./ConfigManager";
import type { GameCacheConfig, GameConfig, GameListEntry } from "./ConfigManager";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const SteamPaths = [
    "Program Files (x86)/Steam",
    "Program Files/Steam",
    "Steam"
];
const SteamLibraryPath = "SteamLibrary/steamapps/common";
const SteamPath = "steamapps/common";
const blacklistedGames = [
    "Steam Controller Configs",
    "SteamVR",
    "SteamVR Home",
    "SteamVR Performance Test",
    "SteamVR Workshop Tools",
    "wallpaper_engine",
    "Steam360VideoPlayer",
    "Steamworks Shared",
    "Unreal Development Kit",
    "DesktopPlus",
    "Soundpad"
]
const blacklistedLaunchFiles = [
    "steam.exe",
    "steamvr.exe",
    "wallpaper_engine.exe",
    "UnityCrashHandler64.exe",
    "UnrealCEFSubProcess.exe"
]
const nonGameLaunchFilePatterns = [
    /^setup/i,
    /^unins/i,
    /^uninstall/i,
    /^vc_redist/i,
    /^dxsetup/i,
    /^crashreport/i,
    /^eula/i,
    /^launcher\s*installer/i,
]
const GOGGalaxyDefaultPaths = [
    "Program Files (x86)/GOG Galaxy/Games",
    "Program Files/GOG Galaxy/Games",
    "GOG Galaxy/Games"
]
const GOGGalaxyOtherPaths = [
    "GOG Galaxy/Games"
]
const GOGGamesPaths = [
    "GOG Games"
];
const XboxGamesPath = "XboxGames";

export interface ScanProgressUpdate {
    percent: number;
    message: string;
}

type ScanProgressCallback = (update: ScanProgressUpdate) => void;

const inFlightRegistrationPaths = new Set<string>();

function normalizePathForCompare(value: string) {
    return value.replace(/\\/g, '/').replace(/\/+$/, '').trim().toLowerCase();
}

function createIgnoredPathMatcher(ignoredFolders: string[]) {
    const normalizedIgnoredFolders = ignoredFolders
        .map((folder) => normalizePathForCompare(folder))
        .filter(Boolean);

    return (candidatePath: string) => {
        const normalizedCandidatePath = normalizePathForCompare(candidatePath);
        return normalizedIgnoredFolders.some(
            (ignoredFolder) => normalizedCandidatePath === ignoredFolder || normalizedCandidatePath.startsWith(`${ignoredFolder}/`)
        );
    };
}

function reportProgress(onProgress: ScanProgressCallback | undefined, percent: number, message: string) {
    if (!onProgress) {
        return;
    }

    const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
    onProgress({ percent: safePercent, message });
}

function mapProgress(value: number, fromStart: number, fromEnd: number, toStart: number, toEnd: number) {
    if (fromEnd <= fromStart) {
        return toStart;
    }

    const normalized = (value - fromStart) / (fromEnd - fromStart);
    return toStart + normalized * (toEnd - toStart);
}

async function fileExistsCaseInsensitive(path: string, fileName: string) {
    try {
        const entries = await readDir(path);
        return entries.some((entry) => !entry.isDirectory && entry.name.toLowerCase() === fileName.toLowerCase());
    } catch {
        return false;
    }
}

    async function resolveChildDirectoryCaseInsensitive(parentPath: string, directoryName: string): Promise<string | null> {
        try {
            const entries = await readDir(parentPath);
            const matched = entries.find(
                (entry) => entry.isDirectory && entry.name.toLowerCase() === directoryName.toLowerCase()
            );

            if (!matched) {
                return null;
            }

            return `${parentPath}/${matched.name}`;
        } catch {
            return null;
        }
    }

async function hasFileInSubtree(rootPath: string, targetFileName: string, maxDepth = 5): Promise<boolean> {
    if (maxDepth < 0) {
        return false;
    }

    try {
        const entries = await readDir(rootPath);
        for (const entry of entries) {
            const entryPath = `${rootPath}/${entry.name}`;

            if (!entry.isDirectory && entry.name.toLowerCase() === targetFileName.toLowerCase()) {
                return true;
            }

            if (entry.isDirectory) {
                const found = await hasFileInSubtree(entryPath, targetFileName, maxDepth - 1);
                if (found) {
                    return true;
                }
            }
        }
    } catch {
        return false;
    }

    return false;
}

async function hasFileInDirectChildBinariesWin64(rootPath: string, targetFileName: string): Promise<boolean> {
    try {
        const entries = await readDir(rootPath);
        for (const entry of entries) {
            if (!entry.isDirectory) {
                continue;
            }

            const childPath = `${rootPath}/${entry.name}`;
            const foundInChildWin64 = await fileExistsCaseInsensitive(`${childPath}/Binaries/Win64`, targetFileName);
            if (foundInChildWin64) {
                return true;
            }
        }
    } catch {
        return false;
    }

    return false;
}

async function hasSteamworksVersionedWin64File(gamePath: string, targetFileName: string): Promise<boolean> {
    const steamworksRoot = `${gamePath}/Engine/Binaries/ThirdParty/Steamworks`;

    try {
        const steamworksExists = await exists(steamworksRoot);
        if (!steamworksExists) {
            return false;
        }

        const steamworksEntries = await readDir(steamworksRoot);
        for (const entry of steamworksEntries) {
            if (!entry.isDirectory) {
                continue;
            }

            if (!entry.name.toLowerCase().startsWith('steamv')) {
                continue;
            }

            const win64Path = `${steamworksRoot}/${entry.name}/Win64`;
            const found = await fileExistsCaseInsensitive(win64Path, targetFileName);
            if (found) {
                return true;
            }
        }
    } catch {
        return false;
    }

    return false;
}

export async function findSpecialTagsForGamePath(gamePath: string, gameId: string): Promise<string[]> {
    const specialTags: string[] = [];
    const addSpecialTag = (tag: string) => {
        if (!specialTags.includes(tag)) {
            specialTags.push(tag);
        }
    };

    try {
        const entries = await readDir(gamePath);
        const normalizedGamePath = gamePath.replace(/[\\/]+$/, "");
        const gameFolderName = normalizedGamePath.split(/[\\/]/).pop()?.toLowerCase() || "";
        const gameCache = await loadGameCache(gameId);
        const platform = gameCache.platform;
        switch (platform) {
            case "Steam":
                addSpecialTag("steam");
                break;
            case "GOG":
                addSpecialTag("gog");
                break;
            case "EpicGames":
                addSpecialTag("epic");
                break;
            case "EA":
                addSpecialTag("ea");
                break;
            case "Xbox":
                addSpecialTag("xbox");
                break;
        }

        if (entries.find((e) => !e.isDirectory && e.name.toLowerCase() === "vbs.cmd")) {
            addSpecialTag("hypervisor");
        }
        if (entries.find((e) => !e.isDirectory && e.name.toLowerCase().endsWith("vr.exe"))) {
            addSpecialTag("vr");
        }
        if (gameFolderName.endsWith("vr")) {
            addSpecialTag("vr");
        }

        if (entries.find((e) => !e.isDirectory && e.name.toLowerCase() === "onlinefix64.dll")) {
            addSpecialTag("onlinefixed");
        }
        // If game folder contains "OnlineFix64.dll" in Engine\Binaries\ThirdParty\Steamworks\SteamvANYNUMBER\Win64, add tag "onlinefixed"
        if (await hasSteamworksVersionedWin64File(normalizedGamePath, "OnlineFix64.dll")) {
            addSpecialTag("onlinefixed");
        }
        // If game folder contains "cream_api.ini" in Engine\Binaries\ThirdParty\Steamworks\SteamvANYNUMBER\Win64, add tag "onlinefixed"
        if (await hasSteamworksVersionedWin64File(normalizedGamePath, "cream_api.ini")) {
            addSpecialTag("onlinefixed");
        }
        // If game folder contains "OnlineFix64.dll" in Binaries\, add tag "cracked"
        const hasOnlineFixInBinariesWin64 = await fileExistsCaseInsensitive(`${normalizedGamePath}/Binaries/Win64`, "OnlineFix64.dll");
        const hasOnlineFixAnywhereInBinaries = await hasFileInSubtree(`${normalizedGamePath}/Binaries`, "OnlineFix64.dll", 4);
        const hasOnlineFixInNestedBinaries = await hasFileInDirectChildBinariesWin64(normalizedGamePath, "OnlineFix64.dll");
        if (hasOnlineFixInBinariesWin64 || hasOnlineFixAnywhereInBinaries || hasOnlineFixInNestedBinaries) {
            addSpecialTag("cracked");
        }
        // If game folder contains "unsteam.dll " BW\Binaries\Win64, add tag "cracked"
        if (await fileExistsCaseInsensitive(`${normalizedGamePath}/BW/Binaries/Win64`, "unsteam.dll")) {
            addSpecialTag("cracked");
        }
        // If game folder contains "steam_emu.ini" in Engine\Binaries\ThirdParty\Steamworks\SteamvANYNUMBER\Win64, add tag "cracked"
        if (await hasSteamworksVersionedWin64File(normalizedGamePath, "steam_emu.ini")) {
            addSpecialTag("cracked");
        }
        // If game folder contains _Redist\fitgirl.md5, add tag "cracked"
        const redistPath = await resolveChildDirectoryCaseInsensitive(normalizedGamePath, "_Redist");
        if (redistPath && await hasFileInSubtree(redistPath, "fitgirl.md5", 6)) {
            addSpecialTag("cracked");
        }
    } catch (err) {
        Logger.error(`Error occurred while finding special tags for ${gamePath}:`, err);
    }

    return specialTags;
}

export async function refetchAllSpecialTags(onProgress?: ScanProgressCallback) {
    try {
        reportProgress(onProgress, 0, 'Preparing special tags refetch...');
        const gameList = await loadGameList();
        const games = gameList.games || [];

        if (games.length < 1) {
            reportProgress(onProgress, 100, 'No games found to refetch tags.');
            return;
        }

        for (let index = 0; index < games.length; index++) {
            const game = games[index];
            reportProgress(
                onProgress,
                mapProgress(index, 0, games.length, 0, 100),
                `Refetching tags ${index + 1}/${games.length}: ${game.name}`
            );

            const specialTags = await findSpecialTagsForGamePath(game.path, game.id);
            const existingConfig = await loadGameConfig(game.id);
            const mergedConfig: GameConfig = {
                customArguments: existingConfig?.customArguments || '',
                defaultLaunchFile: existingConfig?.defaultLaunchFile,
                allLaunchFiles: existingConfig?.allLaunchFiles,
                lockedLaunchFile: existingConfig?.lockedLaunchFile,
                specialTags,
            };

            await saveGameConfig(game.id, mergedConfig);
        }

        reportProgress(onProgress, 100, 'Special tags refetch complete.');
    } catch (err) {
        Logger.error('Error occurred while refetching special tags:', err);
        reportProgress(onProgress, 100, 'Special tags refetch failed.');
    }
}

export async function scanAndAddCustomFolderGames(onProgress?: ScanProgressCallback) {
    try {
        reportProgress(onProgress, 0, 'Preparing custom folder scan...');
        const allCustomFolders = await getCustomScanFolders();
        if (allCustomFolders.length < 1) {
            reportProgress(onProgress, 100, 'No custom folders configured.');
            return;
        }
        const ignoredFolders = await getIgnoredFolders();
        const isIgnoredPath = createIgnoredPathMatcher(ignoredFolders);

        for (let index = 0; index < allCustomFolders.length; index++) {
            const folder = allCustomFolders[index];
            if (isIgnoredPath(folder)) {
                Logger.info(`Skipping ignored custom scan folder: ${folder}`);
                continue;
            }
            const rangeStart = mapProgress(index, 0, allCustomFolders.length, 0, 100);
            const rangeEnd = mapProgress(index + 1, 0, allCustomFolders.length, 0, 100);

            reportProgress(onProgress, rangeStart, `Scanning folder ${index + 1}/${allCustomFolders.length}: ${folder}`);
            const games = await fetchAllCustomFolderGames(folder);
            Logger.info(`Found ${games.length} games in custom folder: ${folder}`);

            await registerGames(games, "Custom", (update) => {
                const mappedPercent = mapProgress(update.percent, 0, 100, rangeStart, rangeEnd);
                reportProgress(onProgress, mappedPercent, `[${index + 1}/${allCustomFolders.length}] ${update.message}`);
            });
        }

        reportProgress(onProgress, 100, 'Custom folder scan complete.');
    } catch (err) {
        Logger.error('Error occurred while scanning and adding custom folder games:', err);
        reportProgress(onProgress, 100, 'Custom folder scan failed.');
    }
}

export async function scanAndAddSteamGames(onProgress?: ScanProgressCallback) {
    try {
        reportProgress(onProgress, 0, 'Preparing Steam scan...');
        reportProgress(onProgress, 15, 'Discovering Steam games...');
        const games = await fetchAllSteamGames();
        Logger.info(`Found ${games.length} games in Steam libraries.`);
        reportProgress(onProgress, 55, `Found ${games.length} Steam games. Registering...`);

        await registerGames(games, "Steam", (update) => {
            const mappedPercent = mapProgress(update.percent, 0, 100, 55, 95);
            reportProgress(onProgress, mappedPercent, update.message);
        });

        reportProgress(onProgress, 100, 'Steam scan complete.');
    } catch (err) {
        Logger.error('Error occurred while scanning and adding Steam games:', err);
        reportProgress(onProgress, 100, 'Steam scan failed.');
    }
}

async function getMainDriveLetter() {
    try {
        const appDataPath = await appDataDir();
        const matched = appDataPath.match(/^([A-Za-z]):/);
        return matched ? matched[1].toUpperCase() : 'C';
    } catch {
        return 'C';
    }
}

export async function fetchGOGGames() {
    const games: any[] = [];
    const seenGameNames = new Set<string>();
    const seenGamePaths = new Set<string>();
    const ignoredFolders = await getIgnoredFolders();
    const isIgnoredPath = createIgnoredPathMatcher(ignoredFolders);

    const addDiscoveredGame = (game: {
        name: string;
        path: string;
        defaultLaunchFile: string | null;
        allLaunchFiles: string[] | null;
    }) => {
        if (isIgnoredPath(game.path)) {
            Logger.info(`Skipping ignored game path: ${game.path}`);
            return;
        }

        const normalizedName = game.name.toLowerCase().trim();
        const normalizedPath = game.path.replace(/\\/g, '/').toLowerCase();

        if (seenGameNames.has(normalizedName) || seenGamePaths.has(normalizedPath)) {
            Logger.warn(`Skipping duplicate game discovery: ${game.name} at ${game.path}`);
            return;
        }

        seenGameNames.add(normalizedName);
        seenGamePaths.add(normalizedPath);
        games.push({ id: null, ...game });
    };

    const scanLibraryRoot = async (libraryRoot: string) => {
        try {
            const pathExists = await exists(libraryRoot);
            if (!pathExists) {
                return;
            }

            Logger.success(`Found GOG library at: ${libraryRoot}`);
            const entries = await readDir(libraryRoot);

            for (const entry of entries) {
                if (!entry.isDirectory) {
                    continue;
                }

                const gamePath = `${libraryRoot}/${entry.name}`;
                const launchFiles = await getAllLaunchFiles(gamePath);
                if (launchFiles.length < 1) {
                    Logger.warn(`No launch files found for game at ${gamePath}, skipping.`);
                    continue;
                }
                if (blacklistedGames.find(g => g.toLowerCase() === entry.name.toLowerCase())) {
                    Logger.warn(`Game ${entry.name} is blacklisted, skipping.`);
                    continue;
                }

                addDiscoveredGame({
                    name: entry.name,
                    path: gamePath,
                    defaultLaunchFile: launchFiles[0] || null,
                    allLaunchFiles: launchFiles.length > 0 ? launchFiles : null
                });
            }
        } catch (err) {
            Logger.error(`Error occurred while fetching GOG games at ${libraryRoot}:`, err);
        }
    };

    const mainDrive = await getMainDriveLetter();
    for (const basePath of GOGGalaxyDefaultPaths) {
        const fullPath = `${mainDrive}:/${basePath}`;
        await scanLibraryRoot(fullPath);
    }

    const allDrivePaths = [...GOGGalaxyOtherPaths, ...GOGGamesPaths];
    for (const drive of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
        for (const basePath of allDrivePaths) {
            const fullPath = `${drive}:/${basePath}`;
            await scanLibraryRoot(fullPath);
        }
    }

    return games;
}

export async function scanAndAddGOGGames(onProgress?: ScanProgressCallback) {
    try {
        reportProgress(onProgress, 0, 'Preparing GOG scan...');
        reportProgress(onProgress, 15, 'Discovering GOG games...');
        const games = await fetchGOGGames();
        Logger.info(`Found ${games.length} games in GOG libraries.`);
        reportProgress(onProgress, 55, `Found ${games.length} GOG games. Registering...`);

        await registerGames(games, "GOG", (update) => {
            const mappedPercent = mapProgress(update.percent, 0, 100, 55, 95);
            reportProgress(onProgress, mappedPercent, update.message);
        });

        reportProgress(onProgress, 100, 'GOG scan complete.');
    } catch (err) {
        Logger.error('Error occurred while scanning and adding GOG games:', err);
        reportProgress(onProgress, 100, 'GOG scan failed.');
    }
}

export async function getLaunchFileName(gamePath: string) {
    try {
        const entries = await readDir(gamePath);
        for (const entry of entries) {
            if (!entry.isDirectory && (entry.name.endsWith('.exe') || entry.name.endsWith('.bat'))) {
                return entry.name;
            }
        }
        return null;
    } catch (err) {
        Logger.error(`Error occurred while getting launch file name from ${gamePath}:`, err);
        return null;
    }
}

export async function getAllLaunchFiles(gamePath: string) {
    try {
        const launchFiles: string[] = [];
        const folderName = gamePath.split('/').pop()?.toLowerCase() || '';

        // Helper to process entries and push valid launch files
        const processEntries = (entries: any[], prefix: string = '') => {
            for (const entry of entries) {
                if (!entry.isDirectory && (entry.name.endsWith('.exe') || entry.name.endsWith('.bat'))) {
                    const normalizedEntryName = entry.name.toLowerCase();
                    const baseFileName = normalizedEntryName.replace(/\.(exe|bat)$/i, '');
                    const isBlacklisted = blacklistedLaunchFiles.find(f => f.toLowerCase() === normalizedEntryName);
                    const matchesNonGamePattern = nonGameLaunchFilePatterns.some((pattern) => pattern.test(baseFileName));
                    const nameLooksRelatedToFolder = folderName.length > 3 && (baseFileName.includes(folderName) || folderName.includes(baseFileName));

                    if(!isBlacklisted && (!matchesNonGamePattern || nameLooksRelatedToFolder)) {
                        launchFiles.push(prefix + entry.name);
                    } else {
                        Logger.warn(`Launch file ${prefix}${entry.name} is blacklisted, skipping.`);
                    }
                }
            }
        };

        // Main folder
        const entries = await readDir(gamePath);
        processEntries(entries);

        // "Game" sub-folder
        const gameSubFolder = entries.find(e => e.isDirectory && e.name.toLowerCase() === 'game');
        if (gameSubFolder) {
            try {
                const subEntries = await readDir(`${gamePath}/Game`);
                processEntries(subEntries, 'Game/');
            } catch (subErr) {
                Logger.warn(`Could not read 'Game' sub-folder in ${gamePath}:`, subErr);
            }
        }

        // Sort launch file by exe then bat, and then alphabetically
        launchFiles.sort((a, b) => {
            const aIsExe = a.endsWith('.exe');
            const bIsExe = b.endsWith('.exe');
            if (aIsExe && !bIsExe) return -1;
            if (!aIsExe && bIsExe) return 1;
            return a.localeCompare(b);
        });
        return launchFiles;
    } catch (err) {
        Logger.error(`Error occurred while getting launch file names from ${gamePath}:`, err);
        return [];
    }
}


export async function fetchAllCustomFolderGames(folderPath: string) {
    const games: any[] = [];
    const seenGameNames = new Set<string>();
    const seenGamePaths = new Set<string>();
    const ignoredFolders = await getIgnoredFolders();
    const isIgnoredPath = createIgnoredPathMatcher(ignoredFolders);

    const normalizedFolderPath = folderPath.replace(/\\/g, '/').replace(/\/+$/, '');

    const addDiscoveredGame = (game: {
        name: string;
        path: string;
        defaultLaunchFile: string | null;
        allLaunchFiles: string[] | null;
    }) => {
        if (isIgnoredPath(game.path)) {
            Logger.info(`Skipping ignored game path: ${game.path}`);
            return;
        }

        const normalizedName = game.name.toLowerCase().trim();
        const normalizedPath = game.path.replace(/\\/g, '/').toLowerCase();

        if (seenGameNames.has(normalizedName) || seenGamePaths.has(normalizedPath)) {
            Logger.warn(`Skipping duplicate game discovery: ${game.name} at ${game.path}`);
            return;
        }

        seenGameNames.add(normalizedName);
        seenGamePaths.add(normalizedPath);
        games.push({ id: null, ...game });
    };

    try {
        const folderExists = await exists(normalizedFolderPath);
        if (!folderExists) {
            Logger.warn(`Custom folder does not exist: ${normalizedFolderPath}`);
            return games;
        }

        if (isIgnoredPath(normalizedFolderPath)) {
            Logger.info(`Custom games folder is ignored, skipping: ${normalizedFolderPath}`);
            return games;
        }

        Logger.success(`Found custom games folder at: ${normalizedFolderPath}`);
        const entries = await readDir(normalizedFolderPath);

        for (const entry of entries) {
            if (!entry.isDirectory) {
                continue;
            }

            const gamePath = `${normalizedFolderPath}/${entry.name}`;
            const launchFiles = await getAllLaunchFiles(gamePath);

            if (launchFiles.length < 1) {
                Logger.warn(`No launch files found for game at ${gamePath}, skipping.`);
                continue;
            }

            if (blacklistedGames.find(g => g.toLowerCase() === entry.name.toLowerCase())) {
                Logger.warn(`Game ${entry.name} is blacklisted, skipping.`);
                continue;
            }

            addDiscoveredGame({
                name: entry.name,
                path: gamePath,
                defaultLaunchFile: launchFiles.length > 0 ? launchFiles[0] : null,
                allLaunchFiles: launchFiles.length > 0 ? launchFiles : null
            });
        }
    } catch (err) {
        Logger.error(`Error occurred while fetching games from custom folder ${normalizedFolderPath}:`, err);
    }

    return games;
}

export async function fetchAllSteamGames() {
    const games: any[] = [];
    const seenGameNames = new Set<string>();
    const seenGamePaths = new Set<string>();
    const ignoredFolders = await getIgnoredFolders();
    const isIgnoredPath = createIgnoredPathMatcher(ignoredFolders);

    const addDiscoveredGame = (game: {
        name: string;
        path: string;
        defaultLaunchFile: string | null;
        allLaunchFiles: string[] | null;
    }) => {
        if (isIgnoredPath(game.path)) {
            Logger.info(`Skipping ignored game path: ${game.path}`);
            return;
        }

        const normalizedName = game.name.toLowerCase().trim();
        const normalizedPath = game.path.replace(/\\/g, '/').toLowerCase();

        if (seenGameNames.has(normalizedName) || seenGamePaths.has(normalizedPath)) {
            Logger.warn(`Skipping duplicate game discovery: ${game.name} at ${game.path}`);
            return;
        }

        seenGameNames.add(normalizedName);
        seenGamePaths.add(normalizedPath);
        games.push({ id: null, ...game });
    };

    for (const basePath of SteamPaths) {
        for (const drive of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
            const fullPath = `${drive}:/${basePath}/${SteamPath}`;
            try {
                const pathExists = await exists(fullPath);
                if (pathExists) {
                    Logger.success(`Found Steam library at: ${fullPath}`);
                    const entries = await readDir(fullPath);
                    for (const entry of entries) {
                        if (entry.isDirectory) {
                            const gamePath = `${fullPath}/${entry.name}`;
                            const launchFiles = await getAllLaunchFiles(gamePath);
                            if(launchFiles.length < 1) {
                                Logger.warn(`No launch files found for game at ${gamePath}, skipping.`);
                                continue;
                            }
                            if(blacklistedGames.find(g => g.toLowerCase() === entry.name.toLowerCase())) {
                                Logger.warn(`Game ${entry.name} is blacklisted, skipping.`);
                                continue;
                            }
                            addDiscoveredGame({
                                name: entry.name,
                                path: gamePath,
                                defaultLaunchFile: launchFiles.length > 0 ? launchFiles[0] : null,
                                allLaunchFiles: launchFiles.length > 0 ? launchFiles : null
                            });
                        }
                    }
                }
                
            } catch (err) {
                Logger.error(`Error occurred while fetching Steam games at ${fullPath}:`, err);
            }
        }
    }

    for (const drive of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
        const libraryPath = `${drive}:/${SteamLibraryPath}`;
        try {
            const libraryExists = await exists(libraryPath);
            if (libraryExists) {
                Logger.success(`Found additional Steam library at: ${libraryPath}`);
                const libraryEntries = await readDir(libraryPath);
                for (const entry of libraryEntries) {
                    if (entry.isDirectory) {
                        const gamePath = `${libraryPath}/${entry.name}`;
                        const launchFiles = await getAllLaunchFiles(gamePath);
                        if (launchFiles.length < 1) {
                            Logger.warn(`No launch files found for game at ${gamePath}, skipping.`);
                            continue;
                        }
                        if (blacklistedGames.find(g => g.toLowerCase() === entry.name.toLowerCase())) {
                            Logger.warn(`Game ${entry.name} is blacklisted, skipping.`);
                            continue;
                        }

                        addDiscoveredGame({
                            name: entry.name,
                            path: gamePath,
                            defaultLaunchFile: launchFiles.length > 0 ? launchFiles[0] : null,
                            allLaunchFiles: launchFiles.length > 0 ? launchFiles : null
                        });
                    }
                }
            }
        } catch (err) {
            Logger.error(`Error occurred while fetching additional Steam games at ${libraryPath}:`, err);
        }
    }

    return games;
}

export async function removeDuplicateGames() {
    const gameList = await loadGameList();
    const uniqueGames = [];
    const seenPaths = new Set<string>();

    for (const game of gameList.games) {
        const normalizedPath = game.path.replace(/\\/g, '/').toLowerCase();
        if (!seenPaths.has(normalizedPath)) {
            seenPaths.add(normalizedPath);
            uniqueGames.push(game);
        } else {
            Logger.warn(`Removing duplicate game entry: ${game.name} at ${game.path}`);
            await removeGameFromList(game.id);
        }
    }

    Logger.info(`Removed duplicates. ${uniqueGames.length} unique games remain.`);
}

async function generateGameId() {
    // game-number
    return `game-${Math.floor(Math.random() * 10000)}`;
}

export async function registerGames(games: any[], platform: string, onProgress?: ScanProgressCallback) {
    const gameList = await loadGameList();
    const existingPaths = new Set(
        (gameList.games || []).map((game: GameListEntry) => normalizePathForCompare(game.path))
    );
    const reservedPaths: string[] = [];

    Logger.info(`Registering ${games.length} games for platform: ${platform}`);
    const seenInputPaths = new Set<string>();
    games = games.filter((g: GameListEntry) => {
        const normalizedPath = normalizePathForCompare(g.path);

        if (!normalizedPath) {
            Logger.warn(`Skipping game with invalid path: ${g.name}`);
            return false;
        }

        if (seenInputPaths.has(normalizedPath)) {
            Logger.warn(`Skipping duplicate game in scan results: ${g.name} at ${g.path}`);
            return false;
        }

        if (existingPaths.has(normalizedPath)) {
            return false;
        }

        if (inFlightRegistrationPaths.has(normalizedPath)) {
            Logger.warn(`Skipping game already being registered: ${g.name} at ${g.path}`);
            return false;
        }

        seenInputPaths.add(normalizedPath);
        inFlightRegistrationPaths.add(normalizedPath);
        reservedPaths.push(normalizedPath);
        return true;
    });
    Logger.info(`${games.length} games remain after filtering out already registered games based on path.`);

    if (games.length < 1) {
        for (const path of reservedPaths) {
            inFlightRegistrationPaths.delete(path);
        }
        reportProgress(onProgress, 100, `No new ${platform} games to register.`);
        return;
    }

    try {
        for (let index = 0; index < games.length; index++) {
            const game = games[index];
            reportProgress(onProgress, mapProgress(index, 0, games.length, 0, 100), `Registering ${index + 1}/${games.length}: ${game.name}`);
            const gameData = await searchGame(game.name);
            const id = await generateGameId();
            game.id = id; // Assign generated ID to game object for later use
            if(gameData.success && gameData.data) {
                const gameEntry: GameCacheConfig = {
                    id,
                    title: gameData ? gameData.data.title : game.name,
                    cover_url: gameData ? gameData.data.cover_url : null,
                    igdb_id: gameData ? gameData.data.id : null,
                    platform: platform || null,
                    folder: game.path,
                    fetched: !!gameData,
                }

                try {
                    await saveGameInfoCache(id, gameEntry);
                    Logger.success(`Saved game info cache for ${gameEntry.title} with ID: ${id}`);
                } catch (err) {
                    Logger.error(`Error occurred while saving game info cache for ${gameEntry.title}:`, err);
                }
            } else {
                if(!gameData.success && gameData.code === 'GAME_NOT_FOUND') {
                    Logger.warn(`Game "${game.name}" not found in IGDB, saving with basic info only.`);
                    const gameEntry: GameCacheConfig = {
                        id,
                        title: game.name,
                        cover_url: null,
                        igdb_id: null,
                        platform: platform || null,
                        folder: game.path,
                        fetched: true,
                    }
                    try {
                    await saveGameInfoCache(id, gameEntry);
                        Logger.success(`Saved game info cache for ${gameEntry.title} with ID: ${id}`);
                    } catch (err) {
                        Logger.error(`Error occurred while saving game info cache for ${gameEntry.title}:`, err);
                    }
                }
            }

            // tags rules: 
            // If game folder contains file "VBS.cmd", add tag "hypervisor" to game config
            // If game folder contains a file ending with "VR.exe", add tag "vr" to game config
            // If game folder name ends with "VR", add tag "vr" to game config
            // If game folder contains a file named "OnlineFix64.dll", add tag "onlinefixed" to game config
            const specialTags = await findSpecialTagsForGamePath(game.path, game.id);


            const gameConfig: GameConfig = {
                customArguments: '',
                defaultLaunchFile: game.defaultLaunchFile,
                allLaunchFiles: game.allLaunchFiles,
                specialTags: specialTags
            } 

            try {
                await saveGameConfig(id, gameConfig);
                Logger.success(`Registered game ${id} (${game.name}) `);
            } catch (err) {
                Logger.error(`Error occurred while saving game config for ${game.name}:`, err);
            }

            await sleep(200);
        }

        await addGamesToList(games);
        reportProgress(onProgress, 100, `${platform} registration complete.`);
    } finally {
        for (const path of reservedPaths) {
            inFlightRegistrationPaths.delete(path);
        }
    }
}

export async function chooseFolder() {
    try {
        const selected = await open({
            directory: true,
            multiple: false
        });
        if (typeof selected === "string") {
            Logger.success(`User selected folder: ${selected}`);
            return selected;
        } else {
            Logger.warn('User cancelled folder selection');
            return null;
        }
    } catch (err) {
        Logger.error('Error occurred while opening folder dialog:', err);
        return null;
    }
}

export async function chooseFile() {
    try {
        const selected = await open({
            directory: false,
            multiple: false
        });
        if (typeof selected === "string") {
            Logger.success(`User selected file: ${selected}`);
            return selected;
        } else {
            Logger.warn('User cancelled file selection');
            return null;
        }
    } catch (err) {
        Logger.error('Error occurred while opening file dialog:', err);
        return null;
    }
}

export async function scanAndAddXboxGames(onProgress?: ScanProgressCallback) {
    try {
        reportProgress(onProgress, 0, 'Preparing Xbox scan...');
        reportProgress(onProgress, 15, 'Discovering Xbox games...');
        const games = await fetchAllXboxGames();
        Logger.info(`Found ${games.length} games in Xbox libraries.`);
        reportProgress(onProgress, 55, `Found ${games.length} Xbox games. Registering...`);

        await registerGames(games, "Xbox", (update) => {
            const mappedPercent = mapProgress(update.percent, 0, 100, 55, 95);
            reportProgress(onProgress, mappedPercent, update.message);
        });

        reportProgress(onProgress, 100, 'Xbox scan complete.');
    } catch (err) {
        Logger.error('Error occurred while scanning and adding Xbox games:', err);
        reportProgress(onProgress, 100, 'Xbox scan failed.');
    }
}

export async function fetchAllXboxGames() {
    const games: any[] = [];
    const seenGameNames = new Set<string>();
    const seenGamePaths = new Set<string>();
    const ignoredFolders = await getIgnoredFolders();
    const isIgnoredPath = createIgnoredPathMatcher(ignoredFolders);

    const addDiscoveredGame = (game: {
        name: string;
        path: string;
        defaultLaunchFile: string | null;
        allLaunchFiles: string[] | null;
    }) => {
        if (isIgnoredPath(game.path)) {
            Logger.info(`Skipping ignored game path: ${game.path}`);
            return;
        }

        const normalizedName = game.name.toLowerCase().trim();
        const normalizedPath = game.path.replace(/\\/g, '/').toLowerCase();

        if (seenGameNames.has(normalizedName) || seenGamePaths.has(normalizedPath)) {
            Logger.warn(`Skipping duplicate game discovery: ${game.name} at ${game.path}`);
            return;
        }

        seenGameNames.add(normalizedName);
        seenGamePaths.add(normalizedPath);
        games.push({ id: null, ...game });
    };

    for (const drive of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
        const libraryPath = `${drive}:/${XboxGamesPath}`;
        try {
            const libraryExists = await exists(libraryPath);
            if (!libraryExists) {
                continue;
            }

            Logger.success(`Found Xbox library at: ${libraryPath}`);
            const libraryEntries = await readDir(libraryPath);

            for (const entry of libraryEntries) {
                if (!entry.isDirectory) {
                    continue;
                }

                const gamePath = `${libraryPath}/${entry.name}`;
                const contentPath = await resolveChildDirectoryCaseInsensitive(gamePath, "Content");
                if (!contentPath) {
                    Logger.warn(`No Content folder found for potential Xbox game at ${gamePath}, skipping.`);
                    continue;
                }

                const launchFiles = await getAllLaunchFiles(contentPath);
                if (launchFiles.length < 1) {
                    Logger.warn(`No launch files found in Content folder for game at ${gamePath}, skipping.`);
                    continue;
                }

                if (blacklistedGames.find(g => g.toLowerCase() === entry.name.toLowerCase())) {
                    Logger.warn(`Game ${entry.name} is blacklisted, skipping.`);
                    continue;
                }

                const relativeLaunchFiles = launchFiles.map((fileName) => `Content/${fileName}`);

                addDiscoveredGame({
                    name: entry.name,
                    path: gamePath,
                    defaultLaunchFile: relativeLaunchFiles.length > 0 ? relativeLaunchFiles[0] : null,
                    allLaunchFiles: relativeLaunchFiles.length > 0 ? relativeLaunchFiles : null
                });
            }
        } catch (err) {
            Logger.error(`Error occurred while fetching Xbox games at ${libraryPath}:`, err);
        }
    }

    return games;
}