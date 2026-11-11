#[allow(dead_code)]
#[path = "src/bin/rebuild.rs"]
mod generator;

use serde_json::Value;
use std::fmt::Write as _;

/// Emit a Rust string literal, retaining absence rather than inventing empty values.
fn optional(value: &Value) -> String {
  value.as_str().map_or_else(|| "None".into(), |text| format!("Some({text:?})"))
}

/// Emit sorted static entries so runtime lookup needs neither JSON nor initialization.
fn character_map(map: &Value) -> String {
  let mut source = String::from("&[");
  for (unicode, entry) in map.as_object().unwrap() {
    write!(
      source,
      "({unicode:?}, StaticChar {{ text: {}, math: {}, macrospacer: {}, stopgap: {}, combining: {}, alt: &[{}] }}),",
      optional(&entry["text"]),
      optional(&entry["math"]),
      entry["macrospacer"].as_bool().unwrap_or(false),
      entry["stopgap"].as_bool().unwrap_or(false),
      entry["combining"].as_bool().unwrap_or(false),
      entry["alt"].as_array().map(|packages| packages.iter().map(|package| format!("{:?}", package.as_str().unwrap())).collect::<Vec<_>>().join(",")).unwrap_or_default(),
    )
    .unwrap();
  }
  source.push(']');
  source
}

/// Compile validated source mappings into static Rust tables.
fn main() -> Result<(), Box<dyn std::error::Error>> {
  let config = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../data/unicode2latex/config.ssv");
  println!("cargo:rerun-if-changed={}", config.display());
  println!("cargo:rerun-if-changed=src/bin/rebuild.rs");
  let output = std::path::PathBuf::from(std::env::var("OUT_DIR")?);
  let mut source = String::new();
  for (name, table) in generator::generate()? {
    if matches!(name, "minimal" | "biblatex" | "bibtex") {
      write!(source, "static {}: StaticMap = StaticMap {{ base: {}, packages: &[", name.to_uppercase(), character_map(&table["base"]))?;
      for (package, map) in table["package"].as_object().unwrap() {
        write!(source, "({package:?}, {}),", character_map(map))?;
      }
      source.push_str("] };\n");
    } else if name == "combining" {
      source.push_str("static COMBINING: &[(&str, Mode, &str)] = &[\n");
      for (unicode, recipe) in table["tolatex"].as_object().unwrap() {
        writeln!(source, "({unicode:?}, Mode::{}, {:?}),", if recipe["mode"] == "text" { "Text" } else { "Math" }, recipe["macro"].as_str().unwrap())?;
      }
      source.push_str("];\n");
    }
  }
  std::fs::write(output.join("tables.rs"), source)?;
  Ok(())
}
