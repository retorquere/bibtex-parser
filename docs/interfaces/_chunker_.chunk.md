**@retorquere/bibtex-parser**

> [README](../README.md) / [Globals](../globals.md) / ["chunker"](../modules/_chunker_.md) / Chunk

# Interface: Chunk

## Hierarchy

* **Chunk**

## Index

### Properties

* [comment](_chunker_.chunk.md#comment)
* [entry](_chunker_.chunk.md#entry)
* [error](_chunker_.chunk.md#error)
* [offset](_chunker_.chunk.md#offset)
* [preamble](_chunker_.chunk.md#preamble)
* [stringDeclaration](_chunker_.chunk.md#stringdeclaration)
* [text](_chunker_.chunk.md#text)

## Properties

### comment

• `Optional` **comment**: boolean

set to `true` if the chunk is an `@comment`

___

### entry

• `Optional` **entry**: boolean

set to `true` if the chunk is a bibtex entry

___

### error

• `Optional` **error**: string

error found, if any.

___

### offset

•  **offset**: { line: number ; pos: number  }

Start location of the chunk in the bib file

#### Type declaration:

Name | Type |
------ | ------ |
`line` | number |
`pos` | number |

___

### preamble

• `Optional` **preamble**: boolean

set to `true` if the chunk is a `@preamble` block

___

### stringDeclaration

• `Optional` **stringDeclaration**: boolean

set to `true` if the chunk is an `@string` declaration

___

### text

•  **text**: string

The text content of the chunk
