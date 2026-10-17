import { QmoosaAmmClient } from "@qmoosa/amm-sdk";
import { AmmEngine } from "@qmoosa/amm-engine";
import { parseFinancialUnits } from "./decimal.ts";

export interface BoundQuote {
  requestId: number;
  tokenIn: string;
  tokenOut: string;
  rawInputString: string;
  amountInUnits: bigint;
  expectedOutUnits: bigint;
  minAmountOutUnits: bigint;
  feeUnits: bigint;
  priceImpactPercent: number;
  reserveInAtQuote: bigint;
  reserveOutAtQuote: bigint;
  poolVersion: number;
  timestamp: number;
}

export class DashboardController {
  public engine: AmmEngine;
  public sdkClient: QmoosaAmmClient;
  public poolId: string;
  public poolVersion: number = 1;
  public activeQuote: BoundQuote | null = null;
  public latestQuoteRequestId: number = 0;
  public isQuotePending: boolean = false;
  public userAddress: string | null = null;
  public decimals: Record<string, number> = {
    USDC: 6,
    ETH: 18
  };

  constructor(engine?: AmmEngine, sdkClient?: QmoosaAmmClient) {
    this.engine = engine || new AmmEngine();
    this.sdkClient = sdkClient || new QmoosaAmmClient({ defaultSlippageBps: 50 });

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

  public getPoolReserves() {
    const pool = this.engine.store.getPool(this.poolId);
    if (!pool) throw new Error("Pool not found");
    const reserveUsdc = pool.tokenA === "USDC" ? BigInt(pool.reserveA) : BigInt(pool.reserveB);
    const reserveEth = pool.tokenA === "ETH" ? BigInt(pool.reserveA) : BigInt(pool.reserveB);
    return { pool, reserveUsdc, reserveEth };
  }

  public invalidateQuote(): void {
    this.activeQuote = null;
  }

  public async requestQuote(
    rawInputString: string,
    tokenIn: string,
    tokenOut: string
  ): Promise<{ quote: BoundQuote | null; error?: string }> {
    this.invalidateQuote();
    this.latestQuoteRequestId++;
    const currentRequestId = this.latestQuoteRequestId;
    const currentPoolVersion = this.poolVersion;

    const decimalsIn = this.decimals[tokenIn];
    if (decimalsIn === undefined) {
      return { quote: null, error: `Unsupported input token: ${tokenIn}` };
    }

    let amountInUnits: bigint;
    try {
      amountInUnits = parseFinancialUnits(rawInputString, decimalsIn);
    } catch (err: any) {
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

      const boundQuote: BoundQuote = {
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
    } catch (err: any) {
      return { quote: null, error: err.message };
    } finally {
      if (currentRequestId === this.latestQuoteRequestId) {
        this.isQuotePending = false;
      }
    }
  }

  public executeSwap(currentRawInput: string, currentTokenIn: string, currentTokenOut: string) {
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
