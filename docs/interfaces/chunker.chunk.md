[](../README.md) / [Exports](../modules.md) / [chunker](../modules/chunker.md) / Chunk

# Interface: Chunk

[chunker](../modules/chunker.md).Chunk

## Hierarchy

* **Chunk**

## Table of contents

### Properties

- [comment](chunker.chunk.md#comment)
- [entry](chunker.chunk.md#entry)
- [error](chunker.chunk.md#error)
- [offset](chunker.chunk.md#offset)
- [preamble](chunker.chunk.md#preamble)
- [stringDeclaration](chunker.chunk.md#stringdeclaration)
- [text](chunker.chunk.md#text)

## Properties

### comment

• `Optional` **comment**: *boolean*

set to `true` if the chunk is an `@comment`

Defined in: [chunker.ts:69](https://github.com/retorquere/bibtex-parser/blob/master/chunker.ts#L69)

___

### entry

• `Optional` **entry**: *boolean*

set to `true` if the chunk is a bibtex entry

Defined in: [chunker.ts:59](https://github.com/retorquere/bibtex-parser/blob/master/chunker.ts#L59)

___

### error

• `Optional` **error**: *string*

error found, if any.

Defined in: [chunker.ts:49](https://github.com/retorquere/bibtex-parser/blob/master/chunker.ts#L49)

___

### offset

• **offset**: { `line`: *number* ; `pos`: *number*  }

Start location of the chunk in the bib file

#### Type declaration:

Name | Type |
------ | ------ |
`line` | *number* |
`pos` | *number* |

Defined in: [chunker.ts:44](https://github.com/retorquere/bibtex-parser/blob/master/chunker.ts#L44)

___

### preamble

• `Optional` **preamble**: *boolean*

set to `true` if the chunk is a `@preamble` block

Defined in: [chunker.ts:54](https://github.com/retorquere/bibtex-parser/blob/master/chunker.ts#L54)

___

### stringDeclaration

• `Optional` **stringDeclaration**: *boolean*

set to `true` if the chunk is an `@string` declaration

Defined in: [chunker.ts:64](https://github.com/retorquere/bibtex-parser/blob/master/chunker.ts#L64)

___

### text

• **text**: *string*

The text content of the chunk

Defined in: [chunker.ts:39](https://github.com/retorquere/bibtex-parser/blob/master/chunker.ts#L39)
