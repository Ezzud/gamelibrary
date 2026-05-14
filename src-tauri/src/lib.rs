use std::io::{self, Write};
use std::fs::File;
use zip::ZipArchive;
use reqwest;
#[tauri::command]
async fn download_file_with_progress(app: tauri::AppHandle, url: String, dest_folder: String, file_name: String) -> Result<String, String> {
    let dest_path = Path::new(&dest_folder).join(&file_name);
    let client = reqwest::Client::new();
    let mut resp = client.get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to start download: {}", e))?;

    let total_size = resp.content_length().unwrap_or(0);
    let mut file = File::create(&dest_path).map_err(|e| format!("Failed to create file: {}", e))?;
    let mut downloaded: u64 = 0;

    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("Download error: {}", e))? {
        file.write_all(&chunk).map_err(|e| format!("Write error: {}", e))?;
        downloaded += chunk.len() as u64;
        let progress = if total_size > 0 {
            (downloaded as f64 / total_size as f64 * 100.0) as u8
        } else {
            0
        };
        app.emit("download_progress", progress).ok();
    }

    Ok(dest_path.to_string_lossy().to_string())
}

#[tauri::command]
fn unzip_file(zip_path: String, dest_folder: String) -> Result<(), String> {
    let zip_file = File::open(&zip_path).map_err(|e| format!("Failed to open zip file: {}", e))?;
    let mut archive = ZipArchive::new(zip_file).map_err(|e| format!("Failed to read zip archive: {}", e))?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| format!("Failed to access file in zip: {}", e))?;
        let outpath = Path::new(&dest_folder).join(file.name());

        if file.is_dir() {
            fs::create_dir_all(&outpath).map_err(|e| format!("Failed to create directory: {}", e))?;
        } else {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    fs::create_dir_all(p).map_err(|e| format!("Failed to create parent directory: {}", e))?;
                }
            }
            let mut outfile = File::create(&outpath).map_err(|e| format!("Failed to create file: {}", e))?;
            io::copy(&mut file, &mut outfile).map_err(|e| format!("Failed to extract file: {}", e))?;
        }
    }
    Ok(())
}
use serde::Deserialize;
use tauri::Emitter;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::time::{Duration, Instant};
use tauri::Manager;
use sysinfo::{Pid, System};

#[cfg(target_os = "windows")]
const WINDOWS_RUN_VALUE_NAMES: [&str; 4] = ["Game Library", "gamelibrary", "GameLibrary", "GameLibrary.exe"];

#[cfg(target_os = "windows")]
const WINDOWS_STARTUP_APPROVED_KEYS: [&str; 2] = [
    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run",
    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run32",
];

#[cfg(target_os = "windows")]
fn normalize_windows_path_like(value: &str) -> String {
    value
        .trim_matches('"')
        .replace('/', "\\")
        .trim()
        .to_ascii_lowercase()
}

#[cfg(target_os = "windows")]
fn log_reg_output(context: &str, output: &std::process::Output) {
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    eprintln!(
        "[startup-reg] {} | status={} | stdout='{}' | stderr='{}'",
        context,
        output.status,
        stdout,
        stderr
    );
}

#[cfg(target_os = "windows")]
fn find_existing_run_value_name_for_exe_windows(exe_path: &str) -> Result<Option<String>, String> {
    let key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
    eprintln!("[startup-reg] Querying Run key for current exe: {}", exe_path);
    let output = Command::new("reg")
        .args(["query", key])
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| format!("Failed to query Run key: {}", e))?;

    log_reg_output("query Run key", &output);

    if !output.status.success() {
        eprintln!("[startup-reg] Run key query did not succeed; no existing value will be reused.");
        return Ok(None);
    }

    let exe_normalized = normalize_windows_path_like(exe_path);
    let stdout = String::from_utf8_lossy(&output.stdout);

    for line in stdout.lines() {
        if !line.to_ascii_lowercase().contains("reg_sz") {
            continue;
        }

        let Some((name_part, data_part)) = line.split_once("REG_SZ") else {
            continue;
        };

        let value_name = name_part.trim();
        if value_name.is_empty() {
            continue;
        }

        let data_normalized = normalize_windows_path_like(data_part);
        eprintln!(
            "[startup-reg] Candidate Run value='{}' data='{}' normalized='{}'",
            value_name,
            data_part.trim(),
            data_normalized
        );
        if data_normalized.contains(&exe_normalized) {
            eprintln!("[startup-reg] Matched existing Run value for current exe: {}", value_name);
            return Ok(Some(value_name.to_string()));
        }
    }

    Ok(None)
}

