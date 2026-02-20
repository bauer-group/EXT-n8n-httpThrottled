# Troubleshooting

## Node not appearing in n8n

**Symptom:** After installation, the "HTTP Request (Throttled)" node doesn't show up in the node panel.

1. Check n8n logs for loading errors:
   ```
   docker logs <n8n-container>
   ```
2. Verify the package is installed: Settings → Community Nodes
3. Ensure the n8n version is compatible (requires n8n ≥ 1.0 with n8n-workflow ≥ 2.9.0)
4. For manual installs: ensure `npm run build` completed successfully and restart n8n

## All built-in nodes disappeared

**Symptom:** After installing the community node, all nodes (including built-in ones) are gone.

This indicates the community package crashed during n8n's loading phase. Possible causes:

1. **Incompatible n8n version** — The package requires `n8n-workflow ≥ 2.9.0`
2. **Corrupted installation** — Remove and reinstall:
   - Settings → Community Nodes → Remove the package
   - Restart n8n
   - Reinstall the package

If the UI is inaccessible, remove via CLI:
```bash
cd ~/.n8n/nodes
npm uninstall @bauer-group/n8n-nodes-http-throttled-request
# Restart n8n
```

## Throttling not working

**Symptom:** The node doesn't retry on rate-limit responses.

1. Verify **Enable Throttling** is toggled on (default: enabled)
2. Check that the API returns one of the configured HTTP status codes (default: 429 only). Add 503/504 if needed
3. Review n8n execution logs for throttling messages:
   ```
   [Throttling] Status 429 – item 0, attempt 1/5, waiting 5000ms
   ```
4. If using the V3 path: the throttle wrapper intercepts `helpers.httpRequest`. If the API response doesn't include a status code in the configured list, no retry occurs

## Maximum retries exceeded

**Symptom:** Error message: `Throttling: max retries (5) exceeded. Last status: 429`

The node retried the configured number of times but still received a throttle response. Options:

1. **Increase Max Throttle Retries** — Allow more attempts (but increases total wait time)
2. **Increase Default Wait Time** — Wait longer between retries to give the API more time
3. **Check API rate limits** — Some APIs have very strict limits. Verify:
   - Your API key/plan has sufficient quota
   - Other workflows aren't consuming the same rate limit
   - The API doesn't require a different backoff strategy

## Authentication errors

**Symptom:** Credential errors that didn't occur with the built-in HTTP Request node.

The Throttled node uses the same credential system as the built-in node. If credentials work with the built-in node but not with this one:

1. The V3 loader may not have found `n8n-nodes-base`. Check n8n logs for:
   ```
   V3 node not available, using fallback
   ```
2. The fallback implementation supports fewer auth types (Basic, Header, OAuth1, OAuth2). For full credential support, ensure `n8n-nodes-base` is accessible

## Wait time seems wrong

**Symptom:** The node waits too long or not long enough.

The wait time is determined by response headers (see [How It Works](how-it-works.md#header-priority)). To debug:

1. Check the execution log for the calculated wait time:
   ```
   [Throttling] Status 429 – item 0, attempt 1/5, waiting 12345ms
   ```
2. If the wait time is always the default (5000 ms): the API response likely doesn't include `Retry-After` or `X-RateLimit-Reset` headers
3. If the wait time is unexpectedly high: the API may return a far-future `X-RateLimit-Reset` timestamp. The node caps individual waits at 300,000 ms (5 minutes)
4. Jitter adds ± the configured percentage. Set jitter to 0 for deterministic wait times during debugging

## Docker / Container issues

**Symptom:** The package installs but doesn't work in Docker.

Ensure your custom Dockerfile installs the package globally:

```dockerfile
FROM n8nio/n8n:latest
USER root
RUN npm install -g @bauer-group/n8n-nodes-http-throttled-request
USER node
```

Check:

1. The `docker build` completed without errors
2. The package name is spelled correctly (scoped: `@bauer-group/...`)
3. The container had internet access during build to download from npm
4. You're using the custom image (`build: .`), not the stock `image: n8nio/n8n`
