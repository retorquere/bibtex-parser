**[@retorquere/bibtex-parser](../README.md)**

[Globals](../globals.md) › ["index"](../modules/_index_.md) › [ParserOptions](_index_.parseroptions.md)

# Interface: ParserOptions

## Hierarchy

* **ParserOptions**

## Index

### Properties

* [async](_index_.parseroptions.md#optional-async)
* [caseProtect](_index_.parseroptions.md#optional-caseprotect)
* [errorHandler](_index_.parseroptions.md#optional-errorhandler)
* [markup](_index_.parseroptions.md#optional-markup)
* [sentenceCase](_index_.parseroptions.md#optional-sentencecase)
* [verbatimFields](_index_.parseroptions.md#optional-verbatimfields)

## Properties

### `Optional` async

• **async**? : *boolean*

return a promise for a [Bibliography](_index_.bibliography.md) when set to true

___

### `Optional` caseProtect

• **caseProtect**? : *boolean*

translate braced parts of text into a case-protected counterpart; uses the [MarkupMapping](_index_.markupmapping.md) table in `markup`.

___

### `Optional` errorHandler

• **errorHandler**? : *function*

By default, when an unexpected parsing error is found (such as a TeX command which I did not anticipate), the parser will throw an error. You can pass a function to handle the error instead,
where you can log it, display it, or even still throw an error

#### Type declaration:

▸ (`message`: string): *void*

**Parameters:**

Name | Type |
------ | ------ |
`message` | string |

___

### `Optional` markup

• **markup**? : *[MarkupMapping](_index_.markupmapping.md)*

The parser can change TeX markup (\textsc, \emph, etc) to a text equivalent. The defaults are HTML-oriented, but you can pass in your own configuration here

___

### `Optional` sentenceCase

• **sentenceCase**? : *boolean*

BibTeX files are expected to store title-type fields in Sentence Case, where other reference managers (such as Zotero) expect them to be stored as Sentence case. When this option is on,
the parser will attempt to sentence-case title-type fields as they are being parsed. This uses heuristics and does not employ any kind of natural language processing, so you should always inspect the results.

___

### `Optional` verbatimFields

• **verbatimFields**? : *string[]*

Some fields such as `url` are parsed in what is called "verbatim mode" where pretty much everything except braces is treated as regular text, not TeX commands. You can change the default list here if you want,
for example to help parse Mendeley `file` fields, which against spec are not in verbatim mode.