import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DashboardController } from "../src/controller.js";

describe("Stale-Quote Prevention & Quote Binding Suite (Mission 05C)", () => {
  test("Quote is successfully requested and bound to specific input parameters", async () => {
    const ctrl = new DashboardController();
    const { quote, error } = await ctrl.requestQuote("10", "USDC", "ETH");

    assert.equal(error, undefined);
    assert.ok(quote);
    assert.equal(quote.rawInputString, "10");
    assert.equal(quote.tokenIn, "USDC");
    assert.equal(quote.tokenOut, "ETH");
    assert.ok(quote.expectedOutUnits > 0n);
    assert.equal(ctrl.activeQuote, quote);
  });

  test("P0 Regression: Changing input amount after receiving quote blocks swap execution", async () => {
    const ctrl = new DashboardController();
    await ctrl.requestQuote("10", "USDC", "ETH");

    // Attacker or user edits input field to "50" without obtaining a new quote
    assert.throws(
      () => ctrl.executeSwap("50", "USDC", "ETH"),
      /STALE_QUOTE_ERROR: Input amount changed from "10" to "50"/
    );
  });

  test("P0 Regression: Changing token selection blocks swap execution", async () => {
    const ctrl = new DashboardController();
    await ctrl.requestQuote("10", "USDC", "ETH");

    // User switches direction to ETH -> USDC
    assert.throws(
      () => ctrl.executeSwap("10", "ETH", "USDC"),
      /STALE_QUOTE_ERROR: Token selection changed/
    );
  });

  test("P0 Regression: Background pool mutation invalidates quote and blocks stale execution", async () => {
    const ctrl = new DashboardController();
    await ctrl.requestQuote("10", "USDC", "ETH");

    // Another trade occurs in the pool (e.g. front-runner or concurrent trade)
    ctrl.engine.swap(
      ctrl.poolId,
      "USDC",
      1_000_000_000n,
      1n,
      "0xFrontRunner",
      Date.now() + 60000
    );
    // Explicitly update pool version or reserve tracking
    ctrl.poolVersion++;

    assert.throws(
      () => ctrl.executeSwap("10", "USDC", "ETH"),
      /STALE_QUOTE_ERROR: Pool state updated since quote was generated/
    );
  });

  test("P0 Regression: Out-of-order asynchronous quote responses are discarded", async () => {
    const ctrl = new DashboardController();

    // Start request 1 (slow)
    const p1 = ctrl.requestQuote("10", "USDC", "ETH");
    // Immediately start request 2 (fast)
    const p2 = ctrl.requestQuote("20", "USDC", "ETH");

    const [res1, res2] = await Promise.all([p1, p2]);

    assert.equal(res1.quote, null, "Older quote must be discarded");
    assert.ok(res2.quote, "Newer quote must be preserved");
    assert.equal(ctrl.activeQuote.rawInputString, "20");
  });

  test("Executing a swap succeeds and immediately invalidates activeQuote", async () => {
    const ctrl = new DashboardController();
    await ctrl.requestQuote("10", "USDC", "ETH");

    const result = ctrl.executeSwap("10", "USDC", "ETH");
    assert.ok(result.amountOut > 0n);

    // Active quote must be null after execution to prevent replay
    assert.equal(ctrl.activeQuote, null);

    // Replay attempt throws error
    assert.throws(
      () => ctrl.executeSwap("10", "USDC", "ETH"),
      /STALE_QUOTE_ERROR: No active quote found/
    );
  });
});
