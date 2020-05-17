#!/usr/bin/env python3

from munch import Munch
import glob
import json
import math
import os, sys
import re
import subprocess
import shlex
import shutil

def run(cmd):
  if type(cmd) == str: cmd = cmd.split(' ')
  print(subprocess.check_output(cmd).decode('utf-8'), '  ')

class Logs:
  @staticmethod
  def clean(log, reason):
    if not os.path.exists(log): return
    print('removing', log, reason)
    os.remove(log)

  @staticmethod
  def build_id(log):
    if os.path.getsize(log) == 0:
      Logs.clean(log, 'empty')
      return False

    try:
      return int(re.match(r'zotero=master=([0-9]+).[23]=push.json$', os.path.basename(log)).group(1))
    except:
      try:
        return int(re.match(r'zotero=v[0-9]+\.[0-9]+\.[0-9]+=([0-9]+).[23]=push.json$', os.path.basename(log)).group(1))
      except:
        Logs.clean(log, 'not zotero-master')
    return False

  @staticmethod
  def builds():
    return sorted(list(set([ Logs.build_id(log) for log in glob.glob(os.path.expanduser('~/pCloud Drive/travis/used/*.json')) if Logs.build_id(log) ])))

  @staticmethod
  def load(build_id):
    logs = [os.path.expanduser(f'~/pCloud Drive/travis/used/zotero=master={build_id}.{n}=push.json') for n in [2, 3]]

    try:
      used = []
      for log in logs:
        with open(log) as f:
          used = used + json.load(f)
      if len(used) == 0:
        [Logs.clean(log, 'empty') for log in logs]
        return False
      return used
    except FileNotFoundError:
      [Logs.clean(log, 'not paired') for log in logs]
      return False
    except json.decoder.JSONDecodeError:
      [Logs.clean(log, 'broken json') for log in logs]
      return False

builds = { build: Logs.load(build) for build in Logs.builds() }
builds = { build_id: build for build_id, build in builds.items() if build }
last = max(builds.keys())
used = builds[last]
for log in glob.glob(os.path.expanduser(f'~/pCloud Drive/travis/used/*.json')):
  build_id = Logs.build_id(log)
  if build_id and build_id < last:
    Logs.clean(log, 'superceded')
print(last)
used = [ source for source in used if re.match(r'.*\.bib(latex|tex)?$', source) ]

root = '__tests__/better-bibtex'
shutil.rmtree(root)
for source in used:
  os.makedirs(os.path.dirname(os.path.join(root, source)), exist_ok=True)
  shutil.copyfile(os.path.join('../better-bibtex/test/fixtures/', source), os.path.join(root, source))
