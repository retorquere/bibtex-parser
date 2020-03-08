#!/usr/bin/env python3

import json
import os
import getopt
from termcolor import colored
import sys

if os.system(f'npm ci') != 0 or os.system(f'npm start') != 0:
  sys.exit(1)

n = 0
for sc in ['off', 'on', 'on+guess']:
  for cp in ['off', 'strict', 'as-needed']:
    n += 1
    env = f'CI=true SENTENCECASE={sc} CASEPROTECTION={cp}'
    print()
    print(colored(n, 'yellow'), colored(env, 'red'))
    print()

    if os.system(f'{env} npm run update-ci') != 0:
      sys.exit(1)

