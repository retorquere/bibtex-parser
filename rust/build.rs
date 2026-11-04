use std::{env, fs, path::PathBuf};

/// Generate the shared preposition slice consumed by both Rust wasm offerings.
fn main() {
  let manifest = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("Cargo provides CARGO_MANIFEST_DIR"));
  let local_data = manifest.join("data/prepositions.json");
  // The standalone crate is nested one level below the shared data directory.
  let source = if local_data.is_file() { local_data } else { manifest.join("../data/prepositions.json") };
  println!("cargo:rerun-if-changed={}", source.display());

  let json = fs::read_to_string(source).expect("prepositions.json is readable");
  let prepositions: Vec<String> = serde_json::from_str(&json).expect("prepositions.json is a string array");
  let generated = format!("&{prepositions:?}");
  let output = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo provides OUT_DIR")).join("prepositions.rs");
  fs::write(output, generated).expect("generated prepositions.rs is writable");
}
