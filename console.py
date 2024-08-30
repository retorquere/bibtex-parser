#!/usr/bin/env python3

import json
import sys

console = 'eslint.config.console.json'

if len(sys.argv) == 1:
  pass
else:
  state, = sys.argv[1:]
  if state in ['on', 'error']:
    pass
  elif state in ['off', 'r', 'rel']:
    state = 'error'
  elif state in ['d', 'c', 'deb']:
    state = 'off'
  else:
    print('unexpected state', state)
    sys.exit(1)

  with open(console, 'w') as f:
    json.dump(state, f)

with open(console) as f:
  print(json.load(f))
