/**
 * @credence/sdk — a typed, framework-agnostic integration SDK for the Credence
 * GenLayer protocol (reputation-underwritten, undercollateralized credit).
 *
 * GenLayer referral: JTR01FHP   #CreditWithoutCollateral
 *
 * @example
 *   import { createClient } from "genlayer-js";
 *   import { studionet } from "genlayer-js/chains";
 *   import { CredenceClient } from "@credence/sdk";
 *
 *   const client = createClient({ chain: studionet, account });
 *   const credence = new CredenceClient(client, "0xYourContractAddress");
 *   const pool = await credence.getPool();
 */

// Primary client.
export { CredenceClient, default } from "./client.js";
export type { CredenceClientOptions } from "./client.js";

// Domain / protocol types.
export type {
  Grade,
  BorrowerStatus,
  EvidenceKind,
  GradeVote,
  EvidenceItem,
  EvidenceDraft,
  Borrower,
  Pool,
  LenderBalance,
  CreditRecord,
  BorrowerSummary,
  BorrowersPage,
  Stats,
  ProtocolConfig,
  ServiceResult,
  TransactionReceipt,
} from "./types.js";

// Fee presets for the consensus-LLM `assess` write.
export { estimateWriteFeePreset, feePresetToTransactionFees } from "./fees.js";
export type { FeePresetLevel, FeePresetEstimate } from "./fees.js";

// Amount conversions (1 token = 1e18 base units).
export { toBaseUnits, fromBaseUnits, tokensToBaseUnits, baseUnitsToTokens } from "./amounts.js";

// Protocol constants and grade helpers.
export {
  BASE,
  DECIMALS,
  GRADES,
  GRADE_TOKENS,
  ORIGINATION_BPS_BY_GRADE,
  UNOWNED_GRADE_CAP,
  PANEL_SIZE,
  APPEAL_PANEL_SIZE,
  MAX_INTEREST_BPS,
  MIN_DRAW_UNITS,
  MIN_REWARD_PRINCIPAL,
  gradeRank,
  creditLineTokens,
  gradeAtLeast,
  isGrade,
} from "./constants.js";

// The structural genlayer-js client surface this SDK depends on (shim).
export type {
  GenLayerClient,
  HexAddress,
  ReadContractParams,
  WriteContractParams,
  WaitForReceiptParams,
  SimulateWriteParams,
} from "./genlayer.js";
