use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{
    Emitter,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use tauri_plugin_opener::OpenerExt;

const UAT_IDENTIFIER: &str = "com.moonlightjournal.desktop.uat";

fn is_local_uat_app(app: &tauri::AppHandle) -> bool {
    app.config().identifier == UAT_IDENTIFIER
}

fn local_uat_resource_path(app: &tauri::AppHandle, resource: &str) -> Result<PathBuf, String> {
    if !is_local_uat_app(app) {
        return Err("本機 UAT 資源只允許 UAT 應用程式使用".into());
    }
    if cfg!(debug_assertions) {
        let project_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or("無法定位本機專案資料夾")?
            .to_path_buf();
        Ok(project_dir.join(".uat-local").join(resource))
    } else {
        app.path()
            .resolve(resource, tauri::path::BaseDirectory::Resource)
            .map_err(|error| error.to_string())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalUatPetAssets {
    root_dir: String,
    manifest_json: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
struct DesktopPetPosition {
    x: i32,
    y: i32,
}

#[derive(Clone, Copy, Debug)]
struct ScreenRect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

struct DesktopPetPositionStore {
    path: PathBuf,
    ready: AtomicBool,
}

impl DesktopPetPositionStore {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            ready: AtomicBool::new(false),
        }
    }

    fn load(&self) -> Option<DesktopPetPosition> {
        let json = fs::read(&self.path).ok()?;
        serde_json::from_slice(&json).ok()
    }

    fn save(&self, position: DesktopPetPosition) {
        if !self.ready.load(Ordering::Acquire) {
            return;
        }
        if let Some(parent) = self.path.parent() {
            if let Err(error) = fs::create_dir_all(parent) {
                eprintln!("無法建立桌面寵物位置資料夾：{error}");
                return;
            }
        }
        let json = match serde_json::to_vec(&position) {
            Ok(json) => json,
            Err(error) => {
                eprintln!("無法編碼桌面寵物位置：{error}");
                return;
            }
        };
        if let Err(error) = fs::write(&self.path, json) {
            eprintln!("無法保存桌面寵物位置：{error}");
        }
    }
}

fn clamp_pet_position(
    saved: DesktopPetPosition,
    window_width: u32,
    window_height: u32,
    screens: &[ScreenRect],
) -> DesktopPetPosition {
    if screens.is_empty() {
        return saved;
    }

    let left = i64::from(saved.x);
    let top = i64::from(saved.y);
    let right = left + i64::from(window_width);
    let bottom = top + i64::from(window_height);
    let fully_visible = screens.iter().any(|screen| {
        let screen_left = i64::from(screen.x);
        let screen_top = i64::from(screen.y);
        let screen_right = screen_left + i64::from(screen.width);
        let screen_bottom = screen_top + i64::from(screen.height);
        left >= screen_left
            && top >= screen_top
            && right <= screen_right
            && bottom <= screen_bottom
    });
    if fully_visible {
        return saved;
    }

    let intersection_area = |screen: &ScreenRect| {
        let screen_left = i64::from(screen.x);
        let screen_top = i64::from(screen.y);
        let screen_right = screen_left + i64::from(screen.width);
        let screen_bottom = screen_top + i64::from(screen.height);
        let overlap_width = (right.min(screen_right) - left.max(screen_left)).max(0);
        let overlap_height = (bottom.min(screen_bottom) - top.max(screen_top)).max(0);
        overlap_width * overlap_height
    };
    let distance_squared = |screen: &ScreenRect| {
        let screen_left = i64::from(screen.x);
        let screen_top = i64::from(screen.y);
        let screen_right = screen_left + i64::from(screen.width);
        let screen_bottom = screen_top + i64::from(screen.height);
        let dx = if right < screen_left {
            screen_left - right
        } else if left > screen_right {
            left - screen_right
        } else {
            0
        };
        let dy = if bottom < screen_top {
            screen_top - bottom
        } else if top > screen_bottom {
            top - screen_bottom
        } else {
            0
        };
        dx * dx + dy * dy
    };
    let best_overlap = screens.iter().map(intersection_area).max().unwrap_or(0);
    let target = if best_overlap > 0 {
        screens
            .iter()
            .max_by_key(|screen| intersection_area(screen))
            .unwrap()
    } else {
        screens
            .iter()
            .min_by_key(|screen| distance_squared(screen))
            .unwrap()
    };

    let min_x = i64::from(target.x);
    let min_y = i64::from(target.y);
    let max_x = (min_x + i64::from(target.width) - i64::from(window_width)).max(min_x);
    let max_y = (min_y + i64::from(target.height) - i64::from(window_height)).max(min_y);
    DesktopPetPosition {
        x: left.clamp(min_x, max_x) as i32,
        y: top.clamp(min_y, max_y) as i32,
    }
}

fn pet_position_with_visible_bounds(
    window: &tauri::WebviewWindow,
    saved: DesktopPetPosition,
) -> Result<DesktopPetPosition, String> {
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let screens = window
        .available_monitors()
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            ScreenRect {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
            }
        })
        .collect::<Vec<_>>();
    Ok(clamp_pet_position(saved, size.width, size.height, &screens))
}

