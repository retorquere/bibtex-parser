#!/usr/bin/env python3

import json
import glob
from collections import defaultdict

import xml.etree.ElementTree as ET

namespaces = {'bcf': 'https://sourceforge.net/projects/biblatex'}
tool_root = ET.parse('submodules/biber/data/biber-tool.conf').getroot()

# ── 1. Crossref field remappings ──────────────────────────────────────────────
# Primary source: biber-tool.conf's <inheritance> section (canonical).
# Supplementary: BCF test files fill in cross-family rules that biber-tool.conf
# omits (e.g. mvcollection↔mvreference, collection↔reference siblings).
# Only true remappings (source field name ≠ target) are stored; same-name
# inheritance is handled by the allowed-fields loop in index.ts.
# A sentinel "* → * → {}" entry ensures that loop always fires for every
# crossref parent-child pair regardless of entry type.

crossref = defaultdict(lambda: defaultdict(dict))

for inherit in tool_root.findall('.//inheritance/inherit'):
  for type_pair in inherit.findall('./type_pair'):
    src = type_pair.attrib['source']
    tgt = type_pair.attrib['target']
    for field in inherit.findall('./field'):
      if field.attrib.get('skip', 'false') == 'true':
        continue
      fsrc = field.attrib['source']
      ftgt = field.attrib['target']
      if fsrc != ftgt:  # only true remappings
        crossref[tgt][src][ftgt] = fsrc

# Supplement with remappings from BCF test files that biber-tool.conf does not
# define.  biber-tool.conf takes precedence: we only add a BCF mapping when the
# slot is not already filled.
for bcf in glob.glob('submodules/biber/t/tdata/*.bcf'):
  tree = ET.parse(bcf)
  for inherit in tree.getroot().findall('.//bcf:inherit', namespaces=namespaces):
    for type_pair in inherit.findall('.//bcf:type_pair', namespaces=namespaces):
      src = type_pair.attrib['source']
      tgt = type_pair.attrib['target']
      if src == '*' and tgt == '*':
        continue
      for field in inherit.findall('.//bcf:field', namespaces=namespaces):
        if field.attrib.get('skip') == 'true':
          continue
        fsrc = field.attrib.get('source', '')
        ftgt = field.attrib.get('target', '')
        if fsrc and ftgt and fsrc != ftgt and ftgt not in crossref[tgt][src]:
          crossref[tgt][src][ftgt] = fsrc

# Sentinel: ensures the same-name inheritance loop in index.ts fires for every
# crossref pair, even when no explicit type-specific mapping exists.
crossref['*']['*']  # touch to create the empty dict via defaultdict

#crossref_out = {k: dict(v) for k, v in crossref.items()}
with open('crossref.ts', 'w') as f:
  print(f'export const crossref: Record<string, Record<string, Record<string, string>>> = {json.dumps(crossref, indent="  ", sort_keys=True)} as const\n', file=f)
with open('data/crossref.json', 'w') as f:
  print(json.dumps(crossref, indent='  ', sort_keys=True), file=f)

# ── 2. Allowed fields per entry type ──────────────────────────────────────────
# Date-type fields (date, eventdate, origdate, urldate) are valid BibTeX input
# fields (e.g. date={2023-01-15}) but carry skip_output="true" in the biber
# datamodel and therefore do not appear in any <entryfields> section.  We add
# them explicitly to the global (no-entrytype) field list so every entry type
# allows them.

allowed = {}
for entrytype in tool_root.findall('.//entrytypes/entrytype'):
  allowed[entrytype.text] = []
for entrytype in tool_root.findall('.//entryfields/entrytype'):
  allowed[entrytype.text] = []

date_fields = [
  f.text for f in tool_root.findall('.//fields/field')
  if f.attrib.get('datatype') == 'date'
]

for entryfields in tool_root.findall('.//entryfields'):
  entrytypes = [et.text for et in entryfields.findall('./entrytype')]
  fields = [f.text for f in entryfields.findall('./field')]
  if not entrytypes:
    # Global section (no entrytype child): also inject date-type fields.
    fields = fields + date_fields
    entrytypes = list(allowed.keys())
  for entrytype in entrytypes:
    allowed[entrytype].extend(fields)

for entrytype in allowed:
  allowed[entrytype] = sorted(set(allowed[entrytype]))

# ── 3. Suppression rules: fields never inherited via crossref ─────────────────
# Extracted from the globally-applicable (source="*" target="*") skip rules that
# appear consistently across all biber BCF test files.  xdata is added
# explicitly: it is an entrykey field that biber resolves before the crossref
# inheritance step, so it is never truly "inherited".

no_crossref_set = set()
for bcf in glob.glob('submodules/biber/t/tdata/*.bcf'):
  try:
    tree = ET.parse(bcf)
    for inherit in tree.getroot().findall('.//bcf:inherit', namespaces=namespaces):
      pairs = [
        (tp.attrib['source'], tp.attrib['target'])
        for tp in inherit.findall('.//bcf:type_pair', namespaces=namespaces)
      ]
      if ('*', '*') in pairs:
        for field in inherit.findall('.//bcf:field', namespaces=namespaces):
          if field.attrib.get('skip') == 'true':
            src = field.attrib.get('source', '')
            if src:
              no_crossref_set.add(src)
  except Exception:
    pass

no_crossref_set.add('xdata')
no_crossref = sorted(no_crossref_set)

with open('fields.ts', 'w') as f:
  print(f'export const allowed: Record<string, string[]> = {json.dumps(allowed, indent="  ", sort_keys=True)} as const\n', file=f)
  print(f'export const noCrossRef: string[] = {json.dumps(no_crossref, indent="  ", sort_keys=True)} as const\n', file=f)
with open('data/fields.json', 'w') as f:
  print(json.dumps({'allowed': allowed, 'noCrossRef': no_crossref}, indent='  ', sort_keys=True), file=f)
