import { QmoosaAmmClient } from "@qmoosa/amm-sdk";
import { AmmEngine } from "@qmoosa/amm-engine";
import { parseFinancialUnits } from "./decimal.js";

export class DashboardController {
  constructor(engine, sdkClient) {
    this.engine = engine || new AmmEngine();
    this.sdkClient = sdkClient || new QmoosaAmmClient({ defaultSlippageBps: 50 });
    this.poolVersion = 1;
    this.activeQuote = null;
    this.latestQuoteRequestId = 0;
    this.isQuotePending = false;
    this.userAddress = null;
    this.decimals = {
      USDC: 6,
      ETH: 18
    };

    const initialUsdc = parseFinancialUnits("50000", this.decimals.USDC);
    const initialEth = parseFinancialUnits("25", this.decimals.ETH);

    const { poolId } = this.engine.createPool(
      "USDC",
      "ETH",
      initialUsdc,
      initialEth,
      "0xCreatorSandboxAccount0001",
      30
    );
    this.poolId = poolId;
  }

  getPoolReserves() {
    const pool = this.engine.store.getPool(this.poolId);
    if (!pool) throw new Error("Pool not found");
    const reserveUsdc = pool.tokenA === "USDC" ? BigInt(pool.reserveA) : BigInt(pool.reserveB);
    const reserveEth = pool.tokenA === "ETH" ? BigInt(pool.reserveA) : BigInt(pool.reserveB);
    return { pool, reserveUsdc, reserveEth };
  }

  invalidateQuote() {
    this.activeQuote = null;
  }

  async requestQuote(rawInputString, tokenIn, tokenOut) {
    this.invalidateQuote();
    this.latestQuoteRequestId++;
    const currentRequestId = this.latestQuoteRequestId;
    const currentPoolVersion = this.poolVersion;

    const decimalsIn = this.decimals[tokenIn];
    if (decimalsIn === undefined) {
      return { quote: null, error: `Unsupported input token: ${tokenIn}` };
    }

    let amountInUnits;
    try {
      amountInUnits = parseFinancialUnits(rawInputString, decimalsIn);
    } catch (err) {
      return { quote: null, error: err.message };
    }

    const { pool, reserveUsdc, reserveEth } = this.getPoolReserves();
    const rIn = tokenIn === "USDC" ? reserveUsdc : reserveEth;
    const rOut = tokenIn === "USDC" ? reserveEth : reserveUsdc;

    this.isQuotePending = true;
    try {
      const sdkQuote = await this.sdkClient.getQuote(
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

      // Check for out-of-order response (a newer quote request was made)
      if (currentRequestId !== this.latestQuoteRequestId) {
        return { quote: null, error: "Out-of-order quote discarded" };
      }

      // Check if pool mutated while quote was in flight
      if (currentPoolVersion !== this.poolVersion) {
        return { quote: null, error: "Pool mutated during quote calculation" };
      }

      const boundQuote = {
        requestId: currentRequestId,
        tokenIn,
        tokenOut,
        rawInputString,
        amountInUnits,
        expectedOutUnits: BigInt(sdkQuote.expectedAmountOut),
        minAmountOutUnits: BigInt(sdkQuote.minAmountOut),
        feeUnits: BigInt(sdkQuote.feeAmount),
        priceImpactPercent: sdkQuote.priceImpactPercent,
        reserveInAtQuote: rIn,
        reserveOutAtQuote: rOut,
        poolVersion: currentPoolVersion,
        timestamp: Date.now()
      };

      this.activeQuote = boundQuote;
      return { quote: boundQuote };
    } catch (err) {
      return { quote: null, error: err.message };
    } finally {
      if (currentRequestId === this.latestQuoteRequestId) {
        this.isQuotePending = false;
      }
    }
  }

  executeSwap(currentRawInput, currentTokenIn, currentTokenOut) {
    if (!this.activeQuote) {
      throw new Error("STALE_QUOTE_ERROR: No active quote found. Please request a quote before swapping.");
    }
    if (this.isQuotePending) {
      throw new Error("STALE_QUOTE_ERROR: A new quote is currently in flight. Execution blocked.");
    }
    if (this.activeQuote.rawInputString !== currentRawInput) {
      throw new Error(
        `STALE_QUOTE_ERROR: Input amount changed from "${this.activeQuote.rawInputString}" to "${currentRawInput}". Swap blocked.`
      );
    }
    if (this.activeQuote.tokenIn !== currentTokenIn || this.activeQuote.tokenOut !== currentTokenOut) {
      throw new Error("STALE_QUOTE_ERROR: Token selection changed since quote was generated. Swap blocked.");
    }
    if (this.activeQuote.poolVersion !== this.poolVersion) {
      throw new Error("STALE_QUOTE_ERROR: Pool state updated since quote was generated. Swap blocked.");
    }

    const { reserveUsdc, reserveEth } = this.getPoolReserves();
    const rIn = currentTokenIn === "USDC" ? reserveUsdc : reserveEth;
    const rOut = currentTokenIn === "USDC" ? reserveEth : reserveUsdc;

    if (rIn !== this.activeQuote.reserveInAtQuote || rOut !== this.activeQuote.reserveOutAtQuote) {
      throw new Error("STALE_QUOTE_ERROR: Reserves changed since quote was generated. Swap blocked.");
    }

    const quoteToExecute = this.activeQuote;

    // Execute through AmmEngine
    const result = this.engine.swap(
      this.poolId,
      quoteToExecute.tokenIn,
      quoteToExecute.amountInUnits,
      quoteToExecute.minAmountOutUnits,
      this.userAddress || "0xSimulatedDevAccount71C8",
      Date.now() + 120000
    );

    const amountIn = quoteToExecute.amountInUnits;

    // Invalidate quote immediately upon state transition and increment poolVersion
    this.poolVersion++;
    this.activeQuote = null;

    return {
      amountIn,
      amountOut: result.amountOut,
      feeAmount: result.feeAmount,
      pool: result.pool
    };
  }
}
