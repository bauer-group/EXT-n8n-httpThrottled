// nodes/HttpRequest/throttling.ts

// ── Konstanten ────────────────────────────────────────────────────────────────

/** Sicherheits-Cap: Server-Angaben über 5 Minuten werden auf diesen Wert begrenzt */
export const MAX_THROTTLE_WAIT_MS = 300_000;

// ── Header-Normalisierung ─────────────────────────────────────────────────────

/**
 * Vereinheitlicht alle Header-Keys auf Lowercase und wandelt
 * Array-Werte (mehrfache Header) in Strings um.
 */
export function normalizeHeaders(
  raw: Record<string, unknown>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (v == null) continue;
    out[k.toLowerCase()] = Array.isArray(v) ? String(v[0]) : String(v);
  }
  return out;
}

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

/**
 * Gibt den ersten gültigen Integer aus den angegebenen Header-Keys zurück.
 * Die Reihenfolge der Keys definiert die Priorität.
 */
export function firstPresentInt(
  h: Record<string, string>,
  keys: string[]
): number | null {
  for (const k of keys) {
    const v = h[k];
    if (!v) continue;
    const n = parseInt(v, 10);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Parst den Retry-After-Header.
 *
 * Unterstützte Formate:
 *   - Sekunden als Integer:  "30"
 *   - HTTP-Date (RFC 7231):  "Wed, 19 Feb 2025 12:00:00 GMT"
 *
 * Gibt null zurück wenn das Format nicht erkannt wird.
 */
export function parseRetryAfterToMs(v: string): number | null {
  const trimmed = v.trim();

  if (/^\d+$/.test(trimmed)) {
    const sec = parseInt(trimmed, 10);
    return Number.isFinite(sec) && sec >= 0 ? sec * 1000 : null;
  }

  const dt = Date.parse(trimmed); // JS Date.parse verarbeitet RFC-1123 nativ
  if (!Number.isNaN(dt)) {
    const delta = dt - Date.now();
    return delta > 0 ? delta : 0;
  }

  return null;
}

/**
 * Berechnet die Wartezeit aus einem Rate-Limit-Reset-Header.
 *
 * Heuristik für den Timestamp-Typ:
 *   > 10^12  → Milliseconds (moderner POSIX-ms)
 *   > 10^9   → Seconds (klassischer Unix-Timestamp)
 *   sonst    → Seconds (Fallback)
 */
export function parseResetToWaitMs(
  h: Record<string, string>
): number | null {
  const reset = firstPresentInt(h, [
    "x-ratelimit-reset",
    "x-hubspot-ratelimit-reset",
    "ratelimit-reset",
  ]);
  if (reset === null) return null;

  const tsMs = reset > 1_000_000_000_000 ? reset : reset * 1000;
  const delta = tsMs - Date.now();
  return delta > 0 ? delta : 0;
}

// ── Kernfunktionen ────────────────────────────────────────────────────────────

/**
 * Berechnet die Wartezeit in Millisekunden aus den Response-Headern.
 *
 * Prioritätsreihenfolge:
 *   1. Retry-After Header (expliziteste Server-Aussage)
 *   2. Remaining = 0 → Reset-Timestamp oder Default
 *   3. Reset-Timestamp allein
 *   4. Konfigurierbarer Default-Wert
 *
 * Das Ergebnis wird auf MAX_THROTTLE_WAIT_MS gecappt.
 */
export function computeWaitMs(
  rawHeaders: Record<string, unknown>,
  defaultWaitMs: number
): number {
  const h = normalizeHeaders(rawHeaders);
  const cap = (ms: number) => Math.min(ms, MAX_THROTTLE_WAIT_MS);

  // 1) Retry-After
  const ra = h["retry-after"];
  if (ra) {
    const ms = parseRetryAfterToMs(ra);
    if (ms !== null && ms > 0) return cap(ms);
  }

  // 2) Remaining = 0
  const remaining = firstPresentInt(h, [
    "x-ratelimit-remaining",
    "x-hubspot-ratelimit-remaining",
    "ratelimit-remaining",
  ]);
  if (remaining !== null && remaining <= 0) {
    const resetMs = parseResetToWaitMs(h);
    return cap(resetMs !== null && resetMs > 0 ? resetMs : defaultWaitMs);
  }

  // 3) Reset-Timestamp
  const resetMs = parseResetToWaitMs(h);
  if (resetMs !== null && resetMs > 0) return cap(resetMs);

  // 4) Fallback
  return cap(defaultWaitMs);
}

/**
 * Wendet einen gleichverteilten Jitter auf die Wartezeit an.
 *
 * Zweck: Thundering-Herd verhindern, wenn viele parallele Executions
 *        gleichzeitig nach einem 429 wiederanlaufen.
 *
 * @param baseMs    Basiswert in Millisekunden
 * @param jitterPct Maximale Abweichung in Prozent (0–100)
 * @returns Jitter-behafteter Wert, niemals negativ
 */
export function applyJitter(baseMs: number, jitterPct: number): number {
  const pct = Math.max(0, Math.min(100, jitterPct));
  const variance = baseMs * (pct / 100);
  const jitter = (Math.random() * 2 - 1) * variance;
  return Math.max(0, baseMs + jitter);
}
