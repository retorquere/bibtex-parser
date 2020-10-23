**[@retorquere/bibtex-parser](README.md)**

> [Globals](globals.md)

# bibtex-parser

A node/npm package for parsing bibtex (.bib) files. This is the parser that drives [Better BibTeX for Zotero](https://retorque.re/zotero-better-bibtex/) bib(la)tex imports.

While parsing, the parser will apply markup for commands such as `\textbf`, `\textsc`, etc, and braces wich protect text against case-changes. Commands will be replaced with their unicode text equivalents where possible.

## What is BibTeX?

BibTeX is a reference management program that makes it easy for users of TeX and LaTeX to generate bibliographies for books and journal articles. When possible, it is usually stylized in the TeX font the way TeX and LaTeX are. LaTeX was first created in 1985 by Leslie Lamport and Oren Patashnik.

Documenation is available at [http://retorque.re/bibtex-parser/](http://retorque.re/bibtex-parser/).
