[BibTeX parser](../README.md) / [jabref](../modules/jabref.md) / JabrefMetadata

# Interface: JabrefMetadata

[jabref](../modules/jabref.md).JabrefMetadata

## Table of contents

### Properties

- [fileDirectory](jabref.jabrefmetadata.md#filedirectory)
- [groups](jabref.jabrefmetadata.md#groups)
- [root](jabref.jabrefmetadata.md#root)
- [version](jabref.jabrefmetadata.md#version)

## Properties

### fileDirectory

• **fileDirectory**: *string*

The base path for file paths

Defined in: [jabref.ts:67](https://github.com/retorquere/bibtex-parser/blob/master/jabref.ts#L67)

___

### groups

• **groups**: *object*

JabRef since 3.8 has changed their groups format. Entries have a `groups` field which has the names of the groups they belong to -- this name does not have to be unique in the groups hierarchy so if you
have multiple groups with the same name, it's not well-defined where the entries should end up. This property gives you the for each group name the first time the group showed up in the hierarchy. Note that
keys from the entries themselves have *not* yet been added to the [Group](jabref.group.md)s. You need to combine this yourself as you're parsing the entries.

#### Type declaration:

Defined in: [jabref.ts:62](https://github.com/retorquere/bibtex-parser/blob/master/jabref.ts#L62)

___

### root

• **root**: [*Group*](jabref.group.md)[]

The root groups. You can find the nested groups in their `groups` property

Defined in: [jabref.ts:55](https://github.com/retorquere/bibtex-parser/blob/master/jabref.ts#L55)

___

### version

• **version**: *string*

The JabRef metadata format version

Defined in: [jabref.ts:72](https://github.com/retorquere/bibtex-parser/blob/master/jabref.ts#L72)