#[cfg(target_os = "windows")]
fn remove_windows_startup_registration_for_value_name(value_name: &str) -> Result<(), String> {
    let run_key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";

    eprintln!("[startup-reg] Removing existing Run entry for value='{}'", value_name);
    let run_status = Command::new("reg")
        .args(["delete", run_key, "/v", value_name, "/f"])
        .creation_flags(0x08000000)
        .status()
        .map_err(|e| format!("Failed to delete Run value '{}': {}", value_name, e))?;
    eprintln!("[startup-reg] Delete Run result for value='{}': {}", value_name, run_status);

    for key in WINDOWS_STARTUP_APPROVED_KEYS {
        eprintln!("[startup-reg] Removing StartupApproved entry for key='{}' value='{}'", key, value_name);
        let status = Command::new("reg")
            .args(["delete", key, "/v", value_name, "/f"])
            .creation_flags(0x08000000)
            .status()
            .map_err(|e| format!("Failed to delete StartupApproved value '{}': {}", value_name, e))?;
        eprintln!("[startup-reg] Delete StartupApproved result for key='{}' value='{}': {}", key, value_name, status);
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn remove_windows_startup_registration_for_exe(exe_path: &str) -> Result<Vec<String>, String> {
    let mut removed_names = Vec::new();

    if let Some(existing_name) = find_existing_run_value_name_for_exe_windows(exe_path)? {
        remove_windows_startup_registration_for_value_name(&existing_name)?;
        removed_names.push(existing_name);
    }

    Ok(removed_names)
}

#[cfg(target_os = "windows")]
fn set_startup_approved_enabled_windows(value_name: &str) -> Result<bool, String> {
    let mut touched_any = false;

    // Removing StartupApproved value clears the explicit disabled state.
    for key in WINDOWS_STARTUP_APPROVED_KEYS {
        eprintln!("[startup-reg] Clearing StartupApproved state: key='{}' value='{}'", key, value_name);
        let status = Command::new("reg")
            .args(["delete", key, "/v", value_name, "/f"])
            .creation_flags(0x08000000)
            .status()
            .map_err(|e| format!("Failed to update StartupApproved state: {}", e))?;

        eprintln!("[startup-reg] StartupApproved delete result for key='{}' value='{}': {}", key, value_name, status);

        if status.success() {
            touched_any = true;
        }
    }

    Ok(touched_any)
}

#[cfg(target_os = "windows")]
fn is_startup_approved_disabled_windows(value_name: &str) -> Result<bool, String> {
    for key in WINDOWS_STARTUP_APPROVED_KEYS {
        eprintln!("[startup-reg] Checking if StartupApproved value is disabled: key='{}' value='{}'", key, value_name);
        let output = Command::new("reg")
            .args(["query", key, "/v", value_name])
            .creation_flags(0x08000000)
            .output()
            .map_err(|e| format!("Failed to query StartupApproved key: {}", e))?;

        log_reg_output(&format!("query StartupApproved key='{}' value='{}'", key, value_name), &output);

        if !output.status.success() {
            continue;
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if !line.to_ascii_lowercase().contains("reg_binary") {
                continue;
            }

            if let Some((_, raw_binary)) = line.split_once("REG_BINARY") {
                let hex: String = raw_binary.chars().filter(|c| c.is_ascii_hexdigit()).collect();
                if hex.len() >= 2 {
                    let first_byte = hex[..2].to_ascii_lowercase();
                    // 0x03 marks a disabled startup entry in Startup Apps.
                    if first_byte == "03" {
                        return Ok(true);
                    }
                }
            }
        }
    }

    Ok(false)
}

#[tauri::command]
async fn set_run_on_startup(enable: bool) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exe_path = match std::env::current_exe() {
            Ok(p) => p,
            Err(e) => return Err(format!("Failed to determine executable path: {}", e)),
        };

        eprintln!("[startup-reg] set_run_on_startup(enable={}) exe_path='{}'", enable, exe_path.display());

        #[cfg(target_os = "windows")]
        {
            use std::process::Command;
            let key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
            let name = WINDOWS_RUN_VALUE_NAMES[0];
            let exe_str = exe_path.to_string_lossy();
            eprintln!("[startup-reg] Windows Run key='{}' default value name='{}'", key, name);

            if enable {
                let removed_names = remove_windows_startup_registration_for_exe(&exe_str)?;
                if removed_names.is_empty() {
                    eprintln!("[startup-reg] No existing startup registration matched current exe. Creating a fresh one.");
                } else {
                    eprintln!("[startup-reg] Removed existing startup registrations for current exe: {:?}", removed_names);
                }

                eprintln!("[startup-reg] Creating fresh Windows startup entry.");
                let status = Command::new("reg")
                    .args(["add", key, "/v", name, "/t", "REG_SZ", "/d", &exe_str, "/f"])
                    .creation_flags(0x08000000)
                    .status()
                    .map_err(|e| format!("Failed to run reg.exe: {}", e))?;
                eprintln!("[startup-reg] reg add result for key='{}' value='{}': {}", key, name, status);
                if !status.success() {
                    eprintln!("[startup-reg] reg add failed; startup entry was not created.");
                    return Ok(false);
                }

                match set_startup_approved_enabled_windows(name) {
                    Ok(enabled_cleared) => {
                        eprintln!("[startup-reg] StartupApproved clear after create returned {} for '{}'.", enabled_cleared, name);
                    }
                    Err(err) => {
                        eprintln!("[startup-reg] Failed to clear StartupApproved state after create for '{}': {}", name, err);
                    }
                }
                return Ok(true);
            } else {
                eprintln!("[startup-reg] Removing Windows startup entry '{}' from Run key.", name);
                let status = Command::new("reg")
                    .args(["delete", key, "/v", name, "/f"])
                    .creation_flags(0x08000000)
                    .status()
                    .map_err(|e| format!("Failed to run reg.exe: {}", e))?;
                eprintln!("[startup-reg] reg delete result for key='{}' value='{}': {}", key, name, status);
                return Ok(status.success());
            }
        }

        #[cfg(target_os = "macos")]
        {
            use std::fs;
            use std::path::PathBuf;
            let plist_name = "com.ezzud.gamelibrary.plist";
            let home = std::env::var("HOME").map_err(|e| format!("Failed to read HOME: {}", e))?;
            let launch_agents = PathBuf::from(home).join("Library").join("LaunchAgents");
            let plist_path = launch_agents.join(plist_name);

            if enable {
                let _ = fs::create_dir_all(&launch_agents);
                let plist = format!(r#"<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\"> 
<plist version=\"1.0\"> 
<dict>
  <key>Label</key>
  <string>com.ezzud.gamelibrary</string>
  <key>ProgramArguments</key>
  <array>
    <string>{}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>"#, exe_path.to_string_lossy());
                fs::write(&plist_path, plist).map_err(|e| format!("Failed to write plist: {}", e))?;
                return Ok(true);
            } else {
                if plist_path.exists() {
                    fs::remove_file(&plist_path).map_err(|e| format!("Failed to remove plist: {}", e))?;
                }
                return Ok(true);
            }
        }

        #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
        {
            use std::fs;
            use std::path::PathBuf;
            let home = std::env::var("HOME").map_err(|e| format!("Failed to read HOME: {}", e))?;
            let config_home = std::env::var("XDG_CONFIG_HOME").unwrap_or_else(|_| format!("{}/.config", home));
            let autostart_dir = PathBuf::from(config_home).join("autostart");
            let desktop_path = autostart_dir.join("gamelibrary.desktop");

            if enable {
                let _ = fs::create_dir_all(&autostart_dir);
                let desktop = format!(r#"[Desktop Entry]
Type=Application
Name=GameLibrary
Exec={}
X-GNOME-Autostart-enabled=true
NoDisplay=false
Comment=Start GameLibrary on login
"#, exe_path.to_string_lossy());
                fs::write(&desktop_path, desktop).map_err(|e| format!("Failed to write desktop file: {}", e))?;
                return Ok(true);
            } else {
                if desktop_path.exists() {
                    fs::remove_file(&desktop_path).map_err(|e| format!("Failed to remove desktop file: {}", e))?;
                }
                return Ok(true);
            }
        }

        // All platform branches return; no fallback needed.
    })
    .await
    .map_err(|err| format!("Failed to run startup command on blocking thread: {}", err))?
}

#[tauri::command]
async fn get_run_on_startup() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            use std::process::Command;
            let key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
            eprintln!("[startup-reg] Checking if run-on-startup is enabled by querying Run key '{}'.", key);
            for name in WINDOWS_RUN_VALUE_NAMES {
                eprintln!("[startup-reg] Querying Run value '{}'.", name);
                let output = Command::new("reg").args(["query", key, "/v", name]).creation_flags(0x08000000).output();
                if let Ok(out) = output {
                    log_reg_output(&format!("query Run key='{}' value='{}'", key, name), &out);
                    if out.status.success() {
                        eprintln!("[startup-reg] Run value '{}' exists.", name);
                        return Ok(true);
                    }
                } else if let Err(err) = output {
                    eprintln!("[startup-reg] Failed to query Run value '{}': {}", name, err);
                }
            }
            eprintln!("[startup-reg] No Windows Run value matched the app.");
            return Ok(false);
        }

        #[cfg(target_os = "macos")]
        {
            use std::path::PathBuf;
            let plist_name = "com.ezzud.gamelibrary.plist";
            let home = std::env::var("HOME").map_err(|e| format!("Failed to read HOME: {}", e))?;
            let plist_path = PathBuf::from(home).join("Library").join("LaunchAgents").join(plist_name);
            return Ok(plist_path.exists());
        }

        #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
        {
            use std::path::PathBuf;
            let home = std::env::var("HOME").map_err(|e| format!("Failed to read HOME: {}", e))?;
            let config_home = std::env::var("XDG_CONFIG_HOME").unwrap_or_else(|_| format!("{}/.config", home));
            let desktop_path = PathBuf::from(config_home).join("autostart").join("gamelibrary.desktop");
            return Ok(desktop_path.exists());
        }

        // All platform branches return; no fallback needed.
    })
    .await
    .map_err(|err| format!("Failed to query startup state on blocking thread: {}", err))?
}

