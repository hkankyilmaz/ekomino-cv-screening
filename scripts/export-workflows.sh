#!/bin/sh
# If you changed the workflow in the n8n editor, run this to save it back into the repo
# (n8n/workflows/*.json). The repo files are re-imported every time n8n starts, so changes
# made only in the editor are lost on the next restart unless you export them.
set -e
cd "$(dirname "$0")/.."
docker compose exec -T n8n sh -c '
  rm -rf /tmp/export && mkdir -p /tmp/export &&
  n8n export:workflow --id=EkominoCvScreen1 --output=/tmp/export/cv-screening-agent.json --pretty &&
  n8n export:workflow --id=EkominoErrorHnd1 --output=/tmp/export/error-handler.json --pretty'
docker compose cp n8n:/tmp/export/cv-screening-agent.json n8n/workflows/cv-screening-agent.json
docker compose cp n8n:/tmp/export/error-handler.json n8n/workflows/error-handler.json
echo "Exported to n8n/workflows/. Review with 'git diff' and commit."
