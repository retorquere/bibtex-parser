#!/usr/bin/env python3

import json
import os, shutil

with open('data/prepositions.json') as f:
  p = json.load(f)
with open('prepositions.ts', 'w') as f:
  print(f'export default {json.dumps(p, indent='  ', sort_keys=True)}\n', file=f)
