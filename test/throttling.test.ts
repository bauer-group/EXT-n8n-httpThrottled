// test/throttling.test.ts

import {
  computeWaitMs,
  applyJitter,
  parseRetryAfterToMs,
  normalizeHeaders,
  MAX_THROTTLE_WAIT_MS,
} from "../src/nodes/HttpRequest/throttling";

// ── normalizeHeaders ──────────────────────────────────────────────────────────

describe("normalizeHeaders", () => {
  it("normalisiert Keys auf Lowercase", () => {
    const result = normalizeHeaders({ "Retry-After": "3", "X-RATELIMIT-REMAINING": "0" });
    expect(result["retry-after"]).toBe("3");
    expect(result["x-ratelimit-remaining"]).toBe("0");
  });

  it("behandelt Array-Werte", () => {
    const result = normalizeHeaders({ "retry-after": ["5", "10"] });
    expect(result["retry-after"]).toBe("5");
  });

  it("überspringt null-Werte", () => {
    const result = normalizeHeaders({ "retry-after": null as unknown as string });
    expect(result["retry-after"]).toBeUndefined();
  });
});

// ── parseRetryAfterToMs ───────────────────────────────────────────────────────

describe("parseRetryAfterToMs", () => {
  it("parst Sekunden-Format", () => {
    expect(parseRetryAfterToMs("3")).toBe(3000);
    expect(parseRetryAfterToMs("0")).toBe(0);
    expect(parseRetryAfterToMs("60")).toBe(60_000);
  });

  it("parst HTTP-Date (Zukunft ~10s)", () => {
    const futureDate = new Date(Date.now() + 10_000).toUTCString();
    const result = parseRetryAfterToMs(futureDate)!;
    expect(result).toBeGreaterThan(8_000);
    expect(result).toBeLessThan(12_000);
  });

  it("gibt 0 zurück bei abgelaufenem HTTP-Date", () => {
    const pastDate = new Date(Date.now() - 5_000).toUTCString();
    expect(parseRetryAfterToMs(pastDate)).toBe(0);
  });

  it("gibt null zurück bei ungültigem Format", () => {
    expect(parseRetryAfterToMs("not-a-date")).toBeNull();
    expect(parseRetryAfterToMs("")).toBeNull();
    expect(parseRetryAfterToMs("abc123")).toBeNull();
  });
});

// ── computeWaitMs ─────────────────────────────────────────────────────────────

describe("computeWaitMs", () => {
  const DEFAULT = 10_000;

  it("nutzt Retry-After (Sekunden), case-insensitiv", () => {
    expect(computeWaitMs({ "Retry-After": "3" }, DEFAULT)).toBe(3_000);
    expect(computeWaitMs({ "retry-after": "5" }, DEFAULT)).toBe(5_000);
  });

  it("nutzt X-RateLimit-Remaining=0 + Reset-Timestamp", () => {
    const resetSec = Math.floor(Date.now() / 1000) + 10;
    const result = computeWaitMs(
      { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": String(resetSec) },
      DEFAULT
    );
    expect(result).toBeGreaterThan(8_000);
    expect(result).toBeLessThan(12_000);
  });

  it("fällt bei Remaining=0 ohne Reset auf Default zurück", () => {
    expect(computeWaitMs({ "X-RateLimit-Remaining": "0" }, DEFAULT)).toBe(DEFAULT);
  });

  it("nutzt Reset-Timestamp wenn kein Retry-After und Remaining > 0", () => {
    const resetSec = Math.floor(Date.now() / 1000) + 5;
    const result = computeWaitMs({ "X-RateLimit-Reset": String(resetSec) }, DEFAULT);
    expect(result).toBeGreaterThan(3_000);
    expect(result).toBeLessThan(7_000);
  });

  it("fällt auf Default zurück wenn keine Header vorhanden", () => {
    expect(computeWaitMs({}, DEFAULT)).toBe(DEFAULT);
  });

  it("verarbeitet HubSpot-spezifische Header", () => {
    expect(
      computeWaitMs({ "X-HubSpot-RateLimit-Remaining": "0" }, DEFAULT)
    ).toBe(DEFAULT);

    const resetSec = Math.floor(Date.now() / 1000) + 5;
    const result = computeWaitMs(
      { "X-HubSpot-RateLimit-Remaining": "0", "X-HubSpot-RateLimit-Reset": String(resetSec) },
      DEFAULT
    );
    expect(result).toBeGreaterThan(3_000);
    expect(result).toBeLessThan(7_000);
  });

  it("verarbeitet Reset-Timestamp in Millisekunden", () => {
    const resetMs = Date.now() + 5_000;
    const result = computeWaitMs({ "X-RateLimit-Reset": String(resetMs) }, DEFAULT);
    expect(result).toBeGreaterThan(3_000);
    expect(result).toBeLessThan(7_000);
  });

  it("cappt bei MAX_THROTTLE_WAIT_MS", () => {
    expect(computeWaitMs({ "Retry-After": "999999" }, DEFAULT)).toBe(MAX_THROTTLE_WAIT_MS);
  });

  it("Retry-After hat Vorrang vor Reset-Timestamp", () => {
    const resetSec = Math.floor(Date.now() / 1000) + 60;
    expect(
      computeWaitMs({ "Retry-After": "3", "X-RateLimit-Reset": String(resetSec) }, DEFAULT)
    ).toBe(3_000);
  });
});

// ── applyJitter ───────────────────────────────────────────────────────────────

describe("applyJitter", () => {
  it("liegt innerhalb ±25% für 10000ms", () => {
    for (let i = 0; i < 200; i++) {
      const result = applyJitter(10_000, 25);
      expect(result).toBeGreaterThanOrEqual(7_500);
      expect(result).toBeLessThanOrEqual(12_500);
    }
  });

  it("gibt exakt base zurück bei jitter=0", () => {
    expect(applyJitter(10_000, 0)).toBe(10_000);
  });

  it("gibt 0 zurück bei base=0", () => {
    expect(applyJitter(0, 50)).toBe(0);
  });

  it("ist niemals negativ, auch bei extremem Jitter", () => {
    for (let i = 0; i < 200; i++) {
      expect(applyJitter(1, 200)).toBeGreaterThanOrEqual(0);
    }
  });

  it("cappt jitterPct auf 100", () => {
    // Bei 100% Jitter muss das Ergebnis zwischen 0 und 2*base liegen
    for (let i = 0; i < 50; i++) {
      const result = applyJitter(1000, 150); // über 100% → wird auf 100% gecappt
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(2000);
    }
  });
});
