<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](./index.md) &gt; [@retorquere/bibtex-parser](./bibtex-parser.md) &gt; [ParserOptions](./bibtex-parser.parseroptions.md) &gt; [caseProtection](./bibtex-parser.parseroptions.caseprotection.md)

## ParserOptions.caseProtection property

translate braced parts of text into a case-protected counterpart; uses the \[\[MarkupMapping\]\] table in `markup`<!-- -->. Default == true == as-needed. In as-needed mode the parser will assume that words that have capitals in them imply "nocase" behavior in the consuming application. If you don't want this, turn this option on, and you'll get case protection exactly as the input has it

<b>Signature:</b>

```typescript
caseProtection?: 'as-needed' | 'strict' | boolean;
```