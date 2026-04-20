# GameLibrary

GameLibrary is a desktop game launcher and organizer built with Tauri, React, and TypeScript.

It helps you manage games from multiple sources, launch them reliably, track play activity, and enrich your library metadata with IGDB.

## Key Features

- Clean desktop UI for browsing and launching your games.
- Multi-source scanning workflow:
	- Steam
	- Custom folders
	- Extensible platform list for future providers
- Smart refresh behavior:
	- Rescans all custom folders
	- Rescans Steam when Steam titles exist in the current library
- Search, filter, and sort controls for fast library navigation.
- Launch file picker support when a game has multiple possible launch files.
- Recently played sidebar with one-click quick launch.
- Play history tracking and maintenance actions.
- Twitch credentials flow for IGDB integration.
- In-app update checker against this repository with version comparison.
- Persistent logging to app data logs:
	- latest.log (reset on each app launch)
	- DD-MM-YYYY.log

## Tech Stack

- Tauri 2
- React 19
- TypeScript
- Vite
- Tailwind CSS

## Getting Started

### Prerequisites

- Node.js 18+ (or current LTS)
- pnpm
- Rust toolchain
- Tauri system prerequisites (WebView2 and platform tooling)

### Install

Run:

pnpm install

### Development

Run:

pnpm tauri dev

### Production Build

Run:

pnpm tauri build

## Configuration and Data

GameLibrary stores config, game metadata, play history, and logs in the Tauri app data directory under the GameLibrary folder.

Important runtime data includes:

- App config (including Twitch credentials)
- Game list and per-game config/cache
- Play history
- Logs folder

## IGDB Credentials

To use IGDB-backed metadata, provide your Twitch Developer credentials in-app:

1. Open the Twitch Developer Console and create an application.
2. Copy your Client ID and Client Secret.
3. Open Settings in GameLibrary and connect credentials.

If credentials are missing or invalid, the app surfaces warnings and guidance in the UI.

## Update Checking

The Update section in App Config checks the repository package version from:

- https://github.com/Ezzud/gamelibrary

States shown in-app:

- Up to date
- New version available (with update action)
- Unable to fetch version

## Logging

Logs are written to both:

- latest.log (cleared at app launch)
- DD-MM-YYYY.log

This keeps a clean current-session log while preserving daily history.

## Recommended IDE Setup

- VS Code
- Tauri extension
- rust-analyzer extension
