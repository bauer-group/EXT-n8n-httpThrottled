# Configuration

## Node Parameters

This node inherits **all** parameters from the built-in HTTP Request node (V3), including:

- All HTTP methods (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)
- URL with expression support
- Authentication (50+ credential types — Basic, OAuth2, API Key, and all predefined service credentials)
- Headers, query parameters, body options (JSON, form data, raw, binary)
- Response format (JSON, text, binary, file)
- Pagination (offset-based, cursor-based, custom)
- Proxy, timeout, SSL, redirect, and batching settings

In addition, the following throttling toggle is appended:

| Parameter             | Type    | Default | Description                          |
| --------------------- | ------- | ------- | ------------------------------------ |
| **Enable Throttling** | Boolean | true    | Enable automatic rate-limit handling |

## Throttling Settings

When throttling is enabled, the following settings become available under *Throttling Settings*:

| Setting                    | Type         | Default | Description                                          |
| -------------------------- | ------------ | ------- | ---------------------------------------------------- |
| **HTTP Codes**             | Multi-select | 429     | Status codes that trigger throttling (429, 503, 504) |
| **Default Wait Time (ms)** | Number       | 5000    | Wait time when no response header provides guidance  |
| **Random Jitter (±%)**    | Number       | 25      | Jitter percentage to prevent thundering herd         |
| **Max Throttle Retries**  | Number       | 5       | Maximum retry attempts before failing                |

### HTTP Codes

Select which HTTP status codes should trigger the throttling/retry logic:

- **429 Too Many Requests** — Standard rate-limit response. Most APIs use this.
- **503 Service Unavailable** — Server temporarily overloaded. Common with cloud services under load.
- **504 Gateway Timeout** — Upstream timeout. Useful for APIs behind load balancers.

### Default Wait Time

The fallback wait time (in milliseconds) when no response header provides guidance. This value is used when:

- The response contains no `Retry-After` header
- The response contains no `X-RateLimit-Reset` header
- All header parsing returns no usable value

### Random Jitter

Adds a random variance (±%) to the calculated wait time. This prevents the **thundering herd problem** — when multiple workflows or items retry at the exact same moment, overwhelming the API again.

Example with 5000 ms base wait and 25% jitter:
- Minimum wait: 3750 ms (5000 − 25%)
- Maximum wait: 6250 ms (5000 + 25%)

Setting jitter to 0 disables randomization (all retries wait the exact calculated time).

### Max Throttle Retries

The maximum number of retry attempts before the node throws an error. After this many retries, the node fails with:

```
Throttling: max retries (5) exceeded. Last status: 429
```

With default settings (5 retries × 5000 ms), the maximum total wait time is approximately **25 seconds** (before jitter). The actual maximum wait is capped at 5 minutes (300,000 ms) per individual retry.

## Safety Limits

| Limit                  | Value          |
| ---------------------- | -------------- |
| Maximum wait per retry | 300,000 ms (5 min) |
| Jitter range           | 0–100%         |
| Minimum jitter result  | 0 ms (never negative) |
| Minimum retries        | 1              |
