import { test, expect } from "@playwright/test";

test.describe("QMOOSA AMM Dashboard Web4 Console E2E Verification", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("1. Initial Sandbox Environment & Disclosures", async ({ page }) => {
    // Verify explicit disclaimer banner
    const banner = page.locator("body > div:first-child");
    await expect(banner).toContainText("DEMONSTRATION / LOCAL SIMULATION MODE");
    await expect(banner).toContainText("No live on-chain assets or mainnet funds are handled");

    // Verify title and settlement status
    await expect(page).toHaveTitle(/QMOOSA AMM/);
    const telemetry = page.getByText("SETTLEMENT: LOCAL SANDBOX");
    await expect(telemetry).toBeVisible();

    // Verify initial reserves display
    const resA = page.locator("#resA");
    const resB = page.locator("#resB");
    await expect(resA).toContainText("50,000.00 USDC");
    await expect(resB).toContainText("25.0000 ETH");
  });

  test("2. USDC-to-ETH Quote Calculation with Valid Input", async ({ page }) => {
    const inputIn = page.locator("#inputAmountIn");
    const inputOut = page.locator("#inputAmountOut");
    const labelMin = page.locator("#labelMinOut");
    const labelFee = page.locator("#labelFee");

    await inputIn.fill("10");
    await inputIn.dispatchEvent("input");

    // Expected ETH output should be ~ 0.004984 ETH
    await expect(inputOut).toHaveValue(/0\.00498/);
    await expect(labelMin).toContainText("ETH");
    await expect(labelFee).toContainText("USDC");

    // Button should be enabled for valid input
    const swapBtn = page.locator("#btnExecuteSwap");
    await expect(swapBtn).toBeEnabled();
    await expect(swapBtn).toHaveText("Simulate Swap Execution");
  });

  test("3. Token Direction Toggle & ETH-to-USDC Quote", async ({ page }) => {
    const selectIn = page.locator("#selectTokenIn");
    const selectOut = page.locator("#selectTokenOut");
    const toggleBtn = page.locator("#toggleTokensBtn");

    await expect(selectIn).toHaveValue("USDC");
    await expect(selectOut).toHaveValue("ETH");

    // Click toggle button
    await toggleBtn.click();

    await expect(selectIn).toHaveValue("ETH");
    await expect(selectOut).toHaveValue("USDC");

    const inputIn = page.locator("#inputAmountIn");
    const inputOut = page.locator("#inputAmountOut");
    await inputIn.fill("1");
    await inputIn.dispatchEvent("input");

    // 1 ETH in a 50,000 USDC : 25 ETH pool gives ~ 1,917.528945 USDC
    await expect(inputOut).toHaveValue(/1,917/);
  });

  test("4. P0 Regression: Rejection of Malformed Financial Inputs in Browser UI", async ({ page }) => {
    const inputIn = page.locator("#inputAmountIn");
    const inputOut = page.locator("#inputAmountOut");
    const labelMin = page.locator("#labelMinOut");
    const swapBtn = page.locator("#btnExecuteSwap");

    // 4.1 Scientific notation '1e3'
    await inputIn.fill("1e3");
    await inputIn.dispatchEvent("input");
    await expect(inputOut).toHaveValue("Invalid Input");
    await expect(labelMin).toContainText("Scientific notation");
    await expect(swapBtn).toBeDisabled();

    // 4.2 Negative amount '-10'
    await inputIn.fill("-10");
    await inputIn.dispatchEvent("input");
    await expect(inputOut).toHaveValue("Invalid Input");
    await expect(labelMin).toContainText("SIGNED_VALUE_FORBIDDEN");
    await expect(swapBtn).toBeDisabled();

    // 4.3 Thousands separator '1,000'
    await inputIn.fill("1,000");
    await inputIn.dispatchEvent("input");
    await expect(inputOut).toHaveValue("Invalid Input");
    await expect(labelMin).toContainText("SEPARATORS_FORBIDDEN");
    await expect(swapBtn).toBeDisabled();

    // 4.4 Excessive decimal precision (7 decimals for 6-decimal USDC)
    await inputIn.fill("1.2345678");
    await inputIn.dispatchEvent("input");
    await expect(inputOut).toHaveValue("Invalid Input");
    await expect(labelMin).toContainText("EXCESSIVE_PRECISION");
    await expect(swapBtn).toBeDisabled();

    // 4.5 Exact 6 decimals is valid
    await inputIn.fill("1.234567");
    await inputIn.dispatchEvent("input");
    await expect(inputOut).not.toHaveValue("Invalid Input");
    await expect(swapBtn).toBeEnabled();
  });

  test("5. Simulated Wallet Connection Flow", async ({ page }) => {
    const connectBtn = page.locator("#connectWalletBtn");
    await expect(connectBtn).toHaveText("Connect Simulated Wallet");

    await connectBtn.click();
    await expect(connectBtn).toHaveText("Simulated Account Connected");
    await expect(connectBtn).toHaveClass(/bg-amber-600/);
  });

  test("6. Full End-to-End Local Engine Swap Execution & Ledger Telemetry", async ({ page }) => {
    const inputIn = page.locator("#inputAmountIn");
    const swapBtn = page.locator("#btnExecuteSwap");
    const txLog = page.locator("#txLog");
    const resA = page.locator("#resA");
    const resB = page.locator("#resB");

    // Input 10 USDC
    await inputIn.fill("10");
    await inputIn.dispatchEvent("input");
    await expect(swapBtn).toBeEnabled();

    // Execute swap
    await swapBtn.click();

    // Ledger must record the simulated trade with [SANDBOX ENGINE] badge
    await expect(txLog).toContainText("Swapped 10.0000 USDC");
    await expect(txLog).toContainText("[SANDBOX ENGINE]");

    // Verify reserves updated in the UI
    await expect(resA).toContainText("50,010.00 USDC");
    // ETH reserve must have decreased from 25.0000
    await expect(resB).toContainText("24.9950 ETH");
  });

  test("7. Absence of Misleading Production Claims", async ({ page }) => {
    const pageContent = await page.content();
    // Must NOT manufacture fake transaction hashes or claim live blockchain settlement
    expect(pageContent).not.toContain("0x_simulated_tx_hash");
    expect(pageContent).not.toContain("etherscan.io/tx");
    expect(pageContent).toContain("LOCAL ENGINE SIMULATION ONLY");
  });
});
