/**
 * Remita Payment Engine API client.
 *
 * Wraps every HTTP call to the Payment Engine with:
 *   - Native `fetch` (Node 18+) — no axios dependency
 *   - Per-request `AbortSignal.timeout()` so hung connections are terminated
 *   - Structured error hierarchy so callers can distinguish transport vs API errors
 *   - Full TypeScript types for all request / response shapes
 *
 * Authentication
 * ─────────────────────────────────────────────────────────────────────────────
 * All requests carry the merchant `secretKey` in the `secretKey` HTTP header
 * as required by the Remita Payment Engine v1 specification.
 *
 * Error hierarchy
 * ─────────────────────────────────────────────────────────────────────────────
 *   RemitaTransportError  — network failure, DNS error, or request timeout
 *   RemitaHttpError       — non-2xx HTTP response from the Payment Engine
 *   RemitaApiError        — 2xx HTTP response but the body signals a failure
 *                           (status !== "00" / "SUCCESS" / "SUCCESSFUL")
 */

// ─── Option types ─────────────────────────────────────────────────────────────

export interface RemitaClientOptions {
  /** Payment Engine base URL.  No trailing slash. */
  baseUrl: string
  /** Merchant secret key issued by Remita. */
  secretKey: string
  /** HTTP request timeout in milliseconds.  Defaults to 30 000. */
  timeoutMs?: number
}

// ─── Request / response shapes ────────────────────────────────────────────────

export interface ChargePayload {
  firstName: string
  lastName: string
  email: string
  phoneNumber: string
  /** Unique opaque identifier for this payment session. */
  paymentIdentifier: string
  /** ISO 4217 currency code in uppercase (e.g. "NGN"). */
  currency: string
  /** Amount in the currency's minor unit (e.g. kobo for NGN). */
  amount: number
  /** Short payment description shown on the hosted payment page. */
  narration: string
  /** URL the browser is redirected to after the customer pays. */
  returnUrl: string
}

export interface ChargeResponse {
  /** Remita API status code.  "00" or "SUCCESS" / "SUCCESSFUL" = success. */
  status: string
  message: string
  data: {
    /** Hosted payment page URL. */
    paymentLink?: string
    paymentUrl?: string
    /** Remita Retrieval Reference. */
    rrr?: string
    rrrNumber?: string
    paymentState?: string
    transactionId?: string
    [key: string]: unknown
  }
}

export interface QueryResponse {
  /** Remita API status code. */
  status: string
  message: string
  data: {
    paymentState?: string
    transactionStatus?: string
    paymentIdentifier?: string
    amount?: number
    currency?: string
    [key: string]: unknown
  }
}

// ─── Error classes ────────────────────────────────────────────────────────────

/**
 * Thrown when the HTTP transport layer fails (network error, DNS failure,
 * request timeout, or non-JSON response body).
 */
export class RemitaTransportError extends Error {
  override readonly name = "RemitaTransportError"

  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message)
    // Restore the prototype chain in case the class is transpiled to ES5.
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * Thrown when the Payment Engine returns a non-2xx HTTP status code.
 *
 * The raw response body is preserved for diagnostics.
 */
