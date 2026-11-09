/**
 * {@link CredenceClient} — a typed, framework-agnostic gateway to the Credence
 * Intelligent Contract (credence.py, v1.4.0): reputation-underwritten,
 * undercollateralized credit for the agentic economy.
 *
 * Construct it with a genlayer-js client you create yourself and the deployed
 * contract address. Every view and write on the contract has a typed method
 * here. The call pattern mirrors the proven reference frontend exactly:
 *   - views  → `client.readContract`
 *   - writes → `client.writeContract` + `client.waitForTransactionReceipt`
 *   - the consensus-LLM write (`assess`) supports fee presets.
 *
 * MONEY: 1 token = 1e18 base units. Amounts read back are base-unit strings;
 * amounts sent in (draw/repay/fund/defund/withdraw) are base-unit `bigint`.
 * Use {@link toBaseUnits} / {@link fromBaseUnits} to convert.
 */

import { fromBaseUnits, toBaseUnits } from "./amounts.js";
import { estimateWriteFeePreset, feePresetToTransactionFees } from "./fees.js";
import type { FeePresetEstimate, FeePresetLevel } from "./fees.js";
import type { GenLayerClient, HexAddress } from "./genlayer.js";
import type {
  Borrower,
  BorrowersPage,
  CreditRecord,
  EvidenceDraft,
  Grade,
  LenderBalance,
  Pool,
  ProtocolConfig,
  Stats,
  TransactionReceipt,
} from "./types.js";

/**
 * Recursively normalize a genlayer-js view return value into a plain JS object.
 *
 * genlayer-js decodes a contract `dict` return as a `Map`; nested values may be
 * further `Map`s or arrays. This converts `Map`→object and recurses, so callers
 * read `borrower.grade`, `borrower.evidence[0].kind`, etc. directly. A `bigint`
 * here is always a small count/epoch/bps field and is coerced to `number`;
 * base-unit money is already returned by the contract as a string and is left
 * untouched (never coerced — a JS number cannot hold 1e18 safely).
 */
function normalize(value: unknown): unknown {
  if (value instanceof Map) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of value.entries()) {
      obj[String(k)] = normalize(v);
    }
    return obj;
  }
  if (Array.isArray(value)) {
    return value.map((v) => normalize(v));
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  return value;
}

/** True when an error is the contract's "no such borrower" revert. */
function isNoSuchBorrower(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("no such borrower");
}

/** Options accepted by the shared write helper. */
interface SubmitOptions {
  /** native value to send with a payable write, base units. */
  value?: bigint;
  /** transaction-fee object (from a fee preset). */
  fees?: unknown;
  /** receipt poll attempts (default 24). */
  retries?: number;
}

/** Construction options for {@link CredenceClient}. */
export interface CredenceClientOptions {
  /** receipt poll attempts for ordinary writes (default 24). */
  defaultRetries?: number;
  /** receipt poll attempts for the consensus-LLM `assess` write (default 36). */
  assessRetries?: number;
  /** receipt poll interval in ms (default 5000). */
  pollIntervalMs?: number;
  /** terminal status to wait for (default "ACCEPTED"). */
  waitStatus?: string;
}

export class CredenceClient {
  private readonly contractAddress: HexAddress;
  private client: GenLayerClient;
  private readonly defaultRetries: number;
  private readonly assessRetries: number;
  private readonly pollIntervalMs: number;
  private readonly waitStatus: string;

  /**
   * @param client   a genlayer-js client (from `createClient(...)`). It must be
   *                 configured with an account to send writes; reads work
   *                 without one.
   * @param contractAddress the deployed Credence contract address (0x…).
   * @param options  optional receipt-polling tuning.
   */
  constructor(
    client: GenLayerClient,
    contractAddress: string,
    options: CredenceClientOptions = {},
  ) {
    if (!client) throw new Error("CredenceClient: a genlayer-js client is required");
    if (!/^0x[a-fA-F0-9]{40}$/.test(contractAddress.trim())) {
      throw new Error(
        `CredenceClient: contractAddress must be a 0x-prefixed 40-hex address, got ${JSON.stringify(
          contractAddress,
        )}`,
      );
    }
    this.client = client;
    this.contractAddress = contractAddress.trim() as HexAddress;
    this.defaultRetries = options.defaultRetries ?? 24;
    this.assessRetries = options.assessRetries ?? 36;
    this.pollIntervalMs = options.pollIntervalMs ?? 5000;
    this.waitStatus = options.waitStatus ?? "ACCEPTED";
  }

