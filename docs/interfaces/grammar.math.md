[BibTeX parser](../README.md) / [grammar](../modules/grammar.md) / Math

# Interface: Math

[grammar](../modules/grammar.md).Math

## Table of contents

### Properties

- [case](grammar.math.md#case)
- [kind](grammar.math.md#kind)
- [loc](grammar.math.md#loc)
- [source](grammar.math.md#source)
- [value](grammar.math.md#value)

## Properties

### case

• `Optional` **case**: *protect* \| *preserve*

Defined in: [grammar.d.ts:106](https://github.com/retorquere/bibtex-parser/blob/master/grammar.d.ts#L106)

___

### kind

• **kind**: *InlineMath* \| *DisplayMath*

Defined in: [grammar.d.ts:102](https://github.com/retorquere/bibtex-parser/blob/master/grammar.d.ts#L102)

___

### loc

• `Optional` **loc**: [*Location*](grammar.location.md)

Defined in: [grammar.d.ts:103](https://github.com/retorquere/bibtex-parser/blob/master/grammar.d.ts#L103)

___

### source

• `Optional` **source**: *string*

Defined in: [grammar.d.ts:104](https://github.com/retorquere/bibtex-parser/blob/master/grammar.d.ts#L104)

___

### value

• **value**: ([*TextValue*](grammar.textvalue.md) \| [*StringReference*](grammar.stringreference.md) \| [*NumberValue*](grammar.numbervalue.md) \| [*Block*](grammar.block.md) \| [*Command*](../modules/grammar.md#command) \| [*Math*](grammar.math.md) \| [*Environment*](grammar.environment.md))[]

Defined in: [grammar.d.ts:105](https://github.com/retorquere/bibtex-parser/blob/master/grammar.d.ts#L105)
