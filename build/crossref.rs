use anyhow::{Context as _, Result, anyhow, bail, ensure};
use serde::Serialize;
use std::{
  collections::{BTreeMap, BTreeSet},
  fs,
  path::Path,
};
use sxd_document::parser;
use sxd_xpath::{Context, Factory, Value, nodeset::Node};

const BCF_NAMESPACE: &str = "https://sourceforge.net/projects/biblatex";

type CrossReferenceMap = BTreeMap<String, BTreeMap<String, BTreeMap<String, String>>>;

#[derive(Serialize)]
struct CrossReferenceData {
  allowed: BTreeMap<String, Vec<String>>,
  #[serde(rename = "noCrossRef")]
  no_cross_ref: Vec<String>,
}

/// Regenerate the cross-reference JSON snapshots when the Biber submodule is available.
///
/// Crate packages omit that submodule and therefore continue using the checked-in snapshots.
pub fn generate(manifest: &Path) -> Result<()> {
  let config_path = manifest.join("submodules/biber/data/biber-tool.conf");
  let bcf_directory = manifest.join("submodules/biber/t/tdata");
  println!("cargo:rerun-if-changed={}", config_path.display());
  println!("cargo:rerun-if-changed={}", bcf_directory.display());

  if !config_path.is_file() && !bcf_directory.is_dir() {
    println!("cargo:warning=Biber sources are unavailable; using the checked-in cross-reference JSON snapshots");
    return Ok(());
  }
  ensure!(config_path.is_file() && bcf_directory.is_dir(), "Biber cross-reference inputs are incomplete");

  let mut bcf_files: Vec<_> = fs::read_dir(&bcf_directory)
    .with_context(|| format!("reading BCF directory {}", bcf_directory.display()))?
    .map(|entry| entry.map(|entry| entry.path()))
    .collect::<std::io::Result<_>>()
    .with_context(|| format!("listing BCF files in {}", bcf_directory.display()))?;
  bcf_files.retain(|path| path.extension().is_some_and(|extension| extension == "bcf"));
  bcf_files.sort();
  ensure!(!bcf_files.is_empty(), "no BCF test files found in {}", bcf_directory.display());
  for path in &bcf_files {
    println!("cargo:rerun-if-changed={}", path.display());
  }

  let config = parser::parse(&fs::read_to_string(&config_path).with_context(|| format!("reading {}", config_path.display()))?).map_err(|error| anyhow!("parsing {}: {error:?}", config_path.display()))?;
  let mut context = Context::new();
  context.set_namespace("bcf", BCF_NAMESPACE);

  // 1. The Biber config is canonical; BCF tests supplement remappings it omits.
  let mut crossref = CrossReferenceMap::new();
  for inherit in nodes("//inheritance/inherit", &context, config.as_document().root())? {
    for type_pair in nodes("./type_pair", &context, inherit)? {
      let src = xpath_string("string(@source)", &context, type_pair)?;
      let tgt = xpath_string("string(@target)", &context, type_pair)?;
      ensure!(!src.is_empty() && !tgt.is_empty(), "{} has an incomplete type_pair", config_path.display());
      for field in nodes("./field", &context, inherit)? {
        if xpath_string("string(@skip)", &context, field)? == "true" {
          continue;
        }
        let fsrc = xpath_string("string(@source)", &context, field)?;
        let ftgt = xpath_string("string(@target)", &context, field)?;
        ensure!(!fsrc.is_empty() && !ftgt.is_empty(), "{} has an incomplete inheritance field", config_path.display());
        // Same-name inheritance is handled by the allowed-fields table at runtime.
        if fsrc != ftgt {
          crossref.entry(tgt.clone()).or_default().entry(src.clone()).or_default().insert(ftgt, fsrc);
        }
      }
    }
  }

  for path in &bcf_files {
    let bcf = parser::parse(&fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?).map_err(|error| anyhow!("parsing {}: {error:?}", path.display()))?;
    for inherit in nodes("//bcf:inherit", &context, bcf.as_document().root())? {
      for type_pair in nodes(".//bcf:type_pair", &context, inherit)? {
        let src = xpath_string("string(@source)", &context, type_pair)?;
        let tgt = xpath_string("string(@target)", &context, type_pair)?;
        if src == "*" && tgt == "*" {
          continue;
        }
        for field in nodes(".//bcf:field", &context, inherit)? {
          if xpath_string("string(@skip)", &context, field)? == "true" {
            continue;
          }
          let fsrc = xpath_string("string(@source)", &context, field)?;
          let ftgt = xpath_string("string(@target)", &context, field)?;
          if !fsrc.is_empty() && !ftgt.is_empty() && fsrc != ftgt {
            // Existing Biber config mappings take precedence over BCF supplements.
            crossref.entry(tgt.clone()).or_default().entry(src.clone()).or_default().entry(ftgt).or_insert(fsrc);
          }
        }
      }
    }
  }
  // Keep the empty default mapping so runtime inheritance handles every untyped pair.
  crossref.entry("*".to_owned()).or_default().entry("*".to_owned()).or_default();
  let mut json = serde_json::to_string_pretty(&crossref)?;
  json.push('\n');
  write_if_changed(&manifest.join("data/crossref.json"), &json).context("writing data/crossref.json")?;

  // 2. Allowed fields per entry type. The global entryfields block omits date fields.
  let mut allowed = BTreeMap::new();
  for entry_type in nodes("//entrytypes/entrytype", &context, config.as_document().root())? {
    allowed.insert(xpath_string("string(.)", &context, entry_type)?, Vec::new());
  }
  for entry_type in nodes("//entryfields/entrytype", &context, config.as_document().root())? {
    allowed.insert(xpath_string("string(.)", &context, entry_type)?, Vec::new());
  }
  let date_fields: Vec<_> = nodes("//fields/field[@datatype='date']", &context, config.as_document().root())?.into_iter().map(|field| xpath_string("string(.)", &context, field)).collect::<Result<_>>()?;

  for entry_fields in nodes("//entryfields", &context, config.as_document().root())? {
    let mut entry_types: Vec<_> = nodes("./entrytype", &context, entry_fields)?.into_iter().map(|entry_type| xpath_string("string(.)", &context, entry_type)).collect::<Result<_>>()?;
    let mut fields: Vec<_> = nodes("./field", &context, entry_fields)?.into_iter().map(|field| xpath_string("string(.)", &context, field)).collect::<Result<_>>()?;
    if entry_types.is_empty() {
      // Date-typed fields are accepted input even though Biber marks them skip_output.
      fields.extend(date_fields.iter().cloned());
      entry_types = allowed.keys().cloned().collect();
    }
    for entry_type in entry_types {
      allowed.get_mut(&entry_type).ok_or_else(|| anyhow!("{} defines entryfields for unknown entry type {entry_type:?}", config_path.display()))?.extend(fields.iter().cloned());
    }
  }
  for fields in allowed.values_mut() {
    fields.sort();
    fields.dedup();
  }

  // 3. Globally skipped fields are never inherited; xdata and file are also excluded.
  let mut no_crossref = BTreeSet::new();
  for path in &bcf_files {
    let bcf = parser::parse(&fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?).map_err(|error| anyhow!("parsing {}: {error:?}", path.display()))?;
    for inherit in nodes("//bcf:inherit", &context, bcf.as_document().root())? {
      let mut global = false;
      for type_pair in nodes(".//bcf:type_pair", &context, inherit)? {
        if xpath_string("string(@source)", &context, type_pair)? == "*" && xpath_string("string(@target)", &context, type_pair)? == "*" {
          global = true;
          break;
        }
      }
      if global {
        for field in nodes(".//bcf:field", &context, inherit)? {
          if xpath_string("string(@skip)", &context, field)? == "true" {
            let src = xpath_string("string(@source)", &context, field)?;
            if !src.is_empty() {
              no_crossref.insert(src);
            }
          }
        }
      }
    }
  }
  no_crossref.extend(["crossref".to_owned(), "xdata".to_owned(), "file".to_owned()]);

  let fields = CrossReferenceData {
    allowed,
    no_cross_ref: no_crossref.into_iter().collect(),
  };
  let mut json = serde_json::to_string_pretty(&fields)?;
  json.push('\n');
  write_if_changed(&manifest.join("data/fields.json"), &json).context("writing data/fields.json")?;
  Ok(())
}

