{
  /*
    MIT License

    Copyright (c) 2017 Derek P Sifford, parts copyright (c) 2019 by Emiliano Heyns

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
  */

  const markup = {
    sl: 'italics',
    em: 'italics',
    it: 'italics',
    itshape: 'italics',

    bf: 'bold',
    bfseries: 'bold',

    sc: 'smallCaps',
    scshape: 'smallCaps',

    tt: 'fixedWidth',
    rm: 'roman',
    sf: 'sansSerif',
    verb: 'verbatim',
  }

  const unnestFields = (options.unnestFields || []).map(field => field.toLowerCase())
  const verbatimFields = (options.verbatimFields || [ 'url', 'doi', 'file', 'files', 'eprint', 'verba', 'verbb', 'verbc' ]).map(field => typeof field === 'string' ? field.toLowerCase() : field)
  const verbatimCommands = (options.verbatimCommands || ['url', 'href'])

  function isVerbatimField(name) {
    return verbatimFields.find(p => (typeof p === 'string') ? name === p : name.match(p))
  }

  function normalizeWhitespace(textArr) {
    return textArr.reduce((prev, curr) => {
      if (/\s/.test(curr)) {
        if (/\s/.test(prev[prev.length - 1])) {
          return prev;
        } else {
          return prev + ' ';
        }
      }
      return prev + curr;
    }, '');
  }

  const has_arguments = {
    ElsevierGlyph: 1,
    end: 1,
    begin: 1,
    bibcyr: 1,
    bibstring: 1,
    chsf: 1,
    cite: 1,
    cyrchar: 1,
    ding: 1,
    emph: 1,
    enquote: 1,
    frac: 2,
    href: 2,
    hspace: 1,
    mathrm: 1,
    mbox: 1,
    mkbibbold: 1,
    mkbibemph: 1,
    mkbibitalic: 1,
    mkbibquote: 1,
    noopsort: 1,
    ocirc: 1,
    section: 1,
    sb: 1,
    sp: 1,
    subsection: 1,
    t: 1,
    textbf: 1,
    textit: 1,
    textrm: 1,
    textsc: 1,
    textsubscript: 1,
    textsuperscript: 1,
    url: 1,
    vphantom: 1,
    vspace: 1,
  }

  function say() {
    console.log(JSON.stringify(Array.from(arguments), null, 2))
    return true
  }

  const math = {
    on: false,

    set: function(state) {
      this.on = state
      return true
    }
  }

  function basicTextConversions(node) {
    if (node.kind !== 'Text') throw new Error(node.kind + ' is not a Text node')

    switch (node.mode) {
      case 'verbatim':
        break

      case 'math':
        node.value = node.value.replace(/~/g, '\u00A0')
        break

      case 'text':
        node.value = node.value
          .replace(/---/g, '\u2014')
          .replace(/--/g, '\u2013')
          .replace(/</g, '\u00A1')
          .replace(/>/g, '\u00BF')
          .replace(/~/g, '\u00A0')
          .replace(/``/g, options.markup.enquote.open)
          .replace(/''/g, options.markup.enquote.close)
        break

      default:
        throw new Error(`Unexpected text mode ${node.mode}`)
    }

    return node
  }

  function protect(v) {
    return {
      kind: 'Block',
      value: [v],
      markup: {},
      case: 'protect',
      source: v.source,
    }
  }
}

Bibliography
  = __ r:Node* __ {
    return {
      kind: 'Bibliography',
      loc: location(),
      source: text(),
      children: r,
    }
  }

Comment
  = '@' __ 'comment'i __h v:BracedComment {
    return {
      kind: 'BracedComment',
      loc: location(),
      source: text(),
      value: v.slice(1, -1),
    }
  }
  / '@' __ 'comment'i __h v:[^\n\r]* [\n\r]* {
    return {
      kind: 'LineComment',
      loc: location(),
      source: text(),
      value: normalizeWhitespace(v),
    }
    }
  / v:([^@] [^\n\r]*) [\n\r]* {
    return {
      kind: 'NonEntryText',
      loc: location(),
      source: text(),
      value: normalizeWhitespace(v),
    }
  }

