/**
 * Transaction-fee presets for the consensus-LLM write (`assess`).
 *
 * `assess` runs an independent AI underwriter panel inside the GenVM and, for url
 * evidence, every validator fetches the page live — it is the one expensive,
 * appeal-sensitive write, so integrators estimate fees before submitting. This
 * module is a framework-agnostic port of the reference frontend's fee helper:
 * it drives only the optional fee-estimation methods on the genlayer-js client
 * and degrades gracefully (returns `undefined`) when they are absent.
 */

import type { GenLayerClient, HexAddress } from "./genlayer.js";

/** Appeal-robustness level: more rounds/rotations cost more but resist appeals. */
export type FeePresetLevel = "low" | "standard" | "high";

/** The opaque fee estimate returned by the genlayer-js client, plus its level. */
export interface FeePresetEstimate {
  level: FeePresetLevel;
  estimate?: {
    distribution?: Record<string, unknown>;
    messageAllocations?: Record<string, unknown>[];
    feeValue?: bigint | number | string;
    fee_value?: bigint | number | string;
    observed?: Record<string, unknown>;
  };
  observed?: Record<string, unknown>;
}

const PRESET_OPTIONS: Record<FeePresetLevel, Record<string, unknown>> = {
  low: {
    appealRounds: 0n,
    rotations: [0n],
  },
  standard: {
    appealRounds: 1n,
    rotations: [0n, 0n],
  },
  high: {
    appealRounds: 2n,
    rotations: [0n, 0n, 0n],
  },
};

function transactionFeesFromEstimate(
  estimate: FeePresetEstimate["estimate"],
): Record<string, unknown> | undefined {
  if (!estimate?.distribution) return undefined;

  const fees: Record<string, unknown> = {
    distribution: estimate.distribution,
  };

  if (estimate.messageAllocations) {
    fees.messageAllocations = estimate.messageAllocations;
  }

  const feeValue = estimate.feeValue ?? estimate.fee_value;
  if (feeValue !== undefined) {
    fees.feeValue = feeValue;
  }

  return fees;
}

/**
 * Turn a {@link FeePresetEstimate} into the `fees` object genlayer-js
 * `writeContract` accepts. Returns `undefined` when there is nothing to pass (the
 * write then uses default fees).
 */
export function feePresetToTransactionFees(
  preset?: FeePresetEstimate,
): Record<string, unknown> | undefined {
  return transactionFeesFromEstimate(preset?.estimate);
}

/**
 * Estimate fees for a write at the given appeal-robustness `level`, refining the
 * estimate with a simulation when the client supports it. Returns `undefined` if
 * the client does not expose fee estimation (older/custom transports), in which
 * case the write should just be submitted with default fees.
 */
export async function estimateWriteFeePreset(
  client: GenLayerClient,
  request: {
    address: HexAddress;
    functionName: string;
    args: unknown[];
    value?: bigint;
  },
  level: FeePresetLevel = "standard",
): Promise<FeePresetEstimate | undefined> {
  if (typeof client.estimateTransactionFees !== "function") {
    return undefined;
  }

  const options = PRESET_OPTIONS[level];
  const initialEstimate = await client.estimateTransactionFees(options);
  let estimate = initialEstimate;

  if (
    typeof client.simulateWriteContract === "function" &&
    typeof client.estimateTransactionFeesFromSimulation === "function"
  ) {
    const simulation = await client.simulateWriteContract({
      ...request,
      includeReceipt: true,
      value: request.value ?? 0n,
      fees: transactionFeesFromEstimate(initialEstimate),
    });

    estimate = await client.estimateTransactionFeesFromSimulation({
      ...options,
      simulation,
    });
  }

  return {
    level,
    estimate,
    observed: estimate?.observed,
  };
}
