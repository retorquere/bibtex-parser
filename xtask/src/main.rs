use serde_json::{Value, json};
use std::{
  env, fs, io,
  path::{Path, PathBuf},
  process::Command,
};
mod abbreviations;

const PARSER_FILES: &[&str] = &["bibtex_parser_bg.wasm", "bibtex_parser.js", "bibtex_parser.d.ts", "bibtex_parser_bg.wasm.d.ts", "index.js", "index.d.ts", "english.json", "snippets"];
const TOKENIZER_FILES: &[&str] = &["index.js", "index.d.ts", "bibtex_tokenizer.js", "bibtex_tokenizer.d.ts", "bibtex_tokenizer_bg.wasm", "bibtex_tokenizer_bg.wasm.d.ts"];

/// Run a command with inherited output and report both launch and exit failures.
fn run(command: &mut Command) -> io::Result<()> {
  let description = format!("{command:?}");
  let status = command.status().map_err(|error| io::Error::new(error.kind(), format!("failed to run {description}: {error}")))?;
  if !status.success() {
    return Err(io::Error::other(format!("{description} exited with {status}")));
  }
  Ok(())
}

/// Remove a generated file if present, surfacing failures other than absence.
fn remove_file(path: &Path) -> io::Result<()> {
  match fs::remove_file(path) {
    Ok(()) => Ok(()),
    Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
    Err(error) => Err(error),
  }
}

/// Remove a specific generated directory if present.
fn remove_directory(path: &Path) -> io::Result<()> {
  match fs::remove_dir_all(path) {
    Ok(()) => Ok(()),
    Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
    Err(error) => Err(error),
  }
}

/// Copy a generated file or directory tree, preserving its relative structure.
fn copy(source: &Path, destination: &Path) -> io::Result<()> {
  if source.is_dir() {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
      let entry = entry?;
      copy(&entry.path(), &destination.join(entry.file_name()))?;
    }
  } else {
    fs::copy(source, destination)?;
  }
  Ok(())
}

/// Run an action with a temporary copied file and remove it even when the action fails.
fn with_temporary_copy(source: &Path, destination: &Path, action: impl FnOnce() -> io::Result<()>) -> io::Result<()> {
  let mut input = fs::File::open(source)?;
  let mut output = fs::OpenOptions::new().write(true).create_new(true).open(destination)?;
  let copied = io::copy(&mut input, &mut output).map(|_| ());
  drop(output);
  let result = copied.and_then(|()| action());
  let cleanup = fs::remove_file(destination);
  match (result, cleanup) {
    (Ok(()), Ok(())) => Ok(()),
    (Err(error), Ok(())) | (Ok(()), Err(error)) => Err(error),
    // Both failures matter: otherwise a compiler error could hide an unremoved temporary file.
    (Err(error), Err(cleanup)) => Err(io::Error::other(format!("{error}; failed to remove {}: {cleanup}", destination.display()))),
  }
}

/// Configure the generated parser package without discarding unrelated wasm-pack metadata.
fn configure_manifest(manifest: &mut Value) -> io::Result<()> {
  let manifest = manifest.as_object_mut().ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "wasm-pack package.json is not an object"))?;
  manifest.insert("main".into(), json!("index.js"));
  manifest.insert("module".into(), json!("index.js"));
  manifest.insert("types".into(), json!("index.d.ts"));
  manifest.insert("files".into(), json!(PARSER_FILES));
  manifest.insert("exports".into(), json!({ ".": { "types": "./index.d.ts", "import": "./index.js", "default": "./index.js" } }));
  Ok(())
}

/// Project paths and commands for the three builds and their shared tables.
struct Tasks {
  root: PathBuf,
}

