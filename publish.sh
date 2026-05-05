#!/bin/bash
set -e
npm run build
npm pack
openclaw plugins install clawnductor-*.tgz --dangerously-force-unsafe-install --force
openclaw plugins enable clawnductor 2>/dev/null || true
echo "Done — restart openclaw gateway to reload"
