<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](./index.md) &gt; [@retorquere/bibtex-parser](./bibtex-parser.md) &gt; [Entry](./bibtex-parser.entry.md)

## Entry interface

<b>Signature:</b>

```typescript
export interface Entry 
```

## Properties

|  Property | Modifiers | Type | Description |
|  --- | --- | --- | --- |
|  [creators](./bibtex-parser.entry.creators.md) |  | { \[type: string\]: [Name](./bibtex-parser.name.md)<!-- -->\[\]; } | authors, editors, by creator type. Name order within the creator-type is retained. |
|  [fields](./bibtex-parser.entry.fields.md) |  | { \[key: string\]: string\[\]; } | entry fields. The keys are always in lowercase |
|  [key](./bibtex-parser.entry.key.md) |  | string | citation key |
|  [sentenceCased?](./bibtex-parser.entry.sentencecased.md) |  | boolean | <i>(Optional)</i> will be set to <code>true</code> if sentence casing was applied to the entry |
|  [type](./bibtex-parser.entry.type.md) |  | string | entry type |
