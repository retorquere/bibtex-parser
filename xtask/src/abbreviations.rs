use bibtex_parser::{MapOptions, Options as BibTeXOptions, Transform, TranslateOptions, parse as parse_bibtex};
use glob::glob;
use reqwest::header::{ETAG, IF_NONE_MATCH};
use serde_json::Value;
use std::{fs, io, path::Path};

struct Abbreviations {
  unabbr: std::collections::HashMap<String, String>,
  strings: String,
  translator: Transform,
}

impl Abbreviations {
  /// Create an empty abbreviation map seeded with the base BibTeX strings.
  fn new() -> Self {
    Self {
      unabbr: std::collections::HashMap::new(),
      strings: String::new(),
      // The BibLaTeX mode matches the mappings previously used to build string definitions.
      translator: Transform::new("biblatex", MapOptions::default()).expect("biblatex is a built-in translation mode"),
    }
  }

  /// Generate abbreviation data using sources and outputs rooted at the workspace.
  ///
  /// # Errors
  /// Returns an error if a source cannot be read or parsed, or generated output cannot be written.
  fn generate(&mut self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // CARGO_MANIFEST_DIR is xtask/, so its parent is the project root.
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().ok_or_else(|| io::Error::other("xtask manifest has no workspace parent"))?;
    let src = root.join("data").join("unabbreviate");
    fs::create_dir_all(&src)?;
    let gen_dir = root.join("gen").join("unabbreviate");
    fs::create_dir_all(&gen_dir)?;

    let listing = fetch("00dir.cmd").unwrap_or_else(|err| panic!("failed to fetch BibTeX strings index: {err}"));
    for bib in listing.lines() {
      if bib.ends_with(".bib") {
        // The directory listing prefixes download commands with `get `.
        let bib = bib.strip_prefix("get ").unwrap_or(bib);
        let strings = fetch(bib).unwrap_or_else(|err| panic!("failed to fetch {bib}: {err}"));
        self.strings += &format!("%% {}\n{}\n", bib, strings);
      }
    }

    // Collect base data sources
    let base_json = root.join("data/unabbreviate/base.json");
    let strings_bib = root.join("data/unabbreviate/strings.bib");
    let abbreviations_rs = root.join("xtask/src/abbreviations.rs");
    let fixups_json = root.join("data/unabbreviate/fixups.json");

    let base_sources: Vec<&Path> = vec![base_json.as_path(), strings_bib.as_path(), abbreviations_rs.as_path()];

    // Collect submodule CSV sources
    let mut csv_files = Vec::new();
    for entry in glob(root.join("submodules/abbrv.jabref.org/journals/journal_abbreviations_*.csv").to_string_lossy().as_ref())? {
      csv_files.push(entry?);
    }
    let csv_sources: Vec<&Path> = csv_files.iter().map(|p| p.as_path()).collect();

    // Collect submodule JSON sources
    let mut json_files = Vec::new();
    for entry in glob(root.join("submodules/abbreviations/**/*.json").to_string_lossy().as_ref())? {
      let path = entry?;
      if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
        if filename != "header.json" && filename != "footer.json" {
          json_files.push(path);
        }
      }
    }
    let json_sources: Vec<&Path> = json_files.iter().map(|p| p.as_path()).collect();

    // Fixups "sources"
    let fixup_sources: Vec<&Path> = vec![fixups_json.as_path()];

    // Check if all source groups are up to date
    if [&base_sources, &csv_sources, &json_sources, &fixup_sources].iter().all(|sources| is_up_to_date(&gen_dir, sources).unwrap_or(false)) {
      return Ok(());
    }

    // Load base data and strings
    self.strings = fs::read_to_string(&strings_bib)?;
    let base: Value = serde_json::from_str(&fs::read_to_string(&base_json)?)?;
    if let Some(map) = base.as_object() {
      for (abbr, full) in map {
        let abbr = self.clean(abbr, full.as_str().unwrap_or(""));
        let full = full.as_str().unwrap_or("");
        if !abbr.is_empty() && !full.is_empty() {
          self.unabbr.insert(abbr, full.to_string());
        }
      }
    }

    for entry in &csv_files {
      let mut reader = csv::ReaderBuilder::new().delimiter(b';').from_path(entry)?;
      for row in reader.records() {
        let row = row?;
        if row.len() < 2 {
          continue;
        }
        let full = &row[0];
        let abbr = &row[1];
        let abbr = self.clean(abbr, full);
        if accept(&abbr, full) {
          self.unabbr.insert(abbr, full.to_string());
        }
      }
    }

