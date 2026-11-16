---
description: "Use when writing, changing, or reviewing Rust code. Document functions and important branch decisions."
applyTo: "**/*.rs"
---

# Rust Documentation

- Document every function and method, including private helpers and tests, with a concise Rust doc comment describing its purpose and contract.
- Explain significant inputs, outputs, units, source offsets, state transitions, failure behavior, and invariants where they are not obvious.
- Comment important branch points: explain why precedence, fallback, recovery, boundary, compatibility, or special-case behavior is necessary. Do not merely restate the condition.
- Keep documentation accurate when changing behavior. Remove stale symbol references and outdated explanations.
- Apply the same standard to code emitted by generators by updating the generator, not generated output alone.
- Before finishing Rust changes, audit touched functions and important branches for documentation as well as validating behavior.