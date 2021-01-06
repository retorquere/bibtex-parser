[](../README.md) / [Exports](../modules.md) / [index](../modules/index.md) / Bibliography

# Interface: Bibliography

## Hierarchy

* **Bibliography**

## Index

### Properties

* [comments](index.bibliography.md#comments)
* [entries](index.bibliography.md#entries)
* [errors](index.bibliography.md#errors)
* [preamble](index.bibliography.md#preamble)
* [strings](index.bibliography.md#strings)

## Properties

### comments

• **comments**: *string*[]

`@comment`s found in the bibtex file. See also [jabref.parse](../modules/jabref.md#parse)

Defined in: [index.ts:227](https://github.com/retorquere/bibtex-parser/blob/master/index.ts#L227)

___

### entries

• **entries**: [*Entry*](index.entry.md)[]

entries in the order in which they are found, omitting those which could not be parsed.

Defined in: [index.ts:222](https://github.com/retorquere/bibtex-parser/blob/master/index.ts#L222)

___

### errors

• **errors**: [*ParseError*](index.parseerror.md)[]

errors found while parsing

Defined in: [index.ts:217](https://github.com/retorquere/bibtex-parser/blob/master/index.ts#L217)

___

### preamble

• **preamble**: *string*[]

`@preamble` declarations found in the bibtex file

Defined in: [index.ts:237](https://github.com/retorquere/bibtex-parser/blob/master/index.ts#L237)

___

### strings

• **strings**: { [key: string]: *string*;  }

`@string`s found in the bibtex file.

Defined in: [index.ts:232](https://github.com/retorquere/bibtex-parser/blob/master/index.ts#L232)
