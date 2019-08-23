**[@retorquere/bibtex-parser](../README.md)**

[Globals](../globals.md) › ["jabref"](../modules/_jabref_.md) › [JabrefMetadata](_jabref_.jabrefmetadata.md)

# Interface: JabrefMetadata

## Hierarchy

* **JabrefMetadata**

## Index

### Properties

* [fileDirectory](_jabref_.jabrefmetadata.md#filedirectory)
* [groups](_jabref_.jabrefmetadata.md#groups)
* [root](_jabref_.jabrefmetadata.md#root)
* [version](_jabref_.jabrefmetadata.md#version)

## Properties

###  fileDirectory

• **fileDirectory**: *string*

The base path for file paths

___

###  groups

• **groups**: *object*

JabRef since 3.8 has changed their groups format. Entries have a `groups` field which has the names of the groups they belong to -- this name does not have to be unique in the groups hierarchy so if you
have multiple groups with the same name, it's not well-defined where the entries should end up. This property gives you the for each group name the first time the group showed up in the hierarchy. Note that
keys from the entries themselves have *not* yet been added to the [Group](_jabref_.group.md)s.

#### Type declaration:

* \[ **key**: *string*\]: [Group](_jabref_.group.md)

___

###  root

• **root**: *[Group](_jabref_.group.md)[]*

The root groups. You can find the nested groups in their `groups` property

___

###  version

• **version**: *string*

The JabRef metadata format version