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
  const verbatim = {
    active: 0,
    property: null,
    closer: null,
    
    verbatimProperties: options.verbatimProperties ? options.verbatimProperties.map(prop => prop.toLowerCase()) : [
      'url',
      'doi',
      'file',
      'eprint',
      'verba',
      'verbb',
      'verbc',
    ],
    verbatimCommands: options.verbatimCommands || [ 'url' ],

    verbatimProperty: function(prop) {
      return this.verbatimProperties.includes(prop.toLowerCase())
    },
    enterProperty: function(closer) {
      if (!this.property || !this.verbatimProperty(this.property)) return true;
      this.property = null;
      this.active = 1;
      this.closer = closer;
      return true;
    },
    leaveProperty: function() {
      this.active = 0;
      this.closer = ''
      this.property = ''
      return true;
    },

    verbatimCommand: function(cmd) {
      return this.verbatimCommands.includes(cmd)
    },
    enterCommand: function(cmd) {
      if (this.verbatimCommand(cmd)) this.active++;
      return true;
    },
    leaveCommand: function(cmd) {
      if (this.verbatimCommand(cmd)) this.active--;
      if (this.active < 0) this.active = 0;
      return true;
    },
  }

  const mode = {
    mode: 'text',

    to: function(newMode) {
      if (this.mode === newMode) return false
      this.mode = newMode
      return true
    },

    convert: function (text) {
      if (verbatim.active) {
        return text

      } else if (this.mode === 'text') {
        return text
          .replace(/---/g, '\u2014')
          .replace(/--/g, '\u2013')
          .replace(/</g, '\u00A1')
          .replace(/>/g, '\u00BF')
          .replace(/~/g, '\u00A0')

      } else {
        return text.replace(/~/g, '\u00A0')

      }
    }
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
    bibcyr: 1,
    bibstring: 1,
    chsf: 1,
    cite: 1,
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
}

File
  = __ r:Node* __ {
    return {
      kind: 'File',
      loc: location(),
      source: text(),
      children: r,
    }
  }

Comment
  = '@comment'i __h v:BracedComment {
    return {
      kind: 'BracedComment',
      loc: location(),
      source: text(),
      value: v.slice(1, -1),
    }
  }
  / '@comment'i __h v:[^\n\r]* [\n\r]* {
    return {
      kind: 'LineComment',
      loc: location(),
      source: text(),
      value: mode.convert(normalizeWhitespace(v)),
    }
    }
  / v:([^@] [^\n\r]*) [\n\r]* {
    return {
      kind: 'NonEntryText',
      loc: location(),
      source: text(),
      value: mode.convert(normalizeWhitespace(v)),
    }
  }

Node
  = n:(Comment / PreambleExpression / StringExpression / Entry) { return n; }

BracedComment
  = '{' comment:( [^{}] / BracedComment )* '}' { return '{' + comment.join('') + '}' }

//-----------------  Top-level Nodes

Entry
  = '@' type:$[A-Za-z]+ __ [({] __ id:EntryId? __ props:Property* __ [})] __ {
    return {
      kind: 'Entry',
      id: id || '',
      type: type.toLowerCase(),
      loc: location(),
      source: text(),
      properties: props,
    }
  }

PreambleExpression
  = '@preamble'i __ [({] __ v:RegularValue* __ [})] __ {
    return {
      kind: 'PreambleExpression',
      loc: location(),
      source: text(),
      value: v.reduce((a, b) => a.concat(b), []),
    }
  }

StringExpression
  = '@string'i __ [({] __ k:VariableName PropertySeparator v:RegularValue+ __ [})] __ {
    return {
      kind: 'StringExpression',
      loc: location(),
      source: text(),
      key: k,
      value: v.reduce((a, b) => a.concat(b), []),
    }
  }

//------------------ Entry Child Nodes

EntryId
  = __ id:$[^ \t\r\n,]* __ ',' { return id; }

Property
  = k:PropertyKey PropertySeparator &{ verbatim.property = k; return true } v:PropertyValue &{ return verbatim.leaveProperty() } PropertyTerminator {
    return {
      kind: 'Property',
      loc: location(),
      source: text(),
      key: k.toLowerCase(),
      value: v,
    }
  }