#[tauri::command]
async fn is_run_on_startup_disabled() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            eprintln!("[startup-reg] Checking if run-on-startup is disabled in StartupApproved keys.");
            for name in WINDOWS_RUN_VALUE_NAMES {
                eprintln!("[startup-reg] Testing disabled state for Run value '{}'.", name);
                if is_startup_approved_disabled_windows(name)? {
                    eprintln!("[startup-reg] Run value '{}' is marked disabled in StartupApproved.", name);
                    return Ok(true);
                }
            }

            eprintln!("[startup-reg] No disabled StartupApproved state found for this app.");
            return Ok(false);
        }

        #[cfg(not(target_os = "windows"))]
        {
            Ok(false)
        }
    })
    .await
    .map_err(|err| format!("Failed to query disabled startup state on blocking thread: {}", err))?
}

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


fn parse_custom_arguments(args_str: Option<String>) -> Vec<String> {
    let args = args_str
        .unwrap_or_default()
        .split_whitespace()
        .map(|s| s.to_string())
        .collect();
    
    eprintln!("[parse_custom_arguments] Parsed arguments: {:?}", args);

    return args;
}

fn normalize_launch_argument(arg: String) -> String {
    let trimmed = arg.trim();
    let mut normalized = if trimmed.len() >= 2 {
        let starts_with_double = trimmed.starts_with('"') && trimmed.ends_with('"');
        let starts_with_single = trimmed.starts_with('\'') && trimmed.ends_with('\'');
        if starts_with_double || starts_with_single {
            trimmed[1..trimmed.len() - 1].to_string()
        } else {
            trimmed.to_string()
        }
    } else {
        trimmed.to_string()
    };

    #[cfg(target_os = "windows")]
    {
        if normalized.contains('/')
            && !normalized.starts_with('-')
            && !normalized.starts_with('/')
            && !normalized.contains("://")
        {
            normalized = normalized.replace('/', "\\");
        }
    }

    normalized
}

