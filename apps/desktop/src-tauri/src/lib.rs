mod watcher;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use watcher::FolderWatcher;

const MINIMIZED_FLAG: &str = "--minimized";

#[derive(Default)]
struct WatchState(Mutex<Option<FolderWatcher>>);

#[tauri::command]
fn start_watching(app: AppHandle, state: State<'_, WatchState>, path: String, since_ms: f64) -> Result<(), String> {
    let mut slot = state.0.lock().unwrap();
    *slot = None;
    let ready_app = app.clone();
    let error_app = app.clone();
    let w = FolderWatcher::start(
        &PathBuf::from(path),
        since_ms.max(0.0) as u128,
        Arc::new(move |file| {
            let _ = ready_app.emit("file-ready", file);
        }),
        Arc::new(move |err| {
            let _ = error_app.emit("watch-error", err);
        }),
    )?;
    *slot = Some(w);
    Ok(())
}

#[tauri::command]
fn stop_watching(state: State<'_, WatchState>) {
    *state.0.lock().unwrap() = None;
}

#[tauri::command]
fn read_file(path: String) -> Result<tauri::ipc::Response, String> {
    std::fs::read(&path)
        .map(tauri::ipc::Response::new)
        .map_err(|e| format!("Couldn't read {path}: {e}"))
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![MINIMIZED_FLAG])))
        .manage(WatchState::default())
        .invoke_handler(tauri::generate_handler![start_watching, stop_watching, read_file])
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Open MixNotes", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("MixNotes — watching for exports")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;

            if std::env::args().any(|a| a == MINIMIZED_FLAG) {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Keep watching in the tray when the window is closed.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running MixNotes");
}