#[tauri::command]
fn is_local_uat(app: tauri::AppHandle) -> bool {
    is_local_uat_app(&app)
}

#[tauri::command]
fn load_local_uat_profile(app: tauri::AppHandle) -> Result<String, String> {
    let path = local_uat_resource_path(&app, "uat-profile.json")?;
    fs::read_to_string(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn load_local_uat_pet_assets(app: tauri::AppHandle) -> Result<LocalUatPetAssets, String> {
    let resource = if cfg!(debug_assertions) {
        "assets/moon-lady"
    } else {
        "moon-lady"
    };
    let root = local_uat_resource_path(&app, resource)?;
    let manifest = fs::read_to_string(root.join("pet-animation-manifest.json"))
        .map_err(|error| error.to_string())?;
    Ok(LocalUatPetAssets {
        root_dir: root.to_string_lossy().into_owned(),
        manifest_json: manifest,
    })
}

fn open_database(data_dir: &str) -> Result<Connection, String> {
    let dir = PathBuf::from(data_dir);
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let db = Connection::open(dir.join("moonlight.db")).map_err(|error| error.to_string())?;
    db.busy_timeout(Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    db.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE IF NOT EXISTS app_state (
           key TEXT PRIMARY KEY NOT NULL,
           value_json TEXT NOT NULL,
           updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
         );",
    )
    .map_err(|error| error.to_string())?;
    Ok(db)
}

#[cfg(target_os = "windows")]
fn find_legacy_data_directory() -> Option<PathBuf> {
    for drive in (b'C'..=b'Z').rev() {
        let root = format!("{}:\\", char::from(drive));
        let candidate = PathBuf::from(root).join("月光簿資料");
        if candidate.join("moonlight.db").is_file() {
            return Some(candidate);
        }
    }
    None
}

#[tauri::command]
fn default_data_directory(app: tauri::AppHandle) -> Result<String, String> {
    let current = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    // UAT must stay on its configured local data directory and must never
    // discover or reuse the shared app's legacy database location.
    if is_local_uat_app(&app) {
        return Ok(current.to_string_lossy().into_owned());
    }
    if current.join("moonlight.db").exists() {
        return Ok(current.to_string_lossy().into_owned());
    }
    #[cfg(target_os = "windows")]
    if let Some(legacy) = find_legacy_data_directory() {
        return Ok(legacy.to_string_lossy().into_owned());
    }
    Ok(current.to_string_lossy().into_owned())
}

#[tauri::command]
fn load_state(data_dir: String) -> Result<Option<String>, String> {
    let db = open_database(&data_dir)?;
    let mut query = db
        .prepare("SELECT value_json FROM app_state WHERE key='main'")
        .map_err(|error| error.to_string())?;
    match query.query_row([], |row| row.get(0)) {
        Ok(value) => Ok(Some(value)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn pet_appearance_path_from_state(value_json: &str) -> String {
    serde_json::from_str::<serde_json::Value>(value_json)
        .ok()
        .and_then(|value| {
            value
                .pointer("/settings/petAppearancePath")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned)
        })
        .unwrap_or_default()
}

fn persist_state(data_dir: &str, value_json: &str) -> Result<bool, String> {
    let db = open_database(data_dir)?;
    let previous_value = db
        .query_row(
            "SELECT value_json FROM app_state WHERE key='main'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let appearance_changed = previous_value
        .as_deref()
        .map(pet_appearance_path_from_state)
        .unwrap_or_default()
        != pet_appearance_path_from_state(value_json);
    db.execute(
        "INSERT INTO app_state(key,value_json,updated_at)
         VALUES('main',?1,CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET
           value_json=excluded.value_json,
           updated_at=CURRENT_TIMESTAMP",
        params![value_json],
    )
    .map_err(|error| error.to_string())?;
    Ok(appearance_changed)
}

#[tauri::command]
fn save_state(app: tauri::AppHandle, data_dir: String, value_json: String) -> Result<(), String> {
    if persist_state(&data_dir, &value_json)? {
        let _ = app.emit("pet-appearance-changed", ());
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredMedia {
    original_path: String,
    preview_path: String,
}

fn safe_extension(name: &str) -> String {
    Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| value.len() <= 10 && value.chars().all(|c| c.is_ascii_alphanumeric()))
        .map(|value| format!(".{}", value.to_ascii_lowercase()))
        .unwrap_or_default()
}

fn safe_media_id(id: &str) -> Result<&str, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("媒體識別碼不正確".into());
    }
    Ok(id)
}

const MAX_PET_IMAGE_BYTES: usize = 10 * 1024 * 1024;
const MIN_PET_IMAGE_DIMENSION: u32 = 128;
const MAX_PET_IMAGE_DIMENSION: u32 = 4096;

fn has_video_signature(bytes: &[u8]) -> bool {
    bytes.get(4..8) == Some(b"ftyp")
        || (bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"AVI "))
        || bytes.starts_with(&[0x1a, 0x45, 0xdf, 0xa3])
        || bytes.starts_with(&[0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11])
        || bytes.starts_with(&[0, 0, 1, 0xba])
        || bytes.starts_with(&[0, 0, 1, 0xb3])
}

fn looks_like_svg_document(bytes: &[u8]) -> bool {
    let text = String::from_utf8_lossy(&bytes[..bytes.len().min(4096)]);
    let mut candidate = text.trim_start_matches('\u{feff}').trim_start();
    loop {
        let lower = candidate.to_ascii_lowercase();
        if lower.starts_with("<!--") {
            let Some(end) = candidate.find("-->") else {
                return false;
            };
            candidate = candidate[end + 3..].trim_start();
            continue;
        }
        if lower.starts_with("<?xml") {
            let Some(end) = candidate.find("?>") else {
                return false;
            };
            candidate = candidate[end + 2..].trim_start();
            continue;
        }
        break;
    }

    let lower = candidate.to_ascii_lowercase();
    let has_svg_root = lower.strip_prefix("<svg").is_some_and(|rest| {
        rest.starts_with('>')
            || rest.starts_with('/')
            || rest.chars().next().is_some_and(char::is_whitespace)
    });
    let has_svg_doctype = lower
        .strip_prefix("<!doctype")
        .map(str::trim_start)
        .is_some_and(|rest| {
            rest.strip_prefix("svg").is_some_and(|after_svg| {
                after_svg.starts_with('>')
                    || after_svg.chars().next().is_some_and(char::is_whitespace)
            })
        });
    has_svg_root || has_svg_doctype
}

fn validate_pet_appearance_image(name: &str, bytes: &[u8]) -> Result<&'static str, String> {
    let extension = Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let lower_name = name.to_lowercase();

    let is_png_or_jpeg = bytes.starts_with(b"\x89PNG\r\n\x1a\n")
        || bytes.starts_with(&[0xff, 0xd8, 0xff]);
    if extension == "svg" || (!is_png_or_jpeg && looks_like_svg_document(bytes)) {
        return Err("不支援 SVG 向量圖；請匯入靜態 PNG、JPG 或 JPEG 圖片。".into());
    }
    if extension == "gif" || bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Err("不支援 GIF 動畫圖片；請匯出單張靜態 PNG、JPG 或 JPEG。".into());
    }
    if extension == "apng" {
        return Err("不支援 APNG 或動畫圖片；請匯出單張靜態 PNG、JPG 或 JPEG。".into());
    }
    if matches!(extension.as_str(), "webp" | "avif") {
        return Err("不支援 WebP 或 AVIF（含動畫版本）；目前只支援靜態 PNG、JPG 或 JPEG。".into());
    }
    if (bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"))
        || (bytes.get(4..8) == Some(b"ftyp")
            && matches!(bytes.get(8..12), Some(b"avif" | b"avis")))
    {
        return Err("不支援 WebP 或 AVIF（含動畫版本）；目前只支援靜態 PNG、JPG 或 JPEG。".into());
    }
    if matches!(
        extension.as_str(),
        "mp4" | "m4v" | "mov" | "avi" | "wmv" | "webm" | "mkv" | "mpeg" | "mpg"
    ) || has_video_signature(bytes)
    {
        return Err("不支援影片；請選擇一張靜態 PNG、JPG 或 JPEG 圖片。".into());
    }
    if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        return Err("不支援 WebP 或動畫 WebP；目前只支援靜態 PNG、JPG 或 JPEG。".into());
    }
    if [
        "spritesheet",
        "sprite-sheet",
        "sprite_sheet",
        "contact-sheet",
        "contact_sheet",
        "atlas",
        "tileset",
        "圖集",
        "精靈圖集",
        "動畫影格",
    ]
    .iter()
    .any(|keyword| lower_name.contains(keyword))
    {
        return Err("不支援精靈圖集或多格動畫影格；請改用一張完整的靜態角色圖片。".into());
    }
    if bytes.len() > MAX_PET_IMAGE_BYTES {
        return Err("圖片檔案超過 10 MB，請縮小後再匯入。".into());
    }

    let (kind, width, height) = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        if extension != "png" {
            return Err("檔案副檔名與 PNG 圖片內容不符；請選擇有效的 PNG、JPG 或 JPEG。".into());
        }
        let mut offset = 8usize;
        let mut dimensions = None;
        let mut found_end = false;
        while offset + 12 <= bytes.len() {
            let length = u32::from_be_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
            let chunk_end = offset
                .checked_add(12)
                .and_then(|value| value.checked_add(length))
                .filter(|value| *value <= bytes.len())
                .ok_or_else(|| "PNG 圖片資料不完整或格式錯誤。".to_string())?;
            let chunk_type = &bytes[offset + 4..offset + 8];
            if chunk_type == b"IHDR" && length == 13 {
                let width = u32::from_be_bytes(bytes[offset + 8..offset + 12].try_into().unwrap());
                let height = u32::from_be_bytes(bytes[offset + 12..offset + 16].try_into().unwrap());
                dimensions = Some((width, height));
            }
            if chunk_type == b"acTL" {
                return Err("不支援 APNG 或動畫圖片；請匯出單張靜態 PNG、JPG 或 JPEG。".into());
            }
            if chunk_type == b"IEND" {
                found_end = true;
                break;
            }
            offset = chunk_end;
        }
        if !found_end {
            return Err("PNG 圖片資料不完整或格式錯誤。".into());
        }
        let (width, height) = dimensions.ok_or_else(|| "PNG 圖片缺少有效尺寸資訊。".to_string())?;
        ("png", width, height)
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        if !matches!(extension.as_str(), "jpg" | "jpeg") {
            return Err("檔案副檔名與 JPEG 圖片內容不符；請選擇有效的 PNG、JPG 或 JPEG。".into());
        }
        let (width, height) = jpeg_dimensions(bytes)
            .ok_or_else(|| "JPEG 圖片資料不完整或缺少有效尺寸資訊。".to_string())?;
        ("jpg", width, height)
    } else {
        return Err("檔案內容不是有效的靜態 PNG、JPG 或 JPEG 圖片；GIF、APNG、SVG 與影片不支援。".into());
    };

    if !(MIN_PET_IMAGE_DIMENSION..=MAX_PET_IMAGE_DIMENSION).contains(&width)
        || !(MIN_PET_IMAGE_DIMENSION..=MAX_PET_IMAGE_DIMENSION).contains(&height)
    {
        return Err(format!(
            "圖片尺寸為 {width}×{height} px；寬與高都必須在 128–4096 px 之間。"
        ));
    }
    Ok(kind)
}

fn jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    let mut offset = 2usize;
    while offset < bytes.len() {
        while bytes.get(offset) == Some(&0xff) {
            offset += 1;
        }
        let marker = *bytes.get(offset)?;
        offset += 1;
        if marker == 0xd9 || marker == 0xda {
            break;
        }
        if marker == 0x01 || (0xd0..=0xd7).contains(&marker) {
            continue;
        }
        let length = u16::from_be_bytes([*bytes.get(offset)?, *bytes.get(offset + 1)?]) as usize;
        if length < 2 || offset.checked_add(length)? > bytes.len() {
            return None;
        }
        if matches!(marker, 0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf) {
            let height = u16::from_be_bytes([*bytes.get(offset + 3)?, *bytes.get(offset + 4)?]);
            let width = u16::from_be_bytes([*bytes.get(offset + 5)?, *bytes.get(offset + 6)?]);
            return Some((u32::from(width), u32::from(height)));
        }
        offset += length;
    }
    None
}

