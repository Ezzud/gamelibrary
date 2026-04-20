use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(Deserialize, Default)]
struct StoredGameConfig {
    #[serde(rename = "customArguments")]
    custom_arguments: Option<String>,
    #[serde(rename = "defaultLaunchFile")]
    default_launch_file: Option<String>,
}

fn calculate_directory_size(path: &Path) -> Result<u64, String> {
    let mut total_size = 0_u64;

    let entries = fs::read_dir(path)
        .map_err(|err| format!("Failed to read directory {}: {}", path.display(), err))?;

    for entry in entries {
        let entry = entry.map_err(|err| format!("Failed to read directory entry: {}", err))?;
        let metadata = entry
            .metadata()
            .map_err(|err| format!("Failed to read metadata for {}: {}", entry.path().display(), err))?;

        if metadata.is_dir() {
            total_size += calculate_directory_size(&entry.path())?;
        } else {
            total_size += metadata.len();
        }
    }

    Ok(total_size)
}

fn read_game_config(app: &tauri::AppHandle, game_id: &str) -> StoredGameConfig {
    let app_data_dir = match app.path().app_data_dir() {
        Ok(path) => path,
        Err(_) => return StoredGameConfig::default(),
    };

    let config_path = app_data_dir
        .join("GameLibrary")
        .join("games")
        .join(game_id)
        .join("config.json");

    let content = match fs::read_to_string(&config_path) {
        Ok(content) => content,
        Err(_) => return StoredGameConfig::default(),
    };

    serde_json::from_str::<StoredGameConfig>(&content).unwrap_or_default()
}

fn find_launch_file(game_path: &Path, configured_file: Option<String>) -> Result<PathBuf, String> {
    if let Some(file_name) = configured_file {
        let configured_path = game_path.join(&file_name);
        if configured_path.exists() {
            return Ok(configured_path);
        }
    }

    let entries = fs::read_dir(game_path)
        .map_err(|err| format!("Failed to read game directory {}: {}", game_path.display(), err))?;

    for entry in entries {
        let entry = entry.map_err(|err| format!("Failed to read directory entry: {}", err))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let extension = path
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();

        if extension == "exe" || extension == "bat" || extension == "cmd" {
            return Ok(path);
        }
    }

    Err(format!("No launchable file found in {}", game_path.display()))
}

#[cfg(target_os = "windows")]
fn quote_for_powershell(value: &str) -> String {
    value.replace('\'', "''")
}

#[cfg(target_os = "windows")]
fn launch_with_elevation(launch_file: &Path, args: &[String], game_path: &Path) -> Result<(), String> {
    let launch_file_escaped = quote_for_powershell(&launch_file.to_string_lossy());
    let working_dir_escaped = quote_for_powershell(&game_path.to_string_lossy());
    let command = if args.is_empty() {
        format!(
            "$exe='{}'; Start-Process -FilePath $exe -WorkingDirectory '{}' -Verb RunAs",
            launch_file_escaped,
            working_dir_escaped
        )
    } else {
        let args_list = args
            .iter()
            .map(|arg| format!("'{}'", quote_for_powershell(arg)))
            .collect::<Vec<String>>()
            .join(", ");

        format!(
            "$exe='{}'; $argList=@({}); Start-Process -FilePath $exe -ArgumentList $argList -WorkingDirectory '{}' -Verb RunAs",
            launch_file_escaped,
            args_list,
            working_dir_escaped
        )
    };

    Command::new("powershell")
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-Command")
        .arg(command)
        .spawn()
        .map_err(|err| format!("Failed to relaunch game with elevation: {}", err))?;

    Ok(())
}

#[tauri::command]
async fn get_directory_size(path: String) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || calculate_directory_size(Path::new(&path)))
        .await
        .map_err(|err| format!("Failed to compute directory size: {}", err))?
}

#[tauri::command]
fn open_game_folder(path: String) -> Result<(), String> {
    let normalized_path = if cfg!(target_os = "windows") {
        path.replace('/', "\\")
    } else {
        path
    };

    let folder_path = PathBuf::from(&normalized_path);
    if !folder_path.exists() {
        return Err(format!("Folder does not exist: {}", folder_path.display()));
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&normalized_path)
            .spawn()
            .map_err(|err| format!("Failed to open folder: {}", err))?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&normalized_path)
            .spawn()
            .map_err(|err| format!("Failed to open folder: {}", err))?;
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(&normalized_path)
            .spawn()
            .map_err(|err| format!("Failed to open folder: {}", err))?;
    }

    Ok(())
}

