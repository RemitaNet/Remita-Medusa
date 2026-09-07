/**
 * Remita Payment Provider for Medusa v2.
 *
 * Implements the AbstractPaymentProvider contract so Medusa's Payment Module
 * can drive the Remita redirect-checkout flow end-to-end.
 *
 * Payment flow overview
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Customer selects "Remita" at checkout.
 * 2. Medusa calls `initiatePayment`:
 *      - A unique `paymentIdentifier` is generated and stored in the session.
 *      - We POST to the Payment Engine `/api/v1/payment/charge` endpoint.
 *      - The hosted-payment-page URL (`payment_url`) is returned in session data.
 * 3. The storefront reads `session.data.payment_url` and redirects the browser.
 * 4. The customer completes (or cancels) payment on Remita's hosted page.
 * 5. Remita redirects the browser back to `returnUrl`.
 * 6. Medusa calls `authorizePayment`:
 *      - We query the Payment Engine `/api/v1/payment/query/{id}` endpoint.
 *      - The response is mapped to AUTHORIZED, PENDING, or ERROR.
 * 7. Medusa calls `capturePayment` (no-op — Remita captures instantly).
 * 8. Optionally Remita POSTs a webhook → `getWebhookActionAndData` maps it to
 *    a Medusa WebhookActionResult (authorized / failed / not_supported).
 *
 * Error strategy
 * ─────────────────────────────────────────────────────────────────────────────
 * - `initiatePayment`: returns a structured error (does not throw) so Medusa
 *   can surface a user-friendly message without crashing the checkout flow.
 * - `authorizePayment`: returns PENDING on transient errors so the storefront
 *   can retry.  Returns ERROR only on confirmed payment failures.
 * - All other methods: safe no-ops — return current session data unchanged.
 */

import { AbstractPaymentProvider, PaymentSessionStatus } from "@medusajs/framework/utils"
import type {
  InitiatePaymentInput,
  InitiatePaymentOutput,
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  RefundPaymentInput,
  RefundPaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  WebhookActionResult,
  ProviderWebhookPayload,
} from "@medusajs/framework/types"

import {
  RemitaCheckoutClient,
  RemitaTransportError,
  RemitaHttpError,
  RemitaApiError,
} from "../services/remita-checkout"
import { generateIdentifier } from "../utils/payment-identifier"
import { ensureMinorUnit } from "../utils/amount-normalizer"
import {
  fromQueryResult,
  fromWebhookPayload,
  toMedusaStatus,
  STATUS_SUCCESS,
  STATUS_FAILED,
} from "../utils/payment-status-mapper"

// ─── Plugin options ───────────────────────────────────────────────────────────

export interface RemitaOptions {
  /**
   * Merchant secret key from the Remita Merchant Console.
   * Required.  Injected via environment variable in production:
   * `REMITA_SECRET_KEY`.
   */
  secret_key: string

  /**
   * Merchant public key.  Currently stored for future client-side SDK
   * integration; not transmitted in server-side calls.
   */
  public_key: string

  /**
   * Payment Engine base URL (no trailing slash).
   * Defaults to the QA environment.  Set `REMITA_BASE_URL` in production:
   *   QA:   "https://api-checkout-qa.systemspecsng.com"
   *   Live: "https://api-checkout.remita.net"
   */
  base_url?: string

  /**
   * HTTP request timeout in milliseconds.
   * Defaults to 30 000 (30 s).
   */
  timeout_ms?: number
}

// ─── Session data shape ───────────────────────────────────────────────────────

/**
 * Data stored on the Medusa PaymentSession (`session.data`).
 *
 * All fields are optional so that downstream code can handle partial states
 * gracefully (e.g. if the session was never successfully initiated).
 */
