#!/usr/bin/env python3

import json
import os
import getopt
import sys
import argparse, shlex

if os.system(f'pnpm install') != 0 or os.system(f'pnpm start') != 0:
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
    print(n, env)
    print()

    if os.system(f'{env} pnpm run update-ci') != 0:
      sys.exit(1)