  /** The deployed contract address this client is bound to. */
  get address(): HexAddress {
    return this.contractAddress;
  }

  /**
   * Swap the underlying genlayer-js client (e.g. after the integrator connects a
   * different account/signer). Reuse the same {@link CredenceClient} instance.
   */
  setClient(client: GenLayerClient): void {
    if (!client) throw new Error("CredenceClient.setClient: a client is required");
    this.client = client;
  }

  // ── Amount / evidence helpers (static) ──────────────────────────────────────

  /** Convert a human token amount to base units (bigint). 1 token = 1e18. */
  static toBaseUnits = toBaseUnits;
  /** Convert base units to a human token decimal string. */
  static fromBaseUnits = fromBaseUnits;

  /**
   * Serialize evidence drafts into the `evidence_json` string `request_credit`
   * expects: a JSON array of `{kind,label,content}`. The contract fills in the
   * `sha256`/`fetched_*`/`ownership_proven` fields itself during `assess`.
   */
  static encodeEvidence(evidence: EvidenceDraft[]): string {
    return JSON.stringify(
      evidence.map((e) => ({ kind: e.kind, label: e.label, content: e.content })),
    );
  }

  // ── Views ────────────────────────────────────────────────────────────────

  /** Read the protocol configuration (version, roles, terms, grades, limits). */
  async getConfig(): Promise<ProtocolConfig> {
    return (await this.read("get_config", [])) as ProtocolConfig;
  }

  /** Read the lending-pool accounting. */
  async getPool(): Promise<Pool> {
    return (await this.read("get_pool", [])) as Pool;
  }

  /** Read the aggregate protocol stats. */
  async getStats(): Promise<Stats> {
    return (await this.read("stats", [])) as Stats;
  }

  /** Read the number of borrowers on the roster. */
  async getRosterSize(): Promise<number> {
    return Number(normalize(await this.rawRead("roster_size", [])));
  }

  /**
   * Read a full borrower record.
   * @returns the {@link Borrower}, or `null` if the address has never applied.
   */
  async getBorrower(borrower: string): Promise<Borrower | null> {
    try {
      return (await this.read("get_borrower", [borrower])) as Borrower;
    } catch (error) {
      if (isNoSuchBorrower(error)) return null;
      throw error;
    }
  }

  /**
   * Read a borrower's currently available credit (`credit_limit - principal`),
   * as a base-unit string.
   * @returns the string, or `null` if the address has never applied.
   */
  async getAvailableCredit(borrower: string): Promise<string | null> {
    try {
      return String(normalize(await this.rawRead("available_credit", [borrower])));
    } catch (error) {
      if (isNoSuchBorrower(error)) return null;
      throw error;
    }
  }

  /**
   * Composable creditworthiness oracle: the live on-chain credit standing of any
   * address (`credit_of`). Always resolves — an unknown address returns a safe
   * `known: false` DENY/zero record rather than throwing. Delinquency is computed
   * live from the consensus clock, so the result is never stale behind the keeper.
   */
  async creditOf(borrower: string): Promise<CreditRecord> {
    return (await this.read("credit_of", [borrower])) as CreditRecord;
  }

  /**
   * One-call creditworthiness gate (`is_creditworthy`): true iff the address
   * currently holds at least `minGrade` and is not in default / reassessment /
   * overdue. The single read other protocols plug into.
   */
  async isCreditworthy(borrower: string, minGrade: Grade): Promise<boolean> {
    return Boolean(normalize(await this.rawRead("is_creditworthy", [borrower, minGrade])));
  }

  /**
   * Read a lender's position: redeemable `funded` principal and accrued,
   * unclaimed `pending_yield` (both base-unit strings). Zeroes for an address
   * that has never funded the pool.
   */
  async getLenderBalance(lender: string): Promise<LenderBalance> {
    const obj = (await this.read("lender_balance", [lender])) as Partial<LenderBalance>;
    return {
      funded: String(obj?.funded ?? "0"),
      pending_yield: String(obj?.pending_yield ?? "0"),
    };
  }

