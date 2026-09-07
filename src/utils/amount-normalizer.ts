/**
 * Amount normalizer utilities.
 *
 * Medusa v2 stores monetary values as integers in the currency's minor unit
 * (e.g. kobo for NGN, cents for USD).  The Remita Payment Engine also expects
 * amounts in kobo, so for NGN no conversion is needed.  The helpers below make
 * the intent explicit and guard against floating-point drift.
 */

/**
 * Convert a naira (major unit) value to kobo (minor unit).
 *
 * Use this when the incoming amount is expressed in naira (e.g. 1500.00)
 * and the Payment Engine expects kobo (e.g. 150000).
 *
 * @param amount - Amount in naira (major unit).  May be a float.
 * @returns Integer kobo value.
 * @throws {RangeError} When `amount` is not a finite number.
 */
export function toKobo(amount: number): number {
  if (!Number.isFinite(amount)) {
    throw new RangeError(`toKobo: expected a finite number, got ${amount}`)
  }
  return Math.round(amount * 100)
}

/**
 * Convert kobo (minor unit) back to naira (major unit).
 *
 * @param kobo - Integer kobo value.
 * @returns Naira value rounded to 2 decimal places.
 */
export function fromKobo(kobo: number): number {
  return Math.round((kobo / 100) * 100) / 100
}

/**
 * Ensure an already-minor-unit value is a safe integer.
 *
 * Medusa v2 passes `amount` as a BigInt-safe integer in the currency's minor
 * unit.  Use this guard when you receive the amount from Medusa's payment
 * context and want to be certain it is a plain integer before sending it to
 * the Payment Engine.
 *
 * @param amount - Integer minor-unit amount (may be a float due to JS coercion).
 * @returns The same value rounded to the nearest integer.
 * @throws {RangeError} When `amount` is not a finite number.
 */
export function ensureMinorUnit(amount: number): number {
  if (!Number.isFinite(amount)) {
    throw new RangeError(`ensureMinorUnit: expected a finite number, got ${amount}`)
  }
  return Math.round(amount)
}
