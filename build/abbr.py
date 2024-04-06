#!/usr/bin/env python3

import json
from pathlib import Path
import re
import urllib.request
import csv
import glob

unabbr = {}
with open('build/strings-base.bib') as f:
  strings = f.read()

with open('node_modules/unicode2latex/tables/biblatex.json') as f:
  u2l = json.load(f)
def unicode2latex(s):
  l = ''
  for c in s:
    if not c in u2l:
      l += c
    elif 'text' in u2l[c]:
      l += u2l[c]['text']
    else:
      l += '$' + u2l[c]['math'] + '$'
  return l.replace('$$', '')

def minimize(s):
  return re.sub(r'[.\s]', '', s)

def accept(abbr, full):
  if len(minimize(full)) <= len(minimize(abbr)): return False
  if len(abbr) == 0: return False
  if '$' in full: return False
  if '"' in full: return False
  if '...' in full: return False
  if unthe(full).lower() == 'journal' and unthe(abbr).lower() == 'journal': return False
  return True

def clean(abbr, full):
  global strings
  abbr = abbr.upper().strip()
  if len(abbr) < 2: return ''
  if abbr[0] == '#' and abbr[-1] == '#':
    abbr = abbr[1:-2]
    if '"' not in full and accept(abbr, full): strings += '@string{' + abbr + ' = "' + unicode2latex(full) + '"}\n'
  return abbr

def unthe(j):
  for prefix in ['^the ', '^la ']:
    if re.match(prefix, j, re.I): return re.sub(prefix, '', j, flags=re.I).strip()
  return j

with open('build/unabbrev-base.json') as f:
  base = json.load(f)
  for abbr, full in base.items():
    abbr = clean(abbr, full)
    unabbr[abbr] = full

for abbrevs in glob.glob('abbrv.jabref.org/journals/journal_abbreviations_*.csv'):
  with open(abbrevs) as f:
    for full, abbr in [row[:2] for row in csv.reader(f, delimiter=';') if len(row) >= 2]:
      abbr = clean(abbr, full)
      if not accept(abbr, full): continue
      unabbr[abbr] = full

for path in Path('abbreviations').rglob('*.json'):
  if path.name in ['header.json', 'footer.json']: continue
  with open(str(path)) as f:
    for full, abbr in json.load(f)['default']['container-title'].items():
      abbr = clean(abbr, full)
      if not accept(abbr, full): continue

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

def fix(journal):
  acros = [
    'ipemc',
    'ces/ieee',
    'acm-ieee',
    'iccad-ieee',
    "'Leos '",
    'IEEE/leos',
    'ieee',
  ]
  for acro in acros:
    journal = re.sub(f'\\b{acro}\\b', lambda m: m.group().upper(), journal, flags=re.IGNORECASE)
  return journal
unabbr = { k.upper(): fix(v) for k, v in unabbr.items() }

with open('build/fixups.json') as f:
  for abbr, full in json.load(f).items():
    for k in [abbr, abbr.replace('.', '')]:
      k = k.upper()
      if full is None:
        if k in unabbr:
          print('popping', k)
          unabbr.pop(k)
      else:
        unabbr[k] = full

for abbr, journal in list(unabbr.items()):
  for k in [abbr, abbr.replace('.', '')]:
    if len(k.replace('.', '')) <= 2:
      unabbr.pop(k, None)

with open('unabbrev.json', 'w') as f:
  json.dump(unabbr, f, indent='  ', sort_keys=True)

def fetch(name):
  return urllib.request.urlopen('https://www.netlib.org/bibnet/tools/strings/' + name).read().decode('utf-8')

for bib in fetch('00dir.cmd').split('\n'):
  if not bib.endswith('.bib'): continue
  bib = re.sub('^get ', '', bib)
  strings += f'%% {bib}\n{fetch(bib)}\n'
with open('strings.bib', 'w') as f:
  f.write(strings)
