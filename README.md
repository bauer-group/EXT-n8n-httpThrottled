# @bauer-group/n8n-nodes-http-throttled-request

An n8n community node that adds intelligent rate-limit throttling to HTTP requests. It automatically detects rate-limit responses (HTTP 429, 503, 504) and waits the appropriate time before retrying, using information from response headers.

## Features

- **Automatic Rate Limit Detection** — Detects HTTP 429, 503, and 504 status codes
- **Smart Wait Time Calculation** — Parses `Retry-After`, `X-RateLimit-*`, and HubSpot-specific headers
- **Jitter Support** — Prevents thundering herd with configurable random variance
- **Full Authentication Support** — None, Basic Auth, Header Auth, OAuth1, OAuth2

## Installation

### n8n Community Nodes (Recommended)

1. Open your self-hosted n8n instance
2. Go to **Settings** → **Community Nodes**
3. Enter `@bauer-group/n8n-nodes-http-throttled-request`
4. Click **Install**

The node appears immediately in the node panel — no restart required.

> Community Nodes are only available on self-hosted n8n instances.

### Manual Installation

For local development or environments without Community Nodes support:

1. Clone this repository
2. Build the package:

```bash
npm install
npm run build
```

3. Link to your n8n installation:

```bash
cd ~/.n8n/nodes
npm link @bauer-group/n8n-nodes-http-throttled-request
```

4. Restart n8n

### Docker

Install the community node via `N8N_COMMUNITY_PACKAGES`:

```yaml
services:
  n8n:
    image: n8nio/n8n
    environment:
      - N8N_COMMUNITY_PACKAGES=@bauer-group/n8n-nodes-http-throttled-request
```

Alternatively, mount the built package as a volume:

```yaml
services:
  n8n:
    image: n8nio/n8n
    volumes:
      - ./n8n-nodes-http-throttled-request:/home/node/.n8n/nodes/n8n-nodes-http-throttled-request
```

## Configuration

### Node Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| **Method** | Options | GET | HTTP method (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS) |
| **URL** | String | — | Target URL for the request |
| **Authentication** | Options | None | Authentication type (None, Basic Auth, Header Auth, OAuth1, OAuth2) |
| **Send Headers** | Boolean | false | Enable custom request headers |
| **Send Body** | Boolean | false | Enable request body |
| **Enable Throttling** | Boolean | true | Enable automatic rate-limit handling |

### Throttling Settings

When throttling is enabled, the following settings become available under *Throttling Settings*:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| **HTTP Codes** | Multi-select | 429 | Status codes that trigger throttling (429, 503, 504) |
| **Default Wait Time (ms)** | Number | 10000 | Wait time when no response header provides guidance |
| **Random Jitter (±%)** | Number | 25 | Jitter percentage to prevent thundering herd |
| **Max Throttle Retries** | Number | 10 | Maximum retry attempts before failing |

## How It Works

When the node receives a response with a configured throttle status code, it:

1. Extracts the wait time from response headers
2. Applies jitter to distribute retry attempts
3. Waits the calculated time
4. Retries the request
5. Repeats until success or max retries reached

### Header Priority

The wait time is determined using this priority (highest first):

| Priority | Source | Example |
| -------- | ------ | ------- |
| 1 | `Retry-After` (seconds) | `Retry-After: 30` |
| 1 | `Retry-After` (HTTP-Date) | `Retry-After: Wed, 19 Feb 2025 12:00:00 GMT` |
| 2 | `X-RateLimit-Remaining: 0` + reset timestamp | `X-RateLimit-Reset: 1739966400` |
| 3 | Reset timestamp alone | `X-RateLimit-Reset: 1739966400` |
| 4 | Default fallback | Configured *Default Wait Time* |

### Supported Headers

- `Retry-After` — seconds or HTTP-Date
- `X-RateLimit-Reset` / `X-RateLimit-Remaining`
- `X-HubSpot-RateLimit-Reset` / `X-HubSpot-RateLimit-Remaining`
- `RateLimit-Reset` / `RateLimit-Remaining`

### Safety Limits

- **Maximum wait time**: 5 minutes (300,000 ms)
- **Jitter range**: 0–100%
- **Minimum jitter result**: 0 ms (never negative)

## Usage Examples

### Basic GET with Throttling

1. Add the **HTTP Request (Throttled)** node to your workflow
2. Set the URL to your API endpoint
3. Throttling is enabled by default — configure settings as needed
4. Execute the workflow

### API with Rate Limits (e.g. HubSpot, GitHub, Stripe)

1. Enable throttling with appropriate HTTP codes (429, 503)
2. Set a reasonable default wait time (e.g. 10,000 ms)
3. Configure max retries based on your workflow timeout
4. Add jitter (25%) to distribute retry attempts

## Development

### Build

```bash
npm run build
```

### Test

```bash
npm test
```

### Test with Coverage

```bash
npm test -- --coverage
```

### Project Structure

```
├── src/
│   └── nodes/
│       └── HttpRequest/
│           ├── HttpRequestThrottled.node.ts   # Main node implementation
│           └── throttling.ts                  # Throttling logic
├── test/
│   └── throttling.test.ts                     # Unit tests
├── package.json
└── tsconfig.json
```

## Troubleshooting

### Node not appearing in n8n

1. Check n8n logs for loading errors
2. Verify the package is installed correctly (Settings → Community Nodes)
3. For manual installs: ensure `npm run build` completed and restart n8n

### Throttling not working

1. Verify *Enable Throttling* is enabled (default: on)
2. Check that the API returns one of the configured HTTP codes
3. Review n8n execution logs for throttling messages

### Maximum retries exceeded

If you see `Throttling: max retries (…) exceeded`:

1. Increase *Max Throttle Retries*
2. Increase *Default Wait Time* to wait longer between retries
3. Check if the API requires authentication or has other restrictions

## API Reference

```typescript
export const MAX_THROTTLE_WAIT_MS = 300_000;

export function normalizeHeaders(raw: Record<string, unknown>): Record<string, string>;
export function parseRetryAfterToMs(v: string): number | null;
export function parseResetToWaitMs(h: Record<string, string>): number | null;
export function computeWaitMs(rawHeaders: Record<string, unknown>, defaultWaitMs: number): number;
export function applyJitter(baseMs: number, jitterPct: number): number;
```

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Run tests: `npm test`
4. Submit a pull request
