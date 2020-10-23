**[@retorquere/bibtex-parser](../README.md)**

> [Globals](../globals.md) / ["index"](../modules/_index_.md) / Entry

# Interface: Entry

## Hierarchy

* **Entry**

## Index

### Properties

* [creators](_index_.entry.md#creators)
* [fields](_index_.entry.md#fields)
* [key](_index_.entry.md#key)
* [sentenceCased](_index_.entry.md#sentencecased)
* [type](_index_.entry.md#type)

## Properties

### creators

•  **creators**: { [type:string]: [Name](_index_.name.md)[];  }

authors, editors, by creator type. Name order within the creator-type is retained.

___

### fields

•  **fields**: { [key:string]: string[];  }

entry fields. The keys are always in lowercase

___

### key

•  **key**: string

citation key

___

### sentenceCased

• `Optional` **sentenceCased**: boolean

will be set to `true` if sentence casing was applied to the entry

___

### type

•  **type**: string

entry type
