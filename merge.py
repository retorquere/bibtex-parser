#!/usr/bin/env python3

import csv, os, json

with open('build/load-order.json') as f:
  import_order = json.load(f)

merged = {}
for abbrevs in import_order:
  with open(abbrevs) as f:
    reader = csv.reader(f, delimiter=';')
    for row in reader:
      full, abbr = row[:2]
      if len(full) > 0 and len(abbr) > 0 and abbr[0] != '#':
        merged[abbr] = [full, os.path.basename(abbrevs)]
        if os.path.basename(abbrevs) == 'unabbr-amendments.csv' and '. ' in abbr:
          if abbr[-1] == '.': abbr = abbr[:-1]
          abbr = abbr.replace('. ', ' ')
          merged[abbr] = [full, os.path.basename(abbrevs)]

with open('merged.csv', 'w') as f:
  writer = csv.writer(f, delimiter=';')
  for abbr, full in merged.items():
    writer.writerow([abbr] + full)

