**@retorquere/bibtex-parser**

> [README](../README.md) / [Globals](../globals.md) / ["index"](../modules/_index_.md) / Name

# Interface: Name

## Hierarchy

* **Name**

## Index

### Properties

* [firstName](_index_.name.md#firstname)
* [initial](_index_.name.md#initial)
* [juniorcomma](_index_.name.md#juniorcomma)
* [lastName](_index_.name.md#lastname)
* [literal](_index_.name.md#literal)
* [prefix](_index_.name.md#prefix)
* [suffix](_index_.name.md#suffix)
* [useprefix](_index_.name.md#useprefix)

## Properties

### firstName

• `Optional` **firstName**: string

given name. Will include middle names and initials.

___

### initial

• `Optional` **initial**: string

Initials.

___

### juniorcomma

• `Optional` **juniorcomma**: boolean

available when parsing biblatex extended name format

___

### lastName

• `Optional` **lastName**: string

Family name

___

### literal

• `Optional` **literal**: string

If the name is a literal (surrounded by braces) it will be in this property, and none of the other properties will be set

___

### prefix

• `Optional` **prefix**: string

things like `von`, `van der`, etc

___

### suffix

• `Optional` **suffix**: string

things like `Jr.`, `III`, etc

___

### useprefix

• `Optional` **useprefix**: boolean

available when parsing biblatex extended name format
