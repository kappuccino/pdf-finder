// Rust minimal : uniquement l'enregistrement des plugins. Toute la logique est en JS.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        // restaure au démarrage l'accès au dossier PDF choisi lors d'une session précédente
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_drag::init())
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application");
}
