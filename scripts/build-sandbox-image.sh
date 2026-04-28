#!/usr/bin/env bash
set -eu
docker build -f container/sandbox/Dockerfile -t wbd/sandbox:dev .
echo "Built wbd/sandbox:dev"