Node
  = n:(Comment / PreambleExpression / StringDeclaration / Entry) { return n; }

BracedComment
  = '{' comment:( [^{}] / BracedComment )* '}' { return '{' + comment.join('') + '}' }

//-----------------  Top-level Nodes

Entry
  = '@' __ type:$[A-Za-z]+ __ [({] __ id:EntryId? __ fields:Field* __ [})] __ {
    return {
      kind: 'Entry',
      id: id || '',
      type: type.toLowerCase(),
      loc: location(),
      source: text(),
      fields: fields,
    }
  }

PreambleExpression
  = '@' __ 'preamble'i __ [({] __ v:RegularValue* __ [})] __ {
    return {
      kind: 'PreambleExpression',
      loc: location(),
      source: text(),
      value: v.reduce((a, b) => a.concat(b), []),
    }
  }

StringDeclaration
  = '@' __ 'string'i __ [({] __ k:VariableName FieldSeparator v:RegularValue+ __ [})] __ {
    return {
      kind: 'StringDeclaration',
      loc: location(),
      source: text(),
      name: k,
      value: v.reduce((a, b) => a.concat(b), []),
    }
  }

//------------------ Entry Child Nodes

EntryId
  = __ id:$[^ \t\r\n,]* __ ',' { return id; }

Field
  = k:FieldName &{ return isVerbatimField(k.toLowerCase()) } FieldSeparator v:VerbatimFieldValue FieldTerminator {
    return {
      kind: 'Field',
      loc: location(),
      source: text(),
      name: k.toLowerCase(),
      loc: location(),
      value: [ protect(v) ]
    }
  }
  / k:FieldName FieldSeparator v:FieldValue FieldTerminator {
    const field = {
      kind: 'Field',
      loc: location(),
      source: text(),
      name: k.toLowerCase(),
      value: v,
    }

    // because this was abused so much, many processors treat double-outer-braces as single
    if (unnestFields.includes(field.name) && Array.isArray(v) && v.length === 1 && v[0].kind === 'Block') {
      if (options.unnestMode === 'preserve') {
        v[0].case = 'preserve'
      } else {
        field.value = v[0].value
      }
    }

    return field
  }

FieldName
  = __ k:$[_:a-zA-Z0-9-]+ { return k; }

//----------------------- Value Descriptors

VerbatimFieldValue
  = '"' v:TextNoQuotes? '"' {
    v = v || {
      kind: 'Text',
      loc: location(),
      source: text(),
      value: '',
      mode: 'verbatim',
    }
    v.mode = 'verbatim'
    return basicTextConversions(v)
  }
  / '{' v:VerbatimText* '}' {
    return basicTextConversions({
      kind: 'Text',
      loc: location(),
      source: text(),
      value: v.join('').trim(),
      mode: 'verbatim',
    })
  }

VerbatimText
  = v:$[^{}]+ { return v }
  / '{' v:VerbatimText* '}' { return '{' + v.join('') + '}' }

FieldValue
  = Number
  / &{ return math.set(false) } v:(RegularValue / StringValue)* {
    return v.reduce((a, b) => a.concat(b), []);
  }

RegularValue
  = '"' v:(Block / Math / Command / TextNoQuotes)* '"' Concat? { return v; }
  / '{' v:(Block / Math / Command / Text)* '}' Concat? { return v; }
  / v:StringReference Concat? { return v; }

StringValue
  = v:StringReference Concat? { return v; }

//---------------------- Value Kinds

Text
  = v:[^\^_${}\\]+ {
    return basicTextConversions({
      kind: 'Text',
      loc: location(),
      source: text(),
      value: normalizeWhitespace(v),
      mode: math.on ? 'math' : 'text',
    })
  }

TextNoQuotes
  = v:[^\^_${}"\\]+ {
    return basicTextConversions({
      kind: 'Text',
      loc: location(),
      source: text(),
      value: normalizeWhitespace(v),
      mode: math.on ? 'math' : 'text',
    })
  }

