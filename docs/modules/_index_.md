[@retorquere/bibtex-parser](../README.md) › [Globals](../globals.md) › ["index"](_index_.md)

# Module: "index"

## Index

### References

* [chunker](_index_.md#chunker)
* [jabref](_index_.md#jabref)

### Interfaces

* [Bibliography](../interfaces/_index_.bibliography.md)
* [Entry](../interfaces/_index_.entry.md)
* [MarkupMapping](../interfaces/_index_.markupmapping.md)
* [Name](../interfaces/_index_.name.md)
* [ParseError](../interfaces/_index_.parseerror.md)
* [ParserOptions](../interfaces/_index_.parseroptions.md)

### Functions

* [ast](_index_.md#ast)
* [parse](_index_.md#parse)

## References

###  chunker

• **chunker**:

___

###  jabref

• **jabref**:

## Functions

###  ast

▸ **ast**(`input`: string, `options`: [ParserOptions](../interfaces/_index_.parseroptions.md), `clean`: boolean): *any[]*

**Parameters:**

Name | Type | Default |
------ | ------ | ------ |
`input` | string | - |
`options` | [ParserOptions](../interfaces/_index_.parseroptions.md) | {} |
`clean` | boolean | true |

**Returns:** *any[]*

___

###  parse

▸ **parse**(`input`: string, `options`: [ParserOptions](../interfaces/_index_.parseroptions.md)): *[Bibliography](../interfaces/_index_.bibliography.md) | Promise‹[Bibliography](../interfaces/_index_.bibliography.md)›*

parse bibtex. This will try to convert TeX commands into unicode equivalents, and apply `@string` expansion

**Parameters:**

Name | Type | Default |
------ | ------ | ------ |
`input` | string | - |
`options` | [ParserOptions](../interfaces/_index_.parseroptions.md) | {} |

**Returns:** *[Bibliography](../interfaces/_index_.bibliography.md) | Promise‹[Bibliography](../interfaces/_index_.bibliography.md)›*
