"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Credence from "../contracts/Credence";
import {
  getContractAddress,
  getStudioUrl,
  isContractConfigured,
} from "../genlayer/client";
import { useWallet } from "../genlayer/wallet";
import { success, error, info } from "../utils/toast";
import type {
  Borrower,
  Pool,
  Stats,
  ProtocolConfig,
  LenderBalance,
  CreditRecord,
  BorrowersPage,
  Grade,
} from "../contracts/types";
import {
  MOCK_BORROWER,
  MOCK_POOL,
  MOCK_STATS,
  MOCK_CONFIG,
  MOCK_LENDER_BALANCE,
  mockCreditOf,
  mockIsCreditworthy,
  mockPageBorrowers,
} from "../contracts/mock";

const DEMO_MSG =
  "Preview mode: no Credence contract is configured, so this action is simulated and moves no real value. Set NEXT_PUBLIC_CREDENCE_CONTRACT_ADDRESS to the deployed address to go live.";

const NOT_CONFIGURED_MSG =
  "The Credence contract address is not set. Add NEXT_PUBLIC_CREDENCE_CONTRACT_ADDRESS to your .env once the contract is deployed.";

/** Whether a usable contract address is configured. */
export function useIsContractConfigured(): boolean {
  return isContractConfigured();
}

/** Inverse convenience: the app is in read-only demo/preview mode. */
export function useIsDemoMode(): boolean {
  return !isContractConfigured();
}

/**
 * Get the Credence contract instance, or null when no address is configured
 * (demo mode). Recreated whenever the wallet address changes so genlayer-js is
 * configured with the current account.
 */
export function useCredenceContract(): Credence | null {
  const { address } = useWallet();
  const contractAddress = getContractAddress();
  const studioUrl = getStudioUrl();

  return useMemo(() => {
    if (!contractAddress) return null;
    return new Credence(contractAddress, address, studioUrl);
  }, [contractAddress, address, studioUrl]);
}

/** Read a full borrower record by address (mock in demo mode). */
export function useBorrower(borrowerAddr: string | null | undefined) {
  const contract = useCredenceContract();
  const demo = useIsDemoMode();
  const addr = (borrowerAddr || "").trim();

  return useQuery<Borrower | null, Error>({
    queryKey: ["borrower", addr, demo],
    queryFn: () => {
      if (demo) {
        // Present the demo borrower under whatever address was queried.
        return Promise.resolve(addr ? { ...MOCK_BORROWER, addr } : MOCK_BORROWER);
      }
      if (!contract) return Promise.resolve(null);
      return contract.getBorrower(addr);
    },
    enabled: demo ? !!addr : !!contract && !!addr,
    staleTime: 2000,
    refetchOnWindowFocus: false,
  });
}

/** Read the lending-pool accounting (mock in demo mode). */
export function usePool() {
  const contract = useCredenceContract();
  const demo = useIsDemoMode();

  return useQuery<Pool | null, Error>({
    queryKey: ["pool", demo],
    queryFn: () => {
      if (demo) return Promise.resolve(MOCK_POOL);
      if (!contract) return Promise.resolve(null);
      return contract.getPool();
    },
    enabled: true,
    staleTime: 4000,
    refetchOnWindowFocus: false,
  });
}

const EMPTY_LENDER_BALANCE: LenderBalance = { funded: "0", pending_yield: "0" };

/**
 * Read a lender's position — redeemable `funded` principal and accrued,
 * unclaimed `pending_yield` (both base-unit strings) — from lender_balance
 * (mock in demo mode). Returns zeroes when no address is given.
 */
