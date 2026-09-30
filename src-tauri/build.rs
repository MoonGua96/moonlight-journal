fn main() {
    println!("cargo:rerun-if-env-changed=MOONLIGHT_PERSONAL_BUILD");
    tauri_build::build()
}
