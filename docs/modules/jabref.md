[](../README.md) / [Exports](../modules.md) / jabref

# Module: jabref

## Index

### Interfaces

* [Group](../interfaces/jabref.group.md)
* [JabrefMetadata](../interfaces/jabref.jabrefmetadata.md)

### Functions

* [parse](jabref.md#parse)

## Functions

### parse

▸ **parse**(`comments`: *string*[]): [*JabrefMetadata*](../interfaces/jabref.jabrefmetadata.md)

Import the JabRef groups from the `@string` comments in which they were stored. You would typically pass the comments parsed by [[bibtex.parse]] in here.

JabRef knows several group types, and this parser parses most, but not all of them:

* independent group: the keys listed in the group are the entries that are considered to belong to it
* intersection: the keys listed in the group are considered to belong to the group if they're also in the parent group
* union: the keys listed in the group are considered to belong to the group, and also the keys that are in the parent group
* query: not supported by this parser

#### Parameters:

Name | Type |
------ | ------ |
`comments` | *string*[] |

**Returns:** [*JabrefMetadata*](../interfaces/jabref.jabrefmetadata.md)

Defined in: [jabref.ts:85](https://github.com/retorquere/bibtex-parser/blob/master/jabref.ts#L85)
