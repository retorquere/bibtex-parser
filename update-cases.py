#!/usr/bin/env python3

import urllib.request
import json
import shutil
import os

with urllib.request.urlopen('https://raw.githubusercontent.com/retorquere/zotero-better-bibtex/master/test/loaded.json') as f:
  used = json.loads(f.read().decode('utf-8'))

root = '__tests__/better-bibtex'
shutil.rmtree(root)
os.makedirs(root)
for source in used:
  if os.path.splitext(source)[1] in ('.bib', '.bibtex', '.biblatex'):
    os.makedirs(os.path.dirname(os.path.join(root, source)), exist_ok=True)
    shutil.copyfile(os.path.join('../better-bibtex/test/fixtures/', source), os.path.join(root, source))
