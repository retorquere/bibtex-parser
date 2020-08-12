[@retorquere/bibtex-parser](../README.md) › [Globals](../globals.md) › ["index"](../modules/_index_.md) › [Entry](_index_.entry.md)

# Interface: Entry

## Hierarchy

* **Entry**

## Index

### Properties

* [creators](_index_.entry.md#creators)
* [fields](_index_.entry.md#fields)
* [key](_index_.entry.md#key)
* [sentenceCased](_index_.entry.md#optional-sentencecased)
* [type](_index_.entry.md#type)

## Properties

###  creators

• **creators**: *object*

authors, editors, by creator type. Name order within the creator-type is retained.

#### Type declaration:

* \[ **type**: *string*\]: [Name](_index_.name.md)[]

___

###  fields

• **fields**: *object*

entry fields. The keys are always in lowercase

#### Type declaration:

* \[ **key**: *string*\]: string[]

___

###  key

• **key**: *string*

citation key

___

### `Optional` sentenceCased

• **sentenceCased**? : *boolean*

will be set to `true` if sentence casing was applied to the entry

___

###  type

• **type**: *string*

entry type
