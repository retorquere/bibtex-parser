#!/usr/bin/env python3

import json
import os
import getopt
from termcolor import colored
import sys
import argparse, shlex

if os.system(f'npm ci') != 0 or os.system(f'npm start') != 0:
  sys.exit(1)

parser = argparse.ArgumentParser()
parser.add_argument('-t', '--test')
args = parser.parse_args()

n = 0
for sc in ['off', 'on', 'on+guess']:
  for cp in ['off', 'strict', 'as-needed']:
    n += 1
    env = f'CI=true SENTENCECASE={sc} CASEPROTECTION={cp}'
    if args.test: env += f' TESTCASE={shlex.quote(args.test)}'
    print()
    print(colored(n, 'yellow'), colored(env, 'red'))
    print()

    if os.system(f'{env} npm run update-ci') != 0:
      sys.exit(1)

