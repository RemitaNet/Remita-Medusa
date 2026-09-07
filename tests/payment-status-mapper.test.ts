/**
 * Tests for src/utils/payment-status-mapper.ts
 *
 * Run with:
 *   npx tsx --test tests/payment-status-mapper.test.ts
 *   npm test
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"

import {
  fromQueryResult,
  fromWebhookPayload,
  toMedusaStatus,
  STATUS_SUCCESS,
  STATUS_PENDING,
  STATUS_FAILED,
} from "../src/utils/payment-status-mapper"
import { PaymentSessionStatus } from "@medusajs/framework/utils"

// ─── fromQueryResult ──────────────────────────────────────────────────────────

describe("fromQueryResult", () => {
  // ── Success cases ──────────────────────────────────────────────────────────

  it('maps status "00" to success', () => {
    assert.equal(
      fromQueryResult({ status: "00", data: {} }),
      STATUS_SUCCESS
    )
  })

  it('maps paymentState "APPROVED" to success', () => {
    assert.equal(
      fromQueryResult({ status: "99", data: { paymentState: "APPROVED" } }),
      STATUS_SUCCESS
    )
  })

  it('maps paymentState "SUCCESSFUL" to success', () => {
    assert.equal(
      fromQueryResult({ status: "99", data: { paymentState: "SUCCESSFUL" } }),
      STATUS_SUCCESS
    )
  })

  it('maps paymentState "SUCCESS" to success', () => {
    assert.equal(
      fromQueryResult({ status: "99", data: { paymentState: "SUCCESS" } }),
      STATUS_SUCCESS
    )
  })

  it('maps paymentState "COMPLETED" to success', () => {
    assert.equal(
      fromQueryResult({ status: "99", data: { paymentState: "COMPLETED" } }),
      STATUS_SUCCESS
    )
  })

  it('prefers status "00" over a non-success paymentState', () => {
    // status "00" is authoritative — overrides even a PENDING paymentState
    assert.equal(
      fromQueryResult({ status: "00", data: { paymentState: "PENDING" } }),
      STATUS_SUCCESS
    )
  })

  // ── Pending cases ──────────────────────────────────────────────────────────

  it('maps status "01" to pending', () => {
    assert.equal(
      fromQueryResult({ status: "01", data: {} }),
      STATUS_PENDING
    )
  })

  it('maps status "02" to pending', () => {
    assert.equal(
      fromQueryResult({ status: "02", data: {} }),
      STATUS_PENDING
    )
  })

  it('maps status "03" to pending', () => {
    assert.equal(
      fromQueryResult({ status: "03", data: {} }),
      STATUS_PENDING
    )
  })

  it('maps status "04" to pending', () => {
    assert.equal(
      fromQueryResult({ status: "04", data: {} }),
      STATUS_PENDING
    )
  })

  it('maps status "09" to pending', () => {
    assert.equal(
      fromQueryResult({ status: "09", data: {} }),
      STATUS_PENDING
    )
  })

  it('maps status "45" to pending', () => {
    assert.equal(
      fromQueryResult({ status: "45", data: {} }),
      STATUS_PENDING
    )
  })

  it('maps paymentState "PENDING" to pending', () => {
    assert.equal(
      fromQueryResult({ status: "99", data: { paymentState: "PENDING" } }),
      STATUS_PENDING
    )
  })

  it('maps paymentState "PROCESSING" to pending', () => {
    assert.equal(
      fromQueryResult({ status: "99", data: { paymentState: "PROCESSING" } }),
      STATUS_PENDING
    )
  })

  it('maps paymentState "REDIRECT" to pending', () => {
    assert.equal(
      fromQueryResult({ status: "99", data: { paymentState: "REDIRECT" } }),
      STATUS_PENDING
    )
  })

  it('maps paymentState "INITIATED" to pending', () => {
    assert.equal(
      fromQueryResult({ status: "99", data: { paymentState: "INITIATED" } }),
      STATUS_PENDING
    )
  })

  // ── Failed cases ───────────────────────────────────────────────────────────

  it('maps unknown status and paymentState to failed', () => {
    assert.equal(
      fromQueryResult({ status: "99", data: { paymentState: "DECLINED" } }),
      STATUS_FAILED
    )
  })

  it("maps an empty payload to failed", () => {
    assert.equal(fromQueryResult({}), STATUS_FAILED)
  })

  it("handles missing data block gracefully (no throw)", () => {
    // Should not throw; should fall through to failed.
    assert.equal(fromQueryResult({ status: "XX" }), STATUS_FAILED)
  })

  it('maps paymentState "REJECTED" to failed', () => {
    assert.equal(
      fromQueryResult({ status: "99", data: { paymentState: "REJECTED" } }),
      STATUS_FAILED
    )
  })
})

// ─── fromWebhookPayload ───────────────────────────────────────────────────────

describe("fromWebhookPayload", () => {
  it('maps data.status "success" to success', () => {
    assert.equal(
      fromWebhookPayload({ data: { status: "success" } }),
      STATUS_SUCCESS
    )
  })

  it('maps data.status "approved" to success', () => {
    assert.equal(
      fromWebhookPayload({ data: { status: "approved" } }),
      STATUS_SUCCESS
    )
  })

  it('maps data.status "completed" to success', () => {
    assert.equal(
      fromWebhookPayload({ data: { status: "completed" } }),
      STATUS_SUCCESS
    )
  })

  it('maps data.status "SUCCESS" (uppercase) to success', () => {
    assert.equal(
      fromWebhookPayload({ data: { status: "SUCCESS" } }),
      STATUS_SUCCESS
    )
  })

  it('maps data.status "pending" to pending', () => {
    assert.equal(
      fromWebhookPayload({ data: { status: "pending" } }),
      STATUS_PENDING
    )
  })

  it('maps data.status "processing" to pending', () => {
    assert.equal(
      fromWebhookPayload({ data: { status: "processing" } }),
      STATUS_PENDING
    )
  })

  it('maps data.status "redirect" to pending', () => {
    assert.equal(
      fromWebhookPayload({ data: { status: "redirect" } }),
      STATUS_PENDING
    )
  })

  it('maps data.status "failed" to failed', () => {
    assert.equal(
      fromWebhookPayload({ data: { status: "failed" } }),
      STATUS_FAILED
    )
  })

  it("maps empty payload to failed", () => {
    assert.equal(fromWebhookPayload({}), STATUS_FAILED)
  })

  it("handles missing data block gracefully (no throw)", () => {
    assert.equal(fromWebhookPayload({ meta: "x" }), STATUS_FAILED)
  })

  it('maps data.status "APPROVED" (mixed case) to success', () => {
    assert.equal(
      fromWebhookPayload({ data: { status: "APPROVED" } }),
      STATUS_SUCCESS
    )
  })
})

// ─── toMedusaStatus ───────────────────────────────────────────────────────────

describe("toMedusaStatus", () => {
  it("maps success to AUTHORIZED", () => {
    assert.equal(toMedusaStatus(STATUS_SUCCESS), PaymentSessionStatus.AUTHORIZED)
  })

  it("maps pending to PENDING", () => {
    assert.equal(toMedusaStatus(STATUS_PENDING), PaymentSessionStatus.PENDING)
  })

  it("maps failed to ERROR", () => {
    assert.equal(toMedusaStatus(STATUS_FAILED), PaymentSessionStatus.ERROR)
  })
})
