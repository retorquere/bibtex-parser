#!/usr/bin/env python3

import json
import glob

import xml.etree.ElementTree as ET
namespaces = {'bcf': 'https://sourceforge.net/projects/biblatex'}

crossref = {}
for bcf in glob.glob('biber/t/tdata/*.bcf'):
  print(bcf)
  tree = ET.parse(bcf)
  for inherit in tree.getroot().findall('.//bcf:inherit', namespaces=namespaces):
    for type_pair in inherit.findall('.//bcf:type_pair', namespaces=namespaces):
      type_source = type_pair.attrib['source']
      type_target = type_pair.attrib['target']
      if not type_target in crossref:
        crossref[type_target] = {}
      if not type_source in crossref[type_target]:
        crossref[type_target][type_source] = {}

      for field in inherit.findall('.//bcf:field', namespaces=namespaces):
        if field.attrib.get('skip', False):
          continue
        field_source = field.attrib['source']
        field_target = field.attrib['target']
        crossref[type_target][type_source][field_target] = field_source

with open('crossref.json', 'w') as f:
  json.dump(crossref, f, indent='  ', sort_keys=True)

allowed = {}
tree = ET.parse('biber/data/biber-tool.conf')
root = tree.getroot()
for entrytype in root.findall('.//entrytypes/entrytype'):
  allowed[entrytype.text] = []
# just to be sure
for entrytype in root.findall('.//entryfields/entrytype'):
  allowed[entrytype.text] = []

for entryfields in root.findall('.//entryfields'):
  entrytypes = [entrytype.text for entrytype in entryfields.findall('./entrytype')]
  entryfields = [entryfield.text for entryfield in entryfields.findall('./field')]
  if len(entrytypes) == 0:
    entrytypes = list(allowed.keys())
  for entrytype in entrytypes:
    for entryfield in entryfields:
      allowed[entrytype].append(entryfield)

for entrytype in allowed.keys():
  allowed[entrytype] = sorted(list(set(allowed[entrytype])))

with open('fields.json', 'w') as f:
  json.dump(allowed, f, indent='  ', sort_keys=True)
