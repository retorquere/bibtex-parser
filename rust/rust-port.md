# Rust Port Roadmap

## Current State

- A standalone verbatim BibTeX parser handles entries, strings, preambles, comments, duplicate fields, and recovery.
- Initial normalization assigns field modes, parses common creator forms and literal lists, normalizes years/months, and merges keywords.
- The TeX parser builds span-bearing root and node ASTs with distinct string, whitespace, paragraph-break, comment, group, math, environment, verb, and macro nodes. It supports `$...$`, `\(...\)`, `\[...\]`, matched nested environments, and delimited `\verb` content.
- Macro arities follow TypeScript's `narguments` table. Simple `\newcommand`/`\ProvideTextCommandDefault` definitions expand; nested `\ifdefined` blocks are skipped.
- Custom `\newcommand` definitions parse optional arity/default brackets and retain the replacement body. As in the TypeScript visitor, nested expansion renders that body literally and does not substitute `#1`-style placeholders.
- TeX-to-Unicode mappings are generated from `unicode2latex` at Cargo build time and compiled into the crate. The wasm runtime does not load mapping JSON.
- The Rust TeX visitor renders generated Unicode mappings and combining marks, common inline markup, rich-text wrappers and list items, and unsupported macro/environment diagnostics. Title root groups and math honor the TypeScript `caseProtection` policy (`off`/`as-needed`/`strict`), and normalized titles pass through sentence casing after TeX rendering.
- `wasm-pack` generates the JavaScript wrapper and TypeScript declarations; the Rust crate also remains usable natively.
- The WASM facade accepts the TypeScript parser option shapes, exposes synchronous `parse` plus Promise-returning `parseAsync`, and serializes normalized entries as the TypeScript `Library` shape. JavaScript `RegExp` values in `verbatimFields` are resolved against parsed field names before Rust normalization.
- `test/wasm.js` mirrors `test/run.js` fixture selection, options, exception assertions, and unchanged snapshot comparisons. The full Rust-backed WASM suite passes 1,338 of 1,338 tests.

## Completed Milestones

### Step 1: AST and macro semantics

- Custom `\newcommand` and `\ProvideTextCommandDefault` definitions skip optional arity/default brackets before recording the replacement body.
- Nested custom macro bodies expand recursively. Invocation arguments and `#1` placeholders remain literal, matching the TypeScript visitor.
- Direct custom-command regressions and the shared noopsort fixture cover this definition behavior.

### Step 2: AST integrity and node parity

- Root and node spans use UTF-16 offsets with 1-based line and column coordinates, matching the TypeScript AST convention. Spans are half-open; macro spans cover the command token, while environment spans include their matched begin/end delimiters.
- Whitespace, paragraph breaks, and comments remain distinct. Comment nodes preserve their source span and TypeScript-style same-line, leading-whitespace, and suffix-parbreak metadata.
- An unmatched opening group is recovered as literal text rather than an incomplete group node; unmatched closing braces remain literal. An unmatched environment remains a begin macro and its parsed body, while a parent environment retains ownership of its matching end tag.
- Direct AST regressions cover UTF-16 positions, malformed groups, comment boundaries, and matched/unmatched/nested environments. The existing `quotation-18.bib` fixture is also checked against the corresponding environment fragment in its default TypeScript snapshot.
- Recovery assumption: when a group opener has no matching closer, only the opener is made literal and its contents continue through the enclosing sequence. Macro expansion preserves the spans of the source nodes from which replacement and argument nodes originated.

### Step 3: TeX visitor policy parity

- Title rendering now carries a TypeScript-compatible `CaseProtection` policy through the render context, allowing the visitor to respect `off`, `as-needed`, and `strict` behavior in the same way as the JavaScript title visitor.
- Root-title protection is triggered for protected groups and math, while nested protected ancestors continue to suppress duplicate wrapping to match the reference behavior.
- The regression suite includes a direct policy check covering the root title path so the default and explicit policy modes remain locked to the visitor contract.

### Step 4: TeX visitor output parity

- Title rendering now applies token-based sentence casing after TeX and Unicode rendering, preserving markup, protected spans, and quoted text while handling English prepositions, acronyms, hyphenated words, and sentence/colon boundaries.
- Shared-snapshot parity checks compare complete title or note fields for markup commands, rich-text lists, paragraph boundaries, headings, nested blockquotes, and quotations.
- Direct sentence-case regressions are checked against the TypeScript implementation for title-case guesses, all-caps input, domains, URLs, abbreviations, numbers, hyphenation, and quote preservation.