export interface RemitaSessionData {
  /** The identifier sent to and returned by the Payment Engine. */
  payment_identifier?: string
  /** Hosted payment page URL the storefront must redirect to. */
  payment_url?: string
  /** Remita Retrieval Reference (RRR) — populated after initiation. */
  rrr?: string
  /** Last known `paymentState` value from the Payment Engine. */
  payment_state?: string
  /** Canonical status: "success" | "pending" | "failed". */
  canonical_status?: string
  /** ISO 8601 timestamp of the last status update (set by this plugin). */
  updated_at?: string
  /** Pass-through of any extra fields returned by the Payment Engine. */
  [key: string]: unknown
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export class RemitaPaymentProvider extends AbstractPaymentProvider<RemitaOptions> {
  static identifier = "remita"

  private readonly client:    RemitaCheckoutClient
  readonly publicKey: string   // intentionally non-private: usable in storefront

  constructor(container: Record<string, unknown>, options: RemitaOptions) {
    super(container, options)

    if (!options.secret_key) {
      throw new Error("RemitaPaymentProvider: `secret_key` option is required.")
    }
    if (!options.public_key) {
      throw new Error("RemitaPaymentProvider: `public_key` option is required.")
    }

    this.publicKey = options.public_key
    this.client    = new RemitaCheckoutClient({
      baseUrl:   options.base_url ?? "https://api-checkout-qa.systemspecsng.com",
      secretKey: options.secret_key,
      timeoutMs: options.timeout_ms ?? 30_000,
    })
  }

  // ─── Initiate ───────────────────────────────────────────────────────────────

  /**
   * Called when the customer selects Remita at checkout (or when the cart
   * changes and the payment session must be re-created).
   *
   * POSTs to `POST /api/v1/payment/charge` and stores the hosted-payment-page
   * URL in `data.payment_url`.  The storefront must redirect the browser to
   * that URL.
   *
   * On API failure this method returns a structured error object rather than
   * throwing so Medusa can handle the error gracefully and display a message
   * to the customer.
   */
  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    const { amount, currency_code, context } = input

    // `context` contains billing address, cart ID, email, etc.  Guard against
    // missing fields because not all storefront configurations populate all fields.
    const ctx            = (context ?? {}) as Record<string, unknown>
    const billing        = (ctx["billing_address"] ?? {}) as Record<string, unknown>
    const cartId         = String(ctx["cart_id"] ?? "cart")
    const email          = String(ctx["email"]    ?? "guest@example.com")
    const phone          = String(billing["phone"] ?? ctx["phone"] ?? "0000000000")
    const firstName      = String(billing["first_name"] ?? "Guest")
    const lastName       = String(billing["last_name"]  ?? "Customer")
    const returnUrl      = String(
      ctx["return_url"] ??
      "https://localhost:9000/api/hooks/payment/remita/return"
    )

    // Re-use an existing identifier when updating a session so the storefront
    // can detect that the link has changed and prompt the customer to re-pay.
    const existingIdentifier = String(
      (input.data as Record<string, unknown> | undefined)?.["payment_identifier"] ?? ""
    )
    const paymentIdentifier = existingIdentifier || generateIdentifier(cartId)

    const amountInMinorUnit = ensureMinorUnit(Number(amount))

    const payload = {
      firstName,
      lastName,
      email,
      phoneNumber: phone,
      paymentIdentifier,
      currency:   currency_code.toUpperCase(),
      amount:     amountInMinorUnit,
      narration:  `Medusa Order - ${cartId} - Ref: ${paymentIdentifier}`,
      returnUrl,
    }

    let chargeResult: Awaited<ReturnType<RemitaCheckoutClient["initiateCharge"]>>

    try {
      chargeResult = await this.client.initiateCharge(payload)
    } catch (err: unknown) {
      const message  = err instanceof Error ? err.message : String(err)
      const code     = this.resolveErrorCode(err)
      const errData: RemitaSessionData = {
        payment_identifier: paymentIdentifier,
        canonical_status:   "failed",
        updated_at:         new Date().toISOString(),
        error_message:      message,
        error_code:         code,
      }
      return {
        id:    paymentIdentifier,
        data:  errData,
        error: { message, code },
      } as unknown as InitiatePaymentOutput
    }

    const apiData      = chargeResult.data ?? {}
    const sessionData: RemitaSessionData = {
      payment_identifier: paymentIdentifier,
      payment_url:        String(apiData["paymentLink"] ?? apiData["paymentUrl"] ?? ""),
      rrr:                String(apiData["rrr"]         ?? apiData["rrrNumber"]  ?? ""),
      payment_state:      String(apiData["paymentState"] ?? "PENDING"),
      canonical_status:   "pending",
      updated_at:         new Date().toISOString(),
    }

    return {
      id:   paymentIdentifier,
      data: sessionData,
    }
  }

