/**
 * Prices as a person types them, and as the API stores them.
 *
 * An organiser types "35" or "$35.00"; the API takes integer minor units,
 * 3500. The conversion is here, in the browser, as a convenience only: the
 * server never takes a price from a request it did not validate as whole cents,
 * and checkout never takes a price from a request at all.
 *
 * The number of decimals is the currency's own, from `Intl` — two for USD and
 * INR, none for JPY — so a yen price is not silently multiplied by a hundred.
 *
 * @module lib/money
 */

/** The largest price the API accepts, in minor units (`MAX_CENTS`). */
export const MAX_CENTS = 1_000_000_000

/**
 * How many decimal places a currency's minor unit has.
 *
 * @param {string} currency An ISO 4217 code.
 * @returns {number} The digits after the decimal point; 2 when the code is unknown.
 */
export function currencyMinorDigits(currency) {
  try {
    return (
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency || 'USD',
      }).resolvedOptions().maximumFractionDigits ?? 2
    )
  } catch {
    return 2
  }
}

/**
 * A currency symbol or three-letter code before or after the number.
 *
 * Only there: a letter anywhere else is a typo, and a typo must not quietly
 * become a different, valid price — `12x5` is not $125.
 */
const CURRENCY_AFFIXES = /^(?:[A-Za-z]{3}|[$€£¥₹])?\s*(?<number>.*?)\s*(?:[A-Za-z]{3}|[$€£¥₹])?$/u

/**
 * Read a price typed in major units into minor units.
 *
 * Accepts a currency symbol or code before or after the number, and commas or
 * spaces between groups of three digits. Refuses anything else — a stray
 * letter, a negative, an exponent, more decimals than the currency has, and
 * anything above {@link MAX_CENTS}; each refusal is a sentence.
 *
 * @param {string} text What was typed.
 * @param {string} [currency] The ISO 4217 code the price is in.
 * @returns {{cents: number}|{error: string}} The minor units, or why not.
 */
export function parseMoneyInput(text, currency = 'USD') {
  const digits = currencyMinorDigits(currency)
  const raw = typeof text === 'string' ? text.trim() : String(text ?? '').trim()

  if (raw.length === 0) return { error: 'Enter a price. Use 0 for a free ticket.' }
  if (/-/.test(raw)) return { error: 'A price cannot be negative.' }

  const number = raw.match(CURRENCY_AFFIXES)?.groups?.number ?? raw

  if (
    !/^(\d{1,3}(,\d{3})+|\d{1,3}( \d{3})+|\d+)(\.\d*)?$/.test(number) &&
    !/^\.\d+$/.test(number)
  ) {
    return { error: 'Type the price as a plain number, such as 35.00.' }
  }

  const [whole = '0', fraction = ''] = number.replace(/[, ]/g, '').split('.')

  if (fraction.length > digits) {
    return {
      error:
        digits === 0
          ? `${currency} prices have no decimal places.`
          : `Use at most ${digits} decimal places.`,
    }
  }

  const cents = Number(whole || '0') * 10 ** digits + Number(fraction.padEnd(digits, '0') || '0')

  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) {
    return { error: 'That price is too large.' }
  }

  return { cents }
}

/**
 * Show minor units in the price box.
 *
 * Plain digits and a point — no symbol and no grouping — so what is shown is
 * exactly what reads back.
 *
 * @param {number|null|undefined} cents The minor units.
 * @param {string} [currency] The ISO 4217 code.
 * @returns {string} For example `35.00`, or an empty string for no value.
 */
export function toMoneyInput(cents, currency = 'USD') {
  if (!Number.isInteger(cents)) return ''

  const digits = currencyMinorDigits(currency)

  if (digits === 0) return String(cents)

  const scale = 10 ** digits
  const whole = Math.floor(cents / scale)
  const fraction = String(cents % scale).padStart(digits, '0')

  return `${whole}.${fraction}`
}
