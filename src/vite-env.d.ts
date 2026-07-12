/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_IGDB_CLIENT_ID: string
	readonly VITE_IGDB_CLIENT_SECRET: string
	readonly VITE_DISCORD_RPC_APP_ID: string
}

interface ImportMeta {
	readonly env: ImportMetaEnv
}
