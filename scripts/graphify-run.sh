#!/bin/bash
# Rebuild Graphify Index
echo "Building Graphify index..."
graphify . --exclude node_modules,.next,dist,build,coverage,logs
echo "Graphify index complete."