    for path in &json_files {
      let data = fs::read_to_string(path)?;
      let base: Value = serde_json::from_str(&data)?;
      if let Some(map) = base.get("default").and_then(|v| v.get("container-title")).and_then(|v| v.as_object()) {
        for (abbr, full) in map {
          let abbr = self.clean(abbr, full.as_str().unwrap_or(""));
          let full = full.as_str().unwrap_or("");

          if !accept(&abbr, full) {
            continue;
          }

          // The first source to provide a mapping establishes its initial value.
          if !self.unabbr.contains_key(&abbr) {
            self.unabbr.insert(abbr, full.to_string());
          }
          // An exact duplicate needs no conflict resolution or redundant write.
          else if self.unabbr[&abbr] == full {
            continue;
          }
          // A shared-prefix difference can be an optional subtitle or qualifier. Keep
          // the first-seen spelling rather than letting source order replace it.
          else if unarticle(&self.unabbr[&abbr]).to_lowercase() == unarticle(full).to_lowercase() {
            self.unabbr.insert(abbr, unarticle(full));
          }
          // The base/JabRef data is loaded before these feeds. Preserve that established
          // spelling when a later source only adds or removes a trailing title extension.
          else if self.unabbr[&abbr].to_lowercase().starts_with(&full.to_lowercase()) || full.to_lowercase().starts_with(&self.unabbr[&abbr].to_lowercase()) {
            continue;
          }
          // With no prefix relationship, neither title is clearly just an extension
          // of the other; prefer the longer candidate to avoid discarding title detail.
          else if self.unabbr[&abbr].len() <= full.len() {
            self.unabbr.insert(abbr, full.to_string());
          }
        }
      }
    }

    // Uppercase keys for consistent abbreviation lookup and normalize acronym casing
    // in the corresponding full titles.
    self.unabbr = self.unabbr.iter().map(|(k, v)| (k.to_uppercase(), fix(v))).collect();

    // Apply manual fixups
    let data = fs::read_to_string(root.join("data/unabbreviate/fixups.json"))?;
    let base: Value = serde_json::from_str(&data)?;
    if let Some(map) = base.as_object() {
      for (abbr, full) in map {
        // Accept both dotted and dotless spellings, regardless of key capitalization.
        let dotless = abbr.replace('.', "");
        for k in [abbr.as_str(), dotless.as_str()] {
          let k = k.to_uppercase();
          // A null fixup means the key is too generic and we don't want it in the mapping.
          if full.is_null() {
            if self.unabbr.contains_key(&k) {
              println!("popping {}", k);
              self.unabbr.remove(&k);
            }
          }
          // Non-null fixups are curated values and take precedence over source data.
          else {
            self.unabbr.insert(k, full.as_str().unwrap_or("").to_string());
          }
        }
      }

      // Very short abbreviations are too ambiguous to expand reliably.
      for abbr in self.unabbr.clone().into_keys() {
        // Remove both forms so dotted and dotless inputs are filtered consistently.
        for k in [abbr.clone(), abbr.replace('.', "")] {
          if k.replace('.', "").len() <= 2 {
            self.unabbr.remove(&k);
          }
        }
      }
    }

    // Save strings.bib amended with JabRef string definitions to strings.bib
    write_if_changed(gen_dir.join("strings.bib"), &self.strings)?;

    // Parse the combined BibTeX source to resolve and serialize its string definitions.
    let parsed = parse_bibtex(&self.strings, BibTeXOptions::default());
    write_if_changed(gen_dir.join("strings.json"), serde_json::to_string(&parsed.strings)?)?;

    // save unabbreviate mapping
    write_if_changed(gen_dir.join("unabbreviate.json"), serde_json::to_string(&self.unabbr)?)?;
    Ok(())
  }

  /// Normalize an abbreviation and add eligible JabRef string definitions.
  fn clean(&mut self, abbr: &str, full: &str) -> String {
    let mut abbr = abbr.to_uppercase();
    abbr = abbr.trim().to_string();
    if abbr.len() < 2 {
      return String::new();
    }
    // JabRef makes some "special" choices sometimes
    if abbr.starts_with('#') && abbr.ends_with('#') {
      abbr = abbr[1..abbr.len() - 2].to_string();
      if !full.contains('"') && accept(&abbr, full) {
        let latex = self.translator.tolatex(full, &mut TranslateOptions::default());
        self.strings += &format!("@string{{{} = \"{}\"}}\n", abbr, latex);
      }
    }
    abbr
  }
}

/// Run abbreviation generation for the workspace task.
pub(super) fn run() -> io::Result<()> {
  Abbreviations::new().generate().map_err(io::Error::other)
}

/// Remove whitespace and periods when comparing abbreviation and title lengths.
fn minimize(s: &str) -> String {
  s.chars().filter(|c| !c.is_whitespace() && *c != '.').collect()
}

/// Decide whether a full title is a useful, safe expansion for an abbreviation.
fn accept(abbr: &str, full: &str) -> bool {
  // not much of an abbreviation if the full form is shorter or equal in length
  if minimize(full).len() <= minimize(abbr).len() {
    return false;
  }
  if abbr.is_empty() {
    return false;
  }
  if full.contains('$') {
    return false;
  }
  if full.contains('"') {
    return false;
  }
  if full.contains("...") {
    return false;
  }
  if just_journal(full) || just_journal(abbr) {
    return false;
  }
  true
}

