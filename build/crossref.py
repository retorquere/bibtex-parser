#!/usr/bin/env python3

import xml.etree.ElementTree as ET
import json

crossref = {}
tree = ET.parse('biber/data/biber-tool.conf')
for inherit in tree.getroot().findall('.//inherit'):
  for type_pair in inherit.findall('.//type_pair'):
    type_source = type_pair.attrib['source']
    type_target = type_pair.attrib['target']
    if not type_target in crossref:
      crossref[type_target] = {}
    if not type_source in crossref[type_target]:
      crossref[type_target][type_source] = {}

    for field in inherit.findall('.//field'):
      field_source = field.attrib['source']
      field_target = field.attrib['target']
      crossref[type_target][type_source][field_target] = field_source

with open('crossref.json', 'w') as f:
  json.dump(crossref, f, indent='  ')