impl Tasks {
  /// Resolve paths relative to this private workspace tool, regardless of the caller's directory.
  fn new() -> io::Result<Self> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().ok_or_else(|| io::Error::other("xtask has no workspace parent"))?.to_path_buf();
    Ok(Self { root })
  }

  /// Create a Cargo command rooted at the workspace.
  fn cargo(&self) -> Command {
    let mut command = Command::new(env::var_os("CARGO").unwrap_or_else(|| "cargo".into()));
    command.current_dir(&self.root);
    command
  }

  /// Export tables from the current configuration to the fixed workspace data directory.
  fn tables(&self) -> io::Result<()> {
    run(self.cargo().args(["run", "--release", "-p", "unicode2latex", "--bin", "rebuild"]))
  }

  /// Run TypeScript with the package's existing NodeNext and declaration settings.
  fn typescript(&self, source: &Path, output: Option<(&Path, &Path)>, json_modules: bool) -> io::Result<()> {
    let mut command = Command::new(self.root.join("node_modules/.bin/tsc"));
    command.current_dir(&self.root).args(["--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext"]);
    if let Some((root, out)) = output {
      command.arg("--rootDir").arg(root).arg("--outDir").arg(out);
    }
    if json_modules {
      command.arg("--resolveJsonModule");
    }
    run(command.args(["--declaration", "--skipLibCheck", "--strictNullChecks"]).arg(source))
  }

  /// Build a wasm-pack library using the validated tables at the fixed workspace path.
  fn wasm_pack(&self, directory: &Path, input: &Path, output: &Path, name: &str) -> io::Result<()> {
    run(Command::new("wasm-pack").current_dir(directory).arg("build").arg(input).args(["--target", "web", "--out-dir"]).arg(output).arg("--out-name").arg(name))
  }

  /// Build the converter and its adapter using tables generated by the caller.
  fn converter(&self) -> io::Result<()> {
    let converter = self.root.join("unicode2latex");
    let dist = self.root.join("dist");
    let output = dist.join("unicode2latex");
    self.wasm_pack(&converter, Path::new("."), &output, "unicode2latex")?;
    remove_file(&output.join(".gitignore"))?;
    let binding_types = converter.join("unicode2latex.d.ts");
    with_temporary_copy(&output.join("unicode2latex.d.ts"), &binding_types, || self.typescript(&converter.join("index.ts"), Some((&self.root, &dist)), true))
  }

  /// Generate shared tables once, then build all three WASM expressions and adapters.
  fn build(&self) -> io::Result<()> {
    let dist = self.root.join("dist");
    let pkg = self.root.join("pkg");
    remove_directory(&dist)?;
    fs::create_dir_all(dist.join("data"))?;
    for entry in fs::read_dir(self.root.join("data"))? {
      let entry = entry?;
      if entry.path().extension().is_some_and(|extension| extension == "json") {
        fs::copy(entry.path(), dist.join("data").join(entry.file_name()))?;
      }
    }

    self.tables()?;
    // wasm-pack can leave obsolete generated snippets in its output directory.
    remove_directory(&pkg.join("snippets"))?;
    self.wasm_pack(&self.root, &self.root, Path::new("pkg"), "bibtex_parser")?;
    self.wasm_pack(&self.root.join("tokenizer"), Path::new("."), &pkg.join("tokenizer"), "bibtex_tokenizer")?;
    let tokenizer_source = pkg.join("tokenizer/index.ts");
    // Both paths are ignored wasm-pack outputs, not user-authored sources.
    remove_file(&tokenizer_source)?;
    with_temporary_copy(&self.root.join("tokenizer/index.ts"), &tokenizer_source, || self.typescript(&tokenizer_source, None, false))?;
    remove_file(&pkg.join("jabref.js"))?;
    remove_file(&pkg.join("jabref.d.ts"))?;

    fs::copy(self.root.join("data/english.json"), pkg.join("english.json"))?;
    let source = pkg.join("index.ts");
    remove_file(&source)?;
    with_temporary_copy(&self.root.join("index.ts"), &source, || self.typescript(&source, None, true))?;

    let manifest_path = pkg.join("package.json");
    let mut manifest: Value = serde_json::from_slice(&fs::read(&manifest_path)?)?;
    configure_manifest(&mut manifest)?;
    fs::write(manifest_path, format!("{}\n", serde_json::to_string_pretty(&manifest)?))?;
    for file in PARSER_FILES {
      copy(&pkg.join(file), &dist.join(file))?;
    }

    let tokenizer_dist = dist.join("tokenizer");
    remove_directory(&tokenizer_dist)?;
    fs::create_dir_all(&tokenizer_dist)?;
    for file in TOKENIZER_FILES {
      fs::copy(pkg.join("tokenizer").join(file), tokenizer_dist.join(file))?;
    }

    self.converter()?;
    self.abbreviation_data()
  }

  /// Generate abbreviation data from already exported Unicode tables.
  fn abbreviation_data(&self) -> io::Result<()> {
    abbreviations::run()
  }

  /// Rebuild tables before generating abbreviation data as a standalone task.
  fn abbr(&self) -> io::Result<()> {
    self.tables()?;
    self.abbreviation_data()
  }

  /// Run workspace tests against one shared set of freshly exported tables.
  fn test_rust(&self) -> io::Result<()> {
    self.tables()?;
    run(self.cargo().args(["test", "--workspace"]))
  }

  /// Run native and JavaScript tests against an existing build.
  fn test_release(&self) -> io::Result<()> {
    self.test_rust()?;
    run(Command::new("node").current_dir(&self.root).args(["--test", "test/run.js"]))?;
    run(Command::new("node").current_dir(&self.root).args(["--test", "test/unicode2latex.js", "test/unicode2latex-api.js"]))
  }

  /// Check workspace Rust formatting using the project's nightly formatter.
  fn lint(&self) -> io::Result<()> {
    run(Command::new("rustup").current_dir(&self.root).args(["run", "nightly", "cargo", "fmt", "--all", "--", "--check"]))
  }

  /// Check formatting before building, as required by the development start command.
  fn start(&self) -> io::Result<()> {
    self.lint()?;
    self.build()
  }
}