/// Remove supported leading articles when comparing or normalizing titles.
fn unarticle(j: &str) -> String {
  let mut j = j.to_string();
  for prefix in ["the ", "la "] {
    if j.to_lowercase().starts_with(prefix) {
      j = j[prefix.len()..].to_string();
    }
  }
  j
}

/// Check whether a title reduces to the uninformative generic word "journal".
fn just_journal(j: &str) -> bool {
  unarticle(j).to_lowercase() == "journal"
}

/// Restore conventional uppercase spelling for selected acronyms in a title.
fn fix(journal: &str) -> String {
  // Correct known acronym spellings that source lists may provide in mixed case.
  static ACRONYM_PATTERNS: std::sync::LazyLock<[regex::Regex; 7]> =
    std::sync::LazyLock::new(|| ["ipemc", "ces/ieee", "acm-ieee", "iccad-ieee", "'Leos '", "IEEE/leos", "ieee"].map(|acro| regex::RegexBuilder::new(&format!(r"\b{}\b", regex::escape(acro))).case_insensitive(true).build().expect("fixed acronym pattern is valid")));
  // Match acronyms case-insensitively at word boundaries so surrounding title text
  // and punctuation are left as supplied.
  let mut journal = journal.to_string();
  for re in ACRONYM_PATTERNS.iter() {
    journal = re.replace_all(&journal, |caps: &regex::Captures| caps[0].to_uppercase()).to_string();
  }
  journal
}

/// Check if all target files are newer than all source files.
/// Returns true if targets are up to date, false if regeneration is needed.
fn is_up_to_date(target_dir: &Path, sources: &[&Path]) -> io::Result<bool> {
  // Get the oldest target file's modification time
  let mut oldest_target: Option<std::time::SystemTime> = None;
  if let Ok(entries) = fs::read_dir(target_dir) {
    for entry in entries {
      let entry = entry?;
      if entry.path().is_file() {
        let mtime = entry.metadata()?.modified()?;
        oldest_target = Some(match oldest_target {
          None => mtime,
          Some(prev) => prev.min(mtime),
        });
      }
    }
  }

  let oldest_target = match oldest_target {
    Some(t) => t,
    None => return Ok(false), // Targets don't exist, need to regenerate
  };

  // Check if any source is newer than the oldest target
  for source in sources {
    if source.is_file() {
      let mtime = fs::metadata(source)?.modified()?;
      if mtime > oldest_target {
        return Ok(false); // Source is newer, need to regenerate
      }
    }
  }

  Ok(true) // All targets are up to date
}

/// Write a file only if its content has changed, avoiding unnecessary filesystem writes.
fn write_if_changed(path: impl AsRef<Path>, content: impl AsRef<[u8]>) -> io::Result<()> {
  let path = path.as_ref();
  let new_content = content.as_ref();
  if let Ok(existing) = fs::read(path) {
    if existing == new_content {
      return Ok(());
    }
  }
  fs::write(path, new_content)
}

/// Fetch a Netlib string file, reusing cached contents while its ETag is unchanged.
///
/// The file and its `.etag` sidecar are stored in the workspace's `data/unabbreviate`
/// directory. Network, missing-ETag, and filesystem failures are returned to the caller.
fn fetch(name: &str) -> Result<String, Box<dyn std::error::Error>> {
  if Path::new(name).file_name().and_then(|filename| filename.to_str()) != Some(name) {
    return Err(io::Error::new(io::ErrorKind::InvalidInput, "expected a file name").into());
  }

  let url = format!("https://www.netlib.org/bibnet/tools/strings/{}", name);
  let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().ok_or_else(|| io::Error::other("xtask manifest has no workspace parent"))?;
  let cache_dir = root.join("data/unabbreviate");
  let cache_path = cache_dir.join(name);
  let etag_path = cache_path.with_extension("etag");
  let client = reqwest::blocking::Client::new();

  let cache_exists = cache_path.try_exists()?;
  let saved_etag = if cache_exists {
    match fs::read_to_string(&etag_path) {
      Ok(etag) => Some(etag),
      Err(error) if error.kind() == io::ErrorKind::NotFound => None,
      Err(error) => return Err(error.into()),
    }
  } else {
    None
  };

  // Conditional GET avoids a separate HEAD request and lets the server confirm an unchanged cache.
  let mut request = client.get(&url);
  if let Some(etag) = saved_etag.as_deref() {
    request = request.header(IF_NONE_MATCH, etag);
  }
  let response = request.send()?;
  if response.status() == reqwest::StatusCode::NOT_MODIFIED {
    if cache_exists && saved_etag.is_some() {
      return Ok(fs::read_to_string(cache_path)?);
    }
    return Err(io::Error::new(io::ErrorKind::InvalidData, "server returned 304 without a cached file").into());
  }

  let response = response.error_for_status()?;
  let etag = response.headers().get(ETAG).ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "download response did not include an ETag"))?.to_str()?.to_owned();
  let body = response.text()?;
  fs::create_dir_all(&cache_dir)?;
  fs::write(&cache_path, &body)?;
  fs::write(etag_path, etag)?;
  Ok(body)
}