fn checked_pet_appearance_path(data_dir: &str, relative_path: &str) -> Result<PathBuf, String> {
    let relative = Path::new(relative_path);
    let mut parts = relative.components();
    let folder = parts.next();
    let filename = parts.next();
    if !matches!(folder, Some(Component::Normal(value)) if value == "pet-appearance")
        || !matches!(filename, Some(Component::Normal(_)))
        || parts.next().is_some()
    {
        return Err("自訂寵物圖片路徑不正確。".into());
    }
    let filename = filename.unwrap().as_os_str().to_string_lossy();
    if !matches!(
        Path::new(filename.as_ref()).extension().and_then(|value| value.to_str()),
        Some("png" | "jpg" | "jpeg")
    ) {
        return Err("自訂寵物圖片路徑不正確。".into());
    }
    let path = PathBuf::from(data_dir).join(relative);
    let root = fs::canonicalize(PathBuf::from(data_dir).join("pet-appearance"))
        .map_err(|_| "找不到已匯入的寵物圖片，請重新選擇圖片。".to_string())?;
    let canonical = fs::canonicalize(&path)
        .map_err(|_| "找不到已匯入的寵物圖片，請重新選擇圖片。".to_string())?;
    if !canonical.is_file() || !canonical.starts_with(root) {
        return Err("自訂寵物圖片路徑不正確。".into());
    }
    Ok(canonical)
}

