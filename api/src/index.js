import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { readFile } from 'node:fs/promises'

dotenv.config()

const PORT = Number(process.env.PORT || 8787)
const TWITCH_CLIENT_ID = (process.env.TWITCH_CLIENT_ID || '').trim()
const TWITCH_CLIENT_SECRET = (process.env.TWITCH_CLIENT_SECRET || '').trim()
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token'
const IGDB_BASE_URL = 'https://api.igdb.com/v4'
const GITHUB_RELEASES_LATEST_URL = 'https://github.com/Ezzud/gamelibrary/releases/latest'
const GITHUB_RELEASE_DOWNLOAD_BASE_URL = 'https://github.com/Ezzud/gamelibrary/releases/download'
const workspacePackageJsonUrl = new URL('../package.json', import.meta.url)
const workspacePackageJson = JSON.parse(await readFile(workspacePackageJsonUrl, 'utf8'))
const API_VERSION = (workspacePackageJson.version || '0.0.0').trim()

const ansi = {
	reset: '\u001b[0m',
	dim: '\u001b[2m',
	bold: '\u001b[1m',
	cyan: '\u001b[36m',
	green: '\u001b[32m',
	yellow: '\u001b[33m',
	red: '\u001b[31m',
	magenta: '\u001b[35m',
	white: '\u001b[37m',
}

const colorize = (value, color) => `${color}${value}${ansi.reset}`
const colorStatusCode = (statusCode) => {
	if (statusCode >= 500) {
		return colorize(statusCode, ansi.red)
	}

	if (statusCode >= 400) {
		return colorize(statusCode, ansi.yellow)
	}

	if (statusCode >= 300) {
		return colorize(statusCode, ansi.magenta)
	}

	return colorize(statusCode, ansi.green)
}

const logger = {
	info: (message) => {
		process.stdout.write(`${colorize('[api]', ansi.cyan)} ${message}\n`)
	},
	success: (message) => {
		process.stdout.write(`${colorize('[api]', ansi.green)} ${message}\n`)
	},
	warn: (message) => {
		process.stdout.write(`${colorize('[api]', ansi.yellow)} ${message}\n`)
	},
	error: (message, error) => {
		process.stderr.write(`${colorize('[api]', ansi.red)} ${message}${error ? ` ${colorize(String(error), ansi.dim)}` : ''}\n`)
	},
	request: (method, path, statusCode, elapsedMs) => {
		const prefix = colorize('[api]', ansi.cyan)
		const verb = colorize(method, ansi.bold + ansi.white)
		const route = colorize(path, ansi.bold + ansi.cyan)
		const status = colorStatusCode(statusCode)
		const delay = colorize(`${elapsedMs}ms`, ansi.dim)

		process.stdout.write(`${prefix} ${verb} ${route} -> ${status} ${delay}\n`)
	},
}

const specificGameRenames = {
	'Minecraft for Windows': 'Minecraft',
	'Minecraft Launcher': 'Minecraft: Java Edition',
	assettocorsa: 'Assetto Corsa',
	'Hatsune Miku Project DIVA Mega Mix Plus': 'Hatsune Miku: Project DIVA Mega Mix+',
	'DB Xenoverse 2': 'Dragon Ball Xenoverse 2',
}

const accessTokenCache = {
	token: null,
	expiresAt: 0,
}

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))
app.use((req, res, next) => {
	if (req.url === '/api') {
		req.url = '/'
		return next()
	}

	if (req.url.startsWith('/api/')) {
		req.url = req.url.slice(4)
	}

	next()
})
app.use((req, res, next) => {
	req.startTime = Date.now()
	const requestPath = `${req.originalUrl || req.url}`

	res.on('finish', () => {
		const elapsedMs = Date.now() - req.startTime
		logger.request(req.method, requestPath, res.statusCode, elapsedMs)
	})

	next()
})

const normalizeName = (value) =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()

const splitCamelCaseName = (value) =>
	value
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
		.replace(/([A-Za-z])([0-9])/g, '$1 $2')
		.replace(/([0-9])([A-Za-z])/g, '$1 $2')
		.replace(/\s+/g, ' ')
		.trim()

const scoreNameMatch = (query, candidate) => {
	const queryNorm = normalizeName(query)
	const candidateNorm = normalizeName(candidate)
	if (!queryNorm || !candidateNorm) {
		return 0
	}

	if (queryNorm === candidateNorm) {
		return 1000
	}

	let score = 0
	if (candidateNorm.includes(queryNorm)) {
		score += 180
	}
	if (queryNorm.includes(candidateNorm)) {
		score += 120
	}

	const queryTokens = new Set(queryNorm.split(' ').filter(Boolean))
	const candidateTokens = new Set(candidateNorm.split(' ').filter(Boolean))
	let intersection = 0
	queryTokens.forEach((token) => {
		if (candidateTokens.has(token)) {
			intersection++
		}
	})

	const union = new Set([...queryTokens, ...candidateTokens]).size || 1
	const jaccard = intersection / union
	score += jaccard * 200

	return score
}

