[@retorquere/bibtex-parser](../README.md) › [Globals](../globals.md) › ["chunker"](_chunker_.md)

# External module: "chunker"

## Index

### Interfaces

* [Chunk](../interfaces/_chunker_.chunk.md)
* [ParserOptions](../interfaces/_chunker_.parseroptions.md)

### Functions

* [parse](_chunker_.md#parse)

## Functions

###  parse

▸ **parse**(`input`: string, `options`: [ParserOptions](../interfaces/_chunker_.parseroptions.md)): *[Chunk](../interfaces/_chunker_.chunk.md)[]*

Reads the bibtex input and splits it into separate chunks of `@string`s, `@comment`s, and bibtex entries. Useful for detecting if a file is bibtex file and for filtering out basic errors that would
make the more sophisticated [[bibtex.parse]] reject the whole file

**Parameters:**

Name | Type | Default |
------ | ------ | ------ |
`input` | string | - |
`options` | [ParserOptions](../interfaces/_chunker_.parseroptions.md) | {} |

**Returns:** *[Chunk](../interfaces/_chunker_.chunk.md)[]*

array of chunks, with markers for type and errors (if any) found.