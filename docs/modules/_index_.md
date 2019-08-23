**[@retorquere/bibtex-parser](../README.md)**

[Globals](../globals.md) › ["index"](_index_.md)

# External module: "index"

## Index

### Interfaces

* [Bibliography](../interfaces/_index_.bibliography.md)
* [Entry](../interfaces/_index_.entry.md)
* [MarkupMapping](../interfaces/_index_.markupmapping.md)
* [Name](../interfaces/_index_.name.md)
* [ParseError](../interfaces/_index_.parseerror.md)
* [ParserOptions](../interfaces/_index_.parseroptions.md)

### Functions

* [parse](_index_.md#parse)

## Functions

###  parse

▸ **parse**(`input`: string, `options`: [ParserOptions](../interfaces/_index_.parseroptions.md)): *[Bibliography](../interfaces/_index_.bibliography.md) | Promise‹[Bibliography](../interfaces/_index_.bibliography.md)›*

parse bibtex. This will try to convert TeX commands into unicode equivalents, and apply `@string` expansion

**Parameters:**

Name | Type | Default |
------ | ------ | ------ |
`input` | string | - |
`options` | [ParserOptions](../interfaces/_index_.parseroptions.md) |  {} |

**Returns:** *[Bibliography](../interfaces/_index_.bibliography.md) | Promise‹[Bibliography](../interfaces/_index_.bibliography.md)›*