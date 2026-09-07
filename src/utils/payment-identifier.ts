/**
 * Payment identifier helpers.
 *
 * Format: `medusa-{cartId}-{timestamp}-{random6}`
 *
 * The identifier is passed to the Remita Payment Engine as `paymentIdentifier`
 * and stored on the Medusa payment session so the callback / webhook handler
 * can look it up later.
 *
 * The cart ID is embedded so that, if a webhook arrives without additional
 * context, the cart can be recovered via `extractCartId()`.
 *
 * Design notes
 * ─────────────
 * - `timestamp` is Unix seconds (not milliseconds) — keeps the string short.
 * - `rand` is 6 characters from a URL-safe, visually-unambiguous alphabet so
 *   the identifier can safely appear in query strings and log lines.
 * - `Math.random` is intentional: the combination of timestamp + cart ID +
 *   random suffix provides enough uniqueness for non-cryptographic identifiers.
 */

const PREFIX = "medusa" as const

/** Characters used for the random suffix (URL-safe, no ambiguous glyphs). */
const RAND_CHARS = "abcdefghjkmnpqrstuvwxyz23456789"

/**
 * Generate a random suffix of exactly `length` characters.
 */
function randomSuffix(length = 6): string {
  let out = ""
  for (let i = 0; i < length; i++) {
    out += RAND_CHARS[Math.floor(Math.random() * RAND_CHARS.length)]
  }
  return out
}

/**
 * Generate a unique Remita `paymentIdentifier` for a Medusa cart.
 *
 * @param cartId    - Medusa cart ID (e.g. `"cart_01HXY…"`).
 * @param timestamp - Unix timestamp in seconds (defaults to `Math.floor(Date.now()/1000)`).
 * @param rand      - Random suffix (defaults to a 6-char random string).
 * @returns A string like `"medusa-cart_01HXY-1718000000-a4b7c2"`.
 */
export function generateIdentifier(
  cartId: string,
  timestamp?: number,
  rand?: string
): string {
  const ts  = timestamp ?? Math.floor(Date.now() / 1000)
  const sfx = rand     ?? randomSuffix(6)
  return `${PREFIX}-${cartId}-${ts}-${sfx}`
}

/**
 * Extract the cart ID embedded in a payment identifier.
 *
 * @param identifier - A string previously produced by `generateIdentifier`.
 * @returns The cart ID, or `null` if the string does not match the expected
 *          format.
 */
export function extractCartId(identifier: string): string | null {
  // Pattern: medusa-{cartId}-{digits}-{alphanum}
  // cartId itself can contain hyphens (e.g. "cart_01HXY-extra"), so we capture
  // everything between the first "medusa-" segment and the last two
  // hyphen-delimited segments (timestamp digits + random suffix).
  const match = identifier.match(/^medusa-(.+)-(\d+)-([a-z0-9]+)$/)
  if (!match) return null
  return match[1] ?? null
}

/**
 * Validate that a string looks like a Remita payment identifier produced by
 * this plugin.
 *
 * @param identifier - Candidate string.
 * @returns `true` if the identifier matches the expected format.
 */
export function isValidIdentifier(identifier: string): boolean {
  return extractCartId(identifier) !== null
}
