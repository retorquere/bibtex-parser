[BibTeX parser](../README.md) / index

# Module: index

## Table of contents

### References

- [chunker](index.md#chunker)
- [jabref](index.md#jabref)

### Interfaces

- [Bibliography](../interfaces/index.bibliography.md)
- [Entry](../interfaces/index.entry.md)
- [MarkupMapping](../interfaces/index.markupmapping.md)
- [Name](../interfaces/index.name.md)
- [ParseError](../interfaces/index.parseerror.md)
- [ParserOptions](../interfaces/index.parseroptions.md)

### Functions

- [ast](index.md#ast)
- [parse](index.md#parse)

## References

### chunker

Renames and exports: [parse](chunker.md#parse)

___

### jabref

Renames and exports: [parse](jabref.md#parse)

## Functions

### ast

▸ **ast**(`input`: *string*, `options?`: [*ParserOptions*](../interfaces/index.parseroptions.md), `clean?`: *boolean*): *any*[]

#### Parameters:

Name | Type | Default value |
:------ | :------ | :------ |
`input` | *string* | - |
`options` | [*ParserOptions*](../interfaces/index.parseroptions.md) | - |
`clean` | *boolean* | true |

**Returns:** *any*[]

Defined in: [index.ts:1782](https://github.com/retorquere/bibtex-parser/blob/master/index.ts#L1782)

___

### parse

▸ **parse**(`input`: *string*, `options?`: [*ParserOptions*](../interfaces/index.parseroptions.md)): [*Bibliography*](../interfaces/index.bibliography.md) \| *Promise*<[*Bibliography*](../interfaces/index.bibliography.md)\>

parse bibtex. This will try to convert TeX commands into unicode equivalents, and apply `@string` expansion

#### Parameters:

Name | Type |
:------ | :------ |
`input` | *string* |
`options` | [*ParserOptions*](../interfaces/index.parseroptions.md) |

**Returns:** [*Bibliography*](../interfaces/index.bibliography.md) \| *Promise*<[*Bibliography*](../interfaces/index.bibliography.md)\>

Defined in: [index.ts:1777](https://github.com/retorquere/bibtex-parser/blob/master/index.ts#L1777)
