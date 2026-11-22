#!/bin/sh
# Starts n8n with everything pre-configured, so nobody has to click through the n8n UI:
#   1. creates the two credentials (Claude API key from .env, local Mailpit SMTP)
#   2. imports the workflows from n8n/workflows (the repo is the source of truth)
#   3. activates the CV screening workflow
#   4. starts n8n
set -e

SEED_DIR=/opt/ekomino
CRED_FILE=/tmp/ekomino-credentials.json

if [ -z "$ANTHROPIC_API_KEY" ] || [ "$ANTHROPIC_API_KEY" = "paste-your-key-here" ]; then
  echo "WARNING: ANTHROPIC_API_KEY is not set in .env, every CV will end up in manual review."
fi

# Credentials are created from environment variables at start-up and are stored encrypted
# inside n8n. The key itself is never written into the workflow files or the repo.
cat > "$CRED_FILE" <<EOF
[
  {
    "id": "ekominoClaudeKey",
    "name": "Claude API Key",
    "type": "httpHeaderAuth",
    "data": { "name": "x-api-key", "value": "${ANTHROPIC_API_KEY}" }
  },
  {
    "id": "ekominoMailpitSmtp",
    "name": "Mailpit SMTP (local)",
    "type": "smtp",
    "data": { "user": "", "password": "", "host": "mailpit", "port": 1025, "secure": false, "disableStartTls": true }
  }
]
EOF
n8n import:credentials --input="$CRED_FILE"
rm -f "$CRED_FILE"

n8n import:workflow --separate --input="$SEED_DIR/workflows"

# Publish (activate) both workflows. The error handler must be published too,
# otherwise n8n refuses to run it when the main workflow fails.
for id in EkominoCvScreen1 EkominoErrorHnd1; do
  n8n publish:workflow --id="$id" 2>/dev/null || n8n update:workflow --id="$id" --active=true
done

exec n8n start