const escapeApicalypseSearch = (value) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

const buildSearchVariants = (gameName) => {
	const trimmed = gameName.trim()
	const withoutDemo = trimmed.replace(/\bdemo\b/gi, ' ').replace(/\s+/g, ' ').trim()
	const splitAlphaNumeric = trimmed
		.replace(/([A-Za-z])([0-9])/g, '$1 $2')
		.replace(/([0-9])([A-Za-z])/g, '$1 $2')
		.replace(/\s+/g, ' ')
		.trim()
	const camelAndNumericSpaced = splitCamelCaseName(splitAlphaNumeric)
	const normalized = normalizeName(trimmed)
	const noBrackets = trimmed.replace(/[\(\[\{].*?[\)\]\}]/g, ' ').replace(/\s+/g, ' ').trim()
	const beforeDelimiter = trimmed.split(/[:\-|]/)[0].trim()

	const variants = [trimmed, withoutDemo, splitAlphaNumeric, camelAndNumericSpaced, noBrackets, beforeDelimiter, normalized]
		.map((variant) => variant.trim())
		.filter((variant) => variant.length >= 2)

	return Array.from(new Set(variants))
}

const normalizeVersion = (version) => version.trim().replace(/^v/i, '')

const getTwitchCredentials = () => {
	if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET) {
		throw new Error('Missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET in api/.env')
	}

	return {
		clientId: TWITCH_CLIENT_ID,
		clientSecret: TWITCH_CLIENT_SECRET,
	}
}

const getAccessToken = async () => {
	const now = Date.now()
	if (accessTokenCache.token && accessTokenCache.expiresAt > now) {
		return accessTokenCache.token
	}

	const { clientId, clientSecret } = getTwitchCredentials()
	const response = await fetch(`${TWITCH_TOKEN_URL}?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&grant_type=client_credentials`, {
		method: 'POST',
	})

	if (!response.ok) {
		throw new Error(`Twitch token request failed with status ${response.status}`)
	}

	const data = await response.json()
	if (!data?.access_token) {
		throw new Error('Twitch token response did not include an access token')
	}

	accessTokenCache.token = data.access_token
	accessTokenCache.expiresAt = now + 60 * 60 * 1000
	return accessTokenCache.token
}

const igdbPost = async (endpoint, body) => {
	const { clientId } = getTwitchCredentials()
	const accessToken = await getAccessToken()

	const response = await fetch(`${IGDB_BASE_URL}/${endpoint}`, {
		method: 'POST',
		headers: {
			'Client-ID': clientId,
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'text/plain',
		},
		body,
	})

	if (!response.ok) {
		throw new Error(`IGDB request to ${endpoint} failed with status ${response.status}`)
	}

	return await response.text()
}

const fetchArtworkUrl = async (artworkId) => {
	const responseText = await igdbPost('artworks', `fields url; where id = ${artworkId};`)
	const data = JSON.parse(responseText)
	if (Array.isArray(data) && data.length > 0 && data[0]?.url) {
		return data[0].url
	}

	return null
}

const searchGame = async (gameName) => {
	try {
		const mappedGameName = specificGameRenames[gameName] || gameName
		const resultsById = new Map()

		const runVariantSearches = async (variantSource) => {
			const variants = buildSearchVariants(variantSource)
			for (const variant of variants) {
				const escapedVariant = escapeApicalypseSearch(variant)
				const responseText = await igdbPost('games', `search "${escapedVariant}"; fields id,name,cover.url,platforms.name,total_rating_count,game_type,artworks; limit 20;`)
				const data = JSON.parse(responseText)
				if (Array.isArray(data)) {
					for (const game of data) {
						if (game?.id && !resultsById.has(game.id)) {
							resultsById.set(game.id, game)
						}
					}
				}
			}
		}

		await runVariantSearches(mappedGameName)

		if (resultsById.size === 0 && /\bdemo\b/i.test(mappedGameName)) {
			const withoutDemo = mappedGameName.replace(/\bdemo\b/gi, ' ').replace(/\s+/g, ' ').trim()
			if (withoutDemo.length >= 2) {
				await runVariantSearches(withoutDemo)
			}
		}

		if (resultsById.size === 0) {
			const camelSpacedName = splitCamelCaseName(mappedGameName)
			if (camelSpacedName && camelSpacedName !== mappedGameName.trim()) {
				await runVariantSearches(camelSpacedName)
			}
		}

		const candidates = Array.from(resultsById.values())
		if (candidates.length === 0) {
			return { success: false, code: 'GAME_NOT_FOUND', data: null }
		}

		const best = candidates.sort((a, b) => {
			const aScore = scoreNameMatch(mappedGameName, a?.name || '')
			const bScore = scoreNameMatch(mappedGameName, b?.name || '')
			if (aScore !== bScore) {
				return bScore - aScore
			}

			const aPopularity = Number(a?.total_rating_count || 0)
			const bPopularity = Number(b?.total_rating_count || 0)
			return bPopularity - aPopularity
		})[0]

		const rawCoverUrl = best.cover && best.cover.url ? best.cover.url : null
		const fixedCoverUrl = rawCoverUrl ? rawCoverUrl.replace('t_thumb', 't_cover_big') : null

		let thumbnailUrl = null
		if (best.artworks && best.artworks.length > 0) {
			const artworkId = best.artworks[0]
			thumbnailUrl = await fetchArtworkUrl(artworkId)
		}
		if (thumbnailUrl) {
			thumbnailUrl = thumbnailUrl.replace('t_thumb', 't_1080p')
		}

		return {
			success: true,
			data: {
				title: best.name,
				cover_url: fixedCoverUrl,
				thumbnail_url: thumbnailUrl,
				id: best.id,
			},
		}
	} catch (error) {
		logger.error('Failed to search IGDB game:', error)
		return { success: false, code: 'FETCH_ERROR', data: null }
	}
}

