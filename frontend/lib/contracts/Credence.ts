import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import type {
  Borrower,
  Pool,
  Stats,
  ProtocolConfig,
  ServiceResult,
  TransactionReceipt,
  LenderBalance,
  CreditRecord,
  BorrowersPage,
  Grade,
} from "./types";
import {
  estimateWriteFeePreset,
  feePresetToTransactionFees,
  type FeePresetEstimate,
  type FeePresetLevel,
} from "../genlayer/fees";

/**
 * Normalize a GenLayer view return value into a plain JS object.
 *
 * genlayer-js decodes a contract dict return as a `Map`. Nested values can be
 * plain primitives or further Maps/arrays. This recursively converts Maps to
 * objects so the UI can read `borrower.grade`, `borrower.evidence[0].kind`, etc.
 * directly. Numeric bigints returned by the SDK are coerced to Number for the
 * small count/epoch fields (never for base-unit money, which the contract
 * already returns as strings).
 */
function normalize(value: any): any {
  if (value instanceof Map) {
    const obj: Record<string, any> = {};
    for (const [k, v] of value.entries()) {
      obj[String(k)] = normalize(v);
    }
    return obj;
  }
  if (Array.isArray(value)) {
    return value.map(normalize);
  }
  if (typeof value === "bigint") {
    // Base-unit money is returned by the contract as strings; any bigint here is
    // a small count/epoch/bps value that is safe as a JS number.
    return Number(value);
  }
  return value;
}

/**
 * Credence contract binding — the frontend's typed gateway to the on-chain,
 * AI-underwritten, undercollateralized credit Intelligent Contract
 * (credence.py, class Credence).
 *
 * Follows the FootballBets.ts / JusticeUpgrade.ts pattern from the GenLayer
 * boilerplate:
 *   - view methods go through client.readContract
 *   - write methods go through client.writeContract + waitForTransactionReceipt
 *   - the LLM-backed write (`assess`) estimates fees with the shared presets
 *
 * MONEY: 1 token = 1e18 base units. Amounts sent into the contract (draw amount,
 * repay/fund value, withdraw amount) are base-unit integers passed as bigint.
 */
class Credence {
  private contractAddress: `0x${string}`;
  private client: any;
  private studioUrl?: string;

  constructor(
    contractAddress: string,
    address?: string | null,
    studioUrl?: string
  ) {
    this.contractAddress = contractAddress as `0x${string}`;
    this.studioUrl = studioUrl;

    const config: any = {
      chain: studionet,
    };

    if (address) {
      config.account = address as `0x${string}`;
    }

    if (studioUrl) {
      config.endpoint = studioUrl;
    }

    this.client = createClient(config);
  }

  /**
   * Update the address used for transactions (recreates the client).
   */
  updateAccount(address: string): void {
    const config: any = {
      chain: studionet,
      account: address as `0x${string}`,
    };

    if (this.studioUrl) {
      config.endpoint = this.studioUrl;
    }

    this.client = createClient(config);
  }

  // ── Fee estimation (assess is the expensive consensus-LLM call) ─────────────
  async estimateAssessFees(
    borrower: string,
    level: FeePresetLevel = "high"
  ): Promise<FeePresetEstimate | undefined> {
    return estimateWriteFeePreset(
      this.client,
      {
        address: this.contractAddress,
        functionName: "assess",
        args: [borrower],
      },
      level
    );
  }

  // ── Views ──────────────────────────────────────────────────────────────────

  /**
   * Read a full borrower record.
   * @returns the Borrower, or null if the address has never applied.
   */
  async getBorrower(borrower: string): Promise<Borrower | null> {
    try {
      const result = await this.client.readContract({
        address: this.contractAddress,
        functionName: "get_borrower",
        args: [borrower],
      });
      return normalize(result) as Borrower;
    } catch (error: any) {
      // The contract raises "no such borrower" for unknown addresses.
      if (String(error?.message || error).includes("no such borrower")) {
        return null;
      }
      console.error("Error fetching borrower:", error);
      throw new Error("Failed to fetch borrower from contract");
    }
  }

  /**
   * Read the available credit (credit_limit - principal), base-unit string.
   * @returns the string, or null if the address has never applied.
   */
  async getAvailableCredit(borrower: string): Promise<string | null> {
    try {
      const result = await this.client.readContract({
        address: this.contractAddress,
        functionName: "available_credit",
        args: [borrower],
      });
      return String(normalize(result));
    } catch (error: any) {
      if (String(error?.message || error).includes("no such borrower")) {
        return null;
      }
      console.error("Error fetching available credit:", error);
      throw new Error("Failed to fetch available credit from contract");
    }
  }

