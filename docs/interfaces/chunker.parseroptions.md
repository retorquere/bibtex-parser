[BibTeX parser](../README.md) / [chunker](../modules/chunker.md) / ParserOptions

# Interface: ParserOptions

[chunker](../modules/chunker.md).ParserOptions

## Table of contents

### Properties

- [async](chunker.parseroptions.md#async)
- [max\_entries](chunker.parseroptions.md#max_entries)

## Properties

### async

• `Optional` **async**: *boolean*

if `true`, return a promise for an array of chunks rather than an array of chunks.

Defined in: [chunker.ts:402](https://github.com/retorquere/bibtex-parser/blob/master/chunker.ts#L402)

___

### max\_entries

• `Optional` **max\_entries**: *number*

stop parsing after `max_entries` entries have been found. Useful for quick detection if a text file is in fact a bibtex file

Defined in: [chunker.ts:397](https://github.com/retorquere/bibtex-parser/blob/master/chunker.ts#L397)
