#[path = "../build/prepositions.rs"]
mod prepositions_build;

/// Generate the shared preposition list without building Unicode mapping tables.
fn main() {
  let manifest = std::path::PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").expect("Cargo provides CARGO_MANIFEST_DIR"));
  prepositions_build::generate(&manifest.join("../data/prepositions.json"));
}
