/**
 * Remita Payment Provider — Medusa v2 plugin entry point.
 *
 * Register this module in your Medusa project's `medusa-config.ts`:
 *
 * ```ts
 * import { Modules } from "@medusajs/framework/utils"
 *
 * export default defineConfig({
 *   modules: [
 *     {
 *       resolve: "@medusajs/payment",
 *       options: {
 *         providers: [
 *           {
 *             resolve: "medusa-payment-remita",
 *             id:      "remita",
 *             options: {
 *               secret_key: process.env.REMITA_SECRET_KEY!,
 *               public_key: process.env.REMITA_PUBLIC_KEY!,
 *               // Optional — defaults to QA environment:
 *               // base_url: "https://api-checkout.remita.net",
 *               // timeout_ms: 30000,
 *             },
 *           },
 *         ],
 *       },
 *     },
 *   ],
 * })
 * ```
 */

import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import { RemitaPaymentProvider } from "./providers/remita-payment"

// ─── Default export: Medusa module ────────────────────────────────────────────

export default ModuleProvider(Modules.PAYMENT, {
  services: [RemitaPaymentProvider],
})

// ─── Named exports: types ─────────────────────────────────────────────────────

export type { RemitaOptions }        from "./providers/remita-payment"
export type { RemitaSessionData }    from "./providers/remita-payment"

// ─── Named exports: provider class ───────────────────────────────────────────

export { RemitaPaymentProvider }

// ─── Named exports: service / client ─────────────────────────────────────────

export { RemitaCheckoutClient }      from "./services/remita-checkout"
export type {
  ChargePayload,
  ChargeResponse,
  QueryResponse,
  RemitaClientOptions,
}                                    from "./services/remita-checkout"
export {
  RemitaTransportError,
  RemitaHttpError,
  RemitaApiError,
}                                    from "./services/remita-checkout"

// ─── Named exports: utilities ─────────────────────────────────────────────────

export {
  generateIdentifier,
  extractCartId,
  isValidIdentifier,
}                                    from "./utils/payment-identifier"

export {
  toKobo,
  fromKobo,
  ensureMinorUnit,
}                                    from "./utils/amount-normalizer"

export {
  fromQueryResult,
  fromWebhookPayload,
  toMedusaStatus,
  STATUS_SUCCESS,
  STATUS_PENDING,
  STATUS_FAILED,
}                                    from "./utils/payment-status-mapper"
export type { CanonicalStatus }      from "./utils/payment-status-mapper"
