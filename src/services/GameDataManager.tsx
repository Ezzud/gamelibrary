import { Logger } from "../utils/Logger";
import { invoke } from "@tauri-apps/api/core";
import { loadGameCache, saveGameInfoCache } from "./ConfigManager";

const envClientId = import.meta.env.VITE_IGDB_CLIENT_ID;
const envClientSecret = import.meta.env.VITE_IGDB_CLIENT_SECRET;

interface IGDBCredentials {
    clientId: string;
    clientSecret: string;
}

const activeCredentials: IGDBCredentials = {
    clientId: envClientId || '',
    clientSecret: envClientSecret || '',
};

if (!activeCredentials.clientId || !activeCredentials.clientSecret) {
    Logger.error('Missing IGDB credentials. Set VITE_IGDB_CLIENT_ID and VITE_IGDB_CLIENT_SECRET in your environment.');
}

const accessTokenCache: { token: string | null, expiresAt: number } = {
    token: null,
    expiresAt: 0
};

const specificGameRenames = {
    "Minecraft for Windows": "Minecraft",
    "Minecraft Launcher": "Minecraft: Java Edition",
    "assettocorsa": "Assetto Corsa",
    "Hatsune Miku Project DIVA Mega Mix Plus": "Hatsune Miku: Project DIVA Mega Mix+",
    "DB Xenoverse 2": "Dragon Ball Xenoverse 2"
};

const resetAccessTokenCache = () => {
    accessTokenCache.token = null;
    accessTokenCache.expiresAt = 0;
};

const applyIGDBCredentials = (credentials: IGDBCredentials) => {
    const nextClientId = credentials.clientId.trim();
    const nextClientSecret = credentials.clientSecret.trim();
    const changed = nextClientId !== activeCredentials.clientId || nextClientSecret !== activeCredentials.clientSecret;

    activeCredentials.clientId = nextClientId;
    activeCredentials.clientSecret = nextClientSecret;

    if (changed) {
        resetAccessTokenCache();
    }
};

export const setIGDBCredentials = (clientId: string, clientSecret: string) => {
    applyIGDBCredentials({ clientId, clientSecret });
};

const getValidAccessToken = async (): Promise<string> => {
    const now = Date.now();
    if (accessTokenCache.token && accessTokenCache.expiresAt > now) {
        return accessTokenCache.token;
    }

    const token = await getIGDBAccessToken();
    accessTokenCache.token = token;
    accessTokenCache.expiresAt = now + 60 * 60 * 1000;
    return token;
};

export const initIGDB = async (credentials?: IGDBCredentials): Promise<boolean> => {
    const previousCredentials = {
        clientId: activeCredentials.clientId,
        clientSecret: activeCredentials.clientSecret,
    };

    if (credentials) {
        applyIGDBCredentials(credentials);
    }

    try {
        await getValidAccessToken();
        Logger.success('IGDB initialized successfully');
        return true;
    } catch (err) {
        if (credentials) {
            applyIGDBCredentials(previousCredentials);
        }
        Logger.error('Failed to initialize IGDB:', err);
        return false;
    }
};

export const getIGDBAccessToken = async (): Promise<string> => {
    try {
        if (!activeCredentials.clientId || !activeCredentials.clientSecret) {
            throw new Error('Missing IGDB credentials');
        }

        const token = await invoke<string>('igdb_get_access_token', {
            clientId: activeCredentials.clientId,
            clientSecret: activeCredentials.clientSecret,
        });
        return token;
    } catch (err) {
        Logger.error('Error occurred while fetching IGDB access token:', err);
        throw err;
    }
};

const escapeApicalypseSearch = (value: string): string => {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
};