  /**
   * Read a lender's position: redeemable `funded` principal and accrued,
   * unclaimed `pending_yield` (both base-unit strings). Zeroes for an address
   * that has never funded the pool.
   */
  async getLenderBalance(lender: string): Promise<LenderBalance> {
    try {
      const result = await this.client.readContract({
        address: this.contractAddress,
        functionName: "lender_balance",
        args: [lender],
      });
      const obj = normalize(result) as Partial<LenderBalance>;
      return {
        funded: String(obj?.funded ?? "0"),
        pending_yield: String(obj?.pending_yield ?? "0"),
      };
    } catch (error: any) {
      console.error("Error fetching lender balance:", error);
      throw new Error("Failed to fetch lender balance from contract");
    }
  }

  /**
   * Read a lender's accrued, unclaimed yield (base-unit string). Convenience
   * read for the Earn panel; equals lender_balance(addr).pending_yield.
   */
  async getPendingYield(lender: string): Promise<string> {
    try {
      const result = await this.client.readContract({
        address: this.contractAddress,
        functionName: "pending_yield",
        args: [lender],
      });
      return String(normalize(result));
    } catch (error: any) {
      console.error("Error fetching pending yield:", error);
      throw new Error("Failed to fetch pending yield from contract");
    }
  }

  /**
   * Composable creditworthiness oracle: the live on-chain credit standing of any
   * address (credit_of). Always resolves — an unknown address returns a safe
   * `known: false` DENY/zero record rather than throwing.
   */
  async getCreditOf(borrower: string): Promise<CreditRecord> {
    const result = await this.client.readContract({
      address: this.contractAddress,
      functionName: "credit_of",
      args: [borrower],
    });
    return normalize(result) as CreditRecord;
  }

  /**
   * One-call creditworthiness gate (is_creditworthy): true iff the address
   * currently holds at least `minGrade` and is not in default.
   */
  async isCreditworthy(borrower: string, minGrade: Grade): Promise<boolean> {
    const result = await this.client.readContract({
      address: this.contractAddress,
      functionName: "is_creditworthy",
      args: [borrower, minGrade],
    });
    return Boolean(normalize(result));
  }

  /**
   * Read a bounded, paginated slice of the borrower roster (page_borrowers).
   * `next_offset` is -1 on the last page.
   */
  async pageBorrowers(offset: number, limit: number): Promise<BorrowersPage> {
    const result = await this.client.readContract({
      address: this.contractAddress,
      functionName: "page_borrowers",
      args: [offset, limit],
    });
    return normalize(result) as BorrowersPage;
  }

  /**
   * Read the lending-pool accounting.
   */
  async getPool(): Promise<Pool> {
    try {
      const result = await this.client.readContract({
        address: this.contractAddress,
        functionName: "get_pool",
        args: [],
      });
      return normalize(result) as Pool;
    } catch (error: any) {
      console.error("Error fetching pool:", error);
      throw new Error("Failed to fetch pool from contract");
    }
  }

  /**
   * Read the aggregate protocol stats.
   */
  async getStats(): Promise<Stats> {
    try {
      const result = await this.client.readContract({
        address: this.contractAddress,
        functionName: "stats",
        args: [],
      });
      return normalize(result) as Stats;
    } catch (error: any) {
      console.error("Error fetching stats:", error);
      throw new Error("Failed to fetch stats from contract");
    }
  }

  /**
   * Read the protocol configuration (grades, grade→tokens, terms, panel size).
   */
  async getConfig(): Promise<ProtocolConfig> {
    try {
      const result = await this.client.readContract({
        address: this.contractAddress,
        functionName: "get_config",
        args: [],
      });
      return normalize(result) as ProtocolConfig;
    } catch (error: any) {
      console.error("Error fetching config:", error);
      throw new Error("Failed to fetch config from contract");
    }
  }

  /**
   * Read the number of borrowers on the roster.
   */
  async getRosterSize(): Promise<number> {
    try {
      const result = await this.client.readContract({
        address: this.contractAddress,
        functionName: "roster_size",
        args: [],
      });
      return Number(normalize(result));
    } catch (error: any) {
      console.error("Error fetching roster size:", error);
      throw new Error("Failed to fetch roster size from contract");
    }
  }

  // ── Writes ──────────────────────────────────────────────────────────────────

