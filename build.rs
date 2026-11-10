use serde::Deserialize;
use std::{
  collections::BTreeMap,
  env, fs,
  path::{Path, PathBuf},
};

#[path = "src/unicode_tables.rs"]
mod unicode_tables;
use unicode_tables::UnicodeMapping;

/// Generate prepositions for both crates and the Unicode table for the full parser only.
fn main() {
  let manifest = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("Cargo provides CARGO_MANIFEST_DIR"));
  let local_data = manifest.join("data/prepositions.json");
  // The tokenizer subcrate is nested one level below the shared data directory.
  let source = if local_data.is_file() { local_data } else { manifest.join("../data/prepositions.json") };
  println!("cargo:rerun-if-changed={}", source.display());

  let json = fs::read_to_string(source).expect("prepositions.json is readable");
  let prepositions: Vec<String> = serde_json::from_str(&json).expect("prepositions.json is a string array");
  let generated = format!("&{prepositions:?}");
  let output = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo provides OUT_DIR")).join("prepositions.rs");
  fs::write(output, generated).expect("generated prepositions.rs is writable");

  // The tokenizer shares this build script but does not render TeX or embed Unicode mappings.
  if env::var("CARGO_PKG_NAME").as_deref() == Ok("rq-bibtex-parser") {
    pack_unicode_mappings(&manifest);
  }
}

/// Upstream values are either shared between modes or explicitly mode-specific.
#[derive(Deserialize)]
#[serde(untagged)]
enum SourceMapping {
  Shared(String),
  Modes { text: Option<String>, math: Option<String> },
}

/// Only the upstream macro-to-combining-mark map is needed for rendering.
#[derive(Deserialize)]
struct Combining {
  tounicode: BTreeMap<String, String>,
}

/// Normalize upstream JSON and write a raw DEFLATE stream containing Postcard rows.
///
/// BTreeMap provides unique UTF-8-byte-sorted keys for runtime binary search. None fields
/// represent unavailable modes; empty strings remain valid mappings. Build failures identify
/// invalid source data rather than producing a partially usable runtime table.
fn pack_unicode_mappings(manifest: &Path) {
  let source = manifest.join("data/unicode2latex");
  let latex = source.join("latex2unicode.json");
  let combining = source.join("combining.json");
  println!("cargo:rerun-if-changed={}", latex.display());
  println!("cargo:rerun-if-changed={}", combining.display());
  let latex: BTreeMap<String, SourceMapping> = serde_json::from_slice(&fs::read(latex).expect("latex2unicode.json is readable")).expect("latex2unicode.json contains shared or mode-specific mappings");
  let combining: Combining = serde_json::from_slice(&fs::read(combining).expect("combining.json is readable")).expect("combining.json contains a tounicode string map");
  let mut mappings = BTreeMap::new();
  for (key, value) in latex {
    let (text, math) = match value {
      // Scalar entries apply in both modes, including the empty string.
      SourceMapping::Shared(value) => (Some(value.clone()), Some(value)),
      SourceMapping::Modes { text, math } => (text, math),
    };
    mappings.insert(key.clone(), UnicodeMapping { key, text, math, combining: None });
  }
  for (name, mark) in combining.tounicode {
    let key = format!("\\{name}");
    // Accents supplement existing mode mappings; accent-only macros get absent mode values.
    mappings.entry(key.clone()).or_insert(UnicodeMapping { key, text: None, math: None, combining: None }).combining = Some(mark);
  }
  let rows: Vec<_> = mappings.into_values().collect();
  let encoded = postcard::to_allocvec(&rows).expect("Unicode mappings serialize as Postcard");
  let packed = miniz_oxide::deflate::compress_to_vec(&encoded, 9);
  let output = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo provides OUT_DIR")).join("unicode_tables.deflate");
  fs::write(output, packed).expect("generated Unicode table is writable");
}
