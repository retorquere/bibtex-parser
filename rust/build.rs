use std::env;
use std::path::PathBuf;
use std::process::Command;

/// Generate the static Rust Unicode table from the repository's unicode2latex exports.
fn main() {
    let manifest = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let exporter = manifest.join("unicode-tables.mjs");
    println!("cargo:rerun-if-changed={}", exporter.display());
    println!(
        "cargo:rerun-if-changed=../node_modules/unicode2latex/dist/esm/tables/latex2unicode.js"
    );
    println!("cargo:rerun-if-changed=../node_modules/unicode2latex/dist/esm/tables/combining.js");

    let status = Command::new("node")
        .arg(exporter)
        .current_dir(&manifest)
        .status()
        .unwrap_or_else(|error| panic!("failed to export unicode2latex tables: {error}"));
    // Compilation must stop if the generated table is absent or stale, rather than ship partial mappings.
    if !status.success() {
        panic!("unicode2latex table generation failed with {status}");
    }
}