  /**
   * Read a lender's accrued, unclaimed yield (base-unit string). Equivalent to
   * `getLenderBalance(addr).pending_yield`.
   */
  async getPendingYield(lender: string): Promise<string> {
    return String(normalize(await this.rawRead("pending_yield", [lender])));
  }

  /**
   * Read a bounded, paginated slice of the borrower roster (`page_borrowers`).
   * `next_offset` is -1 on the last page. `limit` is capped at 50 on-chain.
   */
  async pageBorrowers(offset: number, limit: number): Promise<BorrowersPage> {
    return (await this.read("page_borrowers", [offset, limit])) as BorrowersPage;
  }

  // ── Fee estimation (assess is the expensive consensus-LLM write) ────────────

  /**
   * Estimate fees for the `assess` write at the given appeal-robustness `level`.
   * Returns `undefined` if the client does not expose fee estimation; `assess`
   * then submits with default fees. Pass the result straight into {@link assess}.
   */
  async estimateAssessFees(
    borrower: string,
    level: FeePresetLevel = "high",
  ): Promise<FeePresetEstimate | undefined> {
    return estimateWriteFeePreset(
      this.client,
      { address: this.contractAddress, functionName: "assess", args: [borrower] },
      level,
    );
  }

  /**
   * Estimate fees for the `appeal` write. Appeal runs a LARGER independent panel
   * (`appeal_panel_size`, default 5) than `assess`, so it is the costliest write —
   * estimate before submitting. Takes no borrower argument (the contract keys on
   * `msg.sender`). Returns `undefined` if the client exposes no fee estimation;
   * pass the result straight into {@link appeal}.
   */
  async estimateAppealFees(
    level: FeePresetLevel = "high",
  ): Promise<FeePresetEstimate | undefined> {
    return estimateWriteFeePreset(
      this.client,
      { address: this.contractAddress, functionName: "appeal", args: [] },
      level,
    );
  }

  // ── Borrower writes ─────────────────────────────────────────────────────────

  /**
   * A borrower opts in and submits their own public evidence of creditworthiness.
   *
   * `requestedTokens` is a WHOLE-token integer (1..2500). `evidence` may be the
   * JSON string the contract expects, or an {@link EvidenceDraft}[] which is
   * serialized for you; pass nothing for an application with no evidence. Sent
   * from the borrower's own account (the contract keys on `msg.sender`).
   */
  async requestCredit(
    purpose: string,
    requestedTokens: number,
    evidence: string | EvidenceDraft[] = "",
  ): Promise<TransactionReceipt> {
    const evidenceJson =
      typeof evidence === "string" ? evidence : CredenceClient.encodeEvidence(evidence);
    return this.submit("request_credit", [purpose, requestedTokens, evidenceJson]);
  }

  /**
   * Run the on-chain consensus underwriting panel on a pending request.
   *
   * This is the slow, expensive write: a panel of independent AI underwriters
   * runs inside the GenVM, and for any url evidence every validator independently
   * fetches the page live and must agree on the same bounded grade. After the
   * transaction is accepted the authoritative stored assessment is read back with
   * `get_borrower` rather than parsed from the receipt.
   *
   * @param borrower  the applicant address to assess.
   * @param feePreset an estimate from {@link estimateAssessFees} (recommended).
   * @returns the updated {@link Borrower} with the binding grade, votes and limit.
   */
  async assess(borrower: string, feePreset?: FeePresetEstimate): Promise<Borrower> {
    const fees = feePresetToTransactionFees(feePreset);
    await this.submit("assess", [borrower], { fees, retries: this.assessRetries });
    const result = await this.getBorrower(borrower);
    if (!result) {
      throw new Error("assess: the assessment could not be read back after underwriting");
    }
    return result;
  }

