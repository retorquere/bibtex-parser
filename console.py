#!/usr/bin/env python3

import json
import sys

with open('.eslintrc.json') as f:
  eslint = json.load(f)

if len(sys.argv) == 1:
  pass
else:
  state, = sys.argv[1:]
  if state in ['on', 'error']:
    eslint['rules']['no-console'] = state
  elif state in ['r', 'rel']:
    eslint['rules']['no-console'] = 'error'
  elif state in ['d', 'c', 'deb']:
    eslint['rules']['no-console'] = 'off'
  else:
    print('unexpected state', state)
    sys.exit(1)

  with open('.eslintrc.json', 'w') as f:
    json.dump(eslint, f, sort_keys=True, indent='  ')

mode = { "error": "release", "off": "debug" }
print(eslint['rules']['no-console'], f"({mode[eslint['rules']['no-console']]})")