const normalizeName = (value: string): string => {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

const buildSearchVariants = (gameName: string): string[] => {
    const trimmed = gameName.trim();
    const withoutDemo = trimmed.replace(/\bdemo\b/gi, ' ').replace(/\s+/g, ' ').trim();
    const splitAlphaNumeric = trimmed
        .replace(/([A-Za-z])([0-9])/g, '$1 $2')
        .replace(/([0-9])([A-Za-z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim();
    const camelAndNumericSpaced = splitCamelCaseName(splitAlphaNumeric);
    const normalized = normalizeName(trimmed);
    const noBrackets = trimmed.replace(/[\(\[\{].*?[\)\]\}]/g, ' ').replace(/\s+/g, ' ').trim();
    const beforeDelimiter = trimmed.split(/[:\-|]/)[0].trim();

    const variants = [trimmed, withoutDemo, splitAlphaNumeric, camelAndNumericSpaced, noBrackets, beforeDelimiter, normalized]
        .map(v => v.trim())
        .filter(v => v.length >= 2);

    return Array.from(new Set(variants));
};

const splitCamelCaseName = (value: string): string => {
    return value
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim();
};

const scoreNameMatch = (query: string, candidate: string): number => {
    const queryNorm = normalizeName(query);
    const candidateNorm = normalizeName(candidate);
    if (!queryNorm || !candidateNorm) {
        return 0;
    }

    if (queryNorm === candidateNorm) {
        return 1000;
    }

    let score = 0;
    if (candidateNorm.includes(queryNorm)) {
        score += 180;
    }
    if (queryNorm.includes(candidateNorm)) {
        score += 120;
    }

    const queryTokens = new Set(queryNorm.split(' ').filter(Boolean));
    const candidateTokens = new Set(candidateNorm.split(' ').filter(Boolean));
    let intersection = 0;
    queryTokens.forEach(token => {
        if (candidateTokens.has(token)) {
            intersection++;
        }
    });

    const union = new Set([...queryTokens, ...candidateTokens]).size || 1;
    const jaccard = intersection / union;
    score += jaccard * 200;

    return score;
};

export const searchGame = async (gameName: string) => {
    try {
        const mappedGameName = specificGameRenames[gameName as keyof typeof specificGameRenames] || gameName;
        const accessToken = await getValidAccessToken();
        const resultsById = new Map<number, any>();

        const runVariantSearches = async (variantSource: string) => {
            const variants = buildSearchVariants(variantSource);
            for (const variant of variants) {
                const escapedVariant = escapeApicalypseSearch(variant);
                const responseText = await invoke<string>('igdb_post', {
                    endpoint: 'games',
                    body: `search "${escapedVariant}"; fields id,name,cover.url,platforms.name,total_rating_count,game_type; limit 20;`,
                    clientId: activeCredentials.clientId,
                    accessToken,
                });

                const data = JSON.parse(responseText);
                if (Array.isArray(data)) {
                    for (const game of data) {
                        if (game?.id && !resultsById.has(game.id)) {
                            resultsById.set(game.id, game);
                        }
                    }
                }
            }
        };

        await runVariantSearches(mappedGameName);

        if (resultsById.size === 0 && /\bdemo\b/i.test(mappedGameName)) {
            const withoutDemo = mappedGameName.replace(/\bdemo\b/gi, ' ').replace(/\s+/g, ' ').trim();
            if (withoutDemo.length >= 2) {
                await runVariantSearches(withoutDemo);
            }
        }

        if (resultsById.size === 0) {
            const camelSpacedName = splitCamelCaseName(mappedGameName);
            if (camelSpacedName && camelSpacedName !== mappedGameName.trim()) {
                await runVariantSearches(camelSpacedName);
            }
        }

        const candidates = Array.from(resultsById.values());
        if (candidates.length > 0) {
            const best = candidates.sort((a, b) => {
                const aScore = scoreNameMatch(mappedGameName, a?.name || '');
                const bScore = scoreNameMatch(mappedGameName, b?.name || '');
                if (aScore !== bScore) {
                    return bScore - aScore;
                }

                const aPopularity = Number(a?.total_rating_count || 0);
                const bPopularity = Number(b?.total_rating_count || 0);
                return bPopularity - aPopularity;
            })[0];

            const rawCoverUrl = best.cover && best.cover.url ? best.cover.url : null;
            const fixedCoverUrl = rawCoverUrl ? rawCoverUrl.replace('t_thumb', 't_cover_big') : null;
            const thumbnailUrl = rawCoverUrl ? rawCoverUrl.replace('t_cover_big', 't_1080p') : null;
            return {
                success: true,
                data: {
                    title: best.name,
                    cover_url: fixedCoverUrl,
                    thumbnail_url: thumbnailUrl,
                    id: best.id
                }
            };
        } else {
            return { success: false, code: 'GAME_NOT_FOUND', data: null };
        }
    } catch (err) {
        Logger.error(`Error occurred while fetching game data from IGDB for "${gameName}":`, err);
        return { success: false, code: 'FETCH_ERROR', data: null };
    }
};

export const getGameDetails = async (gameId: number) => {
    try {
        const accessToken = await getValidAccessToken();
        const responseText = await invoke<string>('igdb_post', {
            endpoint: 'games',
            body: `fields name,cover.url,platforms.name; where id = ${gameId};`,
            clientId: activeCredentials.clientId,
            accessToken,
        });
        const data = JSON.parse(responseText);
        if (data.length > 0) {
            const game = data[0];
            return {
                title: game.name,
                cover_url: game.cover ? game.cover.url : null
            };
        } else {
            return null;
        }
    } catch (err) {
        Logger.error(`Error occurred while fetching game details from IGDB for game ID ${gameId}:`, err);
        return null;
    }
};

export const getGameSize = (gamePath: string): Promise<number> => {
    return invoke<number>('get_directory_size', { path: gamePath })
        .catch((err) => {
            Logger.error(`Error occurred while getting game size for path ${gamePath}:`, err);
            throw err;
        });
}

export const resetAndRefetchGameIGDBData = async (gameId: string, gameName: string) => {
    const cacheData = await loadGameCache(gameId);
    if (!cacheData) {
        throw new Error('Failed to load game cache.');
    }

    await saveGameInfoCache(gameId, {
        ...cacheData,
        title: null,
        cover_url: null,
        thumbnail_url: null,
        igdb_id: null,
        fetched: false,
    });

    const igdbData = await searchGame(gameName);
    if (!igdbData.success || !igdbData.data) {
        throw new Error('Failed to refetch IGDB data.');
    }

    await saveGameInfoCache(gameId, {
        ...cacheData,
        title: igdbData.data.title || cacheData.title,
        cover_url: igdbData.data.cover_url || null,
        thumbnail_url: igdbData.data.thumbnail_url || null,
        igdb_id: igdbData.data.id || null,
        fetched: true,
    });

    return {
        title: igdbData.data.title || null,
        cover_url: igdbData.data.cover_url || null,
        thumbnail_url: igdbData.data.thumbnail_url || null,
        igdb_id: igdbData.data.id || null,
    };
}

