[](../README.md) / [Exports](../modules.md) / grammar

# Module: grammar

## Table of contents

### Interfaces

- [Bibliography](../interfaces/grammar.bibliography.md)
- [Block](../interfaces/grammar.block.md)
- [BracedComment](../interfaces/grammar.bracedcomment.md)
- [DiacriticCommand](../interfaces/grammar.diacriticcommand.md)
- [Entry](../interfaces/grammar.entry.md)
- [Environment](../interfaces/grammar.environment.md)
- [Field](../interfaces/grammar.field.md)
- [LineComment](../interfaces/grammar.linecomment.md)
- [Location](../interfaces/grammar.location.md)
- [LocationInfo](../interfaces/grammar.locationinfo.md)
- [Math](../interfaces/grammar.math.md)
- [NonEntryText](../interfaces/grammar.nonentrytext.md)
- [NumberValue](../interfaces/grammar.numbervalue.md)
- [ParseOptions](../interfaces/grammar.parseoptions.md)
- [PreambleExpression](../interfaces/grammar.preambleexpression.md)
- [RegularCommand](../interfaces/grammar.regularcommand.md)
- [StringDeclaration](../interfaces/grammar.stringdeclaration.md)
- [StringReference](../interfaces/grammar.stringreference.md)
- [SubscriptCommand](../interfaces/grammar.subscriptcommand.md)
- [SuperscriptCommand](../interfaces/grammar.superscriptcommand.md)
- [SymbolCommand](../interfaces/grammar.symbolcommand.md)
- [TextValue](../interfaces/grammar.textvalue.md)

### Type aliases

- [Children](grammar.md#children)
- [Command](grammar.md#command)
- [Comment](grammar.md#comment)
- [Node](grammar.md#node)
- [RequiredArgument](grammar.md#requiredargument)
- [ValueType](grammar.md#valuetype)

### Functions

- [parse](grammar.md#parse)

## Type aliases

### Children

Ƭ **Children**: [*Entry*](../interfaces/grammar.entry.md) \| [*PreambleExpression*](../interfaces/grammar.preambleexpression.md) \| [*StringDeclaration*](../interfaces/grammar.stringdeclaration.md) \| [*Comment*](grammar.md#comment)

Defined in: [grammar.d.ts:193](https://github.com/retorquere/bibtex-parser/blob/master/grammar.d.ts#L193)

___

### Command

Ƭ **Command**: [*RegularCommand*](../interfaces/grammar.regularcommand.md) \| [*SymbolCommand*](../interfaces/grammar.symbolcommand.md) \| [*DiacriticCommand*](../interfaces/grammar.diacriticcommand.md) \| [*SubscriptCommand*](../interfaces/grammar.subscriptcommand.md) \| [*SuperscriptCommand*](../interfaces/grammar.superscriptcommand.md)

Defined in: [grammar.d.ts:189](https://github.com/retorquere/bibtex-parser/blob/master/grammar.d.ts#L189)

___

### Comment

Ƭ **Comment**: [*BracedComment*](../interfaces/grammar.bracedcomment.md) \| [*LineComment*](../interfaces/grammar.linecomment.md) \| [*NonEntryText*](../interfaces/grammar.nonentrytext.md)

Defined in: [grammar.d.ts:187](https://github.com/retorquere/bibtex-parser/blob/master/grammar.d.ts#L187)

___

### Node

Ƭ **Node**: [*Comment*](grammar.md#comment) \| [*PreambleExpression*](../interfaces/grammar.preambleexpression.md) \| [*StringDeclaration*](../interfaces/grammar.stringdeclaration.md) \| [*Entry*](../interfaces/grammar.entry.md)

Defined in: [grammar.d.ts:195](https://github.com/retorquere/bibtex-parser/blob/master/grammar.d.ts#L195)

___

### RequiredArgument

Ƭ **RequiredArgument**: [*Block*](../interfaces/grammar.block.md) \| [*Command*](grammar.md#command) \| [*TextValue*](../interfaces/grammar.textvalue.md)

Defined in: [grammar.d.ts:58](https://github.com/retorquere/bibtex-parser/blob/master/grammar.d.ts#L58)

___

### ValueType

Ƭ **ValueType**: [*TextValue*](../interfaces/grammar.textvalue.md) \| [*StringReference*](../interfaces/grammar.stringreference.md) \| [*Block*](../interfaces/grammar.block.md) \| [*Environment*](../interfaces/grammar.environment.md) \| [*Math*](../interfaces/grammar.math.md) \| [*NumberValue*](../interfaces/grammar.numbervalue.md) \| [*Command*](grammar.md#command)

Defined in: [grammar.d.ts:191](https://github.com/retorquere/bibtex-parser/blob/master/grammar.d.ts#L191)

## Functions

### parse

▸ **parse**(`input`: *string*, `options?`: [*ParseOptions*](../interfaces/grammar.parseoptions.md)): [*Bibliography*](../interfaces/grammar.bibliography.md)

#### Parameters:

Name | Type |
------ | ------ |
`input` | *string* |
`options?` | [*ParseOptions*](../interfaces/grammar.parseoptions.md) |

**Returns:** [*Bibliography*](../interfaces/grammar.bibliography.md)

Defined in: [grammar.d.ts:211](https://github.com/retorquere/bibtex-parser/blob/master/grammar.d.ts#L211)
