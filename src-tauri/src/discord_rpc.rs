use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use serde::Deserialize;
use std::sync::Mutex;
use tauri::State;

fn normalize_discord_url(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.starts_with("//") {
        format!("https:{trimmed}")
    } else {
        trimmed.to_string()
    }
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DiscordRpcPresencePayload {
    pub enabled: bool,
    pub app_id: String,
    pub name: Option<String>,
    pub state: Option<String>,
    pub large_image: Option<String>,
    pub large_text: Option<String>,
    pub small_image: Option<String>,
    pub small_text: Option<String>,
    pub display_time_elapsed: bool,
    pub show_button: bool,
    pub button_label: Option<String>,
    pub button_url: Option<String>,
    pub elapsed_started_at: Option<i64>,
}

#[derive(Default)]
pub struct DiscordRpcState {
    client: Mutex<Option<DiscordIpcClient>>,
    app_id: Mutex<Option<String>>,
}

impl DiscordRpcState {
    fn close_client(&self) {
        if let Ok(mut client_guard) = self.client.lock() {
            if let Some(mut client) = client_guard.take() {
                eprintln!("[discord-rpc] Stopping Discord RPC client.");
                let _ = client.clear_activity();
                let _ = client.close();
            }
        }
    }

    fn ensure_client(&self, app_id: &str) -> Result<(), String> {
        let mut app_id_guard = self
            .app_id
            .lock()
            .map_err(|_| "Discord RPC app id lock was poisoned".to_string())?;

        let mut client_guard = self
            .client
            .lock()
            .map_err(|_| "Discord RPC client lock was poisoned".to_string())?;

        let needs_reconnect = app_id_guard.as_deref() != Some(app_id) || client_guard.is_none();
        if !needs_reconnect {
            return Ok(());
        }

        if let Some(mut client) = client_guard.take() {
            eprintln!("[discord-rpc] Replacing existing Discord RPC client.");
            let _ = client.close();
        }

        eprintln!("[discord-rpc] Connecting Discord RPC client for app id {}.", app_id);
        let mut client = DiscordIpcClient::new(app_id);
        if let Err(error) = client.connect() {
            eprintln!("[discord-rpc] Failed to connect Discord RPC client: {}", error);
            return Err(format!("Failed to connect Discord RPC client: {error}"));
        }

        *app_id_guard = Some(app_id.to_string());
        *client_guard = Some(client);
        Ok(())
    }

    fn update_presence(&self, payload: DiscordRpcPresencePayload) -> Result<(), String> {
        if !payload.enabled {
            eprintln!("[discord-rpc] Presence disabled; stopping client.");
            self.close_client();
            return Ok(());
        }

        let app_id = payload.app_id.trim();
        if app_id.is_empty() {
            eprintln!("[discord-rpc] Missing app id; stopping client.");
            self.close_client();
            return Ok(());
        }

        self.ensure_client(app_id)?;

        let mut client_guard = self
            .client
            .lock()
            .map_err(|_| "Discord RPC client lock was poisoned".to_string())?;

        let Some(client) = client_guard.as_mut() else {
            return Err("Discord RPC client is unavailable".to_string());
        };

        eprintln!("[discord-rpc] Updating presence state='{}'", payload.state.as_deref().unwrap_or(""));
        let activity_name = payload
            .name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("Game Library");
        let mut activity = activity::Activity::new()
            .name(activity_name.to_string())
            .activity_type(activity::ActivityType::Playing);

        if let Some(state) = payload.state.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
            activity = activity.state(state.to_string());
        }

        if payload.display_time_elapsed {
            if let Some(started_at) = payload.elapsed_started_at {
                activity = activity.timestamps(activity::Timestamps::new().start(started_at));
            }
        }

        let mut assets = activity::Assets::new();
        let mut has_assets = false;

        if let Some(large_image) = payload.large_image.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
            let normalized_large_image = normalize_discord_url(large_image);
            eprintln!("[discord-rpc] Setting large image asset key/url: {}", normalized_large_image);
            assets = assets.large_image(normalized_large_image);
            has_assets = true;
        }
        if let Some(large_text) = payload.large_text.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
            assets = assets.large_text(large_text.to_string());
            has_assets = true;
        }
        if let Some(small_image) = payload.small_image.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
            let normalized_small_image = normalize_discord_url(small_image);
            eprintln!("[discord-rpc] Setting small image asset key/url: {}", normalized_small_image);
            assets = assets.small_image(normalized_small_image);
            has_assets = true;
        }
        if let Some(small_text) = payload.small_text.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
            assets = assets.small_text(small_text.to_string());
            has_assets = true;
        }

        if has_assets {
            activity = activity.assets(assets);
        }

        if payload.show_button {
            if let (Some(button_label), Some(button_url)) = (
                payload.button_label.as_deref().map(str::trim).filter(|value| !value.is_empty()),
                payload.button_url.as_deref().map(str::trim).filter(|value| !value.is_empty()),
            ) {
                let normalized_button_url = normalize_discord_url(button_url);
                eprintln!("[discord-rpc] Setting button label='{}' url='{}'", button_label, normalized_button_url);
                activity = activity.buttons(vec![activity::Button::new(button_label.to_string(), normalized_button_url)]);
            }
        }

        client
            .set_activity(activity)
            .map_err(|error| format!("Failed to update Discord RPC activity: {error}"))?;

        eprintln!("[discord-rpc] Discord RPC presence updated successfully.");

        Ok(())
    }
}

#[tauri::command]
pub fn discord_rpc_update_presence(state: State<'_, DiscordRpcState>, payload: DiscordRpcPresencePayload) -> Result<(), String> {
    state.update_presence(payload)
}
