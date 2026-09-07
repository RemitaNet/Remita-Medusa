/**
 * Tests for src/utils/amount-normalizer.ts
 *
 * Run with:
 *   npx tsx --test tests/amount-normalizer.test.ts
 *   npm test
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { toKobo, fromKobo, ensureMinorUnit } from "../src/utils/amount-normalizer"

// ─── toKobo ───────────────────────────────────────────────────────────────────

describe("toKobo", () => {
  it("converts 1 naira to 100 kobo", () => {
    assert.equal(toKobo(1), 100)
  })

  it("converts 1500 naira to 150 000 kobo", () => {
    assert.equal(toKobo(1500), 150_000)
  })

  it("converts 0 naira to 0 kobo", () => {
    assert.equal(toKobo(0), 0)
  })

  it("correctly handles a fractional naira value", () => {
    // 1500.50 naira → 150 050 kobo
    assert.equal(toKobo(1500.5), 150_050)
  })

  it("rounds correctly to avoid floating-point drift", () => {
    // 0.1 + 0.2 = 0.30000000000000004 in IEEE 754 — toKobo must round.
    assert.equal(toKobo(0.1 + 0.2), 30)
  })

  it("handles large values without precision loss", () => {
    assert.equal(toKobo(1_000_000), 100_000_000)
  })

  it("handles fractional kobo that round up", () => {
    // 9.995 naira → 999.5 kobo → rounds to 1000
    assert.equal(toKobo(9.995), 1000)
  })

  it("handles fractional kobo that round down", () => {
    // 9.994 naira → 999.4 kobo → rounds to 999
    assert.equal(toKobo(9.994), 999)
  })

  it("throws RangeError for NaN", () => {
    assert.throws(() => toKobo(NaN), RangeError)
  })

  it("throws RangeError for Infinity", () => {
    assert.throws(() => toKobo(Infinity), RangeError)
  })

  it("throws RangeError for -Infinity", () => {
    assert.throws(() => toKobo(-Infinity), RangeError)
  })
})

// ─── fromKobo ─────────────────────────────────────────────────────────────────

describe("fromKobo", () => {
  it("converts 100 kobo to 1 naira", () => {
    assert.equal(fromKobo(100), 1)
  })

  it("converts 150 000 kobo to 1500 naira", () => {
    assert.equal(fromKobo(150_000), 1500)
  })

  it("converts 0 kobo to 0 naira", () => {
    assert.equal(fromKobo(0), 0)
  })

  it("rounds to 2 decimal places", () => {
    // 1 kobo = 0.01 naira
    assert.equal(fromKobo(1), 0.01)
  })

  it("round-trips with toKobo", () => {
    const original = 1234.56
    const kobo     = toKobo(original)
    assert.equal(fromKobo(kobo), original)
  })
})

// ─── ensureMinorUnit ──────────────────────────────────────────────────────────

describe("ensureMinorUnit", () => {
  it("returns the same integer unchanged", () => {
    assert.equal(ensureMinorUnit(150_000), 150_000)
  })

  it("rounds a float to the nearest integer", () => {
    assert.equal(ensureMinorUnit(150_000.7), 150_001)
  })

  it("rounds 0.5 up", () => {
    assert.equal(ensureMinorUnit(0.5), 1)
  })

  it("handles 0", () => {
    assert.equal(ensureMinorUnit(0), 0)
  })

  it("throws RangeError for NaN", () => {
    assert.throws(() => ensureMinorUnit(NaN), RangeError)
  })

  it("throws RangeError for Infinity", () => {
    assert.throws(() => ensureMinorUnit(Infinity), RangeError)
  })
})
