export const scannerPaths = {
	steam: {
		roots: {
			windows: ["Program Files (x86)/Steam", "Program Files/Steam", "Steam"],
			mac: ["Applications/Steam.app", "Library/Application Support/Steam"],
			linux: [".steam/root", ".steam/steam", ".local/share/Steam"],
		},
		libraries: {
			windows: ["SteamLibrary/steamapps/common"],
			mac: ["Library/Application Support/Steam/steamapps/common", "SteamLibrary/steamapps/common"],
			linux: [
				".steam/root/steamapps/common",
				".steam/steam/steamapps/common",
				".local/share/Steam/steamapps/common",
				"SteamLibrary/steamapps/common",
			],
		},
		common: {
			windows: ["steamapps/common"],
			mac: ["steamapps/common"],
			linux: ["steamapps/common"],
		},
	},
	gog: {
		galaxyDefault: {
			windows: ["Program Files (x86)/GOG Galaxy/Games", "Program Files/GOG Galaxy/Games", "GOG Galaxy/Games"],
			mac: ["Applications/GOG Galaxy.app", "Library/Application Support/GOG.com/Galaxy/Applications"],
			linux: [],
		},
		galaxyOther: {
			windows: ["GOG Galaxy/Games"],
			mac: ["Library/Application Support/GOG.com/Galaxy/Applications"],
			linux: [],
		},
		standalone: {
			windows: ["GOG Games"],
			mac: ["GOG Games"],
			linux: ["GOG Games", "Games/Heroic"],
		},
	},
	xbox: { roots: { windows: ["XboxGames"], mac: [], linux: [] } },
	ea: {
		roots: {
			windows: ["Program Files (x86)/EA Games", "Program Files/EA Games", "EA Games"],
			mac: ["Applications/EA Games", "EA Games"],
			linux: ["Games/Heroic/Prefixes/default/EA App/drive_c/Program Files/EA Games"],
		},
	},
	epic: {
		roots: {
			windows: ["Program Files (x86)/Epic Games", "Program Files/Epic Games", "Epic Games"],
			mac: ["Epic Games", "Library/Application Support/Epic/EpicGamesLauncher"],
			linux: ["Games/Heroic", "Games/Epic Games"],
		},
	},
	battlenet: {
		roots: {
			windows: ["Program Files (x86)/Battle.net/Games", "Program Files/Battle.net/Games", "Battle.net/Games"],
			mac: ["Applications/Blizzard", "Applications/Battle.net"],
			linux: [],
		},
	},
} as const