PropertyKey
  = __ k:$[_:a-zA-Z0-9-]+ { return k; }

//----------------------- Value Descriptors

PropertyValue
  = Number
  / v:(RegularValue / StringValue)* {
    return v.reduce((a, b) => a.concat(b), []);
  }

RegularValue
  = '"' &{ return verbatim.enterProperty('"') } v:(NestedLiteral / VerbatimText / Command / TextNoQuotes)* '"' Concat? { return v; }
  / '{' &{ return verbatim.enterProperty('{}') }v:(NestedLiteral / VerbatimText / Command / Text)* '}' Concat? { return v; }

StringValue
  = v:String Concat? { return v; }

//---------------------- Value Kinds

VerbatimText
  = &{ return verbatim.active && verbatim.closer === '"' } v:[^"]+ {
    return {
      kind: 'Text',
      loc: location(),
      source: text(),
      value: mode.convert(normalizeWhitespace(v)),
    }
  }
  / &{ return verbatim.active && verbatim.closer === '{}' } v:[^{}]+ {
    return {
      kind: 'Text',
      loc: location(),
      source: text(),
      value: mode.convert(normalizeWhitespace(v)),
    }
  }

Text
  = v:[^\^_${}\\]+ {
    return {
      kind: 'Text',
      loc: location(),
      source: text(),
      value: mode.convert(normalizeWhitespace(v)),
    }
  }

TextNoQuotes
  = v:[^\^_${}"\\]+ {
    return {
      kind: 'Text',
      loc: location(),
      source: text(),
      value: mode.convert(normalizeWhitespace(v)),
    }
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

String
  = v:VariableName {
    return {
      kind: 'String',
      loc: location(),
      source: text(),
      value: v,
    }
  }

NestedLiteral
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
  / '{' v:(VerbatimText / Text / Command / NestedLiteral )* '}' {
    return {
      kind: 'NestedLiteral',
      loc: location(),
      source: text(),
      value: v,
    }
  }
  / '$$' &{ return mode.to('math') } v:(VerbatimText / Text / Command / NestedLiteral )* &{ return mode.to('text') } '$$' {
    return {
      kind: 'DisplayMath',
      loc: location(),
      source: text(),
      value: v,
    }
  }
  / '$' &{ return mode.to('math') } v:(VerbatimText / Text / Command / NestedLiteral )* &{ return mode.to('text') } '$' {
    return {
      kind: 'InlineMath',
      loc: location(),
      source: text(),
      value: v,
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
      value: v,
    }
  }

RegularCommand
  = '\\' v:$[A-Za-z]+ &{ return (has_arguments[v] === 2) && verbatim.enterCommand(v) } optional:OptionalArgument* req1:RequiredArgument req2:RequiredArgument &{ return verbatim.leaveCommand(v) } {
    return {
      kind: 'RegularCommand',
      loc: location(),
      source: text(),
      value: v,
      arguments: {
        optional: optional,
        required: [req1, req2],
      },
    }
  }
  / '\\' v:$[A-Za-z]+ &{ return (has_arguments[v] === 1) && verbatim.enterCommand(v) } optional:OptionalArgument* req:RequiredArgument &{ return verbatim.leaveCommand(v) } {
    return {
      kind: 'RegularCommand',
      loc: location(),
      source: text(),
      value: v,
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
      value: v,
      arguments: {
        optional: optional,
        required: [],
      }
    }
  }

Argument
  = RequiredArgument
  / OptionalArgument

OptionalArgument
  = '[' __h v:$[^\]]+ __h ']' {
    return {
      kind: 'Text', // this isn't really correct but I don't need these right now
      loc: location(),
      source: text(),
      value: v,
    }
  }

RequiredArgument
  = __h v:[^ \t\^_${}\\]+ {
    return {
      kind: 'Text',
      loc: location(),
      source: text(),
      value: mode.convert(normalizeWhitespace(v)),
    }
  }
  / v:(Command / NestedLiteral) { return v }

//-------------- Helpers

VariableName
  = $([a-zA-Z-_][a-zA-Z0-9-&_:]*)

SimpleDiacritic
  = ['`"=~\^.]

ExtendedDiacritic
  = ['`"=~\^.cbuvdrHk]

PropertySeparator
  = __ '=' __

PropertyTerminator
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
