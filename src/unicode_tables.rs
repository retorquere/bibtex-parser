/// Shared build/runtime schema for one entry in the `unicode2latex` conversion table.
///
/// The payload is a Postcard-encoded `Vec<UnicodeMapping>` wrapped in raw DEFLATE.
/// Postcard encodes struct fields in declaration order, without their names; both sides
/// use this definition so key/text/math/combining cannot silently drift apart. `None` means
/// unavailable, while `Some("")` is a valid replacement. Rows have unique UTF-8-byte-sorted
/// keys for runtime binary search. Wire specification: <https://postcard.jamesmunns.com/>.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct UnicodeMapping {
  pub(crate) key: String,
  pub(crate) text: Option<String>,
  pub(crate) math: Option<String>,
  pub(crate) combining: Option<String>,
}
