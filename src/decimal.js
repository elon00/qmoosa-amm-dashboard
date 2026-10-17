export class DecimalParsingError extends Error {
  constructor(code, message) {
    super(`[${code}] ${message}`);
    this.name = "DecimalParsingError";
    this.code = code;
  }
}

/**
 * Strict financial decimal parser.
 * Requirements:
 * - Accept only unsigned decimal format: ^(0|[1-9]\d*)(\.\d+)?$
 * - Reject scientific notation (e.g. 1e3, 1E-5)
 * - Reject signed inputs (+10, -10)
 * - Reject thousands separators (1,000)
 * - Reject alphabetic characters and multiple dots
 * - Reject fractional precision beyond configured token decimals (zero silent truncation)
 * - Reject zero base units (must be strictly positive)
 * - Exact BigInt base-unit calculation
 */
export function parseFinancialUnits(input, decimals) {
  if (typeof input !== "string") {
    throw new DecimalParsingError("INVALID_TYPE", "Input must be a string");
  }

  // Reject whitespace-only or leading/trailing whitespace
  if (input.trim() !== input || input.length === 0) {
    throw new DecimalParsingError("MALFORMED_WHITESPACE", "Input cannot be empty or contain leading/trailing whitespace");
  }

  if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new DecimalParsingError("INVALID_DECIMALS", "Decimals must be a non-negative integer");
  }

  // Reject scientific notation
  if (/[eE]/.test(input)) {
    throw new DecimalParsingError("SCIENTIFIC_NOTATION_FORBIDDEN", "Scientific notation (e.g. '1e3') is forbidden in financial input");
  }

  // Reject signs (+ or -)
  if (input.startsWith("+") || input.startsWith("-")) {
    throw new DecimalParsingError("SIGNED_VALUE_FORBIDDEN", "Explicit sign (+ or -) is forbidden in unsigned token amounts");
  }

  // Reject thousands separators or formatting characters
  if (input.includes(",") || input.includes(" ") || input.includes("_")) {
    throw new DecimalParsingError("SEPARATORS_FORBIDDEN", "Thousands separators (commas, spaces, underscores) are forbidden");
  }

  // Strict regex: must start with 0 or 1-9, followed by digits, optionally followed by single dot and digits
  const STRICT_DECIMAL_REGEX = /^(0|[1-9]\d*)(\.\d+)?$/;
  if (!STRICT_DECIMAL_REGEX.test(input)) {
    throw new DecimalParsingError("MALFORMED_DECIMAL_FORMAT", `Malformed decimal number: "${input}"`);
  }

  const parts = input.split(".");
  const whole = parts[0];
  const fraction = parts[1] || "";

  // Never silently truncate: reject fractional digits exceeding decimals
  if (fraction.length > decimals) {
    throw new DecimalParsingError(
      "EXCESSIVE_PRECISION",
      `Fractional precision (${fraction.length} decimals) exceeds configured asset precision (${decimals} decimals)`
    );
  }

  const paddedFraction = fraction.padEnd(decimals, "0");
  const baseUnits = BigInt(whole + paddedFraction);

  if (baseUnits <= 0n) {
    throw new DecimalParsingError("ZERO_AMOUNT", "Financial amount must resolve to strictly positive base units (> 0)");
  }

  return baseUnits;
}

/**
 * Format base units back to decimal string with optional display trimming.
 */
export function formatFinancialUnits(units, decimals, maxDisplayDecimals) {
  if (typeof units !== "bigint") {
    throw new Error("Units must be a BigInt");
  }
  const divisor = 10n ** BigInt(decimals);
  const whole = units / divisor;
  const frac = units % divisor;
  const fracStr = frac.toString().padStart(decimals, "0");

  const displayDecimals = maxDisplayDecimals !== undefined ? Math.min(decimals, maxDisplayDecimals) : decimals;
  const trimmedFrac = fracStr.slice(0, displayDecimals);

  if (displayDecimals === 0) {
    return whole.toLocaleString();
  }
  return `${whole.toLocaleString()}.${trimmedFrac}`;
}
