[](../README.md) / [Exports](../modules.md) / chunker

# Module: chunker

## Table of contents

### Interfaces

- [Chunk](../interfaces/chunker.chunk.md)
- [ParserOptions](../interfaces/chunker.parseroptions.md)

### Functions

- [parse](chunker.md#parse)

## Functions

### parse

▸ **parse**(`input`: *string*, `options?`: [*ParserOptions*](../interfaces/chunker.parseroptions.md)): [*Chunk*](../interfaces/chunker.chunk.md)[]

Reads the bibtex input and splits it into separate chunks of `@string`s, `@comment`s, and bibtex entries. Useful for detecting if a file is bibtex file and for filtering out basic errors that would
make the more sophisticated [[bibtex.parse]] reject the whole file

#### Parameters:

Name | Type | Default value |
------ | ------ | ------ |
`input` | *string* | - |
`options` | [*ParserOptions*](../interfaces/chunker.parseroptions.md) | ... |

**Returns:** [*Chunk*](../interfaces/chunker.chunk.md)[]

array of chunks, with markers for type and errors (if any) found.

Defined in: [chunker.ts:411](https://github.com/retorquere/bibtex-parser/blob/master/chunker.ts#L411)