  /**
   * Escalate an assessment to the larger, independent appeal panel (due process).
   *
   * `appeal` re-judges the application from scratch on a bigger panel
   * (`appeal_panel_size`, default 5) and may change the credit line in either
   * direction. It is a consensus-LLM write like {@link assess} — slow and the
   * most expensive, so estimate fees with {@link estimateAppealFees} first. The
   * contract keys on `msg.sender` and takes no argument, so this is sent from the
   * borrower's OWN account; `selfAddress` is that same address, used only to read
   * the re-decided record back after the transaction is accepted.
   *
   * Allowed exactly ONCE per borrower, and only for an already-assessed borrower
   * (`approved`/`denied`) with no outstanding debt — settle any open line first.
   *
   * @param selfAddress the borrower's own address (= the sender), to read back.
   * @param feePreset   an estimate from {@link estimateAppealFees} (recommended).
   * @returns the updated {@link Borrower} with the appeal panel's binding grade,
   *          votes and limit (`appeal_tier` becomes 1).
   */
  async appeal(selfAddress: string, feePreset?: FeePresetEstimate): Promise<Borrower> {
    const fees = feePresetToTransactionFees(feePreset);
    await this.submit("appeal", [], { fees, retries: this.assessRetries });
    const result = await this.getBorrower(selfAddress);
    if (!result) {
      throw new Error("appeal: the re-assessment could not be read back after underwriting");
    }
    return result;
  }

  /**
   * Draw native tokens against an approved line (undercollateralized).
   * `amountBaseUnits` is a base-unit `bigint` (minimum 1 token on-chain). Sent
   * from the borrower's own account. Tokens arrive on finalized timing.
   */
  async draw(amountBaseUnits: bigint): Promise<TransactionReceipt> {
    return this.submit("draw", [amountBaseUnits]);
  }

  /**
   * Repay with native value. `valueBaseUnits` is the native value to send
   * (`bigint`); it is applied principal first (which frees the line), then
   * accrued origination fee, then accrued interest. Overpayment reverts, so to
   * clear a line in full send exactly its total owed — read it from
   * {@link Borrower.owed} (`owed = principal + fee_accrued + interest_accrued`),
   * never principal alone once interest/fees have accrued. A full, on-time
   * repayment of a real line lifts the borrower's standing and grade; fees and
   * interest are split to lenders (as yield) and the protocol.
   */
  async repay(valueBaseUnits: bigint): Promise<TransactionReceipt> {
    return this.submit("repay", [], { value: valueBaseUnits });
  }

  // ── Lender / pool writes ──────────────────────────────────────────────────

  /**
   * Fund the lending pool with native value (`valueBaseUnits`, `bigint`). The
   * contributed capital earns a pro-rata share of every origination fee as yield.
   */
  async fund(valueBaseUnits: bigint): Promise<TransactionReceipt> {
    return this.submit("fund", [], { value: valueBaseUnits });
  }

  /**
   * Redeem (defund) contributed lender capital, up to the pool's available cash.
   * `amountBaseUnits` is a base-unit `bigint`. Capital currently lent out must be
   * repaid before it can be withdrawn; funds return on finalized timing.
   */
  async defund(amountBaseUnits: bigint): Promise<TransactionReceipt> {
    return this.submit("defund", [amountBaseUnits]);
  }

  /**
   * Claim accrued lender yield (`claim_yield`): a share of origination fees, paid
   * from pool cash. Separate from principal (redeem that with {@link defund}).
   */
  async claimYield(): Promise<TransactionReceipt> {
    return this.submit("claim_yield", []);
  }

  /**
   * Service the loan book (permissionless keeper call): walk a bounded batch and
   * move past-due lines to overdue/defaulted against the consensus clock. Read
   * the outcome back from {@link getStats} / {@link getPool} afterwards.
   *
   * @param maxItems batch size (default/capped at 25 on-chain).
   * @param hops     autonomous re-emission budget; -1 lets the contract decide.
   */
  async serviceBook(maxItems = 25, hops = -1): Promise<TransactionReceipt> {
    return this.submit("service_book", [maxItems, hops]);
  }

  // ── Admin writes (owner / staff) ──────────────────────────────────────────

  /**
   * Withdraw accrued protocol revenue (owner-only). `to` may be "" for the dev
   * address. `amountBaseUnits` is a base-unit `bigint`.
   */
  async withdrawFees(to: string, amountBaseUnits: bigint): Promise<TransactionReceipt> {
    return this.submit("withdraw_fees", [to, amountBaseUnits]);
  }