  /**
   * Shared write helper: submit, wait for an ACCEPTED receipt, return it.
   */
  private async submit(
    functionName: string,
    args: unknown[],
    opts: { value?: bigint; fees?: unknown; retries?: number } = {}
  ): Promise<TransactionReceipt> {
    const txHash = await this.client.writeContract({
      address: this.contractAddress,
      functionName,
      args,
      value: opts.value ?? BigInt(0),
      ...(opts.fees ? { fees: opts.fees } : {}),
    });

    const receipt = await this.client.waitForTransactionReceipt({
      hash: txHash,
      status: "ACCEPTED" as any,
      retries: opts.retries ?? 24,
      interval: 5000,
    });

    return receipt as TransactionReceipt;
  }

  /**
   * A borrower opts in and submits their own public evidence of creditworthiness.
   * `requestedTokens` is a whole-token integer (≤ 2500). `evidenceJson` is the
   * JSON string the contract expects: an array of {kind, label, content}. Pass
   * "" for an application with no evidence (the contract treats "" as empty).
   */
  async requestCredit(
    purpose: string,
    requestedTokens: number,
    evidenceJson: string = ""
  ): Promise<TransactionReceipt> {
    try {
      return await this.submit("request_credit", [
        purpose,
        requestedTokens,
        evidenceJson,
      ]);
    } catch (error) {
      console.error("Error requesting credit:", error);
      throw error;
    }
  }

  /**
   * Run the on-chain consensus underwriting panel on a pending request.
   *
   * This is the slow, expensive write: a panel of independent AI underwriters
   * runs inside the GenVM, and for any url evidence every validator independently
   * fetches the page live and must agree on the same bounded grade. After the
   * transaction is accepted we read the stored assessment back with get_borrower
   * (the authoritative on-chain result) rather than parsing the receipt.
   */
  async assess(
    borrower: string,
    feePreset?: FeePresetEstimate
  ): Promise<Borrower> {
    try {
      const fees = feePresetToTransactionFees(feePreset);
      await this.submit("assess", [borrower], { fees, retries: 36 });
      const result = await this.getBorrower(borrower);
      if (!result) {
        throw new Error("Assessment could not be read back after underwriting");
      }
      return result;
    } catch (error) {
      console.error("Error assessing borrower:", error);
      throw error;
    }
  }

  /**
   * Escalate an assessment to the larger, independent appeal panel (due process).
   *
   * `appeal` is sent from the borrower's own account (the contract keys on
   * msg.sender and takes no argument). `selfAddr` is that same address, used only
   * to read the re-decided record back after the write is accepted — exactly as
   * `assess` does. Allowed once, only for an assessed borrower with no debt.
   */
  async appeal(selfAddr: string, feePreset?: FeePresetEstimate): Promise<Borrower> {
    try {
      const fees = feePresetToTransactionFees(feePreset);
      await this.submit("appeal", [], { fees, retries: 36 });
      const result = await this.getBorrower(selfAddr);
      if (!result) {
        throw new Error("Appeal could not be read back after underwriting");
      }
      return result;
    } catch (error) {
      console.error("Error appealing assessment:", error);
      throw error;
    }
  }

  // ── Fee estimation for the appeal panel (larger, so costlier) ───────────────
  async estimateAppealFees(
    level: FeePresetLevel = "high"
  ): Promise<FeePresetEstimate | undefined> {
    return estimateWriteFeePreset(
      this.client,
      {
        address: this.contractAddress,
        functionName: "appeal",
        args: [],
      },
      level
    );
  }

  /**
   * Draw native tokens against an approved line (undercollateralized).
   * `amountBaseUnits` is a base-unit integer (bigint).
   */
  async draw(amountBaseUnits: bigint): Promise<TransactionReceipt> {
    try {
      return await this.submit("draw", [amountBaseUnits]);
    } catch (error) {
      console.error("Error drawing credit:", error);
      throw error;
    }
  }

  /**
   * Repay with native value. `valueBaseUnits` is the amount of native value to
   * send (bigint). Principal is cleared first, then accrued fees.
   */
  async repay(valueBaseUnits: bigint): Promise<TransactionReceipt> {
    try {
      return await this.submit("repay", [], { value: valueBaseUnits });
    } catch (error) {
      console.error("Error repaying:", error);
      throw error;
    }
  }

  /**
   * Fund the lending pool with native value. `valueBaseUnits` is the amount of
   * native value to send (bigint).
   */
  async fund(valueBaseUnits: bigint): Promise<TransactionReceipt> {
    try {
      return await this.submit("fund", [], { value: valueBaseUnits });
    } catch (error) {
      console.error("Error funding pool:", error);
      throw error;
    }
  }