### Step 5: Sentence-case tokenizer and guess parity

- The Rust title tokenizer and guess pass match the TypeScript behavior for UTF-16 guess lengths, Unicode letter/number/mark categories, ASCII number and version priority, case-sensitive acronym aliases, hyphenated grouping, website host boundaries, and NBSP preservation.
- Direct regressions and `test/other/sentence-case-utf16.bib` with its default TypeScript snapshot cover these cases.
- A 14,812-title full-parser differential probe against TypeScript found no mismatches.

### Step 6: Field and creator normalization

- Field-mode selection now honors user overrides before the built-in creator/title/verbatim/literal-list defaults, and `verbatimFields` entries keep their raw text semantics without re-entering TeX rendering.
- Outer-brace stripping follows the TypeScript rule for fields listed in `removeOuterBraces`, handling the root single-group unwrap that many bibtex authors use to force case protection.
- Creator parsing matches the reference behavior for literal names, comma-separated extended-name properties, family/prefix/given decomposition, and the common `and`/`&` splitting rules at top-level depth.
- Duplicate keyword fields still merge, sort, and deduplicate in the same order as the TypeScript parser, and the normalization pass preserves parse errors and TeX render diagnostics in the library result.
- The Rust regressions include direct field override and brace-removal checks as well as the shared fixture parity tests already exercising real `.bib` imports.

### Step 7: Library finalization

- The library finalization pass now parses JabRef metadata comments into a dedicated metadata block while retaining the non-metadata comment stream in source order, matching the TypeScript library contract.
- Cross-reference inheritance copies absent parent fields into the child entry and records the origin as `crossref` provenance, preserving the TypeScript parent/field relationship that downstream consumers inspect.
- Preamble and string values are rendered through the TeX pipeline before the finished library result is returned, and raw parser plus render diagnostics are accumulated in final error order.
- Direct Rust regressions cover a JabRef metadata fixture, inherited crossref fields, and final error aggregation so the pass remains anchored to the same library semantics as the TypeScript implementation.

### Step 8: Options and WASM fixture parity

- Exception fixtures assert the same unsupported-macro rejection as the TypeScript runner instead of comparing engine-specific stack traces.
- The noopsort fixture confirms that `\\newcommand{\\noopsort}[1]{}` records an empty replacement body rather than leaking `[1]` into creator names.
- Sentence-case preservation checks the complete token for single-capital handling, retaining labels such as `C3`, `N6`, `13C`, and `P450` in hyphenated titles.
- The full fixture and API suite passes 1,338 of 1,338 tests against the existing snapshots.

## Implementation Rule

Every Rust implementation added for the port must document:

- the purpose of each new function and helper in plain language,
- the key decision branches inside the function,
- any semantic assumptions that differ from the TypeScript reference behavior,
- the specific test or fixture that exercises the behavior.

New code without inline documentation for functions and branch points is not considered complete for the port.

## Remaining Parity Work

In all cases, an implementation should document function purpose, arguments, key decision branches, and any deviations from the TypeScript reference behavior.

No known options, WASM API, or shared-fixture parity failures remain in the current test suite. Keep future mismatches in their owning parser/TeX abstractions; do not change fixtures or snapshots to hide differences.

## Verification Rule

Parity tests must read the same existing `.bib`/`.biblatex` fixtures as the TypeScript runner and compare against their default TypeScript snapshots. Small inline tests are useful for isolated AST invariants, but they do not count as fixture parity. For AST-only invariants, retain direct position and recovery tests and tie observable environment behavior to a shared fixture/snapshot projection. Keep each new behavior tied to at least one shared fixture and snapshot before expanding to the next slice.

Run the native Rust checks with:

```sh
cargo test --manifest-path rust/Cargo.toml
cargo fmt --manifest-path rust/Cargo.toml -- --check
cargo clippy --manifest-path rust/Cargo.toml --all-targets -- -D warnings
npm run wasm:test
```

`npm run wasm:test` rebuilds the JavaScript/WebAssembly package and runs the same fixture/snapshot suite as `test/run.js` against Rust, plus focused API parity tests. Type-check the generated declarations separately when changing the wasm API.