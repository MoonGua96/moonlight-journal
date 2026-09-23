use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::{
    fs,
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri_plugin_opener::OpenerExt;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

struct PetPressState(Mutex<Option<Instant>>);

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

#[tauri::command]
fn default_data_directory(app: tauri::AppHandle) -> Result<String, String> {
    let current = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    if current.join("moonlight.db").exists() {
        return Ok(current.to_string_lossy().into_owned());
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

#[tauri::command]
fn save_state(data_dir: String, value_json: String) -> Result<(), String> {
    let db = open_database(&data_dir)?;
    db.execute(
        "INSERT INTO app_state(key,value_json,updated_at)
         VALUES('main',?1,CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET
           value_json=excluded.value_json,
           updated_at=CURRENT_TIMESTAMP",
        params![value_json],
    )
    .map_err(|error| error.to_string())?;
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
    let pet = app
        .get_webview_window("pet")
        .ok_or("找不到桌面月光精靈視窗")?;
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
    press_state: tauri::State<PetPressState>,
) -> Result<(), String> {
    let now = Instant::now();
    let mut last_press = press_state
        .0
        .lock()
        .map_err(|_| "無法讀取桌面月光精靈點擊狀態".to_string())?;
    let is_double_click = last_press
        .map(|previous| now.duration_since(previous) <= Duration::from_millis(500))
        .unwrap_or(false);

    if is_double_click {
        *last_press = None;
        drop(last_press);
        return reveal_main_window(&app);
    }
    *last_press = Some(now);
    drop(last_press);

    let pet = app
        .get_webview_window("pet")
        .ok_or("找不到桌面月光精靈視窗")?;
    pet.start_dragging().map_err(|error| error.to_string())
}

#[tauri::command]
fn move_data_directory(source_dir: String, target_dir: String, value_json: String) -> Result<(), String> {
    let source = PathBuf::from(source_dir);
    let target = PathBuf::from(&target_dir);
    if source != target {
        copy_tree(&source.join("media"), &target.join("media"))?;
    }
    save_state(target_dir, value_json)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = reveal_main_window(app);
        }))
        .manage(PetPressState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            default_data_directory,
            load_state,
            save_state,
            store_media,
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
