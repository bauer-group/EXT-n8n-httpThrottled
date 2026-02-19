# n8n-nodes-http-throttled-request

A custom n8n node that extends the HTTP Request functionality with intelligent rate-limit throttling. The node automatically detects rate-limit responses (429 Too Many Requests, etc.) and waits the appropriate time before retrying, using information from response headers.

## Features

- **Automatic Rate Limit Detection**: Detects HTTP 429, 503, and 504 status codes
- **Smart Wait Time Calculation**: Parses `Retry-After`, `X-RateLimit-*`, and HubSpot-specific headers
- **Jitter Support**: Prevents thundering herd with configurable random variance
- **n8n v2 Compatible**: Uses modern `this.helpers.httpRequest()` API
- **Shadow-Override Ready**: Can replace the core HTTP Request node transparently
- **Full Authentication Support**: None, Basic Auth, Header Auth, OAuth1, OAuth2

## Installation

### Prerequisites

- Node.js 20+
- npm 9+
- n8n instance (self-hosted)

### Install from npm

```bash
npm install n8n-nodes-http-throttled-request
```

### Install from source

1. Clone or download this repository
2. Build the package:

```bash
npm install
npm run build
```

3. Link to your n8n installation:

```bash
# Navigate to your n8n custom nodes directory
cd ~/.n8n/nodes

# Link the package
npm link n8n-nodes-http-throttled-request
```

4. Restart your n8n instance

### Docker Installation

Mount the node package into your n8n container:

```yaml
# docker-compose.yml
services:
  n8n:
    image: n8nio/n8n
    volumes:
      - ./n8n-nodes-http-throttled-request:/home/node/.n8n/nodes/n8n-nodes-http-throttled-request
    environment:
      - N8N_CUSTOM_EXTENSIONS=/home/node/.n8n/nodes
```

## Configuration

### Node Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| **Method** | Options | GET | HTTP method (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS) |
| **URL** | String | - | Target URL for the request |
| **Authentication** | Options | None | Authentication type |
| **Send Headers** | Boolean | false | Enable custom headers |
| **Send Body** | Boolean | false | Enable request body |
| **Throttling aktivieren** | Boolean | true | Enable automatic rate-limit handling |

### Throttling Settings

When throttling is enabled, additional options become available:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| **HTTP-Codes** | Multi-select | 429 | Status codes that trigger throttling (429, 503, 504) |
| **Standard-Wartezeit (ms)** | Number | 10000 | Default wait time when no header provides guidance |
| **Zufaellige Abweichung (+/-%)** | Number | 25 | Jitter percentage to prevent thundering herd |
| **Max. Throttle-Versuche** | Number | 10 | Maximum retry attempts before failing |

### Authentication Types

The node supports the following authentication methods:

- **None**: No authentication
- **Basic Auth**: HTTP Basic Authentication (username/password)
- **Header Auth**: Custom header-based authentication
- **OAuth1**: OAuth 1.0 authentication
- **OAuth2**: OAuth 2.0 authentication

## Usage Examples

### Basic GET Request with Throttling

1. Add the "HTTP Request" node to your workflow
2. Set the URL to your API endpoint
3. Enable "Throttling aktivieren" (enabled by default)
4. Configure throttling settings as needed
5. Execute the workflow

### POST Request with JSON Body

1. Add the HTTP Request node
2. Set Method to "POST"
3. Enter the target URL
4. Enable "Send Body"
5. Select "JSON" as Body Content Type
6. Enter your JSON payload in the Body field

### API Request with Rate Limit Handling

For APIs that enforce rate limits (e.g., HubSpot, GitHub, Stripe):

1. Enable throttling with appropriate HTTP codes (429, 503)
2. Set a reasonable default wait time (e.g., 10000ms)
3. Configure max retries based on your workflow timeout
4. Add jitter (25%) to distribute retry attempts

## How It Works

### Rate Limit Detection

When the node receives a response with a configured throttle status code (429, 503, or 504), it:

1. Extracts wait time from response headers
2. Applies jitter to prevent thundering herd
3. Waits the calculated time
4. Retries the request
5. Repeats until success or max retries reached

### Header Priority

The node calculates wait time using this priority:

1. **Retry-After** (highest priority)
   - Seconds format: `Retry-After: 30`
   - HTTP-Date format: `Retry-After: Wed, 19 Feb 2025 12:00:00 GMT`

2. **Rate Limit with Remaining=0**
   - `X-RateLimit-Remaining: 0` combined with reset timestamp

3. **Reset Timestamp alone**
   - `X-RateLimit-Reset: 1739966400`

4. **Default fallback** (lowest priority)
   - Uses configured default wait time

### Supported Headers

| Header | Format | Example |
|--------|--------|---------|
| `Retry-After` | Seconds or HTTP-Date | `30` or `Wed, 19 Feb 2025 12:00:00 GMT` |
| `X-RateLimit-Reset` | Unix timestamp | `1739966400` |
| `X-RateLimit-Remaining` | Integer | `0` |
| `X-HubSpot-RateLimit-Reset` | Unix timestamp | `1739966400` |
| `X-HubSpot-RateLimit-Remaining` | Integer | `0` |
| `RateLimit-Reset` | Unix timestamp | `1739966400` |
| `RateLimit-Remaining` | Integer | `0` |

### Timestamp Detection

The node automatically detects timestamp format:
- Values > 10^12: Treated as milliseconds
- Values > 10^9: Treated as seconds (Unix timestamp)

### Safety Limits

- **Maximum wait time**: 5 minutes (300,000ms)
- **Jitter range**: 0-100%
- **Minimum jitter result**: 0ms (never negative)

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
n8n-nodes-http-throttled-request/
├── package.json              # Package configuration
├── tsconfig.json             # TypeScript configuration
├── README.md                 # This file
├── nodes/
│   └── HttpRequest/
│       ├── HttpRequestThrottled.node.ts  # Main node class
│       └── throttling.ts                  # Throttling logic
└── test/
    └── throttling.test.ts    # Unit tests
```

## Troubleshooting

### Node not appearing in n8n

1. Verify the package is installed in the correct location
2. Check n8n logs for loading errors
3. Ensure `npm run build` completed successfully
4. Restart n8n after installation

### Throttling not working

1. Verify "Throttling aktivieren" is enabled
2. Check that the API returns one of the configured HTTP codes
3. Review n8n execution logs for throttling messages

### Maximum retries exceeded

If you see "Maximale Anzahl Versuche erreicht":
1. Increase "Max. Throttle-Versuche" setting
2. Increase "Standard-Wartezeit" to wait longer between retries
3. Check if the API requires authentication or has other restrictions

## API Reference

### Throttling Module Exports

```typescript
// Maximum wait time cap (5 minutes)
export const MAX_THROTTLE_WAIT_MS = 300_000;

// Normalize headers to lowercase keys
export function normalizeHeaders(raw: Record<string, unknown>): Record<string, string>;

// Parse Retry-After header to milliseconds
export function parseRetryAfterToMs(v: string): number | null;

// Parse reset timestamp headers to wait milliseconds
export function parseResetToWaitMs(h: Record<string, string>): number | null;

// Compute wait time from response headers
export function computeWaitMs(rawHeaders: Record<string, unknown>, defaultWaitMs: number): number;

// Apply jitter to wait time
export function applyJitter(baseMs: number, jitterPct: number): number;
```

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm test`
5. Submit a pull request

