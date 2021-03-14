[BibTeX parser](../README.md) / [grammar](../modules/grammar.md) / Block

# Interface: Block

[grammar](../modules/grammar.md).Block

## Table of contents

### Properties

- [case](grammar.block.md#case)
- [kind](grammar.block.md#kind)
- [loc](grammar.block.md#loc)
- [markup](grammar.block.md#markup)
- [source](grammar.block.md#source)
- [value](grammar.block.md#value)

## Properties

### case

• `Optional` **case**: *protect* \| *preserve*

Defined in: [grammar.d.ts:123](https://github.com/retorquere/bibtex-parser/blob/master/grammar.d.ts#L123)

___

### kind

• **kind**: *Block*

Defined in: [grammar.d.ts:118](https://github.com/retorquere/bibtex-parser/blob/master/grammar.d.ts#L118)

___

### loc

• `Optional` **loc**: [*Location*](grammar.location.md)

Defined in: [grammar.d.ts:119](https://github.com/retorquere/bibtex-parser/blob/master/grammar.d.ts#L119)

___

### markup

• **markup**: *object*

#### Type declaration:

Name | Type |
:------ | :------ |
`bold`? | *boolean* |
`enquote`? | *boolean* |
`italics`? | *boolean* |
`smallCaps`? | *boolean* |
`sub`? | *boolean* |
`sup`? | *boolean* |

Defined in: [grammar.d.ts:124](https://github.com/retorquere/bibtex-parser/blob/master/grammar.d.ts#L124)

___

### source

• `Optional` **source**: *string*

Defined in: [grammar.d.ts:120](https://github.com/retorquere/bibtex-parser/blob/master/grammar.d.ts#L120)

___

### value

• **value**: ([*TextValue*](grammar.textvalue.md) \| [*StringReference*](grammar.stringreference.md) \| [*NumberValue*](grammar.numbervalue.md) \| [*Block*](grammar.block.md) \| [*Command*](../modules/grammar.md#command) \| [*Math*](grammar.math.md) \| [*Environment*](grammar.environment.md))[]

Defined in: [grammar.d.ts:121](https://github.com/retorquere/bibtex-parser/blob/master/grammar.d.ts#L121)
