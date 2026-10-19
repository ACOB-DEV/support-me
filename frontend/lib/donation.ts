/**
 * Donation-amount rules shared between the donate page (which enforces them at
 * send time) and Settings (which must reject invalid quick-select presets
 * before they ever reach the profile page, #244).
 */

/** Smallest donation the donate page will accept, in whole asset units. */
export const MIN_DONATION_AMOUNT = 0.1;

/** Stellar stores balances/amounts to 7 decimal places (stroop precision). */
export const MAX_DONATION_DECIMALS = 7;

/** Upper bound on creator-configured quick-select amounts (#120). */
export const MAX_DONATION_PRESETS = 6;

export type ParsePresetAmountsResult =
  | { ok: true; amounts: number[] }
  | { ok: false; error: string };

/**
 * Parses the Settings "Amounts (comma-separated)" field into the array stored
 * on the creator. Every returned amount is a valid donation on the profile
 * page; duplicates are collapsed and the result is sorted ascending so the
 * buttons render in a predictable order with unique React keys.
 */
export function parsePresetAmounts(input: string): ParsePresetAmountsResult {
  if (!input.trim()) return { ok: true, amounts: [] };

  const parts = input
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length > MAX_DONATION_PRESETS) {
    return { ok: false, error: `Enter at most ${MAX_DONATION_PRESETS} preset amounts.` };
  }

  const amounts: number[] = [];
  for (const part of parts) {
    const value = Number(part);
    if (!Number.isFinite(value) || value <= 0) {
      return { ok: false, error: 'Preset amounts must be positive numbers.' };
    }
    // Trim to stroop precision rather than rejecting, so a pasted
    // 1.12345678 rounds instead of failing the whole save.
    const rounded = Math.round(value * 10 ** MAX_DONATION_DECIMALS) / 10 ** MAX_DONATION_DECIMALS;
    if (rounded < MIN_DONATION_AMOUNT) {
      return { ok: false, error: `Preset amounts must be at least ${MIN_DONATION_AMOUNT}.` };
    }
    amounts.push(rounded);
  }

  const unique = Array.from(new Set(amounts)).sort((a, b) => a - b);
  return { ok: true, amounts: unique };
}