/// Dispatch project build tasks; unknown or extra arguments fail explicitly.
fn main() -> io::Result<()> {
  let mut args = env::args();
  args.next();
  let task = args.next().ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "expected an xtask command"))?;
  if args.next().is_some() {
    return Err(io::Error::new(io::ErrorKind::InvalidInput, "xtask commands do not accept extra arguments"));
  }
  let tasks = Tasks::new()?;
  match task.as_str() {
    "build" => tasks.build(),
    "tables" => tasks.tables(),
    "wasm" => {
      tasks.tables()?;
      tasks.converter()
    }
    "test-rust" => tasks.test_rust(),
    "test-release" => tasks.test_release(),
    "start" => tasks.start(),
    "test" => {
      tasks.start()?;
      tasks.test_release()
    }
    "bench" => {
      tasks.build()?;
      run(Command::new("node").current_dir(&tasks.root).arg("test/tokenizer-benchmark.mjs"))
    }
    "abbr" => tasks.abbr(),
    "publish-check" => {
      tasks.build()?;
      tasks.test_release()
    }
    "preversion" => {
      tasks.abbr()?;
      tasks.test_release()
    }
    _ => Err(io::Error::new(io::ErrorKind::InvalidInput, format!("unknown xtask command: {task}"))),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  /// Never overwrite an existing file, and clean up temporary files after a failed action.
  #[test]
  fn temporary_copy_is_cleaned_and_does_not_replace_existing_files() {
    let directory = env::temp_dir().join(format!("bbt-xtask-test-{}", std::process::id()));
    fs::create_dir(&directory).unwrap();
    let source = directory.join("source");
    let destination = directory.join("temporary");
    fs::write(&source, "source").unwrap();

    let error = with_temporary_copy(&source, &destination, || Err(io::Error::other("expected failure"))).unwrap_err();
    assert_eq!(error.to_string(), "expected failure");
    assert!(!destination.exists());

    fs::write(&destination, "keep").unwrap();
    assert_eq!(with_temporary_copy(&source, &destination, || Ok(())).unwrap_err().kind(), io::ErrorKind::AlreadyExists);
    assert_eq!(fs::read_to_string(&destination).unwrap(), "keep");
    fs::remove_file(source).unwrap();
    fs::remove_file(destination).unwrap();
    fs::remove_dir(directory).unwrap();
  }

  /// Preserve unrelated wasm-pack metadata while exposing the parser adapter and artifacts.
  #[test]
  fn parser_manifest_exposes_adapter() {
    let mut manifest = json!({ "name": "parser", "version": "1.2.3" });
    configure_manifest(&mut manifest).unwrap();
    assert_eq!(manifest["name"], "parser");
    assert_eq!(manifest["main"], "index.js");
    assert_eq!(manifest["exports"]["."]["types"], "./index.d.ts");
    assert!(manifest["files"].as_array().unwrap().iter().any(|file| file == "bibtex_parser_bg.wasm"));
    assert!(configure_manifest(&mut json!([])).is_err());
  }
}
