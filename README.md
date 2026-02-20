# @bauer-group/n8n-nodes-http-throttled-request

[![🚀 Release & NPM Publish](https://github.com/bauer-group/EXT-n8n-httpThrottled/actions/workflows/nodejs-release.yml/badge.svg)](https://github.com/bauer-group/EXT-n8n-httpThrottled/actions/workflows/nodejs-release.yml)
[![npm](https://img.shields.io/npm/v/@bauer-group/n8n-nodes-http-throttled-request)](https://www.npmjs.com/package/@bauer-group/n8n-nodes-http-throttled-request)
[![GitHub package](https://img.shields.io/github/v/release/bauer-group/EXT-n8n-httpThrottled)](https://github.com/bauer-group/EXT-n8n-httpThrottled/releases)

An n8n community node that adds intelligent rate-limit throttling to HTTP requests. It automatically detects rate-limit responses (HTTP 429, 503, 504) and waits the appropriate time before retrying, using information from response headers.

## Features

- **Full V3 Feature Set** — Inherits all parameters from the built-in HTTP Request node (50+ auth types, pagination, response format, proxy, SSL, etc.)
- **Automatic Rate Limit Detection** — Detects HTTP 429, 503, and 504 status codes
- **Smart Wait Time Calculation** — Parses `Retry-After`, `X-RateLimit-*`, and HubSpot-specific headers
- **Jitter Support** — Prevents thundering herd with configurable random variance

## Installation

### n8n Community Nodes (Recommended)

1. Open your self-hosted n8n instance
2. Go to **Settings** → **Community Nodes**
3. Enter `@bauer-group/n8n-nodes-http-throttled-request`
4. Click **Install**

The node appears immediately in the node panel — no restart required.

> Community Nodes are only available on self-hosted n8n instances.

### Docker

Create a custom Dockerfile that pre-installs the package:

```dockerfile
FROM n8nio/n8n:latest
USER root
RUN npm install -g @bauer-group/n8n-nodes-http-throttled-request
USER node
```

Then build and run:

```bash
docker build -t n8n-throttled .
docker run -it --rm -p 5678:5678 n8n-throttled
```

Or with docker-compose — replace `image` with `build`:

```yaml
services:
  n8n:
    build: .
    ports:
      - "5678:5678"
```

## Quick Start

1. Add the **HTTP Request (Throttled)** node to your workflow
2. Configure it exactly like the built-in HTTP Request node
3. Throttling is enabled by default — no extra setup needed
4. When the API returns 429, the node automatically waits and retries

### Default Throttling Settings

| Setting                  | Default | Description                             |
| ------------------------ | ------- | --------------------------------------- |
| **HTTP Codes**           | 429     | Status codes that trigger throttling    |
| **Default Wait Time**    | 5000 ms | Fallback wait when no header is present |
| **Random Jitter**        | ±25%    | Variance to prevent thundering herd     |
| **Max Throttle Retries** | 5       | Max attempts before failing             |

## Documentation

| Document | Description |
| --- | --- |
| [Configuration](docs/configuration.md) | Full parameter reference, throttling settings, safety limits |
| [How It Works](docs/how-it-works.md) | Throttling behavior, header priority, architecture, execution flow |
| [Migration Guide](docs/migration.md) | Replace existing HTTP Request nodes (manual, JSON, API script) |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and solutions |

## Development

```bash
npm install
npm run build
npm test
```

### Project Structure

```text
├── src/
│   └── nodes/
│       └── HttpRequest/
│           ├── HttpRequestThrottled.node.ts   # Main node (V3 composition + fallback)
│           ├── v3-loader.ts                   # Dynamic V3 node loader
│           ├── throttle-wrapper.ts            # Helper interception for throttling
│           ├── throttling.ts                  # Wait time calculation logic
│           ├── throttling-props.ts            # Throttling UI properties
│           └── translations/de/               # German translation
├── docs/                                      # Documentation
├── test/
│   └── throttling.test.ts                     # Unit tests
├── package.json
└── tsconfig.json
```

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Run tests: `npm test`
4. Submit a pull request
