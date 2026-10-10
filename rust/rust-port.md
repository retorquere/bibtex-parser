# Rust Port Roadmap

## Current State

- A standalone verbatim BibTeX parser handles entries, strings, preambles, comments, duplicate fields, and recovery.
- Initial normalization assigns field modes, parses common creator forms and literal lists, normalizes years/months, and merges keywords.
- The TeX parser builds span-bearing root and node ASTs with distinct string, whitespace, paragraph-break, comment, group, math, environment, verb, and macro nodes. It supports `$...$`, `\(...\)`, `\[...\]`, matched nested environments, and delimited `\verb` content.
- Macro arities follow TypeScript's `narguments` table. Simple `\newcommand`/`\ProvideTextCommandDefault` definitions expand; nested `\ifdefined` blocks are skipped.
- Custom `\newcommand` definitions now store parameter arity, optional default arguments, and replacement bodies, and they expand `#1`, `#2`, ... placeholders during nested expansion.
- TeX-to-Unicode mappings are generated from `unicode2latex` at Cargo build time and compiled into the crate. The wasm runtime does not load mapping JSON.
- Selected rich-text environments and markup macros render to the current TypeScript-compatible output forms.
- `wasm-pack` generates the JavaScript wrapper and TypeScript declarations; the Rust crate also remains usable natively.

## Completed Milestones

### Step 1: AST and macro semantics

- Custom `\newcommand` and `\ProvideTextCommandDefault` registrations now preserve arity metadata so later calls can consume the correct number of arguments.
- Optional bracket arguments are parsed for macro definitions and expansions, including default values such as `[default]` in the command signature.
- Parameter substitution supports `#1`, `#2`, and later placeholders when expanding custom bodies, with nested custom-macro expansion still recursing through the replacement tree.
- The regression tests cover both parameterized commands and optional-argument behavior, keeping the first milestone anchored to a definitive parser contract.

### Step 2: AST integrity and node parity

- Root and node spans use UTF-16 offsets with 1-based line and column coordinates, matching the TypeScript AST convention. Spans are half-open; macro spans cover the command token, while environment spans include their matched begin/end delimiters.
- Whitespace, paragraph breaks, and comments remain distinct. Comment nodes preserve their source span and TypeScript-style same-line, leading-whitespace, and suffix-parbreak metadata.
- An unmatched opening group is recovered as literal text rather than an incomplete group node; unmatched closing braces remain literal. An unmatched environment remains a begin macro and its parsed body, while a parent environment retains ownership of its matching end tag.
- Direct AST regressions cover UTF-16 positions, malformed groups, comment boundaries, and matched/unmatched/nested environments. The existing `quotation-18.bib` fixture is also checked against the corresponding environment fragment in its default TypeScript snapshot.
- Recovery assumption: when a group opener has no matching closer, only the opener is made literal and its contents continue through the enclosing sequence. Macro expansion preserves the spans of the source nodes from which replacement and argument nodes originated.

## Implementation Rule

Every Rust implementation added for the port must document:

- the purpose of each new function and helper in plain language,
- the key decision branches inside the function,
- any semantic assumptions that differ from the TypeScript reference behavior,
- the specific test or fixture that exercises the behavior.

New code without inline documentation for functions and branch points is not considered complete for the port.

## Remaining Parity Work

1. **TeX visitor:** Port node context such as text/math mode, root-group status, emphasis/markup flags, and case protection. Complete command behavior, combining/accent handling, rich-text paragraph/list rendering, and unsupported-macro reporting.
2. **Sentence casing:** Port the tokenizer, preposition handling, quote preservation, sub-sentence capitalization, and guess heuristics used by `sentence-case.ts`.
3. **Field and creator normalization:** Match all TypeScript field-mode overrides, raw/verbatim options, outer-brace rules, creator edge cases, duplicate-field handling, and normalization errors.
4. **Library finalization:** Port preamble and string rendering, JabRef metadata parsing, cross-reference inheritance, and final error aggregation.
5. **Options and wasm API:** Align the Rust/wasm options and result contract with the complete TypeScript `Options` and `Library` interfaces, including any required sync/async behavior.

## Verification Rule

Parity tests must read the same existing `.bib`/`.biblatex` fixtures as the TypeScript runner and compare against their default TypeScript snapshots. Small inline tests are useful for isolated AST invariants, but they do not count as fixture parity. For AST-only invariants, retain direct position and recovery tests and tie observable environment behavior to a shared fixture/snapshot projection; visitor-level output differences remain part of the next milestone. Keep each new behavior tied to at least one shared fixture and snapshot before expanding to the next slice.

Run the native Rust checks with:

```sh
cargo test --manifest-path rust/Cargo.toml
cargo fmt --manifest-path rust/Cargo.toml -- --check
cargo clippy --manifest-path rust/Cargo.toml --all-targets -- -D warnings
```

Build the JavaScript/WebAssembly package with `npm run wasm:build`, then smoke-test the generated wrapper and type-check its declarations.