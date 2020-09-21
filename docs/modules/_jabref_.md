**@retorquere/bibtex-parser**

> [README](../README.md) / [Globals](../globals.md) / "jabref"

# Module: "jabref"

## Index

### Interfaces

* [Group](../interfaces/_jabref_.group.md)
* [JabrefMetadata](../interfaces/_jabref_.jabrefmetadata.md)

### Functions

* [parse](_jabref_.md#parse)

## Functions

### parse

▸ **parse**(`comments`: string[]): [JabrefMetadata](../interfaces/_jabref_.jabrefmetadata.md)

Import the JabRef groups from the `@string` comments in which they were stored. You would typically pass the comments parsed by [[bibtex.parse]] in here.

JabRef knows several group types, and this parser parses most, but not all of them:

* independent group: the keys listed in the group are the entries that are considered to belong to it
* intersection: the keys listed in the group are considered to belong to the group if they're also in the parent group
* union: the keys listed in the group are considered to belong to the group, and also the keys that are in the parent group
* query: not supported by this parser

#### Parameters:

Name | Type |
------ | ------ |
`comments` | string[] |

**Returns:** [JabrefMetadata](../interfaces/_jabref_.jabrefmetadata.md)
