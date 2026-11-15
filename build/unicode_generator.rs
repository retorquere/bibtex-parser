use std::{collections::BTreeSet, error::Error, fmt::Write as _, fs, path::Path};

use rusqlite::{Connection, params};
use serde_json::{Map, Value, json};

type Result<T> = std::result::Result<T, Box<dyn Error>>;

/// The JSON tables produced from the Unicode configuration.
pub const TABLE_NAMES: [&str; 5] = ["combining", "minimal", "biblatex", "bibtex", "latex2unicode"];

/// Load the fixed shared table cache when current, otherwise generate from project configuration.
///
/// Every source and cached file is tracked by Cargo so changes rerun the build script.
pub fn load(repository: &Path, output: &Path) -> Result<Vec<(&'static str, Value)>> {
  let config_path = repository.join("data/unicode2latex/config.ssv");
  let generator_path = repository.join("build/unicode_generator.rs");
  println!("cargo:rerun-if-changed={}", config_path.display());
  println!("cargo:rerun-if-changed={}", generator_path.display());
  let config = fs::read(&config_path)?;
  let source = fs::read(&generator_path)?;

  let shared = repository.join("data/unicode2latex");
  for name in ["_config.ssv", "_generator.rs"] {
    println!("cargo:rerun-if-changed={}", shared.join(name).display());
  }
  for name in TABLE_NAMES {
    println!("cargo:rerun-if-changed={}", shared.join(format!("{name}.json")).display());
  }
  let tables = match load_cached(&shared, &config, &source)? {
    Some(tables) => tables,
    None => generate(std::str::from_utf8(&config)?)?,
  };

  write_tables(output, &tables)?;
  fs::write(output.join("_config.ssv"), config)?;
  fs::write(output.join("_generator.rs"), source)?;
  Ok(tables)
}

/// Load shared tables only when their saved inputs match the current sources.
///
/// # Errors
/// Returns an error if a cache file cannot be read or a table is not valid JSON.
fn load_cached(directory: &Path, config: &[u8], source: &[u8]) -> Result<Option<Vec<(&'static str, Value)>>> {
  for (name, expected) in [("_config.ssv", config), ("_generator.rs", source)] {
    let data = match fs::read(directory.join(name)) {
      Ok(data) => data,
      Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
      Err(error) => return Err(error.into()),
    };
    // A stale cache must be regenerated from current inputs rather than mixed into this build.
    if data.as_slice() != expected {
      return Ok(None);
    }
  }

  let mut tables = Vec::new();
  for name in TABLE_NAMES {
    let data = match fs::read(directory.join(format!("{name}.json"))) {
      Ok(data) => data,
      Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
      Err(error) => return Err(error.into()),
    };
    tables.push((name, serde_json::from_slice(&data)?));
  }
  Ok(Some(tables))
}

