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

  return bibtex.parse(input, options)
}