export class RemitaHttpError extends Error {
  override readonly name = "RemitaHttpError"

  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly body: string
  ) {
    super(message)
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * Thrown when the Payment Engine returns a 2xx HTTP response but the body
 * signals a business-logic failure (e.g. status !== "00").
 */
export class RemitaApiError extends Error {
  override readonly name = "RemitaApiError"

  constructor(
    message: string,
    public readonly apiStatus: string,
    public readonly apiMessage: string
  ) {
    super(message)
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class RemitaCheckoutClient {
  private readonly baseUrl:   string
  private readonly secretKey: string
  private readonly timeoutMs: number

  constructor(options: RemitaClientOptions) {
    // Strip trailing slash so callers can safely prefix paths with "/".
    this.baseUrl   = options.baseUrl.replace(/\/+$/, "")
    this.secretKey = options.secretKey
    this.timeoutMs = options.timeoutMs ?? 30_000
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Build an `AbortSignal` that fires after `this.timeoutMs`.
   *
   * Uses `AbortSignal.timeout()` (Node 18+) to avoid leaking timers.
   */
  private abortSignal(): AbortSignal {
    return AbortSignal.timeout(this.timeoutMs)
  }

  private defaultHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "Accept":       "application/json",
      "secretKey":    this.secretKey,
    }
  }

  /**
   * Execute an HTTP request and return the parsed JSON body.
   *
   * Normalises all error conditions into the three error classes so that
   * callers have a single, predictable error hierarchy to handle.
   *
   * @param method - "GET" or "POST".
   * @param path   - URL path relative to `baseUrl`, must start with "/".
   * @param body   - Optional request body (JSON-serialised).
   * @returns Parsed response body.
   * @throws {RemitaTransportError} On network / timeout failures or non-JSON body.
   * @throws {RemitaHttpError}      On non-2xx HTTP responses.
   */
  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`

    let response: Response
    let rawText: string

    try {
      response = await fetch(url, {
        method,
        headers: this.defaultHeaders(),
        body:    body !== undefined ? JSON.stringify(body) : undefined,
        signal:  this.abortSignal(),
      })
      rawText = await response.text()
    } catch (err: unknown) {
      const isTimeout =
        err instanceof Error &&
        (err.name === "TimeoutError" || err.name === "AbortError")

      throw new RemitaTransportError(
        isTimeout
          ? `Remita API request timed out after ${this.timeoutMs}ms (${method} ${url})`
          : `Remita API network error (${method} ${url}): ${String(err)}`,
        err
      )
    }

    if (!response.ok) {
      throw new RemitaHttpError(
        `Remita API HTTP ${response.status} (${method} ${url})`,
        response.status,
        rawText
      )
    }

    let parsed: T
    try {
      parsed = JSON.parse(rawText) as T
    } catch {
      throw new RemitaTransportError(
        `Remita API returned non-JSON body (${method} ${url}): ${rawText.slice(0, 200)}`
      )
    }

    return parsed
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Initiate a redirect-checkout payment session.
   *
   * Calls `POST /api/v1/payment/charge`.
   *
   * On success the response's `data.paymentLink` is the URL the storefront
   * must redirect the browser to so the customer can complete payment.
   *
   * @param payload - Charge request data.
   * @returns Parsed charge response (contains `paymentLink`, `rrr`, etc.).
   * @throws {RemitaTransportError} On network / timeout failures.
   * @throws {RemitaHttpError}      On non-2xx HTTP responses.
   * @throws {RemitaApiError}       When `status` does not indicate success.
   */
  async initiateCharge(payload: ChargePayload): Promise<ChargeResponse> {
    const result = await this.request<ChargeResponse>(
      "POST",
      "/api/v1/payment/charge",
      payload
    )

    const statusUpper = (result.status ?? "").toUpperCase()
    const ok =
      result.status === "00" ||
      statusUpper === "SUCCESS" ||
      statusUpper === "SUCCESSFUL"

    if (!ok) {
      throw new RemitaApiError(
        `Remita charge initiation failed: ${result.message ?? "Unknown error"}`,
        result.status,
        result.message
      )
    }

    return result
  }

  /**
   * Query the current status of a payment by its identifier.
   *
   * Calls `GET /api/v1/payment/query/{paymentIdentifier}`.
   *
   * Note: this method does NOT throw on a non-"00" API status — the caller
   * is responsible for interpreting the response via `payment-status-mapper`.
   * This allows callers to distinguish between "payment failed" (a valid API
   * response) and "request failed" (a transport / HTTP error).
   *
   * @param paymentIdentifier - The identifier used during charge initiation.
   * @returns Parsed query response.
   * @throws {RemitaTransportError} On network / timeout failures.
   * @throws {RemitaHttpError}      On non-2xx HTTP responses.
   */
  async queryPayment(paymentIdentifier: string): Promise<QueryResponse> {
    return this.request<QueryResponse>(
      "GET",
      `/api/v1/payment/query/${encodeURIComponent(paymentIdentifier)}`
    )
  }
}
