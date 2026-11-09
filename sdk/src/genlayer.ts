/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  LOCAL STRUCTURAL SHIM for the genlayer-js client  —  CLEARLY MARKED.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This SDK is transport-agnostic: an integrator constructs a genlayer-js client
 * themselves (with whatever chain, endpoint and account/signer they need) and
 * injects it into {@link CredenceClient}. To stay framework-agnostic and to
 * type-check cleanly even when genlayer-js is not installed in the build
 * environment, we do NOT import any type from genlayer-js here. Instead we
 * declare the minimal *structural* surface of the client that this SDK actually
 * calls — exactly the subset the reference frontend uses:
 *
 *   - readContract
 *   - writeContract
 *   - waitForTransactionReceipt
 *   - estimateTransactionFees                 (optional, for fee presets)
 *   - simulateWriteContract                   (optional, for fee presets)
 *   - estimateTransactionFeesFromSimulation   (optional, for fee presets)
 *
 * A real client returned by `createClient(...)` from genlayer-js is a structural
 * superset of {@link GenLayerClient} and is assignable to it without a cast
 * (verified against genlayer-js 1.1.8). The parameter shapes below are kept
 * deliberately permissive — the required fields are documented and typed, while
 * optional/variant fields (e.g. `value`, `fees`, `status`, `kwargs`) flow through
 * an index signature so the SDK never has to track every optional genlayer-js
 * argument or risk a version-specific type mismatch. Nothing here invents a
 * genlayer-js API; every method mirrors one the proven frontend client calls.
 *
 * To create a client, install the peer dependency `genlayer-js` and:
 *
 *     import { createClient } from "genlayer-js";
 *     import { studionet } from "genlayer-js/chains";
 *     const client = createClient({ chain: studionet, account });
 */

/** A 0x-prefixed hex address. */
export type HexAddress = `0x${string}`;

/**
 * Arguments to a read (view) call — mirrors genlayer-js `readContract`. Extra
 * optional genlayer-js fields (account, kwargs, rawReturn, …) are accepted via
 * the index signature.
 */
export interface ReadContractParams {
  address: HexAddress;
  functionName: string;
  args?: readonly unknown[];
  [key: string]: unknown;
}

/**
 * Arguments to a write call — mirrors genlayer-js `writeContract`. `value`
 * (payable native amount, base units) and `fees` (a fee object from a preset)
 * flow through the index signature to stay version-agnostic.
 */
export interface WriteContractParams {
  address: HexAddress;
  functionName: string;
  args?: readonly unknown[];
  [key: string]: unknown;
}

/**
 * Arguments to `waitForTransactionReceipt`. The terminal `status` flows through
 * the index signature (genlayer-js types it as a specific union).
 */
export interface WaitForReceiptParams {
  hash: string;
  retries?: number;
  interval?: number;
  [key: string]: unknown;
}

/** Arguments to `simulateWriteContract` (used only for fee estimation). */
export interface SimulateWriteParams {
  address: HexAddress;
  functionName: string;
  args?: readonly unknown[];
  [key: string]: unknown;
}

/**
 * The minimal structural surface of a genlayer-js client this SDK depends on.
 * Pass the result of `createClient(...)` straight in — it satisfies this shape.
 */
export interface GenLayerClient {
  /** Execute a read-only (view) method and return its decoded result. */
  readContract(params: ReadContractParams): Promise<unknown>;
  /** Submit a write (transaction) and return its hash. */
  writeContract(params: WriteContractParams): Promise<string>;
  /** Wait until a submitted transaction reaches the requested status. */
  waitForTransactionReceipt(params: WaitForReceiptParams): Promise<unknown>;

  // ── Optional fee-estimation surface (present on studionet clients). ──────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  estimateTransactionFees?(options: Record<string, unknown>): Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  simulateWriteContract?(params: SimulateWriteParams): Promise<any>;
  estimateTransactionFeesFromSimulation?(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params: Record<string, unknown>,
  ): Promise<any>;
}
