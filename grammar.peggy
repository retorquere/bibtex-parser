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
    texttt: 'fixedWidth',
    rm: 'roman',
    sf: 'sansSerif',
    verb: 'verbatim',
  }

  const unnestFields = (options.unnestFields || []).map(field => field.toLowerCase())
  const verbatimFields = (options.verbatimFields || [ 'urlraw', 'url', 'doi', 'file', 'files', 'eprint', 'verba', 'verbb', 'verbc' ]).map(field => typeof field === 'string' ? field.toLowerCase() : field)
  const verbatimCommands = (options.verbatimCommands || [ 'texttt', 'url' ])

  function isVerbatimField(name) {
    return verbatimFields.find(p => (typeof p === 'string') ? name === p : name.match(p))
  }

  function normalizeWhitespace(textArr) {
    if (typeof textArr === 'string') textArr = Array.from(textArr)

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
    citeauthor: 1,
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
    newcommand: 2,
    noopsort: 1,
    ocirc: 1,
    section: 1,
    sb: 1,
    sp: 1,
    subsection: 1,
    subsubsection: 1,
    subsubsubsection: 1,
    t: 1,
    textbf: 1,
    textcite: 1,
    textit: 1,
    textrm: 1,
    textsc: 1,
    textsubscript: 1,
    textsuperscript: 1,
    textup: 1,
    texttt: 1,
    url: 1,
    vphantom: 1,
    vspace: 1,
  }

  if (options.combining) {
    for (const cmd of options.combining) {
      has_arguments[cmd] = 1
    }
  }

  function say() {
    console.log(JSON.stringify(Array.from(arguments), null, 2))
    return true
  }

  function peek(n) {
    return input.substr(peg$savedPos, n)
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
    let source
    if (Array.isArray(v)) {
      source = v.map(e => e.source).join('')
    } else {
      v = [ v ]
      source = v.source
    }

    return {
      kind: 'Block',
      value: v,
      markup: {},
      case: 'protect',
      source: source,
    }
  }

  function handle_markup_switches(block) {
    const value = block.value
    if (!Array.isArray(value)) return block

    block.value = []

    const pseudo = {
      block: null,
      markup: {},
    }
    function pseudo_block() {
      pseudo.block = {
        kind: 'Block',
        loc: location(),
        source: '',
        value: [],
        markup: JSON.parse(JSON.stringify(pseudo.markup)),
        pseudo: true,
      }
      block.value.push(pseudo.block)
    }
    for (const node of value) {
      if (node.kind === 'Environment' || node.kind === 'Block') {
        block.value.push(node)

        if (Object.keys(pseudo.markup).length) {
          pseudo_block()
        } else {
          pseudo.block = null
        }
        continue
      }

      if (node.kind === 'RegularCommand' && markup[node.command]) {
        if (pseudo.markup.italics) { // https://github.com/citation-js/bibtex-parser-experiments/commit/cae475f075a05d1c074485a061b08ed245170c7e
          delete pseudo.markup.italics
          if (markup[node.command] !== 'italics') pseudo.markup[markup[node.command]] = true
        } else {
          pseudo.markup[markup[node.command]] = true
        }

        if (Object.keys(pseudo.markup).length) {
          pseudo_block()
        } else {
           pseudo.block = null
        }
      }

      if (pseudo.block) {
        pseudo.block.source += node.source
        pseudo.block.value.push(node)

      } else {
        block.value.push(node)

      }
    }

    block.value = block.value.filter(node => !(node.pseudo && node.value.length === 0))

    return block
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
  = '@' __ type:$[_A-Za-z]+ __ [({] __ id:EntryId? __ fields:Field* __ [})] __ {
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
  = '@' __ 'preamble'i __ opener:[({] __ v:(Environment / Block / Math / Command / Text)* __ closer:[})] __ {
    switch (opener + closer) {
      case '{}':
      case '()':
        break
      default:
        throw new Error(`Unbalanced opener-closer for preamble: ${opener}...${closer}`)
        break
    }
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
  = name:FieldName &{ return isVerbatimField(name) && unnestFields.includes(name) } FieldSeparator '{' &'{' value:VerbatimFieldValue '}' FieldTerminator* {
    // because this was abused so much, many processors treat double-outer-braces as single
    return {
      kind: 'Field',
      loc: location(),
      source: text(),
      name: name,
      loc: location(),
      value: [ protect(value) ]
    }
  }
  / name:FieldName &{ return isVerbatimField(name) } FieldSeparator value:VerbatimFieldValue FieldTerminator* {
    return {
      kind: 'Field',
      loc: location(),
      source: text(),
      name: name,
      loc: location(),
      value: [ protect(value) ]
    }
  }
  / name:FieldName FieldSeparator value:FieldValue FieldTerminator* {
    // because this was abused so much, many processors treat double-outer-braces as single
    if (unnestFields.includes(name) && Array.isArray(value) && value.length === 1 && value[0].kind === 'Block') {
      if (options.unnestMode === 'preserve') {
        value[0].case = 'preserve'
      } else {
        value = value[0].value
      }
    }

    return handle_markup_switches({
      kind: 'Field',
      loc: location(),
      source: text(),
      name: name,
      value: value,
    })
  }

FieldName
  = __ name:$[0-9A-Za-z!$&*+\-./:;<>?@[\\\]^_`|~]+ { return name.toLowerCase() }

//----------------------- Value Descriptors

VerbatimFieldValue
  = '"' v:VerbatimString? '"' {
    return basicTextConversions({
      kind: 'Text',
      loc: location(),
      source: text(),
      value: v || '',
      mode: 'verbatim',
    })
  }
  / '{' v:VerbatimText* '}' {
    return basicTextConversions({
      kind: 'Text',
      loc: location(),
      source: text(),
      value: v.join(''),
      mode: 'verbatim',
    })
  }

VerbatimText
  = v:$[^{}]+ { return v }
  / '{' v:$VerbatimText* '}' { return '{' + v + '}' }

VerbatimString
  = v:$[^{}"]+ { return v }
  / '{' v:$VerbatimString* '}' { return '{' + v + '}' }

FieldValue
  = Number
  / &{ return math.set(false) } v:(RegularValue / StringValue)* {
    return v.reduce((a, b) => a.concat(b), []);
  }

RegularValue
  = '"' v:(Environment / Block / Math / Command / TextNoQuotes)* '"' Concat? { return v; }
  / '{\\verb' ![a-zA-Z] v:VerbatimText* '}' Concat? {
    return basicTextConversions({
      kind: 'Text',
      loc: location(),
      source: text(),
      value: v.join('').trim(),
      mode: 'verbatim',
    })
  }
  / '{' v:(Environment / Block / Math / Command / Text)* '}' Concat? { return v; }
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

Environment
  = '\\begin{' env:$[a-zA-Z0-9]+ '}' v:(Environment / Block / Command / Math / Text )* '\\end{' cenv:$[a-zA-Z0-9]+ '}' &{ return env === cenv } {
    if (markup[env]) {
      return {
        kind: 'Block',
        loc: location(),
        source: text(),
        value: v,
        markup: { [markup[env]]: true },
      }
    } else {
      return {
        kind: 'Environment',
        loc: location(),
        source: text(),
        value: v,
        env: env,
      }
    }
  }

Block
  = '{\\' mark:ExtendedDiacritic __ chr:([a-zA-Z0-9] / '\\' [ij]) '}' {
    return {
      kind: 'DiacriticCommand',
      loc: location(),
      source: text(),
      mark: mark,
      dotless: !!chr[1],
      character: chr[1] || chr[0],
    }
  }
  / '{\\verb' ![a-zA-Z] v:VerbatimText* '}' {
      return basicTextConversions({
        kind: 'Text',
        loc: location(),
        source: text(),
        value: v.join('').trim(),
        mode: 'verbatim',
      })
  }
  / '{' v:(Environment / Block / Command / Math / Text)* '}' {
    const block = {
      kind: 'Block',
      loc: location(),
      source: text(),
      value: v,
      markup: {},
      case: 'protect',
    }

    let leadingcmd = block.value.length && (block.value[0].kind.endsWith('Command') || block.value[0].kind === 'Environment') ? block.value[0] : null
    let leadingcmdblockarg = leadingcmd
      && leadingcmd.kind === 'RegularCommand'
      && leadingcmd.arguments.required.length
      && leadingcmd.arguments.required[0].kind === 'Block'
      && leadingcmd.arguments.required[0]

    // https://github.com/retorquere/zotero-better-bibtex/issues/541#issuecomment-240156274
    if (leadingcmd) {
      delete block.case

      // command with a block cancels out case protection with containing block
      // if a smallcaps block has set case to 'preserve' we want to keep this
      if (leadingcmdblockarg && leadingcmdblockarg.case === 'protect') delete leadingcmdblockarg.case

      // \sl, \it etc
      if (markup[leadingcmd.command] && leadingcmd.arguments.required.length === 0) {
        block.markup[markup[leadingcmd.command]] = true
        block.value.shift()
      }
    }

    return handle_markup_switches(block)
  }

Math
  = &{ return !math.on } mode:('$' / '$$' / '\\[') &{ return math.set(true) } v:(Block / Command / Text)* ('$' / '$$' / '\\]') &{ return math.set(false) } {
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
  / LineBreak
  / ParBreak
  / DiacriticCommand
  / RegularCommand
  / SymbolCommand
  / InvalidCommand // *must* be last; https://github.com/retorquere/zotero-better-bibtex/issues/2771

LineBreak
  = __ '\\\\' __ {
    return {
      kind: 'RegularCommand',
      loc: location(),
      source: text(),
      command: '\\',
      arguments: {
        optional: [],
        required: [],
      },
    }
  }

ParBreak
  = __h '\r'? '\n' __h '\r'? '\n' __ {
    return {
      kind: 'RegularCommand',
      loc: location(),
      source: text(),
      command: 'par',
      arguments: {
        optional: [],
        required: [],
      },
    }
  }

ScriptCommand
  = mode:[_\^] __h v:Argument {
    if (v.kind === 'Block') v = v.value

    return {
      kind: mode === '_' ? 'SubscriptCommand' : 'SuperscriptCommand',
      loc: location(),
      source: text(),
      value: v,
    }
  }

DiacriticCommand
  = '\\' mark:SimpleDiacritic __ chr:([a-zA-Z0-9] / '\\' [ij]) {
    return {
      kind: 'DiacriticCommand',
      loc: location(),
      source: text(),
      mark: mark,
      dotless: !!chr[1],
      character: chr[1] || chr[0],
    }
  }
  / '\\' mark:ExtendedDiacritic '{' chr:([a-zA-Z0-9] / '\\' [ij]) '}' {
    return {
      kind: 'DiacriticCommand',
      loc: location(),
      source: text(),
      mark: mark,
      dotless: !!chr[1],
      character: chr[1] || chr[0],
    }
  }
  / '\\' mark:ExtendedDiacritic &'{' v:RegularValue {
    return {
      kind: 'RegularCommand',
      loc: location(),
      source: text(),
      command: mark,
      arguments: {
        optional: [],
        required: [ protect(v) ],
      },
    }
  }

SymbolCommand
  = '\\' v:$[^A-Za-z0-9\[\]\t\r\n] {
    return {
      kind: 'SymbolCommand',
      loc: location(),
      source: text(),
      command: v,
    }
  }

RegularCommand
  = '\\' cmd:'newcommand' name:Block &{ return name.value.length == 1 && name.value[0].kind === 'RegularCommand' } optional:OptionalArgument* def:Argument {
    return {
      kind: 'RegularCommand',
      loc: location(),
      source: text(),
      command: cmd,
      arguments: {
        optional: [],
        required: [name, def],
      },
    }
  }
  / '\\' cmd:'url' __h &'{' url:VerbatimFieldValue {
    // https://github.com/retorquere/zotero-better-bibtex/issues/2617
    url.value = url.value.replace(/\\([\#%])/g, '$1')
    return {
      kind: 'RegularCommand',
      loc: location(),
      source: text(),
      command: cmd,
      arguments: {
        optional: [],
        required: [url],
      },
    }
  }
  / '\\' cmd:'href' __h &'{' url:VerbatimFieldValue label:Argument {
    // https://github.com/retorquere/zotero-better-bibtex/issues/2617
    url.value = url.value.replace(/\\([\#%])/g, '$1')
    return {
      kind: 'RegularCommand',
      loc: location(),
      source: text(),
      command: cmd,
      arguments: {
        optional: [],
        required: [url, label],
      },
    }
  }
  / '\\' !'begin' !'end' cmd:$[A-Za-z]+ &{ return verbatimCommands.includes(cmd) && (has_arguments[cmd] === 2) } optional:OptionalArgument* __h &'{' req1:VerbatimFieldValue req2:VerbatimFieldValue {
    return {
      kind: 'RegularCommand',
      loc: location(),
      source: text(),
      command: cmd,
      arguments: {
        optional: optional,
        required: [protect(req1), protect(req2)],
      },
    }
  }
  / '\\' !'begin' !'end' cmd:$[A-Za-z]+ &{ return verbatimCommands.includes(cmd) && (has_arguments[cmd] === 1) } optional:OptionalArgument* __h &'{' req:VerbatimFieldValue {
    return {
      kind: 'RegularCommand',
      loc: location(),
      source: text(),
      command: cmd,
      arguments: {
        optional: optional,
        required: [protect(req)],
      },
    }
  }
  / '\\' !'begin' !'end' cmd:$[A-Za-z]+ &{ return (has_arguments[cmd] === 2) } optional:OptionalArgument* __h req1:Argument req2:Argument {
    return {
      kind: 'RegularCommand',
      loc: location(),
      source: text(),
      command: cmd,
      arguments: {
        optional: optional,
        required: [req1, req2],
      },
    }
  }
  / '\\' !'begin' !'end' cmd:$[A-Za-z]+ &{ return (has_arguments[cmd] === 1) } optional:OptionalArgument* __h req:Argument {
    let m
    if (req.kind === 'Block') {
      switch (cmd) {
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
        default:
          if (m = cmd.match(/^((sub)*)section$/)) {
            req.markup[`h${(m[1].length / 3) + 1}`] = true
          }
      }
    }

    // ignore case stuff on bibcyr
    if (cmd === 'bibcyr') delete req.case

    return {
      kind: 'RegularCommand',
      loc: location(),
      source: text(),
      command: cmd,
      arguments: {
        optional: optional,
        required: [req],
      }
    }
  }
  / '\\' !'begin' !'end' cmd:$[A-Za-z]+ optional:OptionalArgument* __ {
    return {
      kind: 'RegularCommand',
      loc: location(),
      source: text(),
      command: cmd,
      arguments: {
        optional: optional,
        required: [],
      }
    }
  }

InvalidCommand
  = '\\' !'begin' !'end' char:[0-9] __ {
    return basicTextConversions({
      kind: 'Text',
      loc: location(),
      source: text(),
      value: char,
      mode: math.on ? 'math' : 'text',
    })
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

Argument
  = __h v:[^ \t\^_${}\\] {
    return basicTextConversions({
      kind: 'Text',
      loc: location(),
      source: text(),
      value: normalizeWhitespace([v]),
      mode: math.on ? 'math' : 'text',
    })
  }
  / __h v:(Block / Command) { return v }

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
  = _
  / ','
  / LineComment

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