  // ─── Authorize ──────────────────────────────────────────────────────────────

  /**
   * Called after the browser returns from the Remita hosted payment page.
   *
   * Queries the Payment Engine for the current payment state and maps it to a
   * Medusa `PaymentSessionStatus`:
   *   - AUTHORIZED on confirmed success
   *   - PENDING on transient / in-flight states (caller should retry)
   *   - ERROR on confirmed failures
   *
   * Transport errors keep the session in PENDING so the storefront can retry
   * rather than immediately marking the order as failed.
   */
  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    const sessionData  = (input.data ?? {}) as RemitaSessionData
    const identifier   = sessionData.payment_identifier ?? ""

    if (!identifier) {
      return {
        status: PaymentSessionStatus.ERROR,
        data:   {
          ...sessionData,
          error_message: "Missing payment_identifier in session data.",
          updated_at:    new Date().toISOString(),
        },
      }
    }

    let queryResult: Awaited<ReturnType<RemitaCheckoutClient["queryPayment"]>>

    try {
      queryResult = await this.client.queryPayment(identifier)
    } catch (err: unknown) {
      // Keep the session pending on transient network/timeout errors.
      return {
        status: PaymentSessionStatus.PENDING,
        data:   {
          ...sessionData,
          error_message: err instanceof Error ? err.message : String(err),
          updated_at:    new Date().toISOString(),
        },
      }
    }

    const canonical    = fromQueryResult(queryResult as Record<string, unknown>)
    const medusaStatus = toMedusaStatus(canonical)
    const qData        = queryResult.data ?? {}

