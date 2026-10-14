#!/usr/bin/env bash
# Builds build/ for the Lambda zip. Installs Linux wheels regardless of host OS,
# so this works from macOS without Docker. boto3 is provided by the Lambda runtime.
set -euo pipefail
cd "$(dirname "$0")"

ARCH="${LAMBDA_ARCH:-arm64}"   # must match the function's architecture in Terraform
PLATFORM=$([ "$ARCH" = "arm64" ] && echo manylinux2014_aarch64 || echo manylinux2014_x86_64)

rm -rf build && mkdir build
python3 -m pip install -q -r requirements.txt -t build \
  --platform "$PLATFORM" --implementation cp --python-version 3.12 --only-binary=:all:
cp handler.py build/
echo "Built media-processor/build for $ARCH"
