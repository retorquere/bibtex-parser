//! Tokenizer-only WebAssembly API, sharing the parser crate's tokenizer implementation.

/// The shared file also contains helpers used only by the full parser's sentence-casing path.
#[allow(dead_code)]
#[path = "../../src/tokenizer.rs"]
mod tokenizer;

#[cfg(target_arch = "wasm32")]
mod wasm_bindings {
  use serde::Serialize;
  use wasm_bindgen::prelude::*;

  use super::tokenizer::{SentenceTokenKind, sentence_tokens};

  #[derive(Serialize)]
  #[serde(rename_all = "camelCase")]
  struct Token {
    #[serde(rename = "type")]
    kind: SentenceTokenKind,
    text: String,
    shape: String,
    sentence_start: bool,
    sub_sentence_start: bool,
  }

  /// Tokenize input text using the full parser wasm's options and object shape.
  ///
  /// JavaScript property-setting failures are returned as `Err` values.
  #[wasm_bindgen(js_name = tokenize)]
  pub fn tokenize_js(input: &str) -> Result<JsValue, JsValue> {
    let characters: Vec<_> = input.chars().collect();
    let tokens: Vec<_> = sentence_tokens(&characters, true, false)
      .into_iter()
      .map(|token| Token {
        kind: token.kind,
        text: token.text(&characters),
        shape: token.shape,
        sentence_start: token.sentence_start,
        sub_sentence_start: token.sub_sentence_start,
      })
      .collect();
    serde_wasm_bindgen::to_value(&tokens).map_err(|error| JsValue::from_str(&error.to_string()))
  }
}
