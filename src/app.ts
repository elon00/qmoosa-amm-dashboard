// QMOOSA AMM Web4 Dashboard Controller — Local Sandbox Mode
// Strictly consumes @qmoosa/amm-sdk and @qmoosa/amm-engine (No replicated AMM math!)

import { QmoosaAmmClient, QuoteResponse } from "@qmoosa/amm-sdk";
import { AmmEngine } from "@qmoosa/amm-engine";

// Decimals configuration for sandboxed assets
const DECIMALS: Record<string, number> = {
  USDC: 6,
  ETH: 18
};

function parseUnits(val: string, decimals: number): bigint {
  const parts = val.split(".");
  const whole = parts[0] || "0";
  let frac = parts[1] || "";
  if (frac.length > decimals) {
    frac = frac.slice(0, decimals);
  } else {
    frac = frac.padEnd(decimals, "0");
  }
  const cleanWhole = whole.replace(/[^0-9]/g, "") || "0";
  return BigInt(cleanWhole + frac);
}

function formatUnits(units: bigint, decimals: number, maxDisplayDecimals: number = 6): string {
  const isNeg = units < 0n;
  const abs = isNeg ? -units : units;
  const divisor = 10n ** BigInt(decimals);
  const whole = abs / divisor;
  const frac = abs % divisor;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, maxDisplayDecimals);
  return `${isNeg ? "-" : ""}${whole.toLocaleString()}.${fracStr}`;
}

// 1. Initialize Real AMM Engine Instance in Local Memory Store
const engine = new AmmEngine();
const sdkClient = new QmoosaAmmClient({ defaultSlippageBps: 50 });

const creatorAddress = "0xCreatorSandboxAccount0001";
const traderAddress = "0xSimulatedDevAccount71C8";

// Initial pool liquidity: 50,000 USDC : 25 ETH with 30 bps (0.3%) fee
const initialUsdc = parseUnits("50000", DECIMALS.USDC);
const initialEth = parseUnits("25", DECIMALS.ETH);

const { poolId } = engine.createPool(
  "USDC",
  "ETH",
  initialUsdc,
  initialEth,
  creatorAddress,
  30
);

let userAddress: string | null = null;
let lastQuote: QuoteResponse | null = null;

function getPoolReserves() {
  const pool = engine.store.getPool(poolId);
  if (!pool) throw new Error("Pool not found");

  // In AmmEngine, tokenA and tokenB are sorted canonically
  const reserveUsdc = pool.tokenA === "USDC" ? BigInt(pool.reserveA) : BigInt(pool.reserveB);
  const reserveEth = pool.tokenA === "ETH" ? BigInt(pool.reserveA) : BigInt(pool.reserveB);

  return { pool, reserveUsdc, reserveEth };
}

