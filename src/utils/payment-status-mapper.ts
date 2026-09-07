/**
 * Payment status mapper — mirrors the logic in the PHP PaymentStatusMapper.
 *
 * The Remita Payment Engine returns two distinct status signals:
 *   - A top-level `status` string code  (e.g. "00", "01", "02" …)
 *   - A `data.paymentState` string       (e.g. "APPROVED", "PENDING" …)
 *
 * This module normalises both into one of three canonical string values and
 * one of the three Medusa PaymentSessionStatus enum values so callers never
 * hard-code these strings themselves.
 *
 * Status code reference (Payment Engine v1 docs)
 * ────────────────────────────────────────────────
 * "00"                   → success
 * "01", "02", "03", "04" → in-progress / still-processing
 * "09", "45"             → redirect / awaiting confirmation
 * anything else          → failure / unknown
 */

import { PaymentSessionStatus } from "@medusajs/framework/utils"

// ─── Canonical status constants ───────────────────────────────────────────────

/** Canonical status strings shared across the plugin. */
export const STATUS_SUCCESS = "success" as const
export const STATUS_PENDING = "pending" as const
export const STATUS_FAILED  = "failed"  as const

export type CanonicalStatus =
  | typeof STATUS_SUCCESS
  | typeof STATUS_PENDING
  | typeof STATUS_FAILED

// ─── Lookup sets ──────────────────────────────────────────────────────────────

/**
 * Remita API top-level status codes that mean "still processing / in-flight".
 *
 * Codes sourced from Payment Engine v1 documentation and cross-checked against
 * the PHP reference implementation.
 */
const PENDING_CODES = new Set(["01", "02", "03", "04", "09", "45"])

/** Payment Engine `data.paymentState` values that mean success. */
const SUCCESS_STATES = new Set(["APPROVED", "SUCCESSFUL", "SUCCESS", "COMPLETED"])

/** Payment Engine `data.paymentState` values that mean pending / in-flight. */
const PENDING_STATES = new Set(["PENDING", "PROCESSING", "REDIRECT", "INITIATED"])

// ─── Query response mapper ────────────────────────────────────────────────────

/**
 * Derive a canonical status from a Payment Engine query response body.
 *
 * Precedence:
 *   1. Top-level `status === "00"` → success (authoritative).
 *   2. `data.paymentState` in SUCCESS_STATES → success.
 *   3. Top-level `status` in PENDING_CODES → pending.
 *   4. `data.paymentState` in PENDING_STATES → pending.
 *   5. Anything else → failed.
 *
 * @param payload - Parsed JSON body returned by `GET /api/v1/payment/query/{ref}`.
 * @returns One of "success", "pending", or "failed".
 */
export function fromQueryResult(payload: Record<string, unknown>): CanonicalStatus {
  const status       = String(payload["status"] ?? "").trim()
  const dataBlock    = (payload["data"] ?? {}) as Record<string, unknown>
  const paymentState = String(dataBlock["paymentState"] ?? "").toUpperCase().trim()

  // 1. Authoritative success code
  if (status === "00") {
    return STATUS_SUCCESS
  }

  // 2. Success state in data block
  if (SUCCESS_STATES.has(paymentState)) {
    return STATUS_SUCCESS
  }

  // 3. Pending status code
  if (PENDING_CODES.has(status)) {
    return STATUS_PENDING
  }

  // 4. Pending state in data block
  if (PENDING_STATES.has(paymentState)) {
    return STATUS_PENDING
  }

  // 5. Everything else is a failure
  return STATUS_FAILED
}

// ─── Webhook payload mapper ───────────────────────────────────────────────────

/**
 * Derive a canonical status from an inbound Remita webhook payload.
 *
 * Remita POSTs a JSON body with a `data` block that contains a `status` field
 * expressed as a human-readable string (not the numeric API codes).
 *
 * @param payload - Parsed JSON body of the webhook POST.
 * @returns One of "success", "pending", or "failed".
 */
export function fromWebhookPayload(payload: Record<string, unknown>): CanonicalStatus {
  const dataBlock = (payload["data"] ?? {}) as Record<string, unknown>
  const status    = String(dataBlock["status"] ?? "").toLowerCase().trim()

  if (["success", "approved", "completed"].includes(status)) {
    return STATUS_SUCCESS
  }

  if (["pending", "processing", "redirect"].includes(status)) {
    return STATUS_PENDING
  }

  return STATUS_FAILED
}

// ─── Medusa PaymentSessionStatus mapper ──────────────────────────────────────

/**
 * Map a canonical status to a Medusa `PaymentSessionStatus` enum value.
 *
 * @param canonical - Result of `fromQueryResult` or `fromWebhookPayload`.
 * @returns The corresponding Medusa session status.
 */
export function toMedusaStatus(canonical: CanonicalStatus): PaymentSessionStatus {
  switch (canonical) {
    case STATUS_SUCCESS:
      return PaymentSessionStatus.AUTHORIZED
    case STATUS_PENDING:
      return PaymentSessionStatus.PENDING
    case STATUS_FAILED:
    default:
      return PaymentSessionStatus.ERROR
  }
}