/// Build all mappings from a UTF-8 configuration without writing files.
fn generate(config: &str) -> Result<Vec<(&'static str, Value)>> {
  // ---------------- Setup DB ----------------
  // Open the requested SQLite database connection.
  // Empty mode applies to both text and math; empty package selects the base table.
  let db = Connection::open_in_memory()?;
  db.execute_batch(
    "CREATE TABLE texmap (
        line INT NOT NULL,
        unicode TEXT NOT NULL,
        conversion TEXT CHECK(conversion IN ('=', 't2u', 'u2t')),
        tex TEXT NOT NULL,
        mode TEXT CHECK(mode IN ('', 'math', 'text')),
        package TEXT NOT NULL,
        combining INT NOT NULL CHECK(combining IN (0, 1)),
        stopgap INT NOT NULL CHECK(stopgap IN (0, 1))
    )",
  )?;
  // ---------------- Load SSV ----------------
  let mut errors = Vec::new();
  // Parse each configuration record into one database mapping.
  for (index, record) in csv::ReaderBuilder::new().delimiter(b' ').flexible(true).has_headers(false).from_reader(config.as_bytes()).records().enumerate() {
    let record = record?;
    let line = i64::try_from(index + 1)?;
    // Ignore blank lines and configuration comments.
    if record.iter().all(str::is_empty) || record.get(0).is_some_and(|field| field.starts_with("//") || field.starts_with("##")) {
      continue;
    }
    // Report incomplete records alongside other recoverable validation errors.
    if record.len() < 3 {
      errors.push(format!("record {line}: expected Unicode, direction, and TeX"));
      continue;
    }
    // Decode JSON escapes in the Unicode field.
    let unicode: String = serde_json::from_str(&format!("\"{}\"", &record[0]))?;
    let conversion = match &record[1] {
      "<" => "t2u",
      ">" => "u2t",
      "=" => "=",
      direction => {
        errors.push(format!("record {line}: unexpected direction {direction}"));
        continue;
      }
    };
    let tex = &record[2];
    let mut mode = "";
    let mut package = "";
    let mut combining = false;
    let mut stopgap = false;
    // Consume optional flags until the record has no fields left.
    // Stop parsing when the next optional field is empty.
    for flag in record.iter().skip(3).take_while(|flag| !flag.is_empty()) {
      match flag {
        // Apply a mode-only flag to the mapping.
        "math" | "text" => mode = flag,
        // Mark a character that combines with adjacent characters.
        "combining" => combining = true,
        // Mark a fallback conversion that is intentionally less precise.
        "stopgap" => stopgap = true,
        // Ignore the spacing marker because it has no database column.
        "space" => {}
        _ => {
          // Apply a mode and package from a combined flag.
          // Apply a package-only flag.
          // A package-only flag leaves any previously selected mode unchanged.
          if let Some((prefix, name)) = flag.split_once('.') {
            if matches!(prefix, "" | "math" | "text") && !name.is_empty() && name.bytes().all(|byte| byte.is_ascii_alphabetic() || byte == b'-') {
              if !prefix.is_empty() {
                mode = prefix;
              }
              package = name;
              continue;
            }
          }
          // Record unknown flags as build errors while continuing to inspect input.
          errors.push(format!("record {line}: unexpected flag {flag}"));
        }
      }
    }
    if stopgap && conversion == "=" {
      // A bidirectional fallback mapping is suspicious and must fail the build.
      errors.push(format!("record {line}: suspect stopgap conversion for {unicode} = {tex}"));
    }
    if mode == "text" && unicode.len() == 1 && unicode.as_bytes()[0].is_ascii_alphanumeric() {
      // Plain ASCII characters should not be replaced by a null text mapping.
      errors.push(format!("record {line}: null mapping for {unicode}"));
    }
    if stopgap && conversion != "t2u" && tex.contains("\\\\") {
      // Stopgap mappings must not claim a TeX command as their fallback text.
      errors.push(format!("record {line}: faulty stopgap {tex}"));
    }
    db.execute("INSERT INTO texmap VALUES (?, ?, ?, ?, ?, ?, ?, ?)", params![line, unicode, conversion, tex, mode, package, combining, stopgap])?;
  }
  if !errors.is_empty() {
    // Stop before writing tables when any input or sanity check failed.
    return Err(errors.join("\n").into());
  }
  println!("building tables");
  // Build every table before clearing output, so generation errors preserve existing files.
  let mut tables = Vec::new();
  // ---------------- Combining ----------------
  // Build lookup data for characters that combine with neighboring characters.
  // BTreeSet keeps names unique and sorted without a separate sort pass.
  let mut macros = BTreeSet::new();
  let mut tolatex = Map::new();
  let mut tounicode = Map::new();
  let mut single = String::new();
  let mut multi = Vec::new();
  for row in db
    .prepare("SELECT unicode, conversion, tex, mode FROM texmap WHERE combining = 1 ORDER BY mode, line")?
    .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?)))?
  {
    let (unicode, conversion, tex, mode) = row?;
    match unicode.chars().collect::<Vec<_>>().as_slice() {
      // Collect single-character mappings for a compact character class.
      [character] => single.push(*character),
      // Expand multi-character mappings into all valid input orderings.
      [first, second] => multi.push(format!("({first}{second}|{second}{first})")),
      [] => multi.push("()".into()),
      // Reject combining mappings whose input exceeds the supported length.
      _ => return Err(format!("unsupported combining sequence: {unicode:?}").into()),
    }
    if let Some(command) = tex.strip_prefix('\\') {
      // Record bare TeX macros used by combining mappings.
      if !command.is_empty() && command.bytes().all(|byte| byte.is_ascii_lowercase()) {
        macros.insert(command.to_owned());
      }
      // Add macro conversions only when the source direction supports them.
      let command = command.replacen("{}", "", 1);
      if matches!(conversion.as_str(), "t2u" | "=") {
        // Register the macro-to-Unicode conversion.
        tounicode.insert(command.clone(), json!(unicode));
      }
      if matches!(conversion.as_str(), "u2t" | "=") {
        // Register the Unicode-to-macro conversion.
        tolatex.insert(unicode, json!({ "mode": mode, "macro": command }));
      }
    }
  }
  if !single.is_empty() {
    // Add all single-character mappings as one final regex alternative.
    multi.push(format!("[{single}]"));
  }
  tables.push((
    "combining",
    json!({
        "macros": macros, "tolatex": tolatex, "tounicode": tounicode, "regex": multi.join("|")
    }),
  ));

  // ---------------- U2T ----------------
  // Generate each supported Unicode-to-TeX table.
  for name in ["minimal", "biblatex", "bibtex"] {
    // Build the Unicode-to-TeX mapping for one output mode.
    let mut mapping = Map::new();
    mapping.insert(String::new(), json!({}));
    // Later rows overwrite earlier values for each mode. Stopgaps are applied last;
    // within each stopgap group, mode-specific rows follow rows with an empty mode.
    for row in db
      .prepare(
        "SELECT tex.unicode, tex.tex, tex.mode, tex.package, tex.combining, (
                SELECT GROUP_CONCAT(package) FROM texmap alt
                WHERE tex.package = '' AND alt.package <> '' AND tex.unicode = alt.unicode
                    AND alt.conversion IN ('u2t', '=')
            ) AS alt
            FROM texmap tex WHERE tex.conversion IN ('u2t', '=')
            ORDER BY tex.stopgap, tex.mode, tex.line",
      )?
      .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?, row.get::<_, bool>(4)?, row.get::<_, Option<String>>(5)?)))?
    {
      let (unicode, mut tex, mode, package, combining, alt) = row?;
      if name == "minimal" {
        let mut characters = unicode.chars();
        if !characters.next().is_some_and(|character| {
          matches!(
            character,
            '\u{00a0}' | '\u{180e}' | '\u{2000}'..='\u{200b}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}' | '#' | '<' | '>' | '\\' | '$' | '%' | '&' | '^' | '_' | '{' | '}' | '~' | ']'
          )
        }) || characters.next().is_some()
        {
          // Keep only the explicitly supported characters in minimal mode.
          continue;
        }
        if !package.is_empty() {
          // Minimal mode cannot contain package-specific mappings.
          return Err(format!("package-specific minimal mapping: {tex}").into());
        }
      }
      // Create a package bucket when this is its first mapping.
      // Create a character record when this is its first mode.
      let character = mapping.entry(package.clone()).or_insert_with(|| json!({})).as_object_mut().unwrap().entry(unicode.clone()).or_insert_with(|| json!({}));
      for mode in if mode.is_empty() { vec!["text", "math"] } else { vec![mode.as_str()] } {
        if name == "bibtex" && mode == "text" {
          // Use BibTeX-safe names for braces in text mode.
          // http://tex.stackexchange.com/questions/230750/open-brace-in-bibtex-fields/230754#comment545453_230754
          match unicode.as_str() {
            // Replace an opening brace with its text macro.
            "{" => tex = "\\textbraceleft".into(),
            // Replace a closing brace with its text macro.
            "}" => tex = "\\textbraceright".into(),
            _ => {}
          }
        }
        character[mode] = json!(tex);
        if mode == "text" && combining {
          // Preserve the combining marker on text mappings.
          character["combining"] = json!(true);
        }
      }
      if package.is_empty() && name != "minimal" {
        if let Some(alt) = alt.filter(|alt| !alt.is_empty()) {
          // Keep alternate package names available to BibTeX-style consumers.
          character["alt"] = json!(alt.split(',').collect::<BTreeSet<_>>());
        }
      }
    }
    // Keep package-free mappings separate from mappings requiring optional packages.
    tables.push((name, json!({ "base": mapping.remove("").unwrap(), "package": mapping })));
  }

  // ---------------- T2U ----------------
  // Build the TeX-to-Unicode mapping, preserving text and math variants.
  let mut mapping = Map::new();
  // Reverse source order gives newer explicit-mode mappings the first chance to fill a mode.
  for row in db
    .prepare("SELECT unicode, tex, mode FROM texmap WHERE conversion IN ('t2u', '=') ORDER BY line DESC")?
    .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)))?
  {
    let (unicode, tex, mode) = row?;
    // Create a TeX record when this command is first encountered.
    let character = mapping.entry(tex.clone()).or_insert_with(|| json!({}));
    if mode.is_empty() {
      // An unqualified mapping applies identically in both modes.
      // This replaces both values, even if a newer row already supplied them.
      *character = json!({ "text": unicode, "math": unicode });
    } else {
      // Empty strings count as missing here, matching the JavaScript truthiness check.
      if character.get(&mode).and_then(Value::as_str).is_none_or(str::is_empty) {
        // Keep the first mapping for the current mode because rows are prioritized.
        character[&mode] = json!(unicode);
      }
      let other = if mode == "text" { "math" } else { "text" };
      if character.get(other).and_then(Value::as_str).is_none_or(str::is_empty) && !tex.starts_with(['_', '^']) && !tex.contains('\\') {
        // Reuse plain-text commands in the opposite mode when no explicit mapping exists.
        character[other] = json!(tex);
      }
    }
  }
  for character in mapping.values_mut() {
    let modes = character.as_object().unwrap();
    // Collapse identical mode mappings to a scalar value.
    // Collapse a mapping that only has one mode.
    if modes.len() == 1 || modes.get("text") == modes.get("math") {
      *character = modes.values().next().unwrap().clone();
    }
  }
  tables.push(("latex2unicode", Value::Object(mapping)));

  Ok(tables)
}

/// Write validated JSON tables to Cargo's build output directory.
pub fn write_tables(root: &Path, tables: &[(&str, Value)]) -> Result<()> {
  fs::create_dir_all(&root)?;
  for (name, table) in tables {
    fs::write(root.join(format!("{name}.json")), ascii_json(table)?)?;
  }
  Ok(())
}

/// Escape non-ASCII characters so generated JSON remains portable text.
fn ascii_json(value: &Value) -> Result<String> {
  let serialized = serde_json::to_string_pretty(value)?;
  let mut ascii = String::with_capacity(serialized.len());
  for unit in serialized.encode_utf16() {
    if (0x20..=0x7e).contains(&unit) || matches!(unit, 0x0a | 0x0d) {
      ascii.push(char::from_u32(u32::from(unit)).unwrap());
    } else {
      // Escaping UTF-16 units represents supplementary characters as surrogate pairs.
      write!(ascii, "\\u{unit:04x}")?;
    }
  }
  Ok(ascii)
}