  /**
   * Redeem (defund) contributed lender capital, up to the pool's available cash.
   * `amountBaseUnits` is a base-unit integer (bigint). Funds return on finalized
   * timing. Capital currently lent out must be repaid before it can be withdrawn.
   */
  async defund(amountBaseUnits: bigint): Promise<TransactionReceipt> {
    try {
      return await this.submit("defund", [amountBaseUnits]);
    } catch (error) {
      console.error("Error defunding pool:", error);
      throw error;
    }
  }

  /**
   * Service the loan book (permissionless keeper call): walk a bounded batch and
   * move past-due lines to overdue/defaulted against the consensus clock. The
   * result is read back from stats() by the caller; here we just return the
   * receipt.
   */
  async serviceBook(maxItems: number = 25): Promise<TransactionReceipt> {
    try {
      return await this.submit("service_book", [maxItems]);
    } catch (error) {
      console.error("Error servicing book:", error);
      throw error;
    }
  }

  /**
   * Claim accrued lender yield (claim_yield): a share of origination fees,
   * paid from pool cash. Separate from principal; redeem principal with defund.
   * Returns the receipt; the caller reads the new balance back from the views.
   */
  async claimYield(): Promise<TransactionReceipt> {
    try {
      return await this.submit("claim_yield", []);
    } catch (error) {
      console.error("Error claiming yield:", error);
      throw error;
    }
  }

  /**
   * Withdraw accrued protocol revenue (owner-only). `amountBaseUnits` is bigint.
   */
  async withdrawFees(
    to: string,
    amountBaseUnits: bigint
  ): Promise<TransactionReceipt> {
    try {
      return await this.submit("withdraw_fees", [to, amountBaseUnits]);
    } catch (error) {
      console.error("Error withdrawing fees:", error);
      throw error;
    }
  }

  // ── Admin (owner / staff) ────────────────────────────────────────────────────
  async setPaused(paused: boolean): Promise<TransactionReceipt> {
    return this.submit("set_paused", [paused]);
  }

  async setAutonomous(on: boolean): Promise<TransactionReceipt> {
    return this.submit("set_autonomous", [on]);
  }

  /**
   * Set the protocol terms (owner-only). Arg order mirrors the v1.1 contract:
   * set_terms(lender_share_bps, term_seconds, grace_seconds). `lenderShareBps`
   * is 0..10000 (share of each origination fee streamed to lenders as yield).
   */
  async setTerms(
    lenderShareBps: number,
    termSeconds: number,
    graceSeconds: number
  ): Promise<TransactionReceipt> {
    return this.submit("set_terms", [lenderShareBps, termSeconds, graceSeconds]);
  }

  async setRelayer(relayer: string): Promise<TransactionReceipt> {
    return this.submit("set_relayer", [relayer]);
  }

  /**
   * Set the guardian address (owner-only). The guardian is a separation-of-duties
   * incident-response role: it may pause the protocol but cannot move funds or
   * change economics.
   */
  async setGuardian(guardian: string): Promise<TransactionReceipt> {
    return this.submit("set_guardian", [guardian]);
  }

  /**
   * Set the pool utilization cap in basis points, 0..10000 (owner-only). 10000 =
   * no cap; lower it to hold a liquidity buffer against defunds / yield claims.
   */
  async setRiskLimits(maxUtilizationBps: number): Promise<TransactionReceipt> {
    return this.submit("set_risk_limits", [maxUtilizationBps]);
  }

  /**
   * Set the annual interest rate on outstanding principal, 0..10000 bps APR
   * (owner-only). 0 turns interest off. Interest is lenders' primary yield.
   */
  async setInterestBps(interestBps: number): Promise<TransactionReceipt> {
    return this.submit("set_interest_bps", [interestBps]);
  }

  async setDev(dev: string): Promise<TransactionReceipt> {
    return this.submit("set_dev", [dev]);
  }

  async transferOwnership(newOwner: string): Promise<TransactionReceipt> {
    return this.submit("transfer_ownership", [newOwner]);
  }

  /**
   * Second step of the two-step ownership transfer: the nominated pending owner
   * calls this from their own wallet to complete the handover. Reverts for
   * anyone who is not the current `pending_owner`.
   */
  async acceptOwnership(): Promise<TransactionReceipt> {
    return this.submit("accept_ownership", []);
  }
}

export type { ServiceResult };
export default Credence;
