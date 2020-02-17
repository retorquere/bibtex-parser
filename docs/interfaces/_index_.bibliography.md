[@retorquere/bibtex-parser](../README.md) › [Globals](../globals.md) › ["index"](../modules/_index_.md) › [Bibliography](_index_.bibliography.md)

# Interface: Bibliography

## Hierarchy

* **Bibliography**

## Index

### Properties

* [comments](_index_.bibliography.md#comments)
* [entries](_index_.bibliography.md#entries)
* [errors](_index_.bibliography.md#errors)
* [strings](_index_.bibliography.md#strings)

## Properties

###  comments

• **comments**: *string[]*

`@comment`s found in the bibtex file. See also [[jabref.parse]]

___

###  entries

• **entries**: *[Entry](_index_.entry.md)[]*

entries in the order in which they are found, omitting those which could not be parsed.

___

###  errors

• **errors**: *[ParseError](_index_.parseerror.md)[]*

errors found while parsing

___

###  strings

• **strings**: *object*

`@string`s found in the bibtex file.

#### Type declaration:

* \[ **key**: *string*\]: string
