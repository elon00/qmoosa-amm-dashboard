import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseFinancialUnits, formatFinancialUnits, DecimalParsingError } from "../src/decimal.js";

describe("Financial Input Parsing & Precision Enforcement (Mission 05C)", () => {
  const USDC_DECIMALS = 6;
  const ETH_DECIMALS = 18;

  test("Valid unsigned standard decimal amounts parse to exact BigInt base units", () => {
    assert.equal(parseFinancialUnits("10", USDC_DECIMALS), 10_000_000n);
    assert.equal(parseFinancialUnits("1.5", USDC_DECIMALS), 1_500_000n);
    assert.equal(parseFinancialUnits("0.000001", USDC_DECIMALS), 1n);
    assert.equal(parseFinancialUnits("1", ETH_DECIMALS), 1_000_000_000_000_000_000n);
  });

  test("Extremely large values parse accurately without precision loss", () => {
    const large = "1000000000000000000";
    assert.equal(parseFinancialUnits(large, USDC_DECIMALS), 1_000_000_000_000_000_000_000_000n);
  });

  test("P0 Regression: Scientific notation '1e3' is strictly rejected (prevents 13 USDC bug)", () => {
    // The previous buggy parser: "1e3".replace(/[^0-9]/g, "") produced "13", resulting in 13 USDC!
    assert.throws(
      () => parseFinancialUnits("1e3", USDC_DECIMALS),
      (err) => err instanceof DecimalParsingError && err.code === "SCIENTIFIC_NOTATION_FORBIDDEN"
    );
    assert.throws(
      () => parseFinancialUnits("1E6", USDC_DECIMALS),
      (err) => err instanceof DecimalParsingError && err.code === "SCIENTIFIC_NOTATION_FORBIDDEN"
    );
    assert.throws(
      () => parseFinancialUnits("1e-5", USDC_DECIMALS),
      (err) => err instanceof DecimalParsingError && err.code === "SCIENTIFIC_NOTATION_FORBIDDEN"
    );
  });

  test("P0 Regression: Signed inputs ('-10' and '+10') are strictly rejected", () => {
    assert.throws(
      () => parseFinancialUnits("-10", USDC_DECIMALS),
      (err) => err instanceof DecimalParsingError && err.code === "SIGNED_VALUE_FORBIDDEN"
    );
    assert.throws(
      () => parseFinancialUnits("+10", USDC_DECIMALS),
      (err) => err instanceof DecimalParsingError && err.code === "SIGNED_VALUE_FORBIDDEN"
    );
  });

  test("P0 Regression: Thousands separators ('1,000') are strictly rejected", () => {
    assert.throws(
      () => parseFinancialUnits("1,000", USDC_DECIMALS),
      (err) => err instanceof DecimalParsingError && err.code === "SEPARATORS_FORBIDDEN"
    );
    assert.throws(
      () => parseFinancialUnits("1 000", USDC_DECIMALS),
      (err) => err instanceof DecimalParsingError && err.code === "SEPARATORS_FORBIDDEN"
    );
  });

  test("P0 Regression: Fractional precision exceeding asset decimals ('1.2345678' on 6 dec) is rejected", () => {
    // Must NOT silently truncate the 78!
    assert.throws(
      () => parseFinancialUnits("1.2345678", USDC_DECIMALS),
      (err) => err instanceof DecimalParsingError && err.code === "EXCESSIVE_PRECISION"
    );
    // Exact 6 decimals is accepted
    assert.equal(parseFinancialUnits("1.234567", USDC_DECIMALS), 1234567n);
  });

  test("P0 Regression: Whitespace and empty inputs are strictly rejected", () => {
    assert.throws(
      () => parseFinancialUnits("", USDC_DECIMALS),
      (err) => err instanceof DecimalParsingError && err.code === "MALFORMED_WHITESPACE"
    );
    assert.throws(
      () => parseFinancialUnits("   ", USDC_DECIMALS),
      (err) => err instanceof DecimalParsingError && err.code === "MALFORMED_WHITESPACE"
    );
    assert.throws(
      () => parseFinancialUnits(" 10", USDC_DECIMALS),
      (err) => err instanceof DecimalParsingError && err.code === "MALFORMED_WHITESPACE"
    );
  });

  test("P0 Regression: Multiple decimal points ('1.2.3') and non-numeric characters are rejected", () => {
    assert.throws(
      () => parseFinancialUnits("1.2.3", USDC_DECIMALS),
      (err) => err instanceof DecimalParsingError && err.code === "MALFORMED_DECIMAL_FORMAT"
    );
    assert.throws(
      () => parseFinancialUnits(".", USDC_DECIMALS),
      (err) => err instanceof DecimalParsingError && err.code === "MALFORMED_DECIMAL_FORMAT"
    );
    assert.throws(
      () => parseFinancialUnits("abc", USDC_DECIMALS),
      (err) => err instanceof DecimalParsingError && err.code === "MALFORMED_DECIMAL_FORMAT"
    );
    assert.throws(
      () => parseFinancialUnits("10a", USDC_DECIMALS),
      (err) => err instanceof DecimalParsingError && err.code === "MALFORMED_DECIMAL_FORMAT"
    );
  });

  test("P0 Regression: Zero amounts ('0' and '0.000000') are rejected for positive transfers", () => {
    assert.throws(
      () => parseFinancialUnits("0", USDC_DECIMALS),
      (err) => err instanceof DecimalParsingError && err.code === "ZERO_AMOUNT"
    );
    assert.throws(
      () => parseFinancialUnits("0.000000", USDC_DECIMALS),
      (err) => err instanceof DecimalParsingError && err.code === "ZERO_AMOUNT"
    );
  });

  test("Formatting back to string preserves precision", () => {
    assert.equal(formatFinancialUnits(10_000_000n, USDC_DECIMALS), "10.000000");
    assert.equal(formatFinancialUnits(1_234_567n, USDC_DECIMALS, 2), "1.23");
  });
});