/// Write a snapshot only when its contents differ, preserving Cargo's input timestamps otherwise.
fn write_if_changed(path: &Path, contents: &str) -> std::io::Result<()> {
  match fs::read(path) {
    // Rewriting a watched input during the build would make the next build dirty.
    Ok(existing) if existing == contents.as_bytes() => Ok(()),
    Ok(_) => fs::write(path, contents),
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => fs::write(path, contents),
    Err(error) => Err(error),
  }
}

/// Evaluate an XPath that selects nodes, returning them in document order.
fn nodes<'d, N>(expression: &str, context: &Context<'d>, node: N) -> Result<Vec<Node<'d>>>
where N: Into<Node<'d>> {
  let xpath = Factory::new().build(expression).with_context(|| format!("compiling XPath {expression:?}"))?.ok_or_else(|| anyhow!("XPath {expression:?} did not produce an expression"))?;
  match xpath.evaluate(context, node).context("evaluating XPath node selection")? {
    Value::Nodeset(nodes) => Ok(nodes.document_order()),
    _ => bail!("XPath expression did not return a node set"),
  }
}

/// Evaluate an XPath that returns a scalar string.
fn xpath_string<'d, N>(expression: &str, context: &Context<'d>, node: N) -> Result<String>
where N: Into<Node<'d>> {
  let xpath = Factory::new().build(expression).with_context(|| format!("compiling XPath {expression:?}"))?.ok_or_else(|| anyhow!("XPath {expression:?} did not produce an expression"))?;
  match xpath.evaluate(context, node).context("evaluating XPath string")? {
    Value::String(value) => Ok(value),
    _ => bail!("XPath expression did not return a string"),
  }
}
