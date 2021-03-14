[BibTeX parser](../README.md) / [index](../modules/index.md) / Entry

# Interface: Entry

[index](../modules/index.md).Entry

## Table of contents

### Properties

- [creators](index.entry.md#creators)
- [fields](index.entry.md#fields)
- [key](index.entry.md#key)
- [sentenceCased](index.entry.md#sentencecased)
- [type](index.entry.md#type)

## Properties

### creators

• **creators**: *object*

authors, editors, by creator type. Name order within the creator-type is retained.

#### Type declaration:

Defined in: [index.ts:174](https://github.com/retorquere/bibtex-parser/blob/master/index.ts#L174)

___

### fields

• **fields**: *object*

entry fields. The keys are always in lowercase

#### Type declaration:

Defined in: [index.ts:169](https://github.com/retorquere/bibtex-parser/blob/master/index.ts#L169)

___

### key

• **key**: *string*

citation key

Defined in: [index.ts:159](https://github.com/retorquere/bibtex-parser/blob/master/index.ts#L159)

___

### sentenceCased

• `Optional` **sentenceCased**: *boolean*

will be set to `true` if sentence casing was applied to the entry

Defined in: [index.ts:179](https://github.com/retorquere/bibtex-parser/blob/master/index.ts#L179)

___

### type

• **type**: *string*

entry type

Defined in: [index.ts:164](https://github.com/retorquere/bibtex-parser/blob/master/index.ts#L164)
