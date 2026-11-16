use serde::{Deserialize, Serialize};
use std::{
  collections::BTreeMap,
  env, fs,
  path::{Path, PathBuf},
};

#[path = "build/crossref.rs"]
mod crossref_generator;
#[path = "build/unicode_mapping_generator.rs"]
mod unicode_mapping_generator;
#[path = "shared/unicode_mapping.rs"]
mod unicode_tables;
#[path = "build/unicode_to_latex.rs"]
mod unicode_to_latex_generator;
use unicode_tables::UnicodeMapping;

/// Regenerate parser data before embedding it alongside the Unicode tables.
fn main() {
  let manifest = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("Cargo provides CARGO_MANIFEST_DIR"));

  // Track build script modules to ensure rebuild when they change
  println!("cargo:rerun-if-changed={}/build/crossref.rs", manifest.display());
  println!("cargo:rerun-if-changed={}/build/unicode_mapping_generator.rs", manifest.display());
  println!("cargo:rerun-if-changed={}/build/unicode_to_latex.rs", manifest.display());

  // Track shared schema to ensure rebuild when the serialization format changes
  println!("cargo:rerun-if-changed={}/shared/unicode_mapping.rs", manifest.display());

  crossref_generator::generate(&manifest).expect("cross-reference data generation succeeds");
  generate_parser_data(&manifest);
  let output = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo provides OUT_DIR"));
  let gen_dir = manifest.join("gen/unicode2latex");
  let tables = unicode_mapping_generator::load(&manifest, &output).expect("Unicode mappings generate from the shared configuration");

  // Write Unicode mappings to gen/ for distribution with npm package
  unicode_mapping_generator::write_tables(&gen_dir, &tables).expect("Unicode mappings write to gen/");

  unicode_to_latex_generator::generate(&tables, &output).expect("Unicode-to-LaTeX tables generate from the shared mappings");
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
  let gen_dir = manifest.join("gen/crossref");
  let fields_path = gen_dir.join("fields.json");
  let crossref_path = gen_dir.join("crossref.json");
  let english_path = manifest.join("data/english.json");
  // Watch the entire data folder for any source file changes
  println!("cargo:rerun-if-changed={}/data", manifest.display());
  let parser_data = ParserDataSource {
    cross_reference_data: serde_json::from_slice(&fs::read(&fields_path).unwrap_or_else(|e| panic!("fields.json is required but missing or unreadable ({}). Run: cargo xtask build", e))).expect("fields.json has valid cross-reference data"),
    cross_reference_map: serde_json::from_slice(&fs::read(&crossref_path).unwrap_or_else(|e| panic!("crossref.json is required but missing or unreadable ({}). Run: cargo xtask build", e))).expect("crossref.json has valid type mappings"),
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
