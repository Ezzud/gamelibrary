import { Logger } from "../utils/Logger";
import { invoke } from "@tauri-apps/api/core";
import { getAppConfig, loadGameCache, loadGameConfig, saveGameInfoCache } from "./ConfigManager";
import type { IGDBConnectionMode, IGDBCredentials } from "../types/appTypes";

const DEFAULT_GAME_LIBRARY_API_URL = 'https://gamelibrary.ezzud.fr/api';

const accessTokenCache: { token: string | null, expiresAt: number } = {
	token: null,
	expiresAt: 0
};

const activeCredentials: IGDBCredentials = {
	clientId: '',
	clientSecret: '',
};

let temporaryConnectionModeOverride: IGDBConnectionMode | null = null;

const specificGameRenames = {
	"Minecraft for Windows": "Minecraft",
	"Minecraft Launcher": "Minecraft: Java Edition",
	"assettocorsa": "Assetto Corsa",
	"Hatsune Miku Project DIVA Mega Mix Plus": "Hatsune Miku: Project DIVA Mega Mix+",
	"DB Xenoverse 2": "Dragon Ball Xenoverse 2"
};

const normalizeApiBaseUrl = (value: string) => value.trim().replace(/\/+$/, '');

const buildApiUrl = (baseUrl: string, path: string) => {
	const normalizedBaseUrl = normalizeApiBaseUrl(baseUrl) || DEFAULT_GAME_LIBRARY_API_URL;
	const normalizedPath = path.startsWith('/') ? path : `/${path}`;
	return `${normalizedBaseUrl}${normalizedPath}`;
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

const resolveTwitchCredentials = async (credentials?: IGDBCredentials) => {
	if (credentials) {
		return {
			clientId: credentials.clientId.trim(),
			clientSecret: credentials.clientSecret.trim(),
		};
	}

	const config = await getAppConfig();
	return {
		clientId: (config.twitchClientId || '').trim(),
		clientSecret: (config.twitchClientSecret || '').trim(),
	};
};

const resolveIGDBRuntimeConfig = async (credentials?: IGDBCredentials) => {
	const config = await getAppConfig();
	const connectionMode: IGDBConnectionMode = temporaryConnectionModeOverride || (config.igdbConnectionMode === 'twitch' ? 'twitch' : 'api');
	const apiBaseUrl = normalizeApiBaseUrl(config.igdbApiBaseUrl || DEFAULT_GAME_LIBRARY_API_URL) || DEFAULT_GAME_LIBRARY_API_URL;
	const twitchCredentials = await resolveTwitchCredentials(credentials);

	return {
		connectionMode,
		apiBaseUrl,
		twitchCredentials,
	};
};

export const setIGDBCredentials = (clientId: string, clientSecret: string) => {
	applyIGDBCredentials({ clientId, clientSecret });
};

export const setTemporaryIGDBConnectionMode = (mode: IGDBConnectionMode | null) => {
	temporaryConnectionModeOverride = mode;
	Logger.info(`Temporary IGDB connection mode set to ${mode || 'none'}`);
};

export const getTemporaryIGDBConnectionMode = () => temporaryConnectionModeOverride;

const getValidAccessToken = async (credentials?: IGDBCredentials): Promise<string> => {
	const now = Date.now();
	if (accessTokenCache.token && accessTokenCache.expiresAt > now) {
		return accessTokenCache.token;
	}

	const token = await getIGDBAccessToken(credentials);
	accessTokenCache.token = token;
	accessTokenCache.expiresAt = now + 60 * 60 * 1000;
	return token;
};

export const testGameLibraryApi = async (baseUrl?: string) => {
	const controller = new AbortController();
	const timeoutId = window.setTimeout(() => controller.abort(), 5000);
	try {
		let pingRequestStart = Date.now();
		const normalizedBaseUrl = normalizeApiBaseUrl(baseUrl || DEFAULT_GAME_LIBRARY_API_URL) || DEFAULT_GAME_LIBRARY_API_URL;
		const response = await fetch(buildApiUrl(normalizedBaseUrl, '/health?t=' + Date.now()), {
			signal: controller.signal,
		});
		if (!response.ok) {
			throw new Error(`GameLibrary API health check failed with status ${response.status}`);
		}

		const data = await response.json() as { version?: string; pingMs?: number; ping?: number };
		return {
			success: true,
			data: {
				version: typeof data.version === 'string' ? data.version : null,
				pingRequest: Date.now() - pingRequestStart,
				pingMs: typeof data.pingMs === 'number' ? data.pingMs : typeof data.ping === 'number' ? data.ping : null,
			},
		};
	} catch (err) {
		Logger.error('Failed to test GameLibrary API connection:', err);
		return { success: false, data: null };
	} finally {
		window.clearTimeout(timeoutId);
	}
};

export const initIGDB = async (credentials?: IGDBCredentials): Promise<boolean> => {
	const runtime = await resolveIGDBRuntimeConfig(credentials);

	if (runtime.connectionMode === 'api' && !credentials) {
		const health = await testGameLibraryApi(runtime.apiBaseUrl);
		if (health.success) {
			Logger.success('GameLibrary API initialized successfully (' + health.data?.version + (typeof health.data?.pingRequest === 'number' ? `, ${health.data.pingRequest}ms` : '') + ').');
			return true;
		}

		Logger.error('Failed to initialize GameLibrary API');
		return false;
	}

	const previousCredentials = {
		clientId: activeCredentials.clientId,
		clientSecret: activeCredentials.clientSecret,
	};

	applyIGDBCredentials(runtime.twitchCredentials);

	try {
		await getValidAccessToken(runtime.twitchCredentials);
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

export const getIGDBAccessToken = async (credentials?: IGDBCredentials): Promise<string> => {
	try {
		const twitchCredentials = credentials ? {
			clientId: credentials.clientId.trim(),
			clientSecret: credentials.clientSecret.trim(),
		} : activeCredentials.clientId && activeCredentials.clientSecret ? activeCredentials : (await resolveTwitchCredentials());

		if (!twitchCredentials.clientId || !twitchCredentials.clientSecret) {
			throw new Error('Missing IGDB credentials');
		}

		const token = await invoke<string>('igdb_get_access_token', {
			clientId: twitchCredentials.clientId,
			clientSecret: twitchCredentials.clientSecret,
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

const fetchArtworkUrlViaTwitch = async (artworkId: number, credentials?: IGDBCredentials): Promise<string | null> => {
	try {
		const accessToken = await getValidAccessToken(credentials);
		const twitchCredentials = credentials ? {
			clientId: credentials.clientId.trim(),
			clientSecret: credentials.clientSecret.trim(),
		} : activeCredentials;
		const responseText = await invoke<string>('igdb_post', {
			endpoint: 'artworks',
			body: `fields url; where id = ${artworkId};`,
			clientId: twitchCredentials.clientId,
			accessToken,
		});
		const data = JSON.parse(responseText);
		if (data.length > 0 && data[0].url) {
			return data[0].url;
		}
		return null;
	} catch (err) {
		Logger.error(`Error occurred while fetching artwork URL from IGDB for artwork ID ${artworkId}:`, err);
		return null;
	}
};

const searchGameViaTwitch = async (gameName: string, credentials?: IGDBCredentials) => {
	const mappedGameName = specificGameRenames[gameName as keyof typeof specificGameRenames] || gameName;
	const accessToken = await getValidAccessToken(credentials);
	const twitchCredentials = credentials ? {
		clientId: credentials.clientId.trim(),
		clientSecret: credentials.clientSecret.trim(),
	} : activeCredentials;
	const resultsById = new Map<number, any>();

	const runVariantSearches = async (variantSource: string) => {
		const variants = buildSearchVariants(variantSource);
		for (const variant of variants) {
			const escapedVariant = escapeApicalypseSearch(variant);
			const responseText = await invoke<string>('igdb_post', {
				endpoint: 'games',
				body: `search "${escapedVariant}"; fields id,name,cover.url,platforms.name,total_rating_count,game_type,artworks; limit 20;`,
				clientId: twitchCredentials.clientId,
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

		let thumbnailUrl = null;
		if (best.artworks && best.artworks.length > 0) {
			const artworkId = best.artworks[0];
			thumbnailUrl = await fetchArtworkUrlViaTwitch(artworkId, credentials);
		}
		if (thumbnailUrl) thumbnailUrl = thumbnailUrl.replace('t_thumb', 't_1080p');

		return {
			success: true,
			data: {
				title: best.name,
				cover_url: fixedCoverUrl,
				thumbnail_url: thumbnailUrl,
				id: best.id
			}
		};
	}

	return { success: false, code: 'GAME_NOT_FOUND', data: null };
};

const getGameDetailsViaTwitch = async (gameId: number, credentials?: IGDBCredentials) => {
	const accessToken = await getValidAccessToken(credentials);
	const twitchCredentials = credentials ? {
		clientId: credentials.clientId.trim(),
		clientSecret: credentials.clientSecret.trim(),
	} : activeCredentials;
	const responseText = await invoke<string>('igdb_post', {
		endpoint: 'games',
		body: `fields name,cover.url,platforms.name,artworks; where id = ${gameId};`,
		clientId: twitchCredentials.clientId,
		accessToken,
	});
	const data = JSON.parse(responseText);
	if (data.length === 0) {
		return null;
	}

	const game = data[0];
	Logger.info(`Fetched details for game ID ${gameId} from IGDB:`, game);

	let thumbnailUrl = null;
	if (game.artworks && game.artworks.length > 0) {
		const artworkId = game.artworks[0];
		thumbnailUrl = await fetchArtworkUrlViaTwitch(artworkId, credentials);
	}
	if (thumbnailUrl) thumbnailUrl = thumbnailUrl.replace('t_thumb', 't_1080p');

	return {
		title: game.name,
		cover_url: game.cover ? game.cover.url : null,
		thumbnail_url: thumbnailUrl
	};
};

const searchGameViaApi = async (gameName: string, baseUrl: string) => {
	const response = await fetch(buildApiUrl(baseUrl, '/igdb/search'), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ gameName }),
	});

	if (!response.ok) {
		throw new Error(`GameLibrary API search failed with status ${response.status}`);
	}

	return await response.json() as { success: boolean; code?: string; data: { title: string; cover_url: string | null; thumbnail_url: string | null; id: number | null } | null };
};

const getGameDetailsViaApi = async (gameId: number, baseUrl: string) => {
	const response = await fetch(buildApiUrl(baseUrl, '/igdb/details'), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ gameId }),
	});

	if (!response.ok) {
		throw new Error(`GameLibrary API details request failed with status ${response.status}`);
	}

	return await response.json() as { title: string | null; cover_url: string | null; thumbnail_url: string | null } | null;
};

export const fetchArtworkUrl = async (artworkId: number): Promise<string | null> => {
	return await fetchArtworkUrlViaTwitch(artworkId);
};

export const searchGame = async (gameName: string) => {
	try {
		const runtime = await resolveIGDBRuntimeConfig();
		if (runtime.connectionMode === 'api') {
			return await searchGameViaApi(gameName, runtime.apiBaseUrl);
		}

		return await searchGameViaTwitch(gameName, runtime.twitchCredentials);
	} catch (err) {
		Logger.error(`Error occurred while fetching game data from IGDB for "${gameName}":`, err);
		return { success: false, code: 'FETCH_ERROR', data: null };
	}
};

export const getGameDetails = async (gameId: number) => {
	try {
		const runtime = await resolveIGDBRuntimeConfig();
		if (runtime.connectionMode === 'api') {
			return await getGameDetailsViaApi(gameId, runtime.apiBaseUrl);
		}

		return await getGameDetailsViaTwitch(gameId, runtime.twitchCredentials);
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

	const config = await loadGameConfig(gameId);
	const configuredSearchName = typeof config?.searchName === 'string' ? config.searchName.trim() : '';
	const searchName = configuredSearchName || gameName;

	// Get forced_igdb_id from config instead of cache
	const forcedIGDBId = config?.forced_igdb_id;

	await saveGameInfoCache(gameId, {
		...cacheData,
		title: null,
		cover_url: null,
		thumbnail_url: null,
		igdb_id: null,
		platform: cacheData.platform || null,
		fetched: false,
	});

	let igdbData: any;

	// If forced_igdb_id is set, use getGameDetails instead of searchGame
	if (forcedIGDBId && typeof forcedIGDBId === 'number') {
		const gameDetails = await getGameDetails(forcedIGDBId);
		if (gameDetails) {
			igdbData = {
				success: true,
				data: {
					title: gameDetails.title,
					cover_url: gameDetails.cover_url,
					thumbnail_url: gameDetails.thumbnail_url,
					id: forcedIGDBId
				}
			};
		} else {
			throw new Error('Failed to fetch game details using forced_igdb_id.');
		}
	} else {
		igdbData = await searchGame(searchName);
	}

	if (!igdbData.success || !igdbData.data) {
		throw new Error('Failed to refetch IGDB data.');
	}

	await saveGameInfoCache(gameId, {
		...cacheData,
		title: igdbData.data.title || cacheData.title,
		cover_url: igdbData.data.cover_url || null,
		thumbnail_url: igdbData.data.thumbnail_url || null,
		igdb_id: igdbData.data.id || null,
		platform: cacheData.platform || null,
		fetched: true,
	});

	return {
		title: igdbData.data.title || null,
		cover_url: igdbData.data.cover_url || null,
		thumbnail_url: igdbData.data.thumbnail_url || null,
		igdb_id: igdbData.data.id || null,
		platform: cacheData.platform || null,
		forced_igdb_id: forcedIGDBId
	};
}