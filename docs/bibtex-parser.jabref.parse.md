<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](./index.md) &gt; [@retorquere/bibtex-parser](./bibtex-parser.md) &gt; [jabref](./bibtex-parser.jabref.md) &gt; [parse](./bibtex-parser.jabref.parse.md)

## jabref.parse() function

Import the JabRef groups from the `@string` comments in which they were stored. You would typically pass the comments parsed by \[\[bibtex.parse\]\] in here.

JabRef knows several group types, and this parser parses most, but not all of them:

\* independent group: the keys listed in the group are the entries that are considered to belong to it \* intersection: the keys listed in the group are considered to belong to the group if they're also in the parent group \* union: the keys listed in the group are considered to belong to the group, and also the keys that are in the parent group \* query: not supported by this parser

<b>Signature:</b>

```typescript
export declare function parse(comments: string[]): {
    comments: string[];
    jabref: JabRefMetadata;
};
```

## Parameters

|  Parameter | Type | Description |
|  --- | --- | --- |
|  comments | string\[\] |  |

<b>Returns:</b>

{ comments: string\[\]; jabref: [JabRefMetadata](./bibtex-parser.jabref.jabrefmetadata.md)<!-- -->; }
