**[@retorquere/bibtex-parser](../README.md)**

[Globals](../globals.md) › ["chunker"](../modules/_chunker_.md) › [Chunk](_chunker_.chunk.md)

# Interface: Chunk

## Hierarchy

* **Chunk**

## Index

### Properties

* [comment](_chunker_.chunk.md#optional-comment)
* [entry](_chunker_.chunk.md#optional-entry)
* [error](_chunker_.chunk.md#optional-error)
* [offset](_chunker_.chunk.md#offset)
* [preamble](_chunker_.chunk.md#optional-preamble)
* [stringDeclaration](_chunker_.chunk.md#optional-stringdeclaration)
* [text](_chunker_.chunk.md#text)

## Properties

### `Optional` comment

• **comment**? : *boolean*

set to `true` if the chunk is an `@comment`

___

### `Optional` entry

• **entry**? : *boolean*

set to `true` if the chunk is a bibtex entry

___

### `Optional` error

• **error**? : *string*

error found, if any.

___

###  offset

• **offset**: *object*

Start location of the chunk in the bib file

#### Type declaration:

___

### `Optional` preamble

• **preamble**? : *boolean*

set to `true` if the chunk is a `@preamble` block

___

### `Optional` stringDeclaration

• **stringDeclaration**? : *boolean*

set to `true` if the chunk is an `@string` declaration

___

###  text

• **text**: *string*

The text content of the chunk