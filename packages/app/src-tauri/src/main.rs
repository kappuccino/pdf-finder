// Pas de console supplémentaire sous Windows en release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    pdfref_app_lib::run()
}
