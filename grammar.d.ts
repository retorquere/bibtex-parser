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

interface LocationInfo {
  offset: number
  line: number
  column: number
}

interface Location {
  start: LocationInfo
  end: LocationInfo
}

export interface TextValue {
  kind: 'Text'
  loc?: Location
  source?: string
  value: string
  mode: 'text' | 'math' | 'verbatim'
}

export interface StringReference {
  kind: 'StringReference'
  loc: Location
  source: string
  name: string
}

export interface NumberValue {
  kind: 'Number'
  loc: Location
  source: string
  value: number
}

export type RequiredArgument = Block | Command | TextValue

export interface RegularCommand {
  kind: 'RegularCommand'
  loc: Location
  source: string
  command: string
  arguments: {
    optional: TextValue[]
    required: RequiredArgument[]
  }
}

export interface SubscriptCommand {
  kind: 'SubscriptCommand'
  loc: Location
  source: string
  value: string
}

export interface SuperscriptCommand {
  kind: 'SuperscriptCommand'
  loc: Location
  source: string
  value: string
}

export interface SymbolCommand {
  kind: 'SymbolCommand'
  loc: Location
  source: string
  command: string
}

export interface DiacriticCommand {
  kind: 'DiacriticCommand'
  loc: Location
  source: string
  mark: string
  character: string
  dotless: boolean
}

export interface Math {
  kind: 'InlineMath' | 'DisplayMath'
  loc?: Location
  source?: string
  value: ValueType[]
  case?: 'protect' | 'preserve'
}

export interface Environment {
  kind: 'Environment'
  loc?: Location
  source?: string
  value: ValueType[]
  env: string
}

export interface Block {
  kind: 'Block'
  loc?: Location
  source?: string
  value: ValueType[]

  case?: 'protect' | 'preserve'
  markup: {
    sub?: boolean
    sup?: boolean
    bold?: boolean
    italics?: boolean
    smallCaps?: boolean
    enquote?: boolean
  }
}

export interface Field {
  kind: 'Field'
  loc: Location
  source: string
  name: string
  value: ValueType[]
}

export interface Entry {
  kind: 'Entry'
  id: string
  type: string
  loc: Location
  source: string
  fields: Field[]
}

export interface PreambleExpression {
  kind: 'PreambleExpression'
  loc: Location
  source: string
  value: ValueType[]
}

export interface StringDeclaration {
  kind: 'StringDeclaration'
  loc: Location
  source: string
  name: string
  value: ValueType[]
}

export interface BracedComment {
  kind: 'BracedComment'
  loc: Location
  source: string
  value: string
}

export interface LineComment {
  kind: 'LineComment'
  loc: Location
  source: string
  value: string
}

export interface NonEntryText {
  kind: 'NonEntryText'
  loc: Location
  source: string
  value: string
}

export type Comment = BracedComment | LineComment | NonEntryText

export type Command = RegularCommand | SymbolCommand | DiacriticCommand | SubscriptCommand | SuperscriptCommand

export type ValueType = TextValue | StringReference | Block | Environment | Math | NumberValue | Command

export type Children = Entry | PreambleExpression | StringDeclaration | Comment

export type Node = Comment | PreambleExpression | StringDeclaration | Entry

export interface Bibliography {
  kind: 'Bibliography'
  loc: Location
  source: string
  children: Children[]
}

export interface ParseOptions {
  verbatimFields?: Array<string | RegExp>
  verbatimCommands?: string[]
  unnestFields?: string[]
  combiningDiacritics?: string[]
}

export function parse(input: string, options?: ParseOptions): Bibliography