async function updateUi() {
  const inputAmountIn = document.getElementById("inputAmountIn") as HTMLInputElement;
  const inputAmountOut = document.getElementById("inputAmountOut") as HTMLInputElement;
  const selectTokenIn = document.getElementById("selectTokenIn") as HTMLSelectElement;
  const selectTokenOut = document.getElementById("selectTokenOut") as HTMLSelectElement;
  const labelMinOut = document.getElementById("labelMinOut") as HTMLElement;
  const labelPriceImpact = document.getElementById("labelPriceImpact") as HTMLElement;
  const labelFee = document.getElementById("labelFee") as HTMLElement;
  const resA = document.getElementById("resA") as HTMLElement;
  const resB = document.getElementById("resB") as HTMLElement;
  const kInvariant = document.getElementById("kInvariant") as HTMLElement;

  const { pool, reserveUsdc, reserveEth } = getPoolReserves();

  if (resA) resA.innerText = formatUnits(reserveUsdc, DECIMALS.USDC, 2) + " USDC";
  if (resB) resB.innerText = formatUnits(reserveEth, DECIMALS.ETH, 4) + " ETH";
  if (kInvariant) {
    const k = (BigInt(pool.reserveA) * BigInt(pool.reserveB)) / (10n ** 24n);
    kInvariant.innerText = k.toLocaleString() + " e24";
  }

  const tokenIn = selectTokenIn?.value || "USDC";
  const tokenOut = selectTokenOut?.value || "ETH";
  const decimalsIn = DECIMALS[tokenIn] ?? 18;
  const decimalsOut = DECIMALS[tokenOut] ?? 18;

  const rIn = tokenIn === "USDC" ? reserveUsdc : reserveEth;
  const rOut = tokenIn === "USDC" ? reserveEth : reserveUsdc;

  const rawVal = inputAmountIn?.value || "0";
  const numVal = parseFloat(rawVal);

  if (numVal > 0) {
    try {
      const amountInUnits = parseUnits(rawVal, decimalsIn);
      // Consume SDK getQuote (zero local math calculation)
      const quote = await sdkClient.getQuote(
        {
          tokenIn,
          tokenOut,
          amountIn: amountInUnits.toString(),
          feeBps: pool.feeBps,
          slippageBps: 50
        },
        rIn.toString(),
        rOut.toString()
      );

      lastQuote = quote;
      const expectedOut = BigInt(quote.expectedAmountOut);
      const minOut = BigInt(quote.minAmountOut);
      const feeAmount = BigInt(quote.feeAmount);

      if (inputAmountOut) inputAmountOut.value = formatUnits(expectedOut, decimalsOut, 6);
      if (labelMinOut) labelMinOut.innerText = `${formatUnits(minOut, decimalsOut, 6)} ${tokenOut}`;
      if (labelPriceImpact) labelPriceImpact.innerText = `${quote.priceImpactPercent.toFixed(2)}%`;
      if (labelFee) labelFee.innerText = `${formatUnits(feeAmount, decimalsIn, 4)} ${tokenIn}`;
    } catch (err: any) {
      if (inputAmountOut) inputAmountOut.value = "Error";
      if (labelMinOut) labelMinOut.innerText = err.message || "Invalid Quote";
    }
  } else {
    lastQuote = null;
    if (inputAmountOut) inputAmountOut.value = "0.0";
    if (labelMinOut) labelMinOut.innerText = `0.00 ${tokenOut}`;
    if (labelPriceImpact) labelPriceImpact.innerText = "< 0.01%";
    if (labelFee) labelFee.innerText = `0.00 ${tokenIn}`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const inputAmountIn = document.getElementById("inputAmountIn");
  const selectTokenIn = document.getElementById("selectTokenIn") as HTMLSelectElement;
  const selectTokenOut = document.getElementById("selectTokenOut") as HTMLSelectElement;
  const toggleTokensBtn = document.getElementById("toggleTokensBtn");
  const swapForm = document.getElementById("swapForm");
  const connectBtn = document.getElementById("connectWalletBtn");
  const txLog = document.getElementById("txLog");

  inputAmountIn?.addEventListener("input", updateUi);

  selectTokenIn?.addEventListener("change", () => {
    if (selectTokenOut) {
      selectTokenOut.value = selectTokenIn.value === "USDC" ? "ETH" : "USDC";
    }
    updateUi();
  });

  selectTokenOut?.addEventListener("change", () => {
    if (selectTokenIn) {
      selectTokenIn.value = selectTokenOut.value === "USDC" ? "ETH" : "USDC";
    }
    updateUi();
  });

  toggleTokensBtn?.addEventListener("click", () => {
    if (selectTokenIn && selectTokenOut) {
      const prevIn = selectTokenIn.value;
      selectTokenIn.value = selectTokenOut.value;
      selectTokenOut.value = prevIn;
      updateUi();
    }
  });

  connectBtn?.addEventListener("click", () => {
    userAddress = traderAddress;
    connectBtn.innerText = "Simulated Account Connected";
    connectBtn.classList.remove("bg-cyan-600");
    connectBtn.classList.add("bg-amber-600");
  });

  swapForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const tokenIn = selectTokenIn?.value || "USDC";
    const tokenOut = selectTokenOut?.value || "ETH";
    const decimalsIn = DECIMALS[tokenIn] ?? 18;
    const decimalsOut = DECIMALS[tokenOut] ?? 18;

    const inputEl = document.getElementById("inputAmountIn") as HTMLInputElement;
    const valIn = parseFloat(inputEl?.value || "0");
    if (valIn <= 0 || !lastQuote) return;

    const amountInUnits = parseUnits(inputEl.value, decimalsIn);
    const minAmountOutUnits = BigInt(lastQuote.minAmountOut);
    const deadline = Date.now() + 120000;

    try {
      // Execute swap through real engine state machine (Zero simulated hacks)
      const swapResult = engine.swap(
        poolId,
        tokenIn,
        amountInUnits,
        minAmountOutUnits,
        userAddress || traderAddress,
        deadline
      );

      updateUi();

      if (txLog) {
        const li = document.createElement("li");
        li.className = "p-2 rounded bg-slate-950/60 border border-slate-800 text-slate-300 flex items-center justify-between";
        const formattedIn = formatUnits(amountInUnits, decimalsIn, 4);
        const formattedOut = formatUnits(swapResult.amountOut, decimalsOut, 4);
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

  updateUi();
});
