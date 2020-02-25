#!/usr/bin/env python3

import json
import os
import getopt
from termcolor import colored
import sys

status = 'update-ci.json'

opts, args = getopt.getopt(sys.argv[1:], 'r', ['restart'])
for opt, arg in opts:
  if opt in ('-r', '--restart'):
    if os.path.isfile(status): os.remove(status)

if os.path.isfile(status):
  with open(status) as f:
    ran = json.load(f)
else:
  ran = []

aborted = False
n = 0
for sc in ['off', 'on', 'on+guess']:
  for cp in ['off', 'strict', 'as-needed']:
    n += 1
    env = f'CI=true SENTENCECASE={sc} CASEPROTECTION={cp}'
    print()
    print(colored(n, 'yellow'), colored(env, 'red'))
    print()
    if aborted:
      print(colored('skipping', 'orange'))
      
    elif env in ran:
      print(colored('skipping', 'green'))

    elif os.system(f'{env} npm ci') == 0 and os.system(f'{env} npm test -- -u') == 0:
      ran.append(env)
      with open(status, 'w') as f:
        json.dump(ran, f)

    else:
      aborted = True

