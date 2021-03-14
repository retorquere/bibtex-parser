[BibTeX parser](../README.md) / [index](../modules/index.md) / Name

# Interface: Name

[index](../modules/index.md).Name

## Table of contents

### Properties

- [firstName](index.name.md#firstname)
- [initial](index.name.md#initial)
- [juniorcomma](index.name.md#juniorcomma)
- [lastName](index.name.md#lastname)
- [literal](index.name.md#literal)
- [prefix](index.name.md#prefix)
- [suffix](index.name.md#suffix)
- [useprefix](index.name.md#useprefix)

## Properties

### firstName

• `Optional` **firstName**: *string*

given name. Will include middle names and initials.

Defined in: [index.ts:137](https://github.com/retorquere/bibtex-parser/blob/master/index.ts#L137)

___

### initial

• `Optional` **initial**: *string*

Initials.

Defined in: [index.ts:142](https://github.com/retorquere/bibtex-parser/blob/master/index.ts#L142)

___

### juniorcomma

• `Optional` **juniorcomma**: *boolean*

available when parsing biblatex extended name format

Defined in: [index.ts:132](https://github.com/retorquere/bibtex-parser/blob/master/index.ts#L132)

___

### lastName

• `Optional` **lastName**: *string*

Family name

Defined in: [index.ts:122](https://github.com/retorquere/bibtex-parser/blob/master/index.ts#L122)

___

### literal

• `Optional` **literal**: *string*

If the name is a literal (surrounded by braces) it will be in this property, and none of the other properties will be set

Defined in: [index.ts:117](https://github.com/retorquere/bibtex-parser/blob/master/index.ts#L117)

___

### prefix

• `Optional` **prefix**: *string*

things like `von`, `van der`, etc

Defined in: [index.ts:152](https://github.com/retorquere/bibtex-parser/blob/master/index.ts#L152)

___

### suffix

• `Optional` **suffix**: *string*

things like `Jr.`, `III`, etc

Defined in: [index.ts:147](https://github.com/retorquere/bibtex-parser/blob/master/index.ts#L147)

___

### useprefix

• `Optional` **useprefix**: *boolean*

available when parsing biblatex extended name format

Defined in: [index.ts:127](https://github.com/retorquere/bibtex-parser/blob/master/index.ts#L127)
