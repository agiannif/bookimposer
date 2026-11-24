//! The bookimposer desktop app: the Svelte UI in a Tauri window, with PDF
//! inspection and export done natively by the pdf-export crate.

mod commands;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let bundled = app.path().resource_dir()?.join("resources/pdfium");
            app.manage(commands::PdfiumFallbackDir(bundled));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::page_sizes,
            commands::export_pdf
        ])
        .run(tauri::generate_context!())
        .expect("bookimposer could not start");
}