    return {
      status: medusaStatus,
      data:   {
        ...sessionData,
        payment_state:    String(qData["paymentState"] ?? qData["transactionStatus"] ?? ""),
        canonical_status: canonical,
        updated_at:       new Date().toISOString(),
      },
    }
  }

  // ─── Capture ────────────────────────────────────────────────────────────────

  /**
   * Called after successful authorization.
   *
   * Remita Checkout is a redirect (collect-on-redirect) gateway — funds are
   * settled on the hosted page.  This method is a deliberate no-op and marks
   * the canonical status as "success" to reflect the captured state.
   */
  async capturePayment(
    input: CapturePaymentInput
  ): Promise<CapturePaymentOutput> {
    return {
      data: {
        ...(input.data as RemitaSessionData),
        canonical_status: STATUS_SUCCESS,
        updated_at:       new Date().toISOString(),
      },
    }
  }

  // ─── Refund ─────────────────────────────────────────────────────────────────

  /**
   * Remita Checkout does not currently expose a programmatic refund API.
   *
   * Returns session data unchanged so Medusa can record the refund request.
   * Implement this method once the Payment Engine exposes a refund endpoint.
   */
  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    return { data: input.data as RemitaSessionData }
  }

  // ─── Cancel ─────────────────────────────────────────────────────────────────

  /**
   * Redirect-checkout payments cannot be cancelled remotely once initiated.
   *
   * Returns session data unchanged.
   */
  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    return { data: input.data as RemitaSessionData }
  }

  // ─── Delete ─────────────────────────────────────────────────────────────────

  /**
   * No remote resource to delete — the payment lives in Remita's systems.
   *
   * Returns current session data so Medusa can complete its local cleanup.
   */
  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: input.data as RemitaSessionData }
  }

  // ─── Retrieve ───────────────────────────────────────────────────────────────

  /**
   * Fetch the latest payment data from the Payment Engine.
   *
   * Falls back gracefully to the stored session data if the query fails (e.g.
   * during a network outage) so the caller always gets a usable response.
   */
  async retrievePayment(
    input: RetrievePaymentInput
  ): Promise<RetrievePaymentOutput> {
    const sessionData = (input.data ?? {}) as RemitaSessionData
    const identifier  = sessionData.payment_identifier ?? ""

    if (!identifier) {
      return { data: sessionData }
    }

    try {
      const result = await this.client.queryPayment(identifier)
      return {
        data: {
          ...sessionData,
          ...(result.data as Record<string, unknown>),
          updated_at: new Date().toISOString(),
        },
      }
    } catch {
      // Silently fall back to cached session data on query failure.
      return { data: sessionData }
    }
  }

  // ─── Update ─────────────────────────────────────────────────────────────────

  /**
   * Re-initiate the payment session when the cart changes (e.g. amount update,
   * shipping method change).
   *
   * Preserves the existing `payment_identifier` if one is present so the
   * storefront can detect that the payment link has changed and prompt the
   * customer to restart the checkout flow.
   */
  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const existingData = (input.data ?? {}) as RemitaSessionData
    const merged: InitiatePaymentInput = {
      ...input,
      data: { payment_identifier: existingData.payment_identifier },
    }
    return this.initiatePayment(merged)
  }

  // ─── Get status ─────────────────────────────────────────────────────────────

  /**
   * Return the current session status by querying the Payment Engine.
   *
   * Returns PENDING on any query failure so the caller can retry.
   */
  async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    const sessionData = (input.data ?? {}) as RemitaSessionData
    const identifier  = sessionData.payment_identifier ?? ""

    if (!identifier) {
      return { status: PaymentSessionStatus.PENDING }
    }

    try {
      const result    = await this.client.queryPayment(identifier)
      const canonical = fromQueryResult(result as Record<string, unknown>)
      return { status: toMedusaStatus(canonical) }
    } catch {
      return { status: PaymentSessionStatus.PENDING }
    }
  }

  // ─── Webhook ────────────────────────────────────────────────────────────────

  /**
   * Handle an inbound webhook POST from the Remita Payment Engine.
   *
   * Medusa calls this method when a POST arrives at the registered webhook
   * route.  The method maps the payload to a `WebhookActionResult` that Medusa
   * uses to advance the order state machine.
   *
   * Expected webhook payload shape:
   * ```json
   * {
   *   "data": {
   *     "paymentIdentifier": "medusa-cart_01HXY-1718000000-a4b7c2",
   *     "status": "success",
   *     "amount": 150000,
   *     "currency": "NGN"
   *   }
   * }
   * ```
   *
   * Webhook action mapping:
   * - success   → "authorized" (Medusa captures the payment)
   * - failed    → "failed"     (Medusa marks the payment as failed)
   * - pending   → "not_supported" (Medusa takes no action yet)
   * - no id     → "not_supported" (unrecognised payload — ignore)
   */
  async getWebhookActionAndData(
    webhookData: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    const payload = webhookData as Record<string, unknown>
    const data    = (payload["data"] ?? {}) as Record<string, unknown>

    const paymentIdentifier = String(data["paymentIdentifier"] ?? "")

    if (!paymentIdentifier) {
      return {
        action: "not_supported",
        data:   { session_id: "", amount: 0 },
      }
    }

    const canonical = fromWebhookPayload(payload)

    if (canonical === STATUS_SUCCESS) {
      return {
        action: "authorized",
        data:   {
          session_id:         paymentIdentifier,
          amount:             Number(data["amount"] ?? 0),
          payment_identifier: paymentIdentifier,
          payment_state:      String(data["status"] ?? ""),
          canonical_status:   canonical,
          updated_at:         new Date().toISOString(),
        },
      }
    }

    if (canonical === STATUS_FAILED) {
      return {
        action: "failed",
        data:   {
          session_id:         paymentIdentifier,
          amount:             Number(data["amount"] ?? 0),
          payment_identifier: paymentIdentifier,
          canonical_status:   canonical,
          updated_at:         new Date().toISOString(),
        },
      }
    }

    // Pending — Medusa takes no action until a success or failure webhook arrives.
    return {
      action: "not_supported",
      data:   {
        session_id:       paymentIdentifier,
        amount:           Number(data["amount"] ?? 0),
        canonical_status: canonical,
      },
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Map a thrown error to a short machine-readable error code.
   */
  private resolveErrorCode(err: unknown): string {
    if (err instanceof RemitaTransportError) return "TRANSPORT_ERROR"
    if (err instanceof RemitaHttpError)      return `HTTP_${err.httpStatus}`
    if (err instanceof RemitaApiError)       return `API_${err.apiStatus}`
    return "UNKNOWN_ERROR"
  }
}

export default RemitaPaymentProvider
