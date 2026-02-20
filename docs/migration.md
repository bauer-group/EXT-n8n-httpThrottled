# Migration Guide

This guide explains how to replace existing **HTTP Request** nodes with **HTTP Request (Throttled)** in your workflows.

Since both nodes share the same parameter structure (the Throttled node inherits all V3 parameters), migration preserves all existing configuration — URL, authentication, headers, body, and other settings remain unchanged.

## Option 1: Manual Replacement (Single Workflow)

1. Open the workflow in the n8n editor
2. Note the HTTP Request node's connections (input/output)
3. Delete the HTTP Request node
4. Add a new **HTTP Request (Throttled)** node
5. Reconnect the inputs and outputs
6. Copy the configuration from the old node (or re-enter settings)
7. Save the workflow

> **Tip:** Before deleting, open the HTTP Request node and take a screenshot of its settings for reference.

## Option 2: JSON Export/Import (Single Workflow)

1. Open the workflow in n8n
2. Select all nodes (Ctrl+A) and copy (Ctrl+C) — this copies the workflow JSON
3. Paste into a text editor
4. Find and replace:
   - `"type": "n8n-nodes-base.httpRequest"` → `"type": "@bauer-group/n8n-nodes-http-throttled-request.httpRequestThrottled"`
5. Copy the modified JSON
6. In n8n, create a new workflow and paste (Ctrl+V)
7. Verify the workflow and save

The throttling settings will use their defaults (enabled, 429 codes, 5000 ms wait, 25% jitter, 5 retries).

## Option 3: Bulk Migration via n8n API

For migrating many workflows at once, use the n8n REST API.

### Prerequisites

- n8n instance with API access enabled
- API key (Settings → API → Create API Key)

### Script

```bash
#!/usr/bin/env bash
# migrate-to-throttled.sh
# Replaces all HTTP Request nodes with HTTP Request (Throttled) across all workflows.
#
# Usage: N8N_URL=https://your-n8n.example.com N8N_API_KEY=your-key ./migrate-to-throttled.sh

set -euo pipefail

: "${N8N_URL:?Set N8N_URL to your n8n instance URL}"
: "${N8N_API_KEY:?Set N8N_API_KEY to your n8n API key}"

API="${N8N_URL}/api/v1"
AUTH="X-N8N-API-KEY: ${N8N_API_KEY}"

OLD_TYPE="n8n-nodes-base.httpRequest"
NEW_TYPE="@bauer-group/n8n-nodes-http-throttled-request.httpRequestThrottled"

echo "Fetching workflows..."
WORKFLOWS=$(curl -sS -H "$AUTH" "${API}/workflows?limit=100")
IDS=$(echo "$WORKFLOWS" | jq -r '.data[].id')

TOTAL=0
MIGRATED=0

for ID in $IDS; do
  TOTAL=$((TOTAL + 1))

  # Fetch full workflow
  WF=$(curl -sS -H "$AUTH" "${API}/workflows/${ID}")
  NAME=$(echo "$WF" | jq -r '.name')

  # Check if workflow contains the old node type
  if ! echo "$WF" | jq -e ".nodes[] | select(.type == \"$OLD_TYPE\")" > /dev/null 2>&1; then
    continue
  fi

  COUNT=$(echo "$WF" | jq "[.nodes[] | select(.type == \"$OLD_TYPE\")] | length")
  echo "  [$ID] \"$NAME\" — $COUNT HTTP Request node(s) found"

  # Replace node type
  UPDATED=$(echo "$WF" | jq "
    .nodes = [.nodes[] |
      if .type == \"$OLD_TYPE\" then
        .type = \"$NEW_TYPE\" |
        .typeVersion = 1
      else
        .
      end
    ]
  ")

  # Update workflow via API
  curl -sS -X PUT -H "$AUTH" -H "Content-Type: application/json" \
    -d "$UPDATED" "${API}/workflows/${ID}" > /dev/null

  MIGRATED=$((MIGRATED + 1))
  echo "    -> migrated"
done

echo ""
echo "Done. $MIGRATED of $TOTAL workflows migrated."
```

### Usage

```bash
chmod +x migrate-to-throttled.sh

N8N_URL=https://your-n8n.example.com \
N8N_API_KEY=your-api-key \
./migrate-to-throttled.sh
```

### Dry Run

To preview which workflows would be affected without making changes, comment out the `curl -sS -X PUT` line and run the script.

## After Migration

- All migrated nodes will have throttling **enabled by default** with these settings:
  - HTTP Codes: 429
  - Default Wait Time: 5000 ms
  - Random Jitter: 25%
  - Max Throttle Retries: 5
- Existing parameters (URL, auth, headers, body, etc.) are preserved
- No workflow restart required — changes take effect on the next execution