Number
  = v:$[0-9]+ {
    return {
      kind: 'Number',
      loc: location(),
      source: text(),
      value: parseInt(v, 10),
    }
  }

StringReference
  = v:VariableName {
    return {
      kind: 'StringReference',
      loc: location(),
      source: text(),
      name: v,
    }
  }

Block
  = '{\\' mark:ExtendedDiacritic __ char:([a-zA-Z0-9] / '\\' [ij]) '}' {
    return {
      kind: 'DiacriticCommand',
      loc: location(),
      source: text(),
      mark: mark,
      dotless: !!char[1],
      character: char[1] || char[0],
    }
  }
  / '{' v:(Text / Command / Block / Math )* '}' {
    const block = {
      kind: 'Block',
      loc: location(),
      source: text(),
      value: v,
      markup: {},
      case: 'protect',
    }

    let cmd = v.length && v[0].kind.endsWith('Command') ? v[0] : null
    let cmdblock = cmd && cmd.kind === 'RegularCommand' && cmd.arguments.required.length && cmd.arguments.required[0] && cmd.arguments.required[0].kind === 'Block'

    // https://github.com/retorquere/zotero-better-bibtex/issues/541#issuecomment-240156274
    if (cmd) {
      delete block.case

      // command with a block cancels out case protection with containing block
      // if a smallcaps block has set case to 'preserve' we want to keep this
      if (cmdblock && cmdblock.case === 'protect') delete cmdblock.case

      // \sl, \it etc
      if (markup[cmd.command]) block.markup[markup[cmd.command]] = true
    }

    return block
  }

Math
  = &{ return !math.on } mode:('$' / '$$') &{ return math.set(true) } v:(Text / Command / Block )* ('$' / '$$') &{ return math.set(false) } {
    return {
      kind: mode == '$$' ? 'DisplayMath' : 'InlineMath',
      loc: location(),
      source: text(),
      value: v,
      case: 'protect',
      markup: {},
    }
  }

//---------------- Comments

LineComment
  = '%' __h v:$[^\r\n]+ EOL+ {
    return {
      kind: 'LineComment',
      loc: location(),
      source: text(),
      value: v,
    }
  }


//---------------------- LaTeX Commands

Command
  = ScriptCommand
  / DiacriticCommand
  / RegularCommand
  / SymbolCommand

ScriptCommand
  = mode:[_\^] &'{' v:RegularValue {
    return {
      kind: (mode === '_' ? 'Sub' : 'Super') + 'scriptCommand',
      loc: location(),
      source: text(),
      value: v
    }
  }
  / mode:[_\^] &'\\' v:Command {
    return {
      kind: (mode === '_' ? 'Sub' : 'Super') + 'scriptCommand',
      loc: location(),
      source: text(),
      value: v
    }
  }
  / mode:[_\^] v:. {
    return {
      kind: (mode === '_' ? 'Sub' : 'Super') + 'scriptCommand',
      loc: location(),
      source: text(),
      value: v
    }
  }

DiacriticCommand
  = '\\' mark:SimpleDiacritic __ char:([a-zA-Z0-9] / '\\' [ij]) {
    return {
      kind: 'DiacriticCommand',
      loc: location(),
      source: text(),
      mark: mark,
      dotless: !!char[1],
      character: char[1] || char[0],
    }
  }
  / '\\' mark:ExtendedDiacritic '{' char:([a-zA-Z0-9] / '\\' [ij]) '}' {
    return {
      kind: 'DiacriticCommand',
      loc: location(),
      source: text(),
      mark: mark,
      dotless: !!char[1],
      character: char[1] || char[0],
    }
  }

SymbolCommand
  = '\\' v:$[^A-Za-z0-9\t\r\n] {
    return {
      kind: 'SymbolCommand',
      loc: location(),
      source: text(),
      command: v,
    }
  }

