**[@retorquere/bibtex-parser](../README.md)**

[Globals](../globals.md) › ["chunker"](../modules/_chunker_.md) › [ParserOptions](_chunker_.parseroptions.md)

# Interface: ParserOptions

## Hierarchy

* **ParserOptions**

## Index

### Properties

* [async](_chunker_.parseroptions.md#optional-async)
* [max_entries](_chunker_.parseroptions.md#optional-max_entries)

## Properties

### `Optional` async

• **async**? : *boolean*

if `true`, return a promise for an array of chunks rather than an array of chunks.

___

### `Optional` max_entries

• **max_entries**? : *number*

stop parsing after `max_entries` entries have been found. Useful for quick detection if a text file is in fact a bibtex file