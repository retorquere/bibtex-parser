use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{error::Error, fs, path::Path};

type Result<T> = std::result::Result<T, Box<dyn Error>>;

/// A serializable character mapping entry.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct TeXCharEntry {
  pub text: Option<String>,
  pub math: Option<String>,
  pub macrospacer: bool,
  pub stopgap: bool,
  pub combining: bool,
  pub alt: Vec<String>,
}

/// A serializable package map: (character, entry).
pub type CharacterMap = Vec<(String, TeXCharEntry)>;

/// All compressed Unicode-to-LaTeX mapping tables.
#[derive(Serialize, Deserialize)]
pub struct UnicodeTables {
  pub minimal: (CharacterMap, Vec<(String, CharacterMap)>),
  pub bibtex: (CharacterMap, Vec<(String, CharacterMap)>),
  pub biblatex: (CharacterMap, Vec<(String, CharacterMap)>),
  pub combining: Vec<(String, String, String)>, // (unicode, mode, macro)
}

/// Serialize Unicode-to-LaTeX mappings into compressed binary format.
/// Uses Postcard for compact binary serialization, compressed with DEFLATE.
pub fn generate(tables: &[(&str, Value)], output: &Path) -> Result<()> {
  let mut unicode_tables = UnicodeTables {
    minimal: Default::default(),
    bibtex: Default::default(),
    biblatex: Default::default(),
    combining: Vec::new(),
  };

  for (name, table) in tables {
    match *name {
      "minimal" | "bibtex" | "biblatex" => {
        let base = extract_character_map(&table["base"])?;
        let packages = extract_package_maps(&table["package"])?;
        let target = match *name {
          "minimal" => &mut unicode_tables.minimal,
          "bibtex" => &mut unicode_tables.bibtex,
          "biblatex" => &mut unicode_tables.biblatex,
          _ => unreachable!(),
        };
        *target = (base, packages);
      }
      "combining" => {
        for (unicode, recipe) in table["tolatex"].as_object().unwrap() {
          let mode = if recipe["mode"] == "text" { "Text" } else { "Math" };
          let macro_name = recipe["macro"].as_str().unwrap().to_string();
          unicode_tables.combining.push((unicode.clone(), mode.to_string(), macro_name));
        }
      }
      _ => {}
    }
  }

  // Serialize to Postcard binary and compress with DEFLATE for best balance.
  let encoded = postcard::to_allocvec(&unicode_tables)?;
  let compressed = miniz_oxide::deflate::compress_to_vec(&encoded, 9);
  let output_path = output.join("unicode_to_latex_tables.deflate");
  fs::write(output_path, compressed)?;

  Ok(())
}

/// Extract character mappings from a JSON object.
fn extract_character_map(map: &Value) -> Result<CharacterMap> {
  let mut entries = Vec::new();
  for (unicode, entry) in map.as_object().unwrap() {
    let char_entry = TeXCharEntry {
      text: entry["text"].as_str().map(String::from),
      math: entry["math"].as_str().map(String::from),
      macrospacer: entry["macrospacer"].as_bool().unwrap_or(false),
      stopgap: entry["stopgap"].as_bool().unwrap_or(false),
      combining: entry["combining"].as_bool().unwrap_or(false),
      alt: entry["alt"].as_array().map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default(),
    };
    entries.push((unicode.clone(), char_entry));
  }
  Ok(entries)
}

/// Extract package-specific character maps.
fn extract_package_maps(packages: &Value) -> Result<Vec<(String, CharacterMap)>> {
  let mut maps = Vec::new();
  for (package, map) in packages.as_object().unwrap() {
    maps.push((package.clone(), extract_character_map(map)?));
  }
  Ok(maps)
}
