import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DashboardController } from "../src/controller.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Stale-Quote Prevention & Monotonic Request Generation Suite (Mission 05D)", () => {
  test("1. Basic valid quote is bound to exact input parameters and sets activeQuote", async () => {
    const ctrl = new DashboardController();
    const { quote, error } = await ctrl.requestQuote("100", "USDC", "ETH");

    assert.equal(error, undefined);
    assert.ok(quote);
    assert.equal(quote.rawInputString, "100");
    assert.equal(quote.tokenIn, "USDC");
    assert.equal(quote.tokenOut, "ETH");
    assert.ok(quote.expectedOutUnits > 0n);
    assert.equal(ctrl.activeQuote, quote);
  });

  test("2. Mandatory Test 1: Start a delayed quote, clear the input before resolution, then resolve old request -> quote remains unusable", async () => {
    // Custom SDK client with artificial network delay
    const delayedSdk = {
      async getQuote(_params, _rIn, _rOut) {
        await sleep(50);
        return {
          expectedAmountOut: "48000000000000000",
          minAmountOut: "47500000000000000",
          feeAmount: "300000",
          priceImpactPercent: 0.1
        };
      }
    };

    const ctrl = new DashboardController(null, delayedSdk);

    // Step A: User types "100" -> initiates delayed quote
    const inFlightPromise = ctrl.requestQuote("100", "USDC", "ETH");

    // Step B: User clears the input BEFORE the delayed quote resolves
    ctrl.invalidateQuote();
    assert.equal(ctrl.activeQuote, null, "Active quote must be immediately null upon input clear");

    // Step C: Old delayed request resolves
    const result = await inFlightPromise;

    // Assert: old quote must be discarded, activeQuote must remain null, and execution must be impossible
    assert.equal(result.quote, null, "Superseded quote must not return a valid quote object");
    assert.match(result.error, /SUPERSEDED_QUOTE_GENERATION/);
    assert.equal(ctrl.activeQuote, null, "Active quote must NOT be revived by delayed resolution");

    assert.throws(
      () => ctrl.executeSwap("100", "USDC", "ETH"),
      /STALE_QUOTE_ERROR: No active quote found/,
      "Swap execution must be strictly blocked"
    );
  });

  test("3. Mandatory Test 2: Start a delayed quote, switch token direction, then resolve old request -> result must be discarded", async () => {
    const delayedSdk = {
      async getQuote(_params) {
        await sleep(50);
        return {
          expectedAmountOut: "48000000000000000",
          minAmountOut: "47500000000000000",
          feeAmount: "300000",
          priceImpactPercent: 0.1
        };
      }
    };

    const ctrl = new DashboardController(null, delayedSdk);

    // Step A: Start quote for USDC -> ETH
    const inFlightUsdcPromise = ctrl.requestQuote("100", "USDC", "ETH");

    // Step B: User flips tokens to ETH -> USDC
    ctrl.invalidateQuote();

    // Step C: Old request completes
    const result = await inFlightUsdcPromise;

    assert.equal(result.quote, null);
    assert.match(result.error, /SUPERSEDED_QUOTE_GENERATION/);
    assert.equal(ctrl.activeQuote, null);

    assert.throws(
      () => ctrl.executeSwap("100", "ETH", "USDC"),
      /STALE_QUOTE_ERROR: No active quote found/
    );
  });

  test("4. Mandatory Test 3: Start two delayed requests and complete them in reverse order -> only latest response is accepted", async () => {
    let callCount = 0;
    const delayedSdk = {
      async getQuote(_params) {
        callCount++;
        if (callCount === 1) {
          // Request 1 is slow (takes 80ms)
          await sleep(80);
          return {
            expectedAmountOut: "10000000000000000",
            minAmountOut: "9900000000000000",
            feeAmount: "30000",
            priceImpactPercent: 0.05
          };
        } else {
          // Request 2 is fast (takes 20ms)
          await sleep(20);
          return {
            expectedAmountOut: "25000000000000000",
            minAmountOut: "24500000000000000",
            feeAmount: "60000",
            priceImpactPercent: 0.1
          };
        }
      }
    };

    const ctrl = new DashboardController(null, delayedSdk);

    // Launch request 1 (amount = "10")
    const p1 = ctrl.requestQuote("10", "USDC", "ETH");
    // Launch request 2 (amount = "25")
    const p2 = ctrl.requestQuote("25", "USDC", "ETH");

    const [res1, res2] = await Promise.all([p1, p2]);

    // Fast request 2 resolved first, slow request 1 resolved second
    assert.equal(res1.quote, null, "Slow superseded request 1 must be discarded");
    assert.match(res1.error, /SUPERSEDED_QUOTE_GENERATION|OUT_OF_ORDER_QUOTE/);

    assert.ok(res2.quote, "Latest request 2 must be accepted");
    assert.equal(ctrl.activeQuote.rawInputString, "25");
    assert.equal(ctrl.activeQuote.expectedOutUnits, 25000000000000000n);

    // Swap executes for request 2, but cannot execute for request 1
    assert.throws(
      () => ctrl.executeSwap("10", "USDC", "ETH"),
      /STALE_QUOTE_ERROR: Input amount changed/
    );
  });

  test("5. Mandatory Test 4: Mutate actual pool reserves while a quote is pending -> automatic invalidation without manual counter change", async () => {
    let resolveSdkQuote;
    const delayedSdk = {
      getQuote() {
        return new Promise((resolve) => {
          resolveSdkQuote = () =>
            resolve({
              expectedAmountOut: "48000000000000000",
              minAmountOut: "47500000000000000",
              feeAmount: "300000",
              priceImpactPercent: 0.1
            });
        });
      }
    };

    const ctrl = new DashboardController(null, delayedSdk);

    // Step A: Start quote request
    const quotePromise = ctrl.requestQuote("100", "USDC", "ETH");

    // Step B: Concurrent actor executes a REAL swap on the underlying engine (no manual version counter touched)
    ctrl.engine.swap(
      ctrl.poolId,
      "USDC",
      5_000_000_000n, // 5,000 USDC swap
      1n,
      "0xArbitrageTrader01",
      Date.now() + 60000
    );

    // Step C: The delayed quote SDK calculation finishes
    resolveSdkQuote();
    const result = await quotePromise;

    // Assert: Engine reserve mutation was detected automatically from engine state store
    assert.equal(result.quote, null, "Quote calculated against mutated reserves must be rejected");
    assert.match(result.error, /POOL_MUTATED: Pool reserves mutated during quote calculation/);
    assert.equal(ctrl.activeQuote, null, "Active quote must not be set");

    assert.throws(
      () => ctrl.executeSwap("100", "USDC", "ETH"),
      /STALE_QUOTE_ERROR: No active quote found/
    );
  });

  test("6. Mandatory Test 5: Attempt to quote an identical input and output asset -> rejected immediately", async () => {
    const ctrl = new DashboardController();

    const res1 = await ctrl.requestQuote("100", "USDC", "USDC");
    assert.equal(res1.quote, null);
    assert.match(res1.error, /IDENTICAL_TOKENS_FORBIDDEN/);
    assert.equal(ctrl.activeQuote, null);

    const res2 = await ctrl.requestQuote("1", "ETH", "eth");
    assert.equal(res2.quote, null);
    assert.match(res2.error, /IDENTICAL_TOKENS_FORBIDDEN/);
    assert.equal(ctrl.activeQuote, null);
  });

  test("7. Mandatory Test 6: Verify that invalid or zero-output quotes cannot enable execution", async () => {
    const zeroOutputSdk = {
      async getQuote() {
        return {
          expectedAmountOut: "0",
          minAmountOut: "0",
          feeAmount: "0",
          priceImpactPercent: 0.0
        };
      }
    };

    const ctrl = new DashboardController(null, zeroOutputSdk);
    const result = await ctrl.requestQuote("1", "USDC", "ETH");

    assert.equal(result.quote, null);
    assert.match(result.error, /ZERO_OUTPUT_QUOTE/);
    assert.equal(ctrl.activeQuote, null);

    assert.throws(
      () => ctrl.executeSwap("1", "USDC", "ETH"),
      /STALE_QUOTE_ERROR: No active quote found/
    );
  });

  test("8. Successful swap execution invalidates quote and blocks replay", async () => {
    const ctrl = new DashboardController();
    await ctrl.requestQuote("10", "USDC", "ETH");

    const result = ctrl.executeSwap("10", "USDC", "ETH");
    assert.ok(result.amountOut > 0n);
    assert.equal(ctrl.activeQuote, null, "Active quote must be cleared immediately post-swap");

    assert.throws(
      () => ctrl.executeSwap("10", "USDC", "ETH"),
      /STALE_QUOTE_ERROR: No active quote found/
    );
  });
});