RegularCommand
  = '\\' v:$[A-Za-z]+ &{ return verbatimCommands.includes(v) && (has_arguments[v] === 2) } optional:OptionalArgument* __h &'{' req1:VerbatimFieldValue req2:VerbatimFieldValue {
    return {
      kind: 'RegularCommand',
      loc: location(),
      source: text(),
      command: v,
      arguments: {
        optional: optional,
        required: [protect(req1), protect(req2)],
      },
    }
  }
  / '\\' v:$[A-Za-z]+ &{ return verbatimCommands.includes(v) && (has_arguments[v] === 1) } optional:OptionalArgument* __h &'{' req:VerbatimFieldValue {
    const cmd  = {
      kind: 'RegularCommand',
      loc: location(),
      source: text(),
      command: v,
      arguments: {
        optional: optional,
        required: [protect(req)],
      },
    }
    return cmd
  }
  / '\\' v:$[A-Za-z]+ &{ return (has_arguments[v] === 2) } optional:OptionalArgument* __h req1:RequiredArgument req2:RequiredArgument {
    return {
      kind: 'RegularCommand',
      loc: location(),
      source: text(),
      command: v,
      arguments: {
        optional: optional,
        required: [req1, req2],
      },
    }
  }
  / '\\' v:$[A-Za-z]+ &{ return (has_arguments[v] === 1) } optional:OptionalArgument* __h req:RequiredArgument {
    if (req.kind === 'Block') {
      switch (v) {
        case 'textsuperscript':
        case 'sp':
          req.markup.sup = true
          break
        case 'textsubscript':
        case 'sb':
          req.markup.sub = true
          break
        case 'textsc':
          req.markup.smallCaps = true
          break
        case 'enquote':
        case 'mkbibquote':
          req.markup.enquote = true
          break
        case 'textbf':
        case 'mkbibbold':
          req.markup.bold = true
          break
        case 'emph':
        case 'textit':
        case 'mkbibitalic':
        case 'mkbibemph':
          req.markup.italics = true
          break
        case 'section':
          req.markup.h1 = true
          break
        case 'subsection':
          req.markup.h2 = true
          break
      }
    }

    // ignore case stuff on bibcyr
    if (v === 'bibcyr') delete req.case

    return {
      kind: 'RegularCommand',
      loc: location(),
      source: text(),
      command: v,
      arguments: {
        optional: optional,
        required: [req],
      }
    }
  }
  / '\\' v:$[A-Za-z]+ optional:OptionalArgument* __ {
    return {
      kind: 'RegularCommand',
      loc: location(),
      source: text(),
      command: v,
      arguments: {
        optional: optional,
        required: [],
      }
    }
  }

OptionalArgument
  = '[' __h v:$[^\]]+ __h ']' {
    return basicTextConversions({
      kind: 'Text', // this isn't really correct but I don't need these right now
      loc: location(),
      source: text(),
      value: v,
      mode: math.on ? 'math' : 'text',
    })
  }

RequiredArgument
  = __h v:[^ \t\^_${}\\] {
    return basicTextConversions({
      kind: 'Text',
      loc: location(),
      source: text(),
      value: normalizeWhitespace([v]),
      mode: math.on ? 'math' : 'text',
    })
  }
  / v:(Command / Block) { return v }

//-------------- Helpers

VariableName
  = $([a-zA-Z-_][a-zA-Z0-9-&_:]*)

SimpleDiacritic
  = ['`"=~\^.]

ExtendedDiacritic
  = ['`"=~\^.cbuvdrHk]

FieldSeparator
  = __ '=' __

FieldTerminator
  = __ ','? __h (LineComment / EOL)*

Concat
  = __ '#' __

EOL
  = [\r\n]

_h "Mandatory Horizontal Whitespace"
  = [ \t]+

__h "Optional Horizontal Whitespace"
  = [ \t]*

_v "Mandatory Vertical Whitespace"
  = [\r\n]+

__v "Optional Vertical Whitespace"
  = [\r\n]*

_ "Mandatory Whitespace"
  = [ \t\n\r]+

__ "Optional Whitespace"
  = [ \t\n\r]*
