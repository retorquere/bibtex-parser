#!/bin/bash

for sc in on+guess on off; do
  for cp in as-needed off strict; do
    for pq in yes no; do
      ./runtests --sc $sc --cp $cp --pq $pq --big --snap
    done
  done
done

./runtests