#[tauri::command]
fn store_pet_appearance(
    data_dir: String,
    original_name: String,
    image_base64: String,
) -> Result<String, String> {
    let maximum_base64 = ((MAX_PET_IMAGE_BYTES + 2) / 3) * 4;
    if image_base64.len() > maximum_base64 {
        return Err("圖片檔案超過 10 MB，請縮小後再匯入。".into());
    }
    let image_bytes = STANDARD
        .decode(image_base64)
        .map_err(|_| "無法讀取圖片資料，請重新選擇 PNG、JPG 或 JPEG。".to_string())?;
    let extension = validate_pet_appearance_image(&original_name, &image_bytes)?;
    let directory = PathBuf::from(data_dir).join("pet-appearance");
    fs::create_dir_all(&directory).map_err(|error| format!("無法建立本機寵物圖片資料夾：{error}"))?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let filename = format!("custom-{timestamp}.{}", extension);
    let destination = directory.join(&filename);
    let temporary = directory.join(format!(".{filename}.tmp"));
    fs::write(&temporary, &image_bytes).map_err(|error| format!("無法保存寵物圖片：{error}"))?;
    if let Err(error) = fs::rename(&temporary, &destination) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("無法完成寵物圖片保存：{error}"));
    }
    Ok(format!("pet-appearance/{filename}"))
}

