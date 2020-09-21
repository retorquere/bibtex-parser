**@retorquere/bibtex-parser**

> [README](../README.md) / [Globals](../globals.md) / ["chunker"](../modules/_chunker_.md) / ParserOptions

# Interface: ParserOptions

## Hierarchy

* **ParserOptions**

## Index

### Properties

* [async](_chunker_.parseroptions.md#async)
* [max\_entries](_chunker_.parseroptions.md#max_entries)

## Properties

### async

• `Optional` **async**: boolean

if `true`, return a promise for an array of chunks rather than an array of chunks.

___

### max\_entries

• `Optional` **max\_entries**: number

stop parsing after `max_entries` entries have been found. Useful for quick detection if a text file is in fact a bibtex file