#[tauri::command]
fn launch_game(app: tauri::AppHandle, game_path: String, game_id: String) -> Result<(), String> {
    let game_path = PathBuf::from(&game_path);
    if !game_path.exists() {
        return Err(format!("Game path does not exist: {}", game_path.display()));
    }

    let game_config = read_game_config(&app, &game_id);
    let launch_file = find_launch_file(&game_path, game_config.default_launch_file)?;
    let args: Vec<String> = game_config
        .custom_arguments
        .unwrap_or_default()
        .split_whitespace()
        .map(|s| s.to_string())
        .collect();

    let extension = launch_file
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if extension == "bat" || extension == "cmd" {
        let launch_result = Command::new("cmd")
            .arg("/C")
            .arg(&launch_file)
            .args(&args)
            .current_dir(&game_path)
            .spawn();

        if let Err(err) = launch_result {
            #[cfg(target_os = "windows")]
            {
                if err.raw_os_error() == Some(740) {
                    return launch_with_elevation(&launch_file, &args, &game_path);
                }
            }

            return Err(format!("Failed to launch game script: {}", err));
        }
    } else {
        let launch_result = Command::new(&launch_file)
            .args(&args)
            .current_dir(&game_path)
            .spawn();

        if let Err(err) = launch_result {
            #[cfg(target_os = "windows")]
            {
                if err.raw_os_error() == Some(740) {
                    return launch_with_elevation(&launch_file, &args, &game_path);
                }
            }

            return Err(format!("Failed to launch game executable: {}", err));
        }
    }

    Ok(())
}

#[tauri::command]
async fn download_and_launch_installer(app: tauri::AppHandle, version: String) -> Result<String, String> {
    let normalized_version = version.trim().trim_start_matches('v').to_string();
    if normalized_version.is_empty()
        || !normalized_version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
    {
        return Err("Invalid version format".to_string());
    }

    let file_name = "gamelibrary_x64-setup.exe";
    let download_url = format!(
        "https://github.com/Ezzud/gamelibrary/releases/download/v{}/{}",
        normalized_version, file_name
    );

    let base_local_dir = app
        .path()
        .local_data_dir()
        .map_err(|err| format!("Failed to resolve LocalAppData directory: {}", err))?;
    let updates_dir = base_local_dir.join("gamelibrary").join("updates");

    fs::create_dir_all(&updates_dir)
        .map_err(|err| format!("Failed to create updates directory {}: {}", updates_dir.display(), err))?;

    let installer_path = updates_dir.join(&file_name);

    let response = reqwest::Client::new()
        .get(&download_url)
        .send()
        .await
        .map_err(|err| format!("Failed to download installer: {}", err))?;

    if !response.status().is_success() {
        return Err(format!(
            "Installer download failed with status {} for {}",
            response.status(),
            download_url
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|err| format!("Failed to read installer bytes: {}", err))?;

    fs::write(&installer_path, &bytes)
        .map_err(|err| format!("Failed to write installer to {}: {}", installer_path.display(), err))?;

    Command::new(&installer_path)
        .spawn()
        .map_err(|err| format!("Failed to launch installer {}: {}", installer_path.display(), err))?;

    Ok(installer_path.to_string_lossy().into_owned())
}

#[tauri::command]
async fn igdb_get_access_token(client_id: String, client_secret: String) -> Result<String, String> {
    let token_url = format!(
        "https://id.twitch.tv/oauth2/token?client_id={}&client_secret={}&grant_type=client_credentials",
        client_id, client_secret
    );

    let response = reqwest::Client::new()
        .post(token_url)
        .send()
        .await
        .map_err(|err| format!("Token request failed: {}", err))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "unable to read error body".to_string());
        return Err(format!("Token request failed with {}: {}", status, body));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|err| format!("Invalid token response JSON: {}", err))?;

    json.get("access_token")
        .and_then(|v| v.as_str())
        .map(|v| v.to_string())
        .ok_or_else(|| "Token response missing access_token".to_string())
}

#[tauri::command]
async fn igdb_post(endpoint: String, body: String, client_id: String, access_token: String) -> Result<String, String> {
    let url = format!("https://api.igdb.com/v4/{}", endpoint);

    let response = reqwest::Client::new()
        .post(url)
        .header("Client-ID", client_id)
        .bearer_auth(access_token)
        .header("Content-Type", "text/plain")
        .body(body)
        .send()
        .await
        .map_err(|err| format!("IGDB request failed: {}", err))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("Failed to read IGDB response: {}", err))?;

    if !status.is_success() {
        return Err(format!("IGDB request failed with {}: {}", status, text));
    }

    Ok(text)
}

fn cleanup_updates_dir_on_startup(app: &tauri::AppHandle) {
    let local_data_dir = match app.path().local_data_dir() {
        Ok(path) => path,
        Err(err) => {
            eprintln!("[startup-cleanup] Failed to resolve LocalAppData directory: {}", err);
            return;
        }
    };

    let updates_dir = local_data_dir.join("gamelibrary").join("updates");
    if !updates_dir.exists() {
        return;
    }

    if let Err(err) = fs::remove_dir_all(&updates_dir) {
        eprintln!(
            "[startup-cleanup] Failed to remove updates directory {}: {}",
            updates_dir.display(),
            err
        );
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
    .setup(|app| {
        cleanup_updates_dir_on_startup(app.handle());
        Ok(())
    })
    .invoke_handler(tauri::generate_handler![
        greet,
        igdb_get_access_token,
        igdb_post,
        get_directory_size,
        open_game_folder,
        launch_game,
        download_and_launch_installer
    ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
