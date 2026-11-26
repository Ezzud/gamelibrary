# <img src="./src-tauri/icons/icon.png" width="48" style="vertical-align: middle; margin-right: 10px;" alt="GameLibrary icon"> GameLibrary


GameLibrary is a desktop app to regroup all of your installed games from all launchers, as well as configurable custom folders or games.
It has an integrated game launcher and playtime tracker to centralize every playtime from all games

-----
## Features

- Game Scanner: Choose what platform you want to scan your installed games, and it will work by itself and scan for new games every time you launch or refresh the library
![Scanner Demo](readme-assets/Scan.png)
<br>

- Fully Configurable: Configure everything on the app!
![Library Demo](readme-assets/Configurable.png)
<br>

- Custom Game Launcher: Specify launch arguments, choose your default launch file, Change cover style and banners. Track your playtime and your latest time played
![Scanner Demo](readme-assets/Library.png)
<br>

- Discord Presence: Fully configure a discord presence for every game
![RPC Demo](readme-assets/DiscordPresence.png)
<br>


- Self-hostable API, public API OR local igdb requests, you choose how you want to make requests!
![API Demo](readme-assets/API-Startup-Config.png)
<br>

- Custom Folders: Add custom folders where the app will try to find games on
![Scanner Demo](readme-assets/CustomFolders.png)
<br>

- Special tags: Add special tags for modified games/fixed games
- Favorites: Add your games to favorites to see them on top of your library
- Fully Client-side: The app only use IGDB for getting game covers, full name or thumbnail, which is not mandatory. The app can also make requests to Github for version checking, which is not mandatory too


-----

## How to install

- Go to the [RELEASES](https://github.com/Ezzud/gamelibrary/releases), If you don't know the specific details, go to [the official website](https://gamelibrary.ezzud.fr) and click "Download" to select your OS
- Download the executable related to your OS
- Launch the file and proceed to the installation

-----

## Stack

- Tauri v2
- React 19
- Vite
- TailwindCSS
- Lucide Icons
- NodeJS v20 + Typescript


-----

## How to compile yourself
Requirement: Rustc, NodeJS v20

- Clone the repo
- Execute command
```
pnpm run tauri build
```
- You will have the setup file + the .exe to directly launch the app in `src-tauri\target\release\bundle\nsis\`