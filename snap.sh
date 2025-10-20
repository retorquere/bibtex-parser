#!/bin/bash

set -e
set -x

for sc in on+guess on off; do
  for cp in as-needed off strict; do
    for pq in p P; do
      ./test/run.js --sc $sc --cp $cp -$pq --big --snap
    done
  done
done