export function useLenderBalance(lenderAddr: string | null | undefined) {
  const contract = useCredenceContract();
  const demo = useIsDemoMode();
  const addr = (lenderAddr || "").trim();

  return useQuery<LenderBalance, Error>({
    queryKey: ["lenderBalance", addr, demo],
    queryFn: () => {
      if (demo)
        return Promise.resolve(addr ? MOCK_LENDER_BALANCE : EMPTY_LENDER_BALANCE);
      if (!contract || !addr) return Promise.resolve(EMPTY_LENDER_BALANCE);
      return contract.getLenderBalance(addr);
    },
    enabled: demo ? true : !!contract,
    staleTime: 4000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Composable creditworthiness oracle: read any address's live on-chain credit
 * record (credit_of). Only runs when `addr` is a well-formed 0x… address.
 */
export function useCreditOf(lookupAddr: string | null | undefined) {
  const contract = useCredenceContract();
  const demo = useIsDemoMode();
  const addr = (lookupAddr || "").trim();
  const wellFormed = /^0x[a-fA-F0-9]{40}$/.test(addr);

  return useQuery<CreditRecord | null, Error>({
    queryKey: ["creditOf", addr, demo],
    queryFn: () => {
      if (demo) return Promise.resolve(mockCreditOf(addr));
      if (!contract) return Promise.resolve(null);
      return contract.getCreditOf(addr);
    },
    enabled: wellFormed && (demo ? true : !!contract),
    staleTime: 10000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/**
 * The borrower's current ownership-proof token (ownership_challenge). In demo
 * mode a clearly-labelled placeholder is returned.
 */
export function useOwnershipChallenge(lookupAddr: string | null | undefined) {
  const contract = useCredenceContract();
  const demo = useIsDemoMode();
  const addr = (lookupAddr || "").trim();
  const wellFormed = /^0x[a-fA-F0-9]{40}$/.test(addr);
  return useQuery<{ token: string; path: string } | null, Error>({
    queryKey: ["ownershipChallenge", addr, demo],
    queryFn: () => {
      if (demo)
        return Promise.resolve({
          token: "credence-verify=<connect a wallet on the live contract>",
          path: "/.well-known/credence-verify.txt",
        });
      if (!contract) return Promise.resolve(null);
      return contract.getOwnershipChallenge(addr);
    },
    enabled: wellFormed && (demo ? true : !!contract),
    staleTime: 5000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/**
 * One-call creditworthiness gate (is_creditworthy): does `addr` currently hold
 * at least `minGrade` and is not in default. Only runs for a well-formed address.
 */
export function useIsCreditworthy(
  lookupAddr: string | null | undefined,
  minGrade: Grade
) {
  const contract = useCredenceContract();
  const demo = useIsDemoMode();
  const addr = (lookupAddr || "").trim();
  const wellFormed = /^0x[a-fA-F0-9]{40}$/.test(addr);

  return useQuery<boolean, Error>({
    queryKey: ["isCreditworthy", addr, minGrade, demo],
    queryFn: () => {
      if (demo) return Promise.resolve(mockIsCreditworthy(addr, minGrade));
      if (!contract) return Promise.resolve(false);
      return contract.isCreditworthy(addr, minGrade);
    },
    enabled: wellFormed && (demo ? true : !!contract),
    staleTime: 10000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/**
 * Read a bounded, paginated page of the borrower roster (page_borrowers).
 */
export function usePageBorrowers(offset: number, limit: number) {
  const contract = useCredenceContract();
  const demo = useIsDemoMode();

  return useQuery<BorrowersPage | null, Error>({
    queryKey: ["pageBorrowers", offset, limit, demo],
    queryFn: () => {
      if (demo) return Promise.resolve(mockPageBorrowers(offset, limit));
      if (!contract) return Promise.resolve(null);
      return contract.pageBorrowers(offset, limit);
    },
    enabled: demo ? true : !!contract,
    staleTime: 5000,
    refetchOnWindowFocus: false,
  });
}

/** Read aggregate protocol stats (mock in demo mode). */
export function useStats() {
  const contract = useCredenceContract();
  const demo = useIsDemoMode();

  return useQuery<Stats | null, Error>({
    queryKey: ["stats", demo],
    queryFn: () => {
      if (demo) return Promise.resolve(MOCK_STATS);
      if (!contract) return Promise.resolve(null);
      return contract.getStats();
    },
    enabled: true,
    staleTime: 5000,
    refetchOnWindowFocus: false,
  });
}

/** Read the protocol configuration (mock in demo mode). */
export function useConfig() {
  const contract = useCredenceContract();
  const demo = useIsDemoMode();

  return useQuery<ProtocolConfig | null, Error>({
    queryKey: ["config", demo],
    queryFn: () => {
      if (demo) return Promise.resolve(MOCK_CONFIG);
      if (!contract) return Promise.resolve(null);
      return contract.getConfig();
    },
    enabled: true,
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });
}

/** Invalidate the queries that change after a borrower-affecting write. */
function useBorrowerInvalidation() {
  const queryClient = useQueryClient();
  return (addr?: string) => {
    queryClient.invalidateQueries({ queryKey: ["borrower"] });
    queryClient.invalidateQueries({ queryKey: ["pool"] });
    queryClient.invalidateQueries({ queryKey: ["stats"] });
    queryClient.invalidateQueries({ queryKey: ["lenderBalance"] });
    queryClient.invalidateQueries({ queryKey: ["config"] });
    void addr;
  };
}

/**
 * Request a credit line (opt in + submit evidence). Writes only; the caller then
 * triggers `assess`. In demo mode this is simulated locally by the apply form,
 * so this hook rejects with a clear preview message if called.
 */
export function useRequestCredit() {
  const contract = useCredenceContract();
  const { address } = useWallet();
  const demo = useIsDemoMode();
  const invalidate = useBorrowerInvalidation();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const mutation = useMutation({
    mutationFn: async ({
      purpose,
      requestedTokens,
      evidenceJson,
    }: {
      purpose: string;
      requestedTokens: number;
      evidenceJson?: string;
    }) => {
      if (demo) throw new Error(DEMO_MSG);
      if (!contract) throw new Error(NOT_CONFIGURED_MSG);
      if (!address)
        throw new Error("Wallet not connected. Connect your wallet to apply for credit.");
      setIsSubmitting(true);
      return contract.requestCredit(purpose, requestedTokens, evidenceJson ?? "");
    },
    onSuccess: () => {
      invalidate(address || undefined);
      setIsSubmitting(false);
      success("Application submitted on-chain", {
        description: "Your evidence is committed. Now run the underwriting panel.",
      });
    },
    onError: (err: any) => {
      setIsSubmitting(false);
      if (demo) info("Preview mode", { description: DEMO_MSG });
      else error("Failed to submit application", { description: err?.message || "Please try again." });
    },
  });

  return {
    ...mutation,
    isSubmitting,
    requestCredit: mutation.mutate,
    requestCreditAsync: mutation.mutateAsync,
  };
}

/**
 * Run the on-chain consensus underwriting panel on a borrower. The slow,
 * LLM-backed write; the assessment is read back from storage.
 */
export function useAssess() {
  const contract = useCredenceContract();
  const { address } = useWallet();
  const demo = useIsDemoMode();
  const invalidate = useBorrowerInvalidation();
  const [isAssessing, setIsAssessing] = useState(false);

  const mutation = useMutation<Borrower, Error, { borrower: string }>({
    mutationFn: async ({ borrower }) => {
      if (demo) throw new Error(DEMO_MSG);
      if (!contract) throw new Error(NOT_CONFIGURED_MSG);
      if (!address)
        throw new Error("Wallet not connected. Connect your wallet to run an assessment.");
      setIsAssessing(true);
      const feePreset = await contract.estimateAssessFees(borrower, "high");
      return contract.assess(borrower, feePreset);
    },
    onSuccess: (_result, variables) => {
      invalidate(variables.borrower);
      setIsAssessing(false);
      success("The underwriting panel has decided", {
        description: "A bounded credit grade was reached by validator consensus.",
      });
    },
    onError: (err: any) => {
      setIsAssessing(false);
      if (demo) info("Preview mode", { description: DEMO_MSG });
      else error("Assessment failed", { description: err?.message || "Please try again." });
    },
  });

  return {
    ...mutation,
    isAssessing,
    assess: mutation.mutate,
    assessAsync: mutation.mutateAsync,
  };
}

/**
 * Appeal an assessment: escalate to the larger, independent panel (due process).
 * Sent from the borrower's own account; allowed once, only with no outstanding
 * debt. Demo mode is handled locally by the assessment surface, so this hook
 * rejects with the preview message if called while unconfigured.
 */
export function useAppeal() {
  const contract = useCredenceContract();
  const { address } = useWallet();
  const demo = useIsDemoMode();
  const invalidate = useBorrowerInvalidation();
  const [isAppealing, setIsAppealing] = useState(false);

  const mutation = useMutation<Borrower, Error, void>({
    mutationFn: async () => {
      if (demo) throw new Error(DEMO_MSG);
      if (!contract) throw new Error(NOT_CONFIGURED_MSG);
      if (!address)
        throw new Error("Wallet not connected. Connect your wallet to appeal.");
      setIsAppealing(true);
      const feePreset = await contract.estimateAppealFees("high");
      return contract.appeal(address, feePreset);
    },
    onSuccess: () => {
      invalidate(address || undefined);
      setIsAppealing(false);
      success("The appeal panel has decided", {
        description: "A larger, independent panel re-judged your evidence by consensus.",
      });
    },
    onError: (err: any) => {
      setIsAppealing(false);
      if (demo) info("Preview mode", { description: DEMO_MSG });
      else error("Appeal failed", { description: err?.message || "Please try again." });
    },
  });

  return {
    ...mutation,
    isAppealing,
    appeal: mutation.mutate,
    appealAsync: mutation.mutateAsync,
  };
}

/** Draw native tokens against an approved line. `amountBaseUnits` is a bigint. */
export function useDraw() {
  const contract = useCredenceContract();
  const { address } = useWallet();
  const demo = useIsDemoMode();
  const invalidate = useBorrowerInvalidation();
  const [isDrawing, setIsDrawing] = useState(false);

  const mutation = useMutation({
    mutationFn: async ({ amountBaseUnits }: { amountBaseUnits: bigint }) => {
      if (demo) throw new Error(DEMO_MSG);
      if (!contract) throw new Error(NOT_CONFIGURED_MSG);
      if (!address)
        throw new Error("Wallet not connected. Connect your wallet to draw credit.");
      setIsDrawing(true);
      return contract.draw(amountBaseUnits);
    },
    onSuccess: () => {
      invalidate(address || undefined);
      setIsDrawing(false);
      success("Credit drawn", { description: "Tokens are on their way on finalized timing." });
    },
    onError: (err: any) => {
      setIsDrawing(false);
      if (demo) info("Preview mode", { description: DEMO_MSG });
      else error("Draw failed", { description: err?.message || "Please try again." });
    },
  });

  return { ...mutation, isDrawing, draw: mutation.mutate, drawAsync: mutation.mutateAsync };
}

/** Repay with native value. `valueBaseUnits` is a bigint. */
export function useRepay() {
  const contract = useCredenceContract();
  const { address } = useWallet();
  const demo = useIsDemoMode();
  const invalidate = useBorrowerInvalidation();
  const [isRepaying, setIsRepaying] = useState(false);

  const mutation = useMutation({
    mutationFn: async ({ valueBaseUnits }: { valueBaseUnits: bigint }) => {
      if (demo) throw new Error(DEMO_MSG);
      if (!contract) throw new Error(NOT_CONFIGURED_MSG);
      if (!address)
        throw new Error("Wallet not connected. Connect your wallet to repay.");
      setIsRepaying(true);
      return contract.repay(valueBaseUnits);
    },
    onSuccess: () => {
      invalidate(address || undefined);
      setIsRepaying(false);
      success("Repayment received", { description: "Principal cleared first, then fees. Standing updates on a clean, on-time payoff." });
    },
    onError: (err: any) => {
      setIsRepaying(false);
      if (demo) info("Preview mode", { description: DEMO_MSG });
      else error("Repayment failed", { description: err?.message || "Please try again." });
    },
  });

  return { ...mutation, isRepaying, repay: mutation.mutate, repayAsync: mutation.mutateAsync };
}

/** Fund the lending pool with native value. `valueBaseUnits` is a bigint. */
export function useFund() {
  const contract = useCredenceContract();
  const { address } = useWallet();
  const demo = useIsDemoMode();
  const invalidate = useBorrowerInvalidation();
  const [isFunding, setIsFunding] = useState(false);

  const mutation = useMutation({
    mutationFn: async ({ valueBaseUnits }: { valueBaseUnits: bigint }) => {
      if (demo) throw new Error(DEMO_MSG);
      if (!contract) throw new Error(NOT_CONFIGURED_MSG);
      if (!address)
        throw new Error("Wallet not connected. Connect your wallet to fund the pool.");
      setIsFunding(true);
      return contract.fund(valueBaseUnits);
    },
    onSuccess: () => {
      invalidate();
      setIsFunding(false);
      success("Pool funded", { description: "Your liquidity backs undercollateralized draws." });
    },
    onError: (err: any) => {
      setIsFunding(false);
      if (demo) info("Preview mode", { description: DEMO_MSG });
      else error("Funding failed", { description: err?.message || "Please try again." });
    },
  });

  return { ...mutation, isFunding, fund: mutation.mutate, fundAsync: mutation.mutateAsync };
}

/**
 * Redeem (defund) contributed lender capital. `amountBaseUnits` is a bigint.
 * The contract returns funds on finalized timing, up to the pool's available
 * cash (capital currently lent out must be repaid first).
 */
export function useDefund() {
  const contract = useCredenceContract();
  const { address } = useWallet();
  const demo = useIsDemoMode();
  const invalidate = useBorrowerInvalidation();
  const [isDefunding, setIsDefunding] = useState(false);

  const mutation = useMutation({
    mutationFn: async ({ amountBaseUnits }: { amountBaseUnits: bigint }) => {
      if (demo) throw new Error(DEMO_MSG);
      if (!contract) throw new Error(NOT_CONFIGURED_MSG);
      if (!address)
        throw new Error("Wallet not connected. Connect your wallet to withdraw.");
      setIsDefunding(true);
      return contract.defund(amountBaseUnits);
    },
    onSuccess: () => {
      invalidate();
      setIsDefunding(false);
      success("Withdrawal submitted", {
        description: "Your redeemed capital is on its way on finalized timing.",
      });
    },
    onError: (err: any) => {
      setIsDefunding(false);
      if (demo) info("Preview mode", { description: DEMO_MSG });
      else error("Withdrawal failed", { description: err?.message || "Please try again." });
    },
  });

  return { ...mutation, isDefunding, defund: mutation.mutate, defundAsync: mutation.mutateAsync };
}

/**
 * Claim accrued lender yield (claim_yield): a share of origination fees, paid
 * from pool cash. Separate from redeeming principal (defund).
 */
export function useClaimYield() {
  const contract = useCredenceContract();
  const { address } = useWallet();
  const demo = useIsDemoMode();
  const invalidate = useBorrowerInvalidation();
  const [isClaiming, setIsClaiming] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      if (demo) throw new Error(DEMO_MSG);
      if (!contract) throw new Error(NOT_CONFIGURED_MSG);
      if (!address)
        throw new Error("Wallet not connected. Connect your wallet to claim yield.");
      setIsClaiming(true);
      return contract.claimYield();
    },
    onSuccess: () => {
      invalidate();
      setIsClaiming(false);
      success("Yield claimed", {
        description: "Your share of origination fees is on its way on finalized timing.",
      });
    },
    onError: (err: any) => {
      setIsClaiming(false);
      if (demo) info("Preview mode", { description: DEMO_MSG });
      else error("Could not claim yield", { description: err?.message || "Please try again." });
    },
  });

  return { ...mutation, isClaiming, claimYield: mutation.mutate, claimYieldAsync: mutation.mutateAsync };
}

/**
 * Shared factory for the owner/staff admin writes. Each returns a mutation plus
 * a `run`/`runAsync` pair and an `isPending` flag, with consistent toasts and
 * cache invalidation. Demo mode rejects with the preview message.
 */
function useAdminWrite<TArgs>(
  fn: (contract: Credence, args: TArgs) => Promise<unknown>,
  messages: { ok: string; okDesc?: string; failTitle: string }
) {
  const contract = useCredenceContract();
  const { address } = useWallet();
  const demo = useIsDemoMode();
  const invalidate = useBorrowerInvalidation();
  const [isPending, setIsPending] = useState(false);

  const mutation = useMutation<unknown, Error, TArgs>({
    mutationFn: async (args: TArgs) => {
      if (demo) throw new Error(DEMO_MSG);
      if (!contract) throw new Error(NOT_CONFIGURED_MSG);
      if (!address)
        throw new Error("Wallet not connected. Connect the owner wallet to continue.");
      setIsPending(true);
      return fn(contract, args);
    },
    onSuccess: () => {
      invalidate();
      setIsPending(false);
      success(messages.ok, messages.okDesc ? { description: messages.okDesc } : undefined);
    },
    onError: (err: any) => {
      setIsPending(false);
      if (demo) info("Preview mode", { description: DEMO_MSG });
      else error(messages.failTitle, { description: err?.message || "Please try again." });
    },
  });

  return { ...mutation, isPending, run: mutation.mutate, runAsync: mutation.mutateAsync };
}

/** Owner/staff: pause or unpause the protocol. */
export function useSetPaused() {
  return useAdminWrite<boolean>((c, paused) => c.setPaused(paused), {
    ok: "Protocol updated",
    okDesc: "The pause state has been changed.",
    failTitle: "Could not change pause state",
  });
}

/** Owner: toggle autonomous self-servicing of the loan book. */
export function useSetAutonomous() {
  return useAdminWrite<boolean>((c, on) => c.setAutonomous(on), {
    ok: "Autonomous mode updated",
    okDesc: "The loan book's self-servicing setting has been changed.",
    failTitle: "Could not change autonomous mode",
  });
}

/** Owner: set the guardian (separation-of-duties pause role). */
export function useSetGuardian() {
  return useAdminWrite<string>((c, guardian) => c.setGuardian(guardian), {
    ok: "Guardian updated",
    okDesc: "The incident-response guardian address has been set.",
    failTitle: "Could not set guardian",
  });
}

/** Owner: set the pool utilization cap (max_utilization_bps, 0..10000). */
export function useSetRiskLimits() {
  return useAdminWrite<number>((c, bps) => c.setRiskLimits(bps), {
    ok: "Risk limits updated",
    okDesc: "The pool utilization cap has been set.",
    failTitle: "Could not set risk limits",
  });
}

/** Owner: set the annual interest rate on outstanding principal (bps APR). */
export function useSetInterestBps() {
  return useAdminWrite<number>((c, bps) => c.setInterestBps(bps), {
    ok: "Interest rate updated",
    okDesc: "The APR on outstanding principal has been set.",
    failTitle: "Could not set interest rate",
  });
}

/** Owner: set lender share (bps), loan term and grace period. */
export function useSetTerms() {
  return useAdminWrite<{
    lenderShareBps: number;
    termSeconds: number;
    graceSeconds: number;
  }>((c, a) => c.setTerms(a.lenderShareBps, a.termSeconds, a.graceSeconds), {
    ok: "Terms updated",
    okDesc: "Lender share, term and grace period have been set.",
    failTitle: "Could not update terms",
  });
}

/** Owner: withdraw accrued protocol revenue to an address. */
export function useWithdrawFees() {
  return useAdminWrite<{ to: string; amountBaseUnits: bigint }>(
    (c, a) => c.withdrawFees(a.to, a.amountBaseUnits),
    {
      ok: "Revenue withdrawn",
      okDesc: "Protocol revenue is on its way on finalized timing.",
      failTitle: "Could not withdraw revenue",
    }
  );
}

/** Owner: nominate a new owner (first step of the two-step transfer). */
export function useTransferOwnership() {
  return useAdminWrite<string>((c, newOwner) => c.transferOwnership(newOwner), {
    ok: "Owner nominated",
    okDesc: "The nominee must accept from their own wallet to complete the transfer.",
    failTitle: "Could not nominate owner",
  });
}

/**
 * Accept a pending ownership transfer (second step). Only the nominated
 * `pending_owner` can complete it; anyone else reverts.
 */
export function useAcceptOwnership() {
  const contract = useCredenceContract();
  const { address } = useWallet();
  const demo = useIsDemoMode();
  const invalidate = useBorrowerInvalidation();
  const [isAccepting, setIsAccepting] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      if (demo) throw new Error(DEMO_MSG);
      if (!contract) throw new Error(NOT_CONFIGURED_MSG);
      if (!address)
        throw new Error("Wallet not connected. Connect the nominated wallet to accept.");
      setIsAccepting(true);
      return contract.acceptOwnership();
    },
    onSuccess: () => {
      invalidate();
      setIsAccepting(false);
      success("Ownership accepted", {
        description: "You are now the contract owner.",
      });
    },
    onError: (err: any) => {
      setIsAccepting(false);
      if (demo) info("Preview mode", { description: DEMO_MSG });
      else error("Could not accept ownership", { description: err?.message || "Please try again." });
    },
  });

  return {
    ...mutation,
    isAccepting,
    acceptOwnership: mutation.mutate,
    acceptOwnershipAsync: mutation.mutateAsync,
  };
}
