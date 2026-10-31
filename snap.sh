#!/bin/bash

set -e
set -x

for sc in on+guess on off; do
  for cp in as-needed off strict; do
    for pq in P p; do
      ./test/wasm.js --sc $sc --cp $cp -$pq --big --snap --force
    done
  done
done
