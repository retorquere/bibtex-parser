use std::{error::Error, fs, path::Path};

/// Export the cached, Cargo-generated JSON tables for JavaScript consumers.
fn main() -> Result<(), Box<dyn Error>> {
  let repository = Path::new(env!("CARGO_MANIFEST_DIR")).parent().ok_or("unicode2latex crate has no repository parent")?;
  let root = repository.join("data/unicode2latex");
  fs::create_dir_all(&root)?;
  for (name, table) in [
    ("combining", include_str!(concat!(env!("OUT_DIR"), "/combining.json"))),
    ("minimal", include_str!(concat!(env!("OUT_DIR"), "/minimal.json"))),
    ("biblatex", include_str!(concat!(env!("OUT_DIR"), "/biblatex.json"))),
    ("bibtex", include_str!(concat!(env!("OUT_DIR"), "/bibtex.json"))),
    ("latex2unicode", include_str!(concat!(env!("OUT_DIR"), "/latex2unicode.json"))),
  ] {
    fs::write(root.join(format!("{name}.json")), table)?;
  }
  for (name, contents) in [("_config.ssv", include_bytes!(concat!(env!("OUT_DIR"), "/_config.ssv")).as_slice()), ("_generator.rs", include_bytes!(concat!(env!("OUT_DIR"), "/_generator.rs")).as_slice())] {
    fs::write(root.join(name), contents)?;
  }
  Ok(())
}
