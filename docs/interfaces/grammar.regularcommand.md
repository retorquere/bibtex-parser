[BibTeX parser](../README.md) / [grammar](../modules/grammar.md) / RegularCommand

# Interface: RegularCommand

[grammar](../modules/grammar.md).RegularCommand

## Table of contents

### Properties

- [arguments](grammar.regularcommand.md#arguments)
- [command](grammar.regularcommand.md#command)
- [kind](grammar.regularcommand.md#kind)
- [loc](grammar.regularcommand.md#loc)
- [source](grammar.regularcommand.md#source)

## Properties

### arguments

• **arguments**: *object*

#### Type declaration:

Name | Type |
:------ | :------ |
`optional` | [*TextValue*](grammar.textvalue.md)[] |
`required` | ([*TextValue*](grammar.textvalue.md) \| [*Block*](grammar.block.md) \| [*Command*](../modules/grammar.md#command))[] |

Defined in: [grammar.d.ts:65](https://github.com/retorquere/bibtex-parser/blob/master/grammar.d.ts#L65)

___

### command

• **command**: *string*

Defined in: [grammar.d.ts:64](https://github.com/retorquere/bibtex-parser/blob/master/grammar.d.ts#L64)

___

### kind

• **kind**: *RegularCommand*

Defined in: [grammar.d.ts:61](https://github.com/retorquere/bibtex-parser/blob/master/grammar.d.ts#L61)

___

### loc

• **loc**: [*Location*](grammar.location.md)

Defined in: [grammar.d.ts:62](https://github.com/retorquere/bibtex-parser/blob/master/grammar.d.ts#L62)

___

### source

• **source**: *string*

Defined in: [grammar.d.ts:63](https://github.com/retorquere/bibtex-parser/blob/master/grammar.d.ts#L63)
