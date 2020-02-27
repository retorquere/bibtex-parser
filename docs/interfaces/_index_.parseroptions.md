[@retorquere/bibtex-parser](../README.md) › [Globals](../globals.md) › ["index"](../modules/_index_.md) › [ParserOptions](_index_.parseroptions.md)

# Interface: ParserOptions

## Hierarchy

* **ParserOptions**

## Index

### Properties

* [async](_index_.parseroptions.md#optional-async)
* [caseProtection](_index_.parseroptions.md#optional-caseprotection)
* [errorHandler](_index_.parseroptions.md#optional-errorhandler)
* [guessAlreadySentenceCased](_index_.parseroptions.md#optional-guessalreadysentencecased)
* [htmlFields](_index_.parseroptions.md#optional-htmlfields)
* [markup](_index_.parseroptions.md#optional-markup)
* [raw](_index_.parseroptions.md#optional-raw)
* [sentenceCase](_index_.parseroptions.md#optional-sentencecase)
* [strings](_index_.parseroptions.md#optional-strings)
* [unabbreviate](_index_.parseroptions.md#optional-unabbreviate)
* [unnestFields](_index_.parseroptions.md#optional-unnestfields)
* [unnestMode](_index_.parseroptions.md#optional-unnestmode)
* [verbatimCommands](_index_.parseroptions.md#optional-verbatimcommands)
* [verbatimFields](_index_.parseroptions.md#optional-verbatimfields)

## Properties

### `Optional` async

• **async**? : *boolean*

return a promise for a [Bibliography](_index_.bibliography.md) when set to true

___

### `Optional` caseProtection

• **caseProtection**? : *"as-needed" | "strict" | boolean*

translate braced parts of text into a case-protected counterpart; uses the [MarkupMapping](_index_.markupmapping.md) table in `markup`. Default == true == as-needed.
In as-needed mode the parser will assume that words that have capitals in them imply "nocase" behavior in the consuming application. If you don't want this, turn this option on, and you'll get
case protection exactly as the input has it

___

### `Optional` errorHandler

• **errorHandler**? : *false | function*

By default, when an unexpected parsing error is found (such as a TeX command which I did not anticipate), the parser will throw an error. You can pass a function to handle the error instead,
where you can log it, display it, or even still throw an error

___

### `Optional` guessAlreadySentenceCased

• **guessAlreadySentenceCased**? : *boolean*

Some bibtex has titles in sentence case, or all-uppercase. If this is on, and there is a field that would normally have sentence-casing applied in which more words are all-`X`case
(where `X` is either lower or upper) than mixed-case, it is assumed that you want them this way, and no sentence-casing will be applied to that field

___

### `Optional` htmlFields

• **htmlFields**? : *string[]*

Some note-like fields may have more rich formatting. If listed here, more HTML conversions will be applied.

___

### `Optional` markup

• **markup**? : *[MarkupMapping](_index_.markupmapping.md)*

The parser can change TeX markup (\textsc, \emph, etc) to a text equivalent. The defaults are HTML-oriented, but you can pass in your own configuration here

___

### `Optional` raw

• **raw**? : *boolean*

If this flag is set entries will be returned without conversion of LaTeX to unicode equivalents.

___

### `Optional` sentenceCase

• **sentenceCase**? : *string[] | boolean*

BibTeX files are expected to store title-type fields in Sentence Case, where other reference managers (such as Zotero) expect them to be stored as Sentence case. When there is no language field, or the language field
is one of the languages (case insensitive) passed in this option, the parser will attempt to sentence-case title-type fields as they are being parsed. This uses heuristics and does not employ any kind of natural
language processing, so you should always inspect the results. Default languages to sentenceCase are:

- american
- british
- canadian
- english
- australian
- newzealand
- usenglish
- ukenglish
- en
- eng
- en-au
- en-bz
- en-ca
- en-cb
- en-gb
- en-ie
- en-jm
- en-nz
- en-ph
- en-tt
- en-us
- en-za
- en-zw

If you pass an empty array, or `false`, no sentence casing will be applied (even when there's no language field).

___

### `Optional` strings

• **strings**? : *Record‹string, string›*

You can pass in an existing @string dictionary

___

### `Optional` unabbreviate

• **unabbreviate**? : *Record‹string, string›*

BibTeX files may have abbreviations in the journal field. If you provide a dictionary, journal names that are found in the dictionary are replaced with the attached full name

___

### `Optional` unnestFields

• **unnestFields**? : *string[]*

In the past many bibtex entries would just always wrap a field in double braces ({{ title here }}), likely because whomever was writing them couldn't figure out the case meddling rules (and who could
blame them. Fields listed here will either have one outer layer of braces treated as case-preserve, or have the outer braced be ignored completely, if this is detected.

___

### `Optional` unnestMode

• **unnestMode**? : *"preserve" | "unwrap"*

___

### `Optional` verbatimCommands

• **verbatimCommands**? : *string[]*

Some commands such as `url` are parsed in what is called "verbatim mode" where pretty much everything except braces is treated as regular text, not TeX commands.

___

### `Optional` verbatimFields

• **verbatimFields**? : *string | RegExp‹›[]*

Some fields such as `url` are parsed in what is called "verbatim mode" where pretty much everything except braces is treated as regular text, not TeX commands. You can change the default list here if you want,
for example to help parse Mendeley `file` fields, which against spec are not in verbatim mode.