#[tauri::command]
fn launch_game(app: tauri::AppHandle, game_path: String, game_id: String) -> Result<u32, String> {
    let game_path = PathBuf::from(&game_path);
    if !game_path.exists() {
        return Err(format!("Game path does not exist: {}", game_path.display()));
    }

    let game_config = read_game_config(&app, &game_id);
    let launch_file = find_launch_file(&game_path, game_config.default_launch_file)?;
    let args: Vec<String> = parse_custom_arguments(game_config.custom_arguments)
        .into_iter()
        .map(normalize_launch_argument)
        .collect();

    let extension = launch_file
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    let launch_result = if extension == "bat" || extension == "cmd" {
        Command::new("cmd")
            .arg("/C")
            .arg(&launch_file)
            .args(&args)
            .current_dir(&game_path)
            .spawn()
    } else {
        Command::new(&launch_file)
            .args(&args)
            .current_dir(&game_path)
            .spawn()
    };

    match launch_result {
        Ok(child) => Ok(child.id()),
        Err(err) => {
            #[cfg(target_os = "windows")]
            {
                if err.raw_os_error() == Some(740) {
                    launch_with_elevation(&launch_file, &args, &game_path)?;
                    return Ok(0);
                }
            }

            let label = if extension == "bat" || extension == "cmd" {
                "script"
            } else {
                "executable"
            };

            Err(format!("Failed to launch game {}: {}", label, err))
        }
    }
}

