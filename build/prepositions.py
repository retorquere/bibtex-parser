#!/usr/bin/env python3

import json
import os, shutil

with open('data/prepositions.json') as f:
  p = json.load(f)
with open('js/prepositions.ts', 'w') as f:
  print(f'export default {json.dumps(p, indent='  ', sort_keys=True)}\n', file=f)

os.makedirs('rust/data', exist_ok=True)
shutil.copyfile('data/prepositions.json', 'rust/data/prepositions.json')
