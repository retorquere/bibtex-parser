use serde::{Deserialize, Serialize};
use std::{
  collections::BTreeMap,
  env, fs,
  path::{Path, PathBuf},
};

#[path = "build/unicode_generator.rs"]
mod unicode_generator;
#[path = "shared/unicode_mapping.rs"]
mod unicode_tables;
use unicode_tables::UnicodeMapping;

/// Generate parser data and Unicode tables.
fn main() {
  let manifest = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("Cargo provides CARGO_MANIFEST_DIR"));

  generate_parser_data(&manifest);
  let output = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo provides OUT_DIR"));
  let tables = unicode_generator::load(&manifest, &output).expect("Unicode tables generate from the shared configuration");
  pack_unicode_mappings(&tables);
}

#[derive(Deserialize, Serialize)]
struct CrossReferenceDataSource {
  allowed: BTreeMap<String, Vec<String>>,
  #[serde(rename = "noCrossRef")]
  no_cross_ref: Vec<String>,
}

type CrossReferenceMapSource = BTreeMap<String, BTreeMap<String, BTreeMap<String, String>>>;

#[derive(Serialize)]
struct ParserDataSource {
  cross_reference_data: CrossReferenceDataSource,
  cross_reference_map: CrossReferenceMapSource,
  default_english: Vec<String>,
}

/// Serialize validated parser data into a compact build artifact for one-time runtime decoding.
fn generate_parser_data(manifest: &Path) {
  let data = manifest.join("data");
  let fields_path = data.join("fields.json");
  let crossref_path = data.join("crossref.json");
  let english_path = data.join("english.json");
  for path in [&fields_path, &crossref_path, &english_path] {
    println!("cargo:rerun-if-changed={}", path.display());
  }
  let parser_data = ParserDataSource {
    cross_reference_data: serde_json::from_slice(&fs::read(fields_path).expect("fields.json is readable")).expect("fields.json has valid cross-reference data"),
    cross_reference_map: serde_json::from_slice(&fs::read(crossref_path).expect("crossref.json is readable")).expect("crossref.json has valid type mappings"),
    default_english: serde_json::from_slice(&fs::read(english_path).expect("english.json is readable")).expect("english.json is a string array"),
  };
  let encoded = postcard::to_allocvec(&parser_data).expect("parser data serializes as Postcard");
  let compressed = miniz_oxide::deflate::compress_to_vec(&encoded, 9);
  let output = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo provides OUT_DIR")).join("parser_data.deflate");
  fs::write(output, compressed).expect("generated parser data is writable");
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

/// Normalize generated tables and write a raw DEFLATE stream containing Postcard rows.
///
/// BTreeMap provides unique UTF-8-byte-sorted keys for runtime binary search. None fields
/// represent unavailable modes; empty strings remain valid mappings. Build failures identify
/// invalid source data rather than producing a partially usable runtime table.
fn pack_unicode_mappings(tables: &[(&str, serde_json::Value)]) {
  let table = |name| tables.iter().find(|(key, _)| *key == name).expect("required Unicode table is generated").1.clone();
  let latex: BTreeMap<String, SourceMapping> = serde_json::from_value(table("latex2unicode")).expect("latex2unicode contains shared or mode-specific mappings");
  let combining: Combining = serde_json::from_value(table("combining")).expect("combining contains a tounicode string map");
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
