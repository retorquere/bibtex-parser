[](../README.md) / [Exports](../modules.md) / [index](../modules/index.md) / ParserOptions

# Interface: ParserOptions

## Hierarchy

* **ParserOptions**

## Index

### Properties

* [async](index.parseroptions.md#async)
* [caseProtection](index.parseroptions.md#caseprotection)
* [errorHandler](index.parseroptions.md#errorhandler)
* [guessAlreadySentenceCased](index.parseroptions.md#guessalreadysentencecased)
* [htmlFields](index.parseroptions.md#htmlfields)
* [markup](index.parseroptions.md#markup)
* [raw](index.parseroptions.md#raw)
* [sentenceCase](index.parseroptions.md#sentencecase)
* [strings](index.parseroptions.md#strings)
* [unabbreviate](index.parseroptions.md#unabbreviate)
* [unnestFields](index.parseroptions.md#unnestfields)
* [unnestMode](index.parseroptions.md#unnestmode)
* [verbatimCommands](index.parseroptions.md#verbatimcommands)
* [verbatimFields](index.parseroptions.md#verbatimfields)

## Properties

### async

• `Optional` **async**: *boolean*

return a promise for a [Bibliography](index.bibliography.md) when set to true

Defined in: [index.ts:372](https://github.com/retorquere/bibtex-parser/blob/master/index.ts#L372)

___

### caseProtection

• `Optional` **caseProtection**: *boolean* \| *as-needed* \| *strict*

translate braced parts of text into a case-protected counterpart; uses the [MarkupMapping](index.markupmapping.md) table in `markup`. Default == true == as-needed.
In as-needed mode the parser will assume that words that have capitals in them imply "nocase" behavior in the consuming application. If you don't want this, turn this option on, and you'll get
case protection exactly as the input has it

Defined in: [index.ts:362](https://github.com/retorquere/bibtex-parser/blob/master/index.ts#L362)

___

### errorHandler

• `Optional` **errorHandler**: *false* \| (`message`: *string*) => *void*

By default, when an unexpected parsing error is found (such as a TeX command which I did not anticipate), the parser will throw an error. You can pass a function to handle the error instead,
where you can log it, display it, or even still throw an error

Defined in: [index.ts:378](https://github.com/retorquere/bibtex-parser/blob/master/index.ts#L378)

___

### guessAlreadySentenceCased

• `Optional` **guessAlreadySentenceCased**: *boolean*

Some bibtex has titles in sentence case, or all-uppercase. If this is on, and there is a field that would normally have sentence-casing applied in which more words are all-`X`case
(where `X` is either lower or upper) than mixed-case, it is assumed that you want them this way, and no sentence-casing will be applied to that field

Defined in: [index.ts:355](https://github.com/retorquere/bibtex-parser/blob/master/index.ts#L355)

___

### htmlFields

• `Optional` **htmlFields**: *string*[]

Some note-like fields may have more rich formatting. If listed here, more HTML conversions will be applied.

Defined in: [index.ts:401](https://github.com/retorquere/bibtex-parser/blob/master/index.ts#L401)

___

### markup

• `Optional` **markup**: [*MarkupMapping*](index.markupmapping.md)

The parser can change TeX markup (\textsc, \emph, etc) to a text equivalent. The defaults are HTML-oriented, but you can pass in your own configuration here

Defined in: [index.ts:367](https://github.com/retorquere/bibtex-parser/blob/master/index.ts#L367)

___

### raw

• `Optional` **raw**: *boolean*

If this flag is set entries will be returned without conversion of LaTeX to unicode equivalents.

Defined in: [index.ts:406](https://github.com/retorquere/bibtex-parser/blob/master/index.ts#L406)

___

### sentenceCase

• `Optional` **sentenceCase**: *boolean* \| *string*[]

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

Defined in: [index.ts:349](https://github.com/retorquere/bibtex-parser/blob/master/index.ts#L349)

___

### strings

• `Optional` **strings**: *Record*<*string*, *string*\>

You can pass in an existing @string dictionary

Defined in: [index.ts:411](https://github.com/retorquere/bibtex-parser/blob/master/index.ts#L411)

___

### unabbreviate

• `Optional` **unabbreviate**: *Record*<*string*, { `ast`: *any* ; `text`: *string*  }\>

BibTeX files may have abbreviations in the journal field. If you provide a dictionary, journal names that are found in the dictionary are replaced with the attached full name

Defined in: [index.ts:416](https://github.com/retorquere/bibtex-parser/blob/master/index.ts#L416)

___

### unnestFields

• `Optional` **unnestFields**: *string*[]

In the past many bibtex entries would just always wrap a field in double braces ({{ title here }}), likely because whomever was writing them couldn't figure out the case meddling rules (and who could
blame them. Fields listed here will either have one outer layer of braces treated as case-preserve, or have the outer braced be ignored completely, if this is detected.

Defined in: [index.ts:395](https://github.com/retorquere/bibtex-parser/blob/master/index.ts#L395)

___

### unnestMode

• `Optional` **unnestMode**: *preserve* \| *unwrap*

Defined in: [index.ts:396](https://github.com/retorquere/bibtex-parser/blob/master/index.ts#L396)

___

### verbatimCommands

• `Optional` **verbatimCommands**: *string*[]

Some commands such as `url` are parsed in what is called "verbatim mode" where pretty much everything except braces is treated as regular text, not TeX commands.

Defined in: [index.ts:389](https://github.com/retorquere/bibtex-parser/blob/master/index.ts#L389)

___

### verbatimFields

• `Optional` **verbatimFields**: (*string* \| *RegExp*)[]

Some fields such as `url` are parsed in what is called "verbatim mode" where pretty much everything except braces is treated as regular text, not TeX commands. You can change the default list here if you want,
for example to help parse Mendeley `file` fields, which against spec are not in verbatim mode.

Defined in: [index.ts:384](https://github.com/retorquere/bibtex-parser/blob/master/index.ts#L384)
