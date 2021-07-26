#!/usr/bin/env python3

import json
from pathlib import Path
import re
import urllib.request

def unthe(j):
  for prefix in ['the ', 'la ']:
    if j.startswith(prefix): return re.sub('^' + prefix, '', j, re.I).strip()
  return j

unabbr = {}
for path in Path('abbreviations').rglob('*.json'):
  if path.name in ['header.json', 'footer.json']: continue
  with open(str(path)) as f:
    for full, abbr in json.load(f)['default']['container-title'].items():
      if len(abbr) == len(full): continue
      if len(abbr) == 0: continue

      if abbr in unabbr:
        existing = unabbr[abbr]
        if existing == full: continue
        if unthe(unabbr[abbr]).lower() == unthe(full):
          full = unthe(full)
        elif existing.lower().startswith(full.lower()):
          pass
        elif full.lower().startswith(existing.lower()):
          full = existing
        else:
          print((abbr, existing, full))
          if len(existing) > len(full): full = existing

      unabbr[abbr] = full

with open('unabbrev.json', 'w') as f:
  json.dump(unabbr, f, indent='  ')

def fetch(name):
  return urllib.request.urlopen('https://www.netlib.org/bibnet/tools/strings/' + name).read().decode('utf-8')

strings = ''
for bib in fetch('00dir.cmd').split('\n'):
  if not bib.endswith('.bib'): continue
  bib = re.sub('^get ', '', bib)
  strings += f'%% {bib}\n{fetch(bib)}\n'
with open('strings.bib', 'w') as f:
  f.write(strings)
