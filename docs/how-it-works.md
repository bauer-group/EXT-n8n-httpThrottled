# How It Works

## Overview

When the node receives a response with a configured throttle status code (e.g. 429), it:

1. Extracts the wait time from response headers
2. Applies jitter to distribute retry attempts
3. Waits the calculated time
4. Retries the request
5. Repeats until success or max retries reached

## Header Priority

The wait time is determined using this priority (highest first):

| Priority | Source                                       | Example                                          |
| -------- | -------------------------------------------- | ------------------------------------------------ |
| 1        | `Retry-After` (seconds)                      | `Retry-After: 30`                                |
| 1        | `Retry-After` (HTTP-Date)                    | `Retry-After: Wed, 19 Feb 2025 12:00:00 GMT`    |
| 2        | `X-RateLimit-Remaining: 0` + reset timestamp | `X-RateLimit-Reset: 1739966400`                  |
| 3        | Reset timestamp alone                        | `X-RateLimit-Reset: 1739966400`                  |
| 4        | Default fallback                             | Configured *Default Wait Time*                   |

### Supported Headers

Standard headers:

- `Retry-After` — seconds or HTTP-Date (RFC 7231)
- `X-RateLimit-Reset` / `X-RateLimit-Remaining`
- `RateLimit-Reset` / `RateLimit-Remaining`

Vendor-specific headers:

- `X-HubSpot-RateLimit-Reset` / `X-HubSpot-RateLimit-Remaining`

All header names are matched case-insensitively.

### Reset Timestamp Detection

The node automatically detects whether a reset value is in **seconds** (Unix timestamp) or **milliseconds** (JavaScript timestamp):

- Values < 1,000,000,000,000 are treated as **seconds** (e.g. `1739966400`)
- Values ≥ 1,000,000,000,000 are treated as **milliseconds** (e.g. `1739966400000`)

## Architecture

### V3 Composition

The node uses **composition with helper interception** to inherit all features from n8n's built-in HTTP Request V3 node:

```
┌─────────────────────────────────────────┐
│  HTTP Request (Throttled)               │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  V3 Properties + Credentials    │◄── loaded from n8n-nodes-base at runtime
│  └─────────────────────────────────┘    │
│  ┌─────────────────────────────────┐    │
│  │  Throttling Properties          │◄── appended by this package
│  └─────────────────────────────────┘    │
│                                         │
│  execute():                             │
│    1. Wrap helpers with throttling      │
│    2. Call V3's execute()               │
│    3. V3 makes HTTP calls via helpers   │
│    4. Wrapped helpers intercept calls   │
│    5. On 429/503/504: wait + retry      │
│    6. On success: return to V3          │
└─────────────────────────────────────────┘
```

### Helper Interception

Instead of modifying V3's code, the node intercepts `this.helpers.httpRequest` and `this.helpers.httpRequestWithAuthentication` before delegating to V3's execute method. The intercepted helpers:

1. Force `returnFullResponse: true` and `ignoreHttpStatusErrors: true` to inspect status codes
2. Check if the status code matches a configured throttle code
3. If throttled: compute wait time from headers, apply jitter, sleep, and retry
4. If successful: restore the original response format (body-only if the caller didn't request full response)

This approach is transparent to V3 — it doesn't know its HTTP calls are being throttled.

### Lazy Loading

The V3 node from `n8n-nodes-base` is loaded **lazily** (on first use, not at module import time). This prevents:

- Side effects during n8n's module loading phase
- Crashes from internal V3 properties (`codex`, `routing`, `requestDefaults`) that are only valid for built-in nodes
- Circular dependency issues between community packages and n8n-nodes-base

### Fallback

When `n8n-nodes-base` is not available (e.g. during development or testing), the node falls back to a minimal standalone implementation with basic HTTP features and full throttling support.

## Execution Flow

```
Request arrives
       │
       ▼
 Throttling enabled?
   │          │
   No         Yes
   │          │
   ▼          ▼
 V3 execute   Wrap helpers with throttling
 (unmodified) │
              ▼
           V3 execute (with wrapped helpers)
              │
              ▼
         HTTP call via wrapped helper
              │
              ▼
         Status code in throttle list?
           │          │
           No         Yes
           │          │
           ▼          ▼
         Return     Retry count < max?
         result       │          │
                      Yes        No
                      │          │
                      ▼          ▼
                    Wait +     Throw error:
                    retry      "max retries exceeded"
```