#[tauri::command]
async fn wait_for_process_exit(pid: u32, poll_interval_ms: Option<u64>) -> Result<(), String> {
    let poll_interval_ms = poll_interval_ms.unwrap_or(10000);
    let relaunch_grace = Duration::from_secs(15);
    if pid == 0 {
        return Ok(());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let mut system = System::new();
        let target_pid = Pid::from_u32(pid);
        let mut relaunch_deadline: Option<Instant> = None;

        system.refresh_processes();
        let target_exe = system
            .process(target_pid)
            .and_then(|process| process.exe().map(|path| path.to_path_buf()));

        loop {
            system.refresh_processes();

            let original_running = system.process(target_pid).is_some();

            let same_exe_running = target_exe.as_ref().is_some_and(|exe_path| {
                system.processes().values().any(|process| {
                    process
                        .exe()
                        .is_some_and(|path| path == exe_path.as_path())
                })
            });

            if original_running || same_exe_running {
                relaunch_deadline = None;
            } else if target_exe.is_some() {
                if let Some(deadline) = relaunch_deadline {
                    if Instant::now() >= deadline {
                        break;
                    }
                } else {
                    relaunch_deadline = Some(Instant::now() + relaunch_grace);
                }
            } else {
                break;
            }

            std::thread::sleep(Duration::from_millis(poll_interval_ms));
        }

        Ok(())
    })
    .await
    .map_err(|err| format!("Failed to monitor process {}: {}", pid, err))?
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

    if bytes.is_empty() {
        return Err(format!(
            "Downloaded installer is empty for URL {}",
            download_url
        ));
    }

    fs::write(&installer_path, &bytes)
        .map_err(|err| format!("Failed to write installer to {}: {}", installer_path.display(), err))?;

    let mut child = Command::new(&installer_path)
        .spawn()
        .map_err(|err| format!("Failed to launch installer {}: {}", installer_path.display(), err))?;

    std::thread::sleep(Duration::from_millis(800));
    if let Some(status) = child
        .try_wait()
        .map_err(|err| format!("Failed to inspect installer process state: {}", err))?
    {
        if !status.success() {
            return Err(format!(
                "Installer process exited early with status {}",
                status
            ));
        }
    }

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
#[tauri::command]
fn copy_file(source: String, destination: String) -> Result<(), String> {
    fs::copy(&source, &destination)
        .map_err(|e| format!("Failed to copy file from {} to {}: {}", source, destination, e))?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            cleanup_updates_dir_on_startup(app.handle());

            // --- Custom URI scheme handler ---
            // On Windows, when the app is launched via a custom protocol, the URL is passed as a command-line argument
            let args: Vec<String> = std::env::args().collect();
            for arg in &args {
                if arg.starts_with("gamelibrary://") {
                    // Send the URL to the frontend
                    app.emit("custom-uri", arg.clone()).ok();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            igdb_get_access_token,
            igdb_post,
            get_directory_size,
            open_game_folder,
            launch_game,
            set_run_on_startup,
            get_run_on_startup,
            is_run_on_startup_disabled,
            wait_for_process_exit,
            download_and_launch_installer,
            download_file_with_progress,
            unzip_file,
            copy_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