#[tauri::command]
fn resolve_pet_appearance(data_dir: String, relative_path: String) -> Result<String, String> {
    checked_pet_appearance_path(&data_dir, &relative_path)
        .map(|path| path.to_string_lossy().into_owned())
}

fn safe_album_folder(folder: Option<&str>) -> Result<Option<PathBuf>, String> {
    let Some(folder) = folder.filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if folder.len() > 120
        || Path::new(folder)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("相簿資料夾名稱不正確".into());
    }
    Ok(Some(PathBuf::from(folder)))
}

#[tauri::command]
fn store_media(
    data_dir: String,
    media_id: String,
    original_name: String,
    original_base64: String,
    preview_base64: String,
    album_folder: Option<String>,
) -> Result<StoredMedia, String> {
    let id = safe_media_id(&media_id)?;
    let root = PathBuf::from(data_dir).join("media");
    let root = match safe_album_folder(album_folder.as_deref())? {
        Some(folder) => root.join("albums").join(folder),
        None => root,
    };
    let originals = root.join("originals");
    let previews = root.join("previews");
    fs::create_dir_all(&originals).map_err(|e| e.to_string())?;
    fs::create_dir_all(&previews).map_err(|e| e.to_string())?;
    let original_name = format!("{}{}", id, safe_extension(&original_name));
    let preview_name = format!("{}.jpg", id);
    let original = originals.join(&original_name);
    let preview = previews.join(&preview_name);
    let original_bytes = STANDARD.decode(original_base64).map_err(|e| e.to_string())?;
    let preview_bytes = STANDARD.decode(preview_base64).map_err(|e| e.to_string())?;
    fs::write(&original, original_bytes)
        .map_err(|e| e.to_string())?;
    if let Err(error) = fs::write(&preview, preview_bytes) {
        let _ = fs::remove_file(&original);
        return Err(error.to_string());
    }
    let prefix = match album_folder.as_deref() {
        Some(folder) if !folder.is_empty() => format!("media/albums/{folder}"),
        _ => "media".to_string(),
    };
    Ok(StoredMedia {
        original_path: format!("{prefix}/originals/{original_name}"),
        preview_path: format!("{prefix}/previews/{preview_name}"),
    })
}

