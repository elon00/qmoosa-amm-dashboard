// QMOOSA AMM Web4 Dashboard Controller

interface MockPool {
  tokenA: string;
  tokenB: string;
  reserveA: number;
  reserveB: number;
  feeBps: number;
}

const pool: MockPool = {
  tokenA: "USDC",
  tokenB: "ETH",
  reserveA: 50000,
  reserveB: 25,
  feeBps: 30
};

let userAddress: string | null = null;

function calculateQuote(amountIn: number): { amountOut: number; minOut: number; fee: number; impact: number } {
  const feeRate = pool.feeBps / 10000;
  const amountInWithFee = amountIn * (1 - feeRate);
  const amountOut = (amountInWithFee * pool.reserveB) / (pool.reserveA + amountInWithFee);
  const minOut = amountOut * 0.995; // 0.5% slippage
  const fee = amountIn * feeRate;
  const impact = (amountIn / (pool.reserveA + amountIn)) * 100;

  return { amountOut, minOut, fee, impact };
}

function updateUi() {
  const inputAmountIn = document.getElementById("inputAmountIn") as HTMLInputElement;
  const inputAmountOut = document.getElementById("inputAmountOut") as HTMLInputElement;
  const labelMinOut = document.getElementById("labelMinOut") as HTMLElement;
  const labelPriceImpact = document.getElementById("labelPriceImpact") as HTMLElement;
  const labelFee = document.getElementById("labelFee") as HTMLElement;
  const resA = document.getElementById("resA") as HTMLElement;
  const resB = document.getElementById("resB") as HTMLElement;
  const kInvariant = document.getElementById("kInvariant") as HTMLElement;

  if (resA) resA.innerText = pool.reserveA.toLocaleString(undefined, { minimumFractionDigits: 2 });
  if (resB) resB.innerText = pool.reserveB.toLocaleString(undefined, { minimumFractionDigits: 4 });
  if (kInvariant) kInvariant.innerText = (pool.reserveA * pool.reserveB).toLocaleString();

  const valIn = parseFloat(inputAmountIn?.value || "0");
  if (valIn > 0) {
    const q = calculateQuote(valIn);
    if (inputAmountOut) inputAmountOut.value = q.amountOut.toFixed(6);
    if (labelMinOut) labelMinOut.innerText = q.minOut.toFixed(6) + " ETH";
    if (labelPriceImpact) labelPriceImpact.innerText = `${q.impact.toFixed(2)}%`;
    if (labelFee) labelFee.innerText = `${q.fee.toFixed(4)} USDC`;
  } else {
    if (inputAmountOut) inputAmountOut.value = "0.0";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const inputAmountIn = document.getElementById("inputAmountIn");
  const swapForm = document.getElementById("swapForm");
  const connectBtn = document.getElementById("connectWalletBtn");
  const txLog = document.getElementById("txLog");

  inputAmountIn?.addEventListener("input", updateUi);

  connectBtn?.addEventListener("click", () => {
    userAddress = "0x71C83...f12B";
    connectBtn.innerText = "0x71C83...f12B";
    connectBtn.classList.remove("bg-cyan-600");
    connectBtn.classList.add("bg-emerald-600");
  });

  swapForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const inputAmountIn = document.getElementById("inputAmountIn") as HTMLInputElement;
    const valIn = parseFloat(inputAmountIn?.value || "0");
    if (valIn <= 0) return;

    const q = calculateQuote(valIn);
    pool.reserveA += valIn;
    pool.reserveB -= q.amountOut;

    updateUi();

    if (txLog) {
      const li = document.createElement("li");
      li.className = "p-2 rounded bg-slate-950/60 border border-slate-800 text-slate-300 flex items-center justify-between";
      li.innerHTML = `<span>Swapped ${valIn} USDC for ${q.amountOut.toFixed(4)} ETH</span><span class="text-emerald-400">SUCCESS</span>`;
      txLog.prepend(li);
    }
  });

  updateUi();
});
