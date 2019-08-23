**[@retorquere/bibtex-parser](../README.md)**

[Globals](../globals.md) › ["index"](../modules/_index_.md) › [Entry](_index_.entry.md)

# Interface: Entry

## Hierarchy

* **Entry**

## Index

### Properties

* [creators](_index_.entry.md#creators)
* [fields](_index_.entry.md#fields)
* [key](_index_.entry.md#key)
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

###  type

• **type**: *string*

entry type