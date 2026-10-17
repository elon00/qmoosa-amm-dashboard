import { QmoosaAmmClient } from "@qmoosa/amm-sdk";
import { AmmEngine } from "@qmoosa/amm-engine";
import { parseFinancialUnits } from "./decimal.js";

export class DashboardController {
  constructor(engine, sdkClient) {
    this.engine = engine || new AmmEngine();
    this.sdkClient = sdkClient || new QmoosaAmmClient({ defaultSlippageBps: 50 });
    this.quoteGeneration = 0;
    this.latestQuoteRequestId = 0;
    this.activeQuote = null;
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
    const isTokenAUsdc = pool.tokenA.toLowerCase() === "usdc";
    const reserveUsdc = isTokenAUsdc ? BigInt(pool.reserveA) : BigInt(pool.reserveB);
    const reserveEth = isTokenAUsdc ? BigInt(pool.reserveB) : BigInt(pool.reserveA);
    return { pool, reserveUsdc, reserveEth };
  }

  /**
   * Invalidates any active quote and advances the generation identifier.
   * Any pending or in-flight quote requests created prior to this call
   * will be discarded upon resolution and cannot restore an executable quote.
   */
  invalidateQuote() {
    this.quoteGeneration++;
    this.activeQuote = null;
    this.isQuotePending = false;
  }

  async requestQuote(rawInputString, tokenIn, tokenOut) {
    // 1. Mandatory asset identity validation
    if (!tokenIn || !tokenOut) {
      return { quote: null, error: "INVALID_TOKEN_PAIR: Both tokens must be specified" };
    }
    if (tokenIn.trim().toLowerCase() === tokenOut.trim().toLowerCase()) {
      this.invalidateQuote();
      return { quote: null, error: "IDENTICAL_TOKENS_FORBIDDEN: Cannot quote swap between identical assets" };
    }

    // 2. Invalidate previous quote and advance generation monotonically
    this.quoteGeneration++;
    const currentGeneration = this.quoteGeneration;
    this.latestQuoteRequestId++;
    const currentRequestId = this.latestQuoteRequestId;

    const decimalsIn = this.decimals[tokenIn];
    if (decimalsIn === undefined) {
      this.activeQuote = null;
      return { quote: null, error: `Unsupported input token: ${tokenIn}` };
    }

    let amountInUnits;
    try {
      amountInUnits = parseFinancialUnits(rawInputString, decimalsIn);
    } catch (err) {
      this.activeQuote = null;
      return { quote: null, error: err.message };
    }

    if (amountInUnits <= 0n) {
      this.activeQuote = null;
      return { quote: null, error: "ZERO_AMOUNT_FORBIDDEN: Swap input amount must be positive" };
    }

    // 3. Snapshot live pool reserves and mutation markers directly from the engine
    const { pool: initialPool, reserveUsdc, reserveEth } = this.getPoolReserves();
    const snapshotReserveA = initialPool.reserveA;
    const snapshotReserveB = initialPool.reserveB;
    const snapshotTradeCount = initialPool.tradeCount;

    const isTokenInUsdc = tokenIn.toLowerCase() === "usdc";
    const rIn = isTokenInUsdc ? reserveUsdc : reserveEth;
    const rOut = isTokenInUsdc ? reserveEth : reserveUsdc;

    this.isQuotePending = true;

    try {
      const sdkQuote = await this.sdkClient.getQuote(
        {
          tokenIn,
          tokenOut,
          amountIn: amountInUnits.toString(),
          feeBps: initialPool.feeBps,
          slippageBps: 50
        },
        rIn.toString(),
        rOut.toString()
      );

      // Check 1: Monotonic request generation cancellation
      // If invalidateQuote() was called (e.g. input cleared, reset), generation has advanced
      if (this.quoteGeneration !== currentGeneration) {
        return { quote: null, error: "SUPERSEDED_QUOTE_GENERATION: In-flight quote canceled by newer user action" };
      }

      // Check 2: Monotonic request ID ordering (newer request started)
      if (this.latestQuoteRequestId !== currentRequestId) {
        return { quote: null, error: "OUT_OF_ORDER_QUOTE: Discarded older asynchronous quote" };
      }

      // Check 3: Real pool mutation detection from engine state store
      const { pool: livePool } = this.getPoolReserves();
      if (
        livePool.tradeCount !== snapshotTradeCount ||
        livePool.reserveA !== snapshotReserveA ||
        livePool.reserveB !== snapshotReserveB
      ) {
        return { quote: null, error: "POOL_MUTATED: Pool reserves mutated during quote calculation" };
      }

      const expectedOutUnits = BigInt(sdkQuote.expectedAmountOut);
      const minAmountOutUnits = BigInt(sdkQuote.minAmountOut);

      // Check 4: Zero-output rejection
      if (expectedOutUnits <= 0n || minAmountOutUnits <= 0n) {
        return { quote: null, error: "ZERO_OUTPUT_QUOTE: Quote resulted in zero executable output" };
      }

      const boundQuote = {
        generation: currentGeneration,
        requestId: currentRequestId,
        tokenIn,
        tokenOut,
        rawInputString,
        amountInUnits,
        expectedOutUnits,
        minAmountOutUnits,
        feeUnits: BigInt(sdkQuote.feeAmount),
        priceImpactPercent: sdkQuote.priceImpactPercent,
        reserveInAtQuote: rIn,
        reserveOutAtQuote: rOut,
        snapshotReserveA,
        snapshotReserveB,
        snapshotTradeCount,
        timestamp: Date.now()
      };

      // Atomic binding only if state remains unperturbed
      if (this.quoteGeneration === currentGeneration && this.latestQuoteRequestId === currentRequestId) {
        this.activeQuote = boundQuote;
        return { quote: boundQuote };
      } else {
        return { quote: null, error: "SUPERSEDED_QUOTE_GENERATION: Quote canceled prior to state commitment" };
      }
    } catch (err) {
      return { quote: null, error: err.message };
    } finally {
      if (this.latestQuoteRequestId === currentRequestId) {
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

    // Verify against actual live engine state
    const { pool: livePool } = this.getPoolReserves();
    if (
      livePool.tradeCount !== this.activeQuote.snapshotTradeCount ||
      livePool.reserveA !== this.activeQuote.snapshotReserveA ||
      livePool.reserveB !== this.activeQuote.snapshotReserveB
    ) {
      this.invalidateQuote();
      throw new Error("STALE_QUOTE_ERROR: Pool state mutated since quote was generated. Swap blocked.");
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

    // Invalidate quote immediately upon state transition
    this.invalidateQuote();

    return {
      amountIn,
      amountOut: result.amountOut,
      feeAmount: result.feeAmount,
      pool: result.pool
    };
  }
}
