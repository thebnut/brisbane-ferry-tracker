#!/bin/sh
# Regenerate src/gen/gtfs-realtime_pb.js from the official GTFS-RT proto (google/transit, proto2),
# using buf + protoc-gen-es from devDependencies (no system protoc needed). Config: buf.gen.yaml.
# To refresh the proto itself:
#   curl -fsSL https://raw.githubusercontent.com/google/transit/master/gtfs-realtime/proto/gtfs-realtime.proto -o proto/gtfs-realtime.proto
set -eu
cd "$(dirname "$0")/.."
PATH="$PWD/node_modules/.bin:$PATH" buf generate
