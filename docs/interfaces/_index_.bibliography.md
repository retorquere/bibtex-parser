**[@retorquere/bibtex-parser](../README.md)**

> [Globals](../globals.md) / ["index"](../modules/_index_.md) / Bibliography

# Interface: Bibliography

## Hierarchy

* **Bibliography**

## Index

### Properties

* [comments](_index_.bibliography.md#comments)
* [entries](_index_.bibliography.md#entries)
* [errors](_index_.bibliography.md#errors)
* [preamble](_index_.bibliography.md#preamble)
* [strings](_index_.bibliography.md#strings)

## Properties

### comments

•  **comments**: string[]

`@comment`s found in the bibtex file. See also [[jabref.parse]]

___

### entries

•  **entries**: [Entry](_index_.entry.md)[]

entries in the order in which they are found, omitting those which could not be parsed.

___

### errors

•  **errors**: [ParseError](_index_.parseerror.md)[]

errors found while parsing

___

### preamble

•  **preamble**: string[]

`@preamble` declarations found in the bibtex file

___

### strings

•  **strings**: { [key:string]: string;  }

`@string`s found in the bibtex file.