#[tauri::command]
fn ensure_album_media_directory(data_dir: String, album_folder: String) -> Result<(), String> {
    let folder = safe_album_folder(Some(&album_folder))?
        .ok_or_else(|| "相簿資料夾名稱不可空白".to_string())?;
    let root = PathBuf::from(data_dir)
        .join("media")
        .join("albums")
        .join(folder);
    fs::create_dir_all(root.join("originals")).map_err(|error| error.to_string())?;
    fs::create_dir_all(root.join("previews")).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn reveal_media_location(
    app: tauri::AppHandle,
    data_dir: String,
    relative_path: String,
) -> Result<(), String> {
    let relative = checked_relative(&relative_path)?;
    if relative.as_os_str().is_empty() {
        return Err("找不到媒體檔案位置".into());
    }
    let absolute = fs::canonicalize(PathBuf::from(data_dir).join(relative))
        .map_err(|_| "找不到媒體檔案，可能已被移動或刪除".to_string())?;
    if !absolute.is_file() {
        return Err("找不到媒體檔案，可能已被移動或刪除".into());
    }
    app.opener()
        .reveal_item_in_dir(absolute.to_string_lossy().as_ref())
        .map_err(|error| error.to_string())
}

fn checked_relative(path: &str) -> Result<PathBuf, String> {
    let value = PathBuf::from(path);
    if value.as_os_str().is_empty() {
        return Ok(value);
    }
    if value.is_absolute() || value.components().any(|part| !matches!(part, Component::Normal(_))) {
        return Err("媒體路徑不正確".into());
    }
    Ok(value)
}

#[tauri::command]
fn remove_media(data_dir: String, original_path: String, preview_path: String) -> Result<(), String> {
    let root = PathBuf::from(data_dir);
    for relative in [original_path, preview_path] {
        let path = checked_relative(&relative)?;
        if !path.as_os_str().is_empty() {
            match fs::remove_file(root.join(path)) {
                Ok(_) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.to_string()),
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn load_media(data_dir: String, relative_path: String) -> Result<tauri::ipc::Response, String> {
    let path = checked_relative(&relative_path)?;
    if path.as_os_str().is_empty() {
        return Err("找不到影片檔案".into());
    }
    let bytes = fs::read(PathBuf::from(data_dir).join(path)).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

fn copy_tree(source: &Path, target: &Path) -> Result<(), String> {
    if !source.exists() { return Ok(()); }
    fs::create_dir_all(target).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let destination = target.join(entry.file_name());
        if entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            copy_tree(&entry.path(), &destination)?;
        } else {
            fs::copy(entry.path(), destination).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn timestamp() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .map_err(|error| error.to_string())
}

fn checkpoint_database(data_dir: &str) -> Result<(), String> {
    let db = open_database(data_dir)?;
    db.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn create_full_backup(
    data_dir: String,
    target_dir: String,
    manifest_json: String,
) -> Result<String, String> {
    if target_dir.trim().is_empty() {
        return Err("備份位置不可空白".into());
    }
    let source = PathBuf::from(&data_dir);
    let target_root = PathBuf::from(&target_dir);
    fs::create_dir_all(&target_root).map_err(|error| error.to_string())?;
    let source_abs = fs::canonicalize(&source).map_err(|error| error.to_string())?;
    let target_abs = fs::canonicalize(&target_root).map_err(|error| error.to_string())?;
    if target_abs == source_abs || target_abs.starts_with(&source_abs) {
        return Err("備份位置不能放在資料夾裡面".into());
    }
    checkpoint_database(&data_dir)?;
    let stamp = timestamp()?;
    let final_path = target_root.join(format!("月光簿完整備份-{stamp}"));
    let partial_path = target_root.join(format!(".月光簿備份-{stamp}.partial"));
    if partial_path.exists() {
        fs::remove_dir_all(&partial_path).map_err(|error| error.to_string())?;
    }
    if let Err(error) = copy_tree(&source, &partial_path)
        .and_then(|_| fs::write(partial_path.join("backup-manifest.json"), manifest_json).map_err(|value| value.to_string()))
    {
        let _ = fs::remove_dir_all(&partial_path);
        return Err(error);
    }
    fs::rename(&partial_path, &final_path).map_err(|error| {
        let _ = fs::remove_dir_all(&partial_path);
        error.to_string()
    })?;
    Ok(final_path.to_string_lossy().into_owned())
}

#[tauri::command]
fn restore_full_backup(data_dir: String, backup_dir: String) -> Result<String, String> {
    let data = PathBuf::from(&data_dir);
    let backup = PathBuf::from(&backup_dir);
    if !backup.join("moonlight.db").is_file() || !backup.join("backup-manifest.json").is_file() {
        return Err("這不是完整的月光簿備份".into());
    }
    let data_abs = fs::canonicalize(&data).map_err(|error| error.to_string())?;
    let backup_abs = fs::canonicalize(&backup).map_err(|error| error.to_string())?;
    if data_abs == backup_abs || backup_abs.starts_with(&data_abs) {
        return Err("備份位置不正確".into());
    }
    checkpoint_database(&data_dir)?;
    let stamp = timestamp()?;
    let parent = data.parent().ok_or("資料夾沒有可用的上層路徑")?;
    let safety = parent.join(format!("月光簿還原前備份-{stamp}"));
    let staged = parent.join(format!(".月光簿還原-{stamp}.partial"));
    let old = parent.join(format!(".月光簿舊資料-{stamp}"));
    copy_tree(&data, &safety)?;
    if let Err(error) = copy_tree(&backup, &staged) {
        let _ = fs::remove_dir_all(&staged);
        return Err(error);
    }
    fs::rename(&data, &old).map_err(|error| error.to_string())?;
    if let Err(error) = fs::rename(&staged, &data) {
        let _ = fs::rename(&old, &data);
        let _ = fs::remove_dir_all(&staged);
        return Err(error.to_string());
    }
    let _ = fs::remove_dir_all(&old);
    Ok(safety.to_string_lossy().into_owned())
}

#[tauri::command]
fn set_pet_visible(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    let pet = app.get_webview_window("pet").ok_or("找不到桌面月光精靈視窗")?;
    if visible {
        pet.show().map_err(|error| error.to_string())?;
    } else {
        pet.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn reveal_main_window(app: &tauri::AppHandle) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or("找不到月光簿主視窗")?;
    main.unminimize().map_err(|error| error.to_string())?;
    main.show().map_err(|error| error.to_string())?;
    main.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    reveal_main_window(&app)
}

#[tauri::command]
fn start_pet_drag(
    app: tauri::AppHandle,
) -> Result<(), String> {
    let pet = app
        .get_webview_window("pet")
        .ok_or("找不到桌面月光精靈視窗")?;
    pet.start_dragging().map_err(|error| error.to_string())
}

#[tauri::command]
fn move_data_directory(
    app: tauri::AppHandle,
    source_dir: String,
    target_dir: String,
    value_json: String,
) -> Result<(), String> {
    let source = PathBuf::from(source_dir);
    let target = PathBuf::from(&target_dir);
    if source != target {
        copy_tree(&source.join("media"), &target.join("media"))?;
    }
    save_state(app, target_dir, value_json)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = reveal_main_window(app);
        }))
        .invoke_handler(tauri::generate_handler![
            is_local_uat,
            load_local_uat_profile,
            load_local_uat_pet_assets,
            default_data_directory,
            load_state,
            save_state,
            store_media,
            store_pet_appearance,
            resolve_pet_appearance,
            ensure_album_media_directory,
            reveal_media_location,
            remove_media,
            load_media,
            move_data_directory,
            create_full_backup,
            restore_full_backup,
            set_pet_visible,
            show_main_window,
            start_pet_drag
        ])
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let position_path = app
                .path()
                .app_data_dir()?
                .join("window-state")
                .join("desktop-pet-position.json");
            app.manage(DesktopPetPositionStore::new(position_path));
            if let Some(pet) = app.get_webview_window("pet") {
                if let Some(saved) = app.state::<DesktopPetPositionStore>().load() {
                    match pet_position_with_visible_bounds(&pet, saved) {
                        Ok(position) => {
                            if let Err(error) = pet.set_position(tauri::PhysicalPosition::new(
                                position.x,
                                position.y,
                            )) {
                                eprintln!("無法還原桌面寵物位置：{error}");
                            }
                        }
                        Err(error) => eprintln!("無法校正桌面寵物位置：{error}"),
                    }
                }
            }
            app.state::<DesktopPetPositionStore>()
                .ready
                .store(true, Ordering::Release);

            let open_item =
                MenuItem::with_id(app, "open", "開啟月光簿", true, None::<&str>)?;
            let quit_item =
                MenuItem::with_id(app, "quit", "完全結束", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &quit_item])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("月光簿")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        let _ = reveal_main_window(app);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let _ = reveal_main_window(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "pet" {
                if let tauri::WindowEvent::Moved(position) = event {
                    if let Some(store) = window.try_state::<DesktopPetPositionStore>() {
                        store.save(DesktopPetPosition {
                            x: position.x,
                            y: position.y,
                        });
                    }
                }
            }
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running 月光簿");
}

#[cfg(test)]
mod desktop_pet_position_tests {
    use super::{
        clamp_pet_position, DesktopPetPosition, DesktopPetPositionStore, ScreenRect,
    };
    use std::sync::atomic::Ordering;

    #[test]
    fn keeps_position_when_window_fits_a_non_primary_monitor() {
        let saved = DesktopPetPosition { x: -1100, y: 80 };
        let screens = [
            ScreenRect {
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
            },
            ScreenRect {
                x: -1280,
                y: 0,
                width: 1280,
                height: 1024,
            },
        ];

        assert_eq!(clamp_pet_position(saved, 230, 345, &screens), saved);
    }

    #[test]
    fn moves_offscreen_window_inside_remaining_monitor() {
        let screens = [ScreenRect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        }];

        assert_eq!(
            clamp_pet_position(DesktopPetPosition { x: 2200, y: 900 }, 230, 345, &screens),
            DesktopPetPosition { x: 1690, y: 735 }
        );
    }

    #[test]
    fn clamps_partially_visible_window_to_monitor_edges() {
        let screens = [ScreenRect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        }];

        assert_eq!(
            clamp_pet_position(DesktopPetPosition { x: -100, y: 900 }, 230, 345, &screens),
            DesktopPetPosition { x: 0, y: 735 }
        );
    }

    #[test]
    fn saves_and_loads_position_in_local_store() {
        let test_dir = std::env::current_dir()
            .expect("workspace directory should be available")
            .join(".uat-local")
            .join("tmp");
        std::fs::create_dir_all(&test_dir).expect("UAT temp directory should be available");
        let test_path = test_dir.join(format!(
            "desktop-pet-position-test-{}-{}.json",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock should be after Unix epoch")
                .as_nanos()
        ));
        let store = DesktopPetPositionStore::new(test_path.clone());
        store.ready.store(true, Ordering::Release);

        let expected = DesktopPetPosition { x: 240, y: 160 };
        store.save(expected);

        assert_eq!(store.load(), Some(expected));
        std::fs::remove_file(test_path).expect("test position file should be removed");
    }
}

#[cfg(test)]
mod pet_appearance_tests {
    use super::{
        load_state, persist_state, resolve_pet_appearance, store_pet_appearance,
        validate_pet_appearance_image, MAX_PET_IMAGE_BYTES,
    };
    use base64::{engine::general_purpose::STANDARD, Engine};

    fn png(width: u32, height: u32, animated: bool) -> Vec<u8> {
        fn chunk(bytes: &mut Vec<u8>, name: &[u8; 4], data: &[u8]) {
            bytes.extend_from_slice(&(data.len() as u32).to_be_bytes());
            bytes.extend_from_slice(name);
            bytes.extend_from_slice(data);
            bytes.extend_from_slice(&[0, 0, 0, 0]);
        }
        let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
        let mut header = Vec::from(width.to_be_bytes());
        header.extend_from_slice(&height.to_be_bytes());
        header.extend_from_slice(&[8, 6, 0, 0, 0]);
        chunk(&mut bytes, b"IHDR", &header);
        if animated {
            chunk(&mut bytes, b"acTL", &[0, 0, 0, 2, 0, 0, 0, 0]);
        }
        chunk(&mut bytes, b"IDAT", &[]);
        chunk(&mut bytes, b"IEND", &[]);
        bytes
    }

    fn jpeg(width: u16, height: u16) -> Vec<u8> {
        let mut bytes = vec![0xff, 0xd8, 0xff, 0xc0, 0, 11, 8];
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&[1, 1, 0x11, 0]);
        bytes.extend_from_slice(&[0xff, 0xd9]);
        bytes
    }

    #[test]
    fn accepts_static_png_and_jpeg_with_supported_dimensions() {
        assert_eq!(validate_pet_appearance_image("pet.png", &png(128, 4096, false)), Ok("png"));
        assert_eq!(validate_pet_appearance_image("pet.jpeg", &jpeg(256, 512)), Ok("jpg"));
    }

    #[test]
    fn accepts_png_with_svg_text_in_metadata_and_still_rejects_svg_documents() {
        let mut image = png(256, 512, false);
        let marker = b"Comment\0metadata contains <svg";
        let mut text_chunk = Vec::new();
        text_chunk.extend_from_slice(&(marker.len() as u32).to_be_bytes());
        text_chunk.extend_from_slice(b"tEXt");
        text_chunk.extend_from_slice(marker);
        text_chunk.extend_from_slice(&[0, 0, 0, 0]);
        let end_chunk = image.len() - 12;
        image.splice(end_chunk..end_chunk, text_chunk);

        assert_eq!(validate_pet_appearance_image("custom.png", &image), Ok("png"));
        assert!(validate_pet_appearance_image("drawing.svg", b"<?xml version=\"1.0\"?><svg></svg>")
            .unwrap_err()
            .contains("SVG"));
    }

    #[test]
    fn rejects_dimensions_outside_limits() {
        let error = validate_pet_appearance_image("small.png", &png(127, 128, false)).unwrap_err();
        assert!(error.contains("128–4096 px"));
        let error = validate_pet_appearance_image("large.png", &png(4097, 128, false)).unwrap_err();
        assert!(error.contains("128–4096 px"));
    }

    #[test]
    fn rejects_apng_and_disallowed_formats_with_clear_reasons() {
        let error = validate_pet_appearance_image("animated.png", &png(128, 128, true)).unwrap_err();
        assert!(error.contains("APNG"));
        assert!(validate_pet_appearance_image("pet.gif", b"GIF89a").unwrap_err().contains("GIF"));
        assert!(validate_pet_appearance_image("pet.svg", b"<svg></svg>").unwrap_err().contains("SVG"));
        assert!(validate_pet_appearance_image("clip.mp4", b"....ftyp").unwrap_err().contains("影片"));
        assert!(validate_pet_appearance_image("pet-atlas.png", &png(128, 128, false)).unwrap_err().contains("精靈圖集"));
    }

    #[test]
    fn rejects_files_over_ten_megabytes() {
        let error = validate_pet_appearance_image("large.png", &vec![0; MAX_PET_IMAGE_BYTES + 1])
            .unwrap_err();
        assert!(error.contains("10 MB"));
    }

    #[test]
    fn copies_image_and_restores_its_relative_path_after_database_reload() {
        let root = std::env::current_dir()
            .expect("Tauri crate directory should be available")
            .parent()
            .expect("project directory should be available")
            .join(".uat-local")
            .join("tmp")
            .join(format!(
                "pet-appearance-test-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .expect("system clock should be after Unix epoch")
                    .as_nanos()
            ));
        assert!(!root.exists(), "test path should be unique");
        let image = png(256, 512, false);
        let relative = store_pet_appearance(
            root.to_string_lossy().into_owned(),
            "picked-from-another-folder.png".into(),
            STANDARD.encode(&image),
        )
        .expect("valid image should be copied to the local data folder");
        assert!(relative.starts_with("pet-appearance/custom-"));
        let data_dir = root.to_string_lossy().into_owned();
        let value_json = serde_json::json!({
            "settings": { "petAppearancePath": relative },
            "todos": []
        })
        .to_string();
        persist_state(&data_dir, &value_json)
            .expect("relative appearance path should be persisted to the local test database");
        let reloaded_state = load_state(data_dir.clone())
            .expect("test database should be readable")
            .expect("saved app state should exist after restart");
        let reloaded_json = serde_json::from_str::<serde_json::Value>(&reloaded_state)
            .expect("saved state should remain valid JSON");
        let reloaded_path = reloaded_json["settings"]["petAppearancePath"]
            .as_str()
            .expect("custom path should be saved as a relative string")
            .to_string();
        assert_eq!(reloaded_path, relative);
        let resolved = resolve_pet_appearance(
            data_dir,
            reloaded_path,
        )
        .expect("relative appearance path should resolve after database reload");
        assert_eq!(std::fs::read(resolved).expect("stored image should exist"), image);
        std::fs::remove_dir_all(root).expect("test-only appearance folder should be removed");
    }
}