const getGameDetails = async (gameId) => {
	try {
		const responseText = await igdbPost('games', `fields name,cover.url,platforms.name,artworks; where id = ${gameId};`)
		const data = JSON.parse(responseText)
		if (!Array.isArray(data) || data.length === 0) {
			return null
		}

		const game = data[0]
		let thumbnailUrl = null
		if (game.artworks && game.artworks.length > 0) {
			const artworkId = game.artworks[0]
			thumbnailUrl = await fetchArtworkUrl(artworkId)
		}
		if (thumbnailUrl) {
			thumbnailUrl = thumbnailUrl.replace('t_thumb', 't_1080p')
		}

		return {
			title: game.name,
			cover_url: game.cover ? game.cover.url : null,
			thumbnail_url: thumbnailUrl,
		}
	} catch (error) {
		logger.error('Failed to fetch IGDB game details:', error)
		return null
	}
}

app.get('/health', (req, res) => {
	res.json({
		version: API_VERSION,
		pingMs: Date.now() - req.startTime,
	})
})

app.get('/updater/:distribution', async (req, res) => {
	const distribution = String(req.params.distribution || '').trim().toLowerCase()
	const distributionSuffixes = {
		nsis: '',
		linux: '-linux',
		macos: '-macos',
	}

	if (!Object.prototype.hasOwnProperty.call(distributionSuffixes, distribution)) {
		return res.status(404).json({ error: 'Unknown updater distribution' })
	}

	try {
		const latestResponse = await fetch(GITHUB_RELEASES_LATEST_URL, { redirect: 'manual' })
		const location = latestResponse.headers.get('location') || ''
		const tagMatch = location.match(/\/tag\/(v[^/?#]+)$/i)
		const baseTag = tagMatch?.[1].match(/^v\d+\.\d+\.\d+/i)?.[0]

		if (!baseTag) {
			throw new Error('GitHub latest release did not redirect to a version tag')
		}

		const releaseTag = `${baseTag}${distributionSuffixes[distribution]}`
		const updaterUrl = `${GITHUB_RELEASE_DOWNLOAD_BASE_URL}/${encodeURIComponent(releaseTag)}/latest.json`
		return res.redirect(302, updaterUrl)
	} catch (error) {
		logger.error(`Failed to resolve updater manifest for ${distribution}:`, error)
		return res.status(502).json({ error: 'Unable to resolve the latest release' })
	}
})

app.post('/igdb/search', async (req, res) => {
	const gameName = typeof req.body?.gameName === 'string' ? req.body.gameName.trim() : ''
	if (!gameName) {
		return res.status(400).json({ success: false, code: 'INVALID_REQUEST', data: null })
	}

	const result = await searchGame(gameName)
	return res.status(200).json(result)
})

app.post('/igdb/details', async (req, res) => {
	const gameId = Number(req.body?.gameId)
	if (!Number.isFinite(gameId)) {
		return res.status(400).json(null)
	}

	const result = await getGameDetails(gameId)
	return res.status(result ? 200 : 404).json(result)
})

app.post('/igdb/artwork', async (req, res) => {
	const artworkId = Number(req.body?.artworkId)
	if (!Number.isFinite(artworkId)) {
		return res.status(400).json({ url: null })
	}

	try {
		const url = await fetchArtworkUrl(artworkId)
		return res.json({ url })
	} catch (error) {
		logger.error('Failed to fetch IGDB artwork:', error)
		return res.status(500).json({ url: null })
	}
})

app.use((error, req, res, next) => {
	logger.error('Unhandled error:', error)
	if (res.headersSent) {
		return next(error)
	}
	res.status(500).json({ error: 'Internal server error' })
})

app.listen(PORT, () => {
	logger.success(`GameLibrary API v${API_VERSION} listening on http://localhost:${PORT}`)
})