  /** Set the relayer address (owner-only). */
  async setRelayer(relayer: string): Promise<TransactionReceipt> {
    return this.submit("set_relayer", [relayer]);
  }

  /** Set the dev (fee recipient) address (owner-only). */
  async setDev(dev: string): Promise<TransactionReceipt> {
    return this.submit("set_dev", [dev]);
  }

  /**
   * Set the guardian address (owner-only). The guardian is a separation-of-duties
   * incident-response role: it may pause the protocol but cannot move funds or
   * change economics.
   */
  async setGuardian(guardian: string): Promise<TransactionReceipt> {
    return this.submit("set_guardian", [guardian]);
  }

  /** Pause or unpause the protocol (owner, relayer, or guardian). */
  async setPaused(paused: boolean): Promise<TransactionReceipt> {
    return this.submit("set_paused", [paused]);
  }

  /** Toggle autonomous self-servicing of the loan book (owner-only). */
  async setAutonomous(on: boolean): Promise<TransactionReceipt> {
    return this.submit("set_autonomous", [on]);
  }

  /**
   * Set protocol terms (owner-only). Arg order mirrors the contract:
   * `set_terms(lenderShareBps, termSeconds, graceSeconds)`. `lenderShareBps` is
   * 0..10000 (share of each origination fee streamed to lenders as yield).
   */
  async setTerms(
    lenderShareBps: number,
    termSeconds: number,
    graceSeconds: number,
  ): Promise<TransactionReceipt> {
    return this.submit("set_terms", [lenderShareBps, termSeconds, graceSeconds]);
  }

  /**
   * Set the pool utilization cap in basis points, 0..10000 (owner-only). 10000 =
   * no cap; lower it to hold a liquidity buffer against defunds/yield claims.
   */
  async setRiskLimits(maxUtilizationBps: number): Promise<TransactionReceipt> {
    return this.submit("set_risk_limits", [maxUtilizationBps]);
  }

  /**
   * Set the annual interest rate on outstanding principal, in basis points APR,
   * 0..10000 (owner-only). 0 turns interest off (the default); 10000 is the hard
   * cap (100% APR). Interest is lenders' primary yield. It applies only to lines
   * opened AFTER this call — an open line keeps the `rate_bps` it was fixed at on
   * draw (no retroactive re-pricing), so changing this never re-prices live debt.
   */
  async setInterestBps(interestBps: number): Promise<TransactionReceipt> {
    return this.submit("set_interest_bps", [interestBps]);
  }

  /** Nominate the next owner (step 1 of a two-step transfer; owner-only). */
  async transferOwnership(newOwner: string): Promise<TransactionReceipt> {
    return this.submit("transfer_ownership", [newOwner]);
  }

  /**
   * Accept ownership (step 2): called by the nominated pending owner from their
   * own wallet to complete the handover. Reverts for anyone else.
   */
  async acceptOwnership(): Promise<TransactionReceipt> {
    return this.submit("accept_ownership", []);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /** Raw view read (no normalization) — for scalar returns. */
  private rawRead(functionName: string, args: unknown[]): Promise<unknown> {
    return this.client.readContract({
      address: this.contractAddress,
      functionName,
      args,
    });
  }

  /** View read, normalized (Map→object, bigint counts→number). */
  private async read(functionName: string, args: unknown[]): Promise<unknown> {
    return normalize(await this.rawRead(functionName, args));
  }

  /** Submit a write, wait for the terminal receipt, and return it. */
  private async submit(
    functionName: string,
    args: unknown[],
    opts: SubmitOptions = {},
  ): Promise<TransactionReceipt> {
    const hash = await this.client.writeContract({
      address: this.contractAddress,
      functionName,
      args,
      value: opts.value ?? 0n,
      ...(opts.fees ? { fees: opts.fees } : {}),
    });

    const receipt = await this.client.waitForTransactionReceipt({
      hash,
      status: this.waitStatus,
      retries: opts.retries ?? this.defaultRetries,
      interval: this.pollIntervalMs,
    });

    return receipt as TransactionReceipt;
  }
}

export default CredenceClient;
