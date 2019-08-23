**[@retorquere/bibtex-parser](../README.md)**

[Globals](../globals.md) › ["index"](../modules/_index_.md) › [Name](_index_.name.md)

# Interface: Name

## Hierarchy

* **Name**

## Index

### Properties

* [firstName](_index_.name.md#optional-firstname)
* [lastName](_index_.name.md#optional-lastname)
* [literal](_index_.name.md#optional-literal)
* [prefix](_index_.name.md#optional-prefix)
* [suffix](_index_.name.md#optional-suffix)
* [useprefix](_index_.name.md#optional-useprefix)

## Properties

### `Optional` firstName

• **firstName**? : *string*

given name. Will include middle names and initials.

___

### `Optional` lastName

• **lastName**? : *string*

Family name

___

### `Optional` literal

• **literal**? : *string*

If the name is a literal (surrounded by braces) it will be in this property, and none of the other properties will be set

___

### `Optional` prefix

• **prefix**? : *string*

things like `von`, `van der`, etc

___

### `Optional` suffix

• **suffix**? : *string*

things like `Jr.`, `III`, etc

___

### `Optional` useprefix

• **useprefix**? : *boolean*

available when parsing biblatex extended name format