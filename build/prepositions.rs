use std::{
  env, fs,
  path::{Path, PathBuf},
};

/// Generate the shared preposition list from JSON in Cargo's output directory.
pub fn generate(source: &Path) {
  println!("cargo:rerun-if-changed={}", source.display());
  let json = fs::read_to_string(source).expect("prepositions.json is readable");
  let prepositions: Vec<String> = serde_json::from_str(&json).expect("prepositions.json is a string array");
  let output = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo provides OUT_DIR")).join("prepositions.rs");
  fs::write(output, format!("&{prepositions:?}")).expect("generated prepositions.rs is writable");
}
