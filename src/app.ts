// QMOOSA AMM Web4 Dashboard Controller — Local Sandbox Mode (Mission 05C Hardened)
// Strictly consumes DashboardController, @qmoosa/amm-sdk, and @qmoosa/amm-engine

import { DashboardController } from "./controller.js";
import { formatFinancialUnits } from "./decimal.js";

const controller = new DashboardController();

function updatePoolDisplay() {
  const resA = document.getElementById("resA") as HTMLElement;
  const resB = document.getElementById("resB") as HTMLElement;
  const kInvariant = document.getElementById("kInvariant") as HTMLElement;

  const { pool, reserveUsdc, reserveEth } = controller.getPoolReserves();

  if (resA) resA.innerText = formatFinancialUnits(reserveUsdc, controller.decimals.USDC, 2) + " USDC";
  if (resB) resB.innerText = formatFinancialUnits(reserveEth, controller.decimals.ETH, 4) + " ETH";
  if (kInvariant) {
    const k = (BigInt(pool.reserveA) * BigInt(pool.reserveB)) / (10n ** 24n);
    kInvariant.innerText = k.toLocaleString() + " e24";
  }
}

async function handleInputChange() {
  const inputAmountIn = document.getElementById("inputAmountIn") as HTMLInputElement;
  const inputAmountOut = document.getElementById("inputAmountOut") as HTMLInputElement;
  const selectTokenIn = document.getElementById("selectTokenIn") as HTMLSelectElement;
  const selectTokenOut = document.getElementById("selectTokenOut") as HTMLSelectElement;
  const labelMinOut = document.getElementById("labelMinOut") as HTMLElement;
  const labelPriceImpact = document.getElementById("labelPriceImpact") as HTMLElement;
  const labelFee = document.getElementById("labelFee") as HTMLElement;
  const btnExecute = document.getElementById("btnExecuteSwap") as HTMLButtonElement;

  const rawInput = inputAmountIn?.value || "";
  const tokenIn = selectTokenIn?.value || "USDC";
  const tokenOut = selectTokenOut?.value || "ETH";
  const decMap = controller.decimals as Record<string, number>;
  const decimalsOut = decMap[tokenOut] ?? 18;
  const decimalsIn = decMap[tokenIn] ?? 6;

  // Invalidate any active quote immediately when input changes
  controller.invalidateQuote();
  if (btnExecute) {
    btnExecute.disabled = true;
    btnExecute.innerText = "Calculating quote...";
  }

  if (!rawInput || rawInput.trim().length === 0) {
    if (inputAmountOut) inputAmountOut.value = "0.0";
    if (labelMinOut) labelMinOut.innerText = `0.00 ${tokenOut}`;
    if (labelPriceImpact) labelPriceImpact.innerText = "< 0.01%";
    if (labelFee) labelFee.innerText = `0.00 ${tokenIn}`;
    if (btnExecute) {
      btnExecute.innerText = "Enter valid amount";
    }
    return;
  }

  const { quote, error } = await controller.requestQuote(rawInput, tokenIn, tokenOut);

  if (error || !quote || controller.activeQuote !== quote) {
    if (inputAmountOut) inputAmountOut.value = "Invalid Input";
    if (labelMinOut) {
      labelMinOut.innerText = error || "Parsing Error";
      labelMinOut.className = "text-rose-400 font-mono text-xs";
    }
    if (btnExecute) {
      btnExecute.disabled = true;
      btnExecute.innerText = error ? "Invalid Quote" : "Enter valid amount";
    }
    return;
  }

  // Valid bound quote obtained
  if (inputAmountOut) {
    inputAmountOut.value = formatFinancialUnits(quote.expectedOutUnits, decimalsOut, 6);
  }
  if (labelMinOut) {
    labelMinOut.innerText = `${formatFinancialUnits(quote.minAmountOutUnits, decimalsOut, 6)} ${tokenOut}`;
    labelMinOut.className = "text-slate-200 font-mono text-xs";
  }
  if (labelPriceImpact) {
    labelPriceImpact.innerText = `${quote.priceImpactPercent.toFixed(2)}%`;
  }
  if (labelFee) {
    labelFee.innerText = `${formatFinancialUnits(quote.feeUnits, decimalsIn, 4)} ${tokenIn}`;
  }
  if (btnExecute) {
    btnExecute.disabled = false;
    btnExecute.innerText = "Simulate Swap Execution";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const inputAmountIn = document.getElementById("inputAmountIn") as HTMLInputElement;
  const selectTokenIn = document.getElementById("selectTokenIn") as HTMLSelectElement;
  const selectTokenOut = document.getElementById("selectTokenOut") as HTMLSelectElement;
  const toggleTokensBtn = document.getElementById("toggleTokensBtn");
  const swapForm = document.getElementById("swapForm");
  const connectBtn = document.getElementById("connectWalletBtn");
  const txLog = document.getElementById("txLog");

  updatePoolDisplay();
  handleInputChange();

  inputAmountIn?.addEventListener("input", handleInputChange);

  selectTokenIn?.addEventListener("change", () => {
    if (selectTokenOut) {
      selectTokenOut.value = selectTokenIn.value === "USDC" ? "ETH" : "USDC";
    }
    handleInputChange();
  });

  selectTokenOut?.addEventListener("change", () => {
    if (selectTokenIn) {
      selectTokenIn.value = selectTokenOut.value === "USDC" ? "ETH" : "USDC";
    }
    handleInputChange();
  });

  toggleTokensBtn?.addEventListener("click", () => {
    if (selectTokenIn && selectTokenOut) {
      const prevIn = selectTokenIn.value;
      selectTokenIn.value = selectTokenOut.value;
      selectTokenOut.value = prevIn;
      handleInputChange();
    }
  });

  connectBtn?.addEventListener("click", () => {
    controller.userAddress = "0xSimulatedDevAccount71C8";
    connectBtn.innerText = "Simulated Account Connected";
    connectBtn.classList.remove("bg-cyan-600");
    connectBtn.classList.add("bg-amber-600");
  });

  swapForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const tokenIn = selectTokenIn?.value || "USDC";
    const tokenOut = selectTokenOut?.value || "ETH";
    const rawVal = inputAmountIn?.value || "";

    try {
      // Execute swap with strict stale-quote protection
      const swapResult = controller.executeSwap(rawVal, tokenIn, tokenOut);

      updatePoolDisplay();
      handleInputChange();

      if (txLog) {
        const li = document.createElement("li");
        li.className = "p-2 rounded bg-slate-950/60 border border-slate-800 text-slate-300 flex items-center justify-between";
        const decMap = controller.decimals as Record<string, number>;
        const decimalsIn = decMap[tokenIn] ?? 6;
        const decimalsOut = decMap[tokenOut] ?? 18;
        const formattedIn = formatFinancialUnits(swapResult.amountIn, decimalsIn, 4);
        const formattedOut = formatFinancialUnits(swapResult.amountOut, decimalsOut, 4);
        li.innerHTML = `<span>Swapped ${formattedIn} ${tokenIn} → ${formattedOut} ${tokenOut}</span><span class="text-amber-400 font-mono text-[10px]">[SANDBOX ENGINE]</span>`;
        txLog.prepend(li);
      }
    } catch (err: any) {
      if (txLog) {
        const li = document.createElement("li");
        li.className = "p-2 rounded bg-rose-950/40 border border-rose-800 text-rose-300 flex items-center justify-between";
        li.innerHTML = `<span>Swap Failed: ${err.message}</span><span class="text-rose-400 font-mono text-[10px]">[REVERTED]</span>`;
        txLog.prepend(li);
      }
    }
  });
});
