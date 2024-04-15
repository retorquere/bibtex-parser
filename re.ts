export type CharCategory =  {
  name: string
  alias: string
  isBmpLast: boolean
  bmp: string
}

export function match(cats: CharCategory[], extra?: string, neg=false): string {
  return `[${neg ? '^' : ''}${cats.map(cat => cat.bmp).join('')}${extra || ''}]`
}

export const categories: CharCategory[] = require('xregexp/tools/output/categories')
