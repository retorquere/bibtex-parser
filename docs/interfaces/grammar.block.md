[](../README.md) / [Exports](../modules.md) / [grammar](../modules/grammar.md) / Block

# Interface: Block

[grammar](../modules/grammar.md).Block

## Hierarchy

* **Block**

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

• **markup**: { `bold?`: *boolean* ; `enquote?`: *boolean* ; `italics?`: *boolean* ; `smallCaps?`: *boolean* ; `sub?`: *boolean* ; `sup?`: *boolean*  }

#### Type declaration:

Name | Type |
------ | ------ |
`bold?` | *boolean* |
`enquote?` | *boolean* |
`italics?` | *boolean* |
`smallCaps?` | *boolean* |
`sub?` | *boolean* |
`sup?` | *boolean* |

Defined in: [grammar.d.ts:124](https://github.com/retorquere/bibtex-parser/blob/master/grammar.d.ts#L124)

___

### source

• `Optional` **source**: *string*

Defined in: [grammar.d.ts:120](https://github.com/retorquere/bibtex-parser/blob/master/grammar.d.ts#L120)

___

### value

• **value**: [*ValueType*](../modules/grammar.md#valuetype)[]

Defined in: [grammar.d.ts:121](https://github.com/retorquere/bibtex-parser/blob/master/grammar.d.ts#L121)
