/**
 * Tests for src/utils/payment-identifier.ts
 *
 * Run with:
 *   npx tsx --test tests/payment-identifier.test.ts
 *   npm test
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"

import {
  generateIdentifier,
  extractCartId,
  isValidIdentifier,
} from "../src/utils/payment-identifier"

// ─── generateIdentifier ───────────────────────────────────────────────────────

describe("generateIdentifier", () => {
  it("returns a string that starts with 'medusa-'", () => {
    const id = generateIdentifier("cart_01HXY")
    assert.match(id, /^medusa-/)
  })

  it("embeds the cartId in the identifier", () => {
    const id = generateIdentifier("cart_ABCDE")
    assert.ok(id.includes("cart_ABCDE"), `Expected "${id}" to contain "cart_ABCDE"`)
  })

  it("uses the supplied timestamp when provided", () => {
    const ts = 1_718_000_000
    const id = generateIdentifier("cart_01", ts)
    assert.ok(
      id.includes(`-${ts}-`),
      `Expected "${id}" to contain "-${ts}-"`
    )
  })

  it("uses the supplied random suffix when provided", () => {
    const id = generateIdentifier("cart_01", 1_000, "zzzzzz")
    assert.ok(id.endsWith("-zzzzzz"), `Expected "${id}" to end with "-zzzzzz"`)
  })

  it("produces unique identifiers on successive calls", () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateIdentifier("cart_X")))
    assert.equal(ids.size, 50, "Expected 50 unique identifiers")
  })

  it("produces identifiers that pass isValidIdentifier", () => {
    for (let i = 0; i < 20; i++) {
      const id = generateIdentifier(`cart_${i}`)
      assert.ok(isValidIdentifier(id), `"${id}" failed isValidIdentifier`)
    }
  })

  it("handles cartId strings containing hyphens", () => {
    // Medusa cart IDs can look like "cart_01HXYZ-extra"
    const id = generateIdentifier("cart_01HXYZ-extra", 1_000, "abc123")
    assert.equal(extractCartId(id), "cart_01HXYZ-extra")
  })

  it("produces a well-formed structure: prefix-cartId-timestamp-rand", () => {
    const id = generateIdentifier("cart_01", 1_718_000_000, "abcdef")
    assert.equal(id, "medusa-cart_01-1718000000-abcdef")
  })
})

// ─── extractCartId ────────────────────────────────────────────────────────────

describe("extractCartId", () => {
  it("returns the correct cartId for a known identifier", () => {
    const id = "medusa-cart_01HXY-1718000000-a4b7c2"
    assert.equal(extractCartId(id), "cart_01HXY")
  })

  it("returns null for a string without the 'medusa-' prefix", () => {
    assert.equal(extractCartId("armember-1-2-3-4"), null)
  })

  it("returns null for an empty string", () => {
    assert.equal(extractCartId(""), null)
  })

  it("returns null when the timestamp segment is missing", () => {
    assert.equal(extractCartId("medusa-cart_01HXY-abc"), null)
  })

  it("returns null when the random segment is missing", () => {
    assert.equal(extractCartId("medusa-cart_01HXY-1718000000"), null)
  })

  it("round-trips through generateIdentifier", () => {
    const cartId = "cart_ROUNDTRIP"
    const id     = generateIdentifier(cartId, 9_999_999, "xxxxxx")
    assert.equal(extractCartId(id), cartId)
  })

  it("correctly handles cartId with underscores", () => {
    const id = "medusa-cart_01HXYZ_suffix-1718000000-abc123"
    assert.equal(extractCartId(id), "cart_01HXYZ_suffix")
  })
})

// ─── isValidIdentifier ────────────────────────────────────────────────────────

describe("isValidIdentifier", () => {
  it("returns true for a well-formed identifier", () => {
    assert.ok(isValidIdentifier("medusa-cart_01HXY-1718000000-a4b7c2"))
  })

  it("returns false for an identifier without the prefix", () => {
    assert.equal(isValidIdentifier("invalid-cart_01HXY-1718000000-a4b7c2"), false)
  })

  it("returns false for an empty string", () => {
    assert.equal(isValidIdentifier(""), false)
  })

  it("returns false for a PHP-style ARMember identifier", () => {
    assert.equal(isValidIdentifier("armember-42-7-1718000000-123456"), false)
  })

  it("returns true for all identifiers produced by generateIdentifier", () => {
    for (let i = 0; i < 30; i++) {
      const id = generateIdentifier(`cart_${i}`)
      assert.ok(isValidIdentifier(id), `"${id}" should be valid`)
    }
  })

  it("returns false for a string with only the prefix", () => {
    assert.equal(isValidIdentifier("medusa-"), false)
  })
})
