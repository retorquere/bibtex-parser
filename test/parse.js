const fs = require('fs')
const path = require('path')
const bibtex = require('../index')

module.exports = function parse(bibfile, options) {
  const input = fs.readFileSync(bibfile, 'utf-8')

  if (path.basename(bibfile) === 'long.bib') {
    options.errorHandler = function(e) {
      if (e.name === 'TeXError') return // ignore TeX
      throw e
    }
  }

  const unknown = [
    'web_page and other mendeley idiocy.bib',
    'unknown command handler #1733.bib',
  ]

  if (unknown.includes(path.basename(bibfile))) {
    options.unknownCommandHandler = false
  }

  if (options.unabbreviations) {
    options.unabbreviate = require(options.unabbreviations)
    options.strings = fs.readFileSync(options.strings, 'utf-8')
  }
  else {
    delete options.unabbrevations
    delete options.strings
  }

  return bibtex.parse(input, options)
}
