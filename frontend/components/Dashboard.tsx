"use client";

import { useState } from "react";
import {
  Wallet,
  Gauge,
  CalendarClock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ArrowUpFromLine,
  ArrowDownToLine,
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  Scale,
  Percent,
} from "lucide-react";
import {
  useBorrower,
  useDraw,
  useRepay,
  useConfig,
  useIsDemoMode,
} from "@/lib/hooks/useCredence";
import { useWallet } from "@/lib/genlayer/wallet";
import { MOCK_BORROWER } from "@/lib/contracts/mock";
import {
  formatTokens,
  tokensToBaseUnits,
  baseToTokenNumber,
  formatDueDate,
  daysUntil,
  feeBpsForGrade,
  formatBps,
  drawFeeBaseUnits,
} from "@/lib/utils/format";
import type { Grade, Borrower } from "@/lib/contracts/types";
import { GradeBadge } from "./GradeBadge";
import { InfoHint } from "./InfoHint";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export function Dashboard() {
  const demo = useIsDemoMode();
  const { address, isConnected } = useWallet();
  const effectiveAddr = address || (demo ? MOCK_BORROWER.addr : "");
  const { data: borrower, isLoading } = useBorrower(effectiveAddr);

  const { drawAsync, isDrawing } = useDraw();
  const { repayAsync, isRepaying } = useRepay();
  const { data: config } = useConfig();

  const [drawAmt, setDrawAmt] = useState("");
  const [repayAmt, setRepayAmt] = useState("");

  // Not connected & live mode: prompt to connect.
  if (!demo && !isConnected) {
    return (
      <section id="dashboard" className="brand-card p-6 text-center scroll-mt-24">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-accent/10 text-accent mb-3">
          <Wallet className="w-6 h-6" />
        </div>
        <h2 className="font-bold text-lg mb-1">Your credit dashboard</h2>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          Connect your wallet to see your standing, grade, credit line and loan,
          and to draw or repay.
        </p>
      </section>
    );
  }

  const b: Borrower | null | undefined = borrower;
  const hasAccount = !!b && b.status !== "none";

  if (!isLoading && !hasAccount) {
    return (
      <section id="dashboard" className="brand-card p-6 text-center scroll-mt-24">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-accent/10 text-accent mb-3">
          <Wallet className="w-6 h-6" />
        </div>
        <h2 className="font-bold text-lg mb-1">No credit line yet</h2>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          Apply above to have the consensus panel underwrite you. Your dashboard
          appears here once you have a standing and a line.
        </p>
      </section>
    );
  }

  const standing = b?.standing ?? 0;
  const availableTokens = baseToTokenNumber(b?.available);

  // owed = principal + fees + interest (the contract returns it directly).
  const principalBase = BigInt(b?.principal || "0");
  const feeBase = BigInt(b?.fee_accrued || "0");
  const interestBase = BigInt(b?.interest_accrued || "0");
  const owedBase =
    BigInt(b?.owed || "0") || principalBase + feeBase + interestBase;
  const owedTokens = baseToTokenNumber(owedBase.toString());

  // The contract enforces a minimum draw of 1 token (1e18 base units).
  const MIN_DRAW_TOKENS = 1;
  const drawNum = parseFloat(drawAmt);
  const needsReassessment = !!b?.requires_reassessment;
  const canDraw = b?.status === "approved" && !needsReassessment && !b?.overdue;
  const drawTooSmall =
    Number.isFinite(drawNum) && drawNum > 0 && drawNum < MIN_DRAW_TOKENS;
  const drawValid =
    canDraw &&
    Number.isFinite(drawNum) &&
    drawNum >= MIN_DRAW_TOKENS &&
    drawNum <= availableTokens + 1e-9;

  const repayNum = parseFloat(repayAmt);
  const repayValid = Number.isFinite(repayNum) && repayNum > 0 && repayNum <= owedTokens + 1e-9;

  const due = daysUntil(b?.due_at);
  const hasLoan = owedBase > 0n;

  // Risk-priced origination fee: the exact bps this borrower's grade pays, and
  // the fee a draw of the entered size would accrue (mirrors the contract).
  const grade = (b?.grade || "") as Grade | "";
  const feeBps = feeBpsForGrade(grade, config?.origination_bps_by_grade);
  // Per-line APR locked at draw (the contract does not retroactively re-price an
  // open line). The owed breakdown below only renders when a line is open.
  const lineRateBps = b?.rate_bps ?? 0;
  const drawFeePreview =
    drawValid && drawNum > 0
      ? drawFeeBaseUnits(tokensToBaseUnits(drawNum), feeBps)
      : 0n;

  const appealed = (b?.appeal_tier ?? 0) > 0;

  const handleDraw = async () => {
    if (!drawValid) return;
    try {
      await drawAsync({ amountBaseUnits: tokensToBaseUnits(drawNum) });
      setDrawAmt("");
    } catch {
      /* toast in hook */
    }
  };

  const handleRepay = async () => {
    if (!repayValid) return;
    try {
      await repayAsync({ valueBaseUnits: tokensToBaseUnits(repayNum) });
      setRepayAmt("");
    } catch {
      /* toast in hook */
    }
  };

  // Pay off the line exactly. The owed amount can carry 18-decimal interest dust
  // that a rounded token input cannot express, and the contract reverts on
  // overpayment — so a full payoff must send exactly `owed` base units.
  const handleRepayAll = async () => {
    if (owedBase <= 0n) return;
    try {
      await repayAsync({ valueBaseUnits: owedBase });
      setRepayAmt("");
    } catch {
      /* toast in hook */
    }
  };

  const scrollToApply = () =>
    document.getElementById("apply")?.scrollIntoView({ behavior: "smooth" });

  const statusTone =
    b?.status === "defaulted"
      ? "text-red-700 dark:text-red-300 border-red-500/40 bg-red-500/10"
      : b?.status === "approved"
        ? "text-emerald-700 dark:text-emerald-300 border-emerald-500/40 bg-emerald-500/10"
        : b?.status === "denied"
          ? "text-red-700 dark:text-red-300 border-red-500/40 bg-red-500/10"
          : "text-muted-foreground border-hair bg-panel";

  return (
    <section
      id="dashboard"
      className="brand-card p-5 md:p-6 space-y-6 scroll-mt-24"
      aria-labelledby="dashboard-heading"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="gradient-purple-pink rounded-lg p-2 flex text-white">
            <Wallet className="w-5 h-5" />
          </span>
          <div>
            <h2 id="dashboard-heading" className="font-bold text-lg leading-tight">
              Your dashboard
            </h2>
            <p className="text-xs text-muted-foreground font-mono break-all">
              {b?.addr}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${statusTone}`}
          >
            {b?.status}
          </span>
          {appealed && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent"
              title="This grade was decided on appeal by a larger panel"
            >
              <Scale className="w-3.5 h-3.5" />
              on appeal
            </span>
          )}
          {b?.grade && b.grade !== "DENY" && (
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                b?.ownership_proven
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              }`}
              title={
                b?.ownership_proven
                  ? "A cited page displayed your wallet address — ownership proven"
                  : "No cited page displayed your wallet address — grade capped at C"
              }
            >
              {b?.ownership_proven ? (
                <>
                  <ShieldCheck className="w-3.5 h-3.5" />
                  ownership verified
                </>
              ) : (
                <>
                  <ShieldAlert className="w-3.5 h-3.5" />
                  unverified (capped at C)
                </>
              )}
            </span>
          )}
          <GradeBadge grade={b?.grade ?? ""} size="md" showLine />
        </div>
      </div>

      {/* Re-assessment required (after a default) */}
      {needsReassessment && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
          <RefreshCw className="w-5 h-5 text-amber-600 dark:text-amber-300 shrink-0" />
          <div className="flex-grow">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200 flex items-center gap-1.5">
              Re-assessment required
              <InfoHint label="What is re-assessment?">
                A default is on record. Before you can draw again you must submit a
                fresh application and pass a new consensus assessment — the panel
                re-reads your current evidence and sets a new line.
              </InfoHint>
            </p>
            <p className="text-xs text-amber-800/90 dark:text-amber-200/80">
              A default is on record, so drawing is locked until a new assessment passes.
            </p>
          </div>
          <Button variant="outline" className="shrink-0 press" onClick={scrollToApply}>
            Re-apply
          </Button>
        </div>
      )}

      {/* Standing meter */}
      <div className="rounded-xl border border-hair bg-panel p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Gauge className="w-4 h-4 text-accent" />
            <span className="text-sm font-semibold flex items-center gap-1.5">
              Standing
              <InfoHint label="What is standing?">
                Your on-chain reputation, 0–100. It starts at 50, rises when you
                repay a real line on time, and falls on overdue or default. Higher
                standing earns a better grade and a larger line over time.
              </InfoHint>
            </span>
          </div>
          <span className="text-sm font-bold tabular-nums">{standing} / 100</span>
        </div>
        <div
          className="h-2.5 w-full rounded-full bg-panel-2 overflow-hidden"
          role="meter"
          aria-valuenow={standing}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Reputation standing"
        >
          <div
            className="meter-fill h-full gradient-purple-pink rounded-full transition-[width] duration-700"
            style={{ width: `${Math.max(0, Math.min(100, standing))}%` }}
          />
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            {b?.on_time ?? 0} on-time repayment{(b?.on_time ?? 0) === 1 ? "" : "s"}
          </span>
          <span className="inline-flex items-center gap-1">
            <XCircle className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
            {b?.defaults ?? 0} default{(b?.defaults ?? 0) === 1 ? "" : "s"}
          </span>
          {b?.sybil_flag && (
            <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5" />
              evidence reuse flagged
            </span>
          )}
        </div>
      </div>

      {/* Figures */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Figure
          label="Credit limit"
          value={formatTokens(b?.credit_limit)}
          hint="The most you can owe at once, set by your consensus grade."
        />
        <Figure
          label="Available"
          value={formatTokens(b?.available)}
          highlight
          hint="Credit limit minus what you currently owe — what you can draw right now."
        />
        <Figure
          label="Outstanding principal"
          value={formatTokens(b?.principal)}
          hint="The tokens you have drawn and not yet repaid."
        />
        <Figure
          label="Lifetime repaid"
          value={formatTokens(b?.total_repaid)}
          hint="Everything you have ever repaid — a track record the panel weighs on your next assessment."
        />
      </div>

      {/* What you owe — the full breakdown (principal + fee + interest = owed) */}
      {hasLoan && (
        <div className="rounded-xl border border-hair bg-panel p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              What you owe
              <InfoHint label="How is the amount owed calculated?">
                Owed = outstanding principal + origination fee + accrued interest.
                A repayment clears principal first (which frees your line), then the
                fee, then interest.
              </InfoHint>
            </h3>
            <span className="text-xs text-muted-foreground">
              {lineRateBps > 0 ? (
                <span className="inline-flex items-center gap-1">
                  <Percent className="w-3 h-3" />
                  interest {formatBps(lineRateBps)} APR
                  <InfoHint label="How is this APR set?">
                    Your line&apos;s rate is locked at draw time and does not change
                    if the protocol later re-prices interest. This is the rate your
                    outstanding principal actually accrues at.
                  </InfoHint>
                </span>
              ) : (
                "no interest on this line"
              )}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <OwedPart label="Principal" value={formatTokens(b?.principal)} />
            <OwedPart label="Fee" value={formatTokens(b?.fee_accrued)} />
            <OwedPart label="Interest" value={formatTokens(b?.interest_accrued)} />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-accent/30 bg-accent/5 px-3 py-2">
            <span className="text-sm font-semibold">Total owed</span>
            <span className="text-lg font-bold tabular-nums">
              {formatTokens(owedBase.toString())}
              <span className="text-xs font-medium text-muted-foreground ml-1">GEN</span>
            </span>
          </div>
        </div>
      )}

      {/* Due date / loan status */}
      {hasLoan && (
        <div
          className={`flex items-center gap-2 rounded-xl border p-3 text-sm ${
            b?.overdue
              ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-200"
              : "border-hair bg-panel text-foreground/80"
          }`}
        >
          <CalendarClock className="w-4 h-4 shrink-0" />
          <span>
            {b?.overdue ? "Overdue — " : "Due "}
            <span className="font-semibold">{formatDueDate(b?.due_at)}</span>
            {due !== null && !b?.overdue && (
              <span className="text-muted-foreground"> ({due} day{due === 1 ? "" : "s"} left)</span>
            )}
          </span>
        </div>
      )}

      {/* Draw / Repay controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Draw */}
        <div className="rounded-xl border border-hair bg-panel p-4 space-y-2.5">
          <div className="flex items-center gap-2">
            <ArrowUpFromLine className="w-4 h-4 text-accent" />
            <Label htmlFor="draw-amt" className="text-sm">
              Draw credit
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">
            Up to{" "}
            <span className="font-semibold text-foreground">
              {formatTokens(b?.available)}
            </span>{" "}
            tokens available. Minimum draw {MIN_DRAW_TOKENS} token.
          </p>
          <div className="flex gap-2">
            <Input
              id="draw-amt"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              placeholder="Amount"
              value={drawAmt}
              onChange={(e) => setDrawAmt(e.target.value)}
              disabled={!canDraw}
            />
            <Button
              variant="gradient"
              onClick={handleDraw}
              disabled={!drawValid || isDrawing || !canDraw}
              className="shrink-0 press"
            >
              {isDrawing ? "…" : "Draw"}
            </Button>
          </div>

          {/* Risk-priced origination fee (by grade) */}
          {canDraw && grade && grade !== "DENY" && (
            <div className="rounded-lg border border-hair bg-panel-2 p-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground inline-flex items-center gap-1">
                  Origination fee · grade{" "}
                  <span className="font-semibold text-foreground">{grade}</span>
                  <InfoHint label="What is the origination fee?">
                    A one-time fee taken when you draw, priced by your grade —
                    riskier grades pay more. Half of it (plus any interest) is paid
                    to lenders as yield; the rest is protocol revenue.
                  </InfoHint>
                </span>
                <span className="font-semibold tabular-nums text-accent">
                  {formatBps(feeBps)}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                {drawFeePreview > 0n ? (
                  <>
                    This draw accrues{" "}
                    <span className="font-semibold text-foreground">
                      {formatTokens(drawFeePreview.toString(), 4)} GEN
                    </span>{" "}
                    in fees. Riskier grades pay more — price follows the AI grade.
                  </>
                ) : (
                  <>Riskier grades pay a higher rate — price follows the AI grade.</>
                )}
              </p>
            </div>
          )}

          {needsReassessment ? (
            <p className="text-[11px] text-amber-600 dark:text-amber-300">
              Drawing is locked until you pass a new assessment (a default is on record).
            </p>
          ) : b?.overdue ? (
            <p className="text-[11px] text-amber-600 dark:text-amber-300">
              This line is overdue — repay it before drawing again.
            </p>
          ) : b?.status !== "approved" ? (
            <p className="text-[11px] text-muted-foreground">
              Drawing requires an approved line.
            </p>
          ) : drawTooSmall ? (
            <p className="text-[11px] text-destructive">
              Minimum draw is {MIN_DRAW_TOKENS} token (1e18 base units).
            </p>
          ) : null}
        </div>

        {/* Repay */}
        <div className="rounded-xl border border-hair bg-panel p-4 space-y-2.5">
          <div className="flex items-center gap-2">
            <ArrowDownToLine className="w-4 h-4 text-accent" />
            <Label htmlFor="repay-amt" className="text-sm">
              Repay
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">
            Owed:{" "}
            <span className="font-semibold text-foreground">
              {formatTokens(owedBase.toString())}
            </span>{" "}
            tokens (principal first, then fee, then interest).
          </p>
          <div className="flex gap-2">
            <Input
              id="repay-amt"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              placeholder="Amount"
              value={repayAmt}
              onChange={(e) => setRepayAmt(e.target.value)}
              disabled={owedTokens <= 0}
            />
            <Button
              variant="outline"
              onClick={handleRepay}
              disabled={!repayValid || isRepaying || owedTokens <= 0}
              className="shrink-0 press"
            >
              {isRepaying ? "…" : "Repay"}
            </Button>
          </div>
          {owedTokens > 0 && (
            <button
              type="button"
              onClick={handleRepayAll}
              disabled={isRepaying}
              className="text-[11px] text-accent font-medium underline-offset-2 hover:underline disabled:opacity-60"
            >
              Repay all — clear the full {formatTokens(owedBase.toString(), 4)} GEN owed, to the last unit
            </button>
          )}
          <p className="text-[11px] text-muted-foreground">
            A clean, on-time payoff raises your standing and grade.
          </p>
        </div>
      </div>

      {demo && (
        <p className="text-xs text-muted-foreground">
          Preview mode — this is representative sample data; draw and repay are
          simulated and move no real value.
        </p>
      )}
    </section>
  );
}

function Figure({
  label,
  value,
  highlight,
  hint,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  hint?: string;
}) {
  return (
    <div
      className={`lift rounded-xl border p-3 ${
        highlight ? "border-accent/30 bg-accent/5" : "border-hair bg-panel"
      }`}
    >
      <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
        {label}
        {hint && <InfoHint label={`What is ${label.toLowerCase()}?`}>{hint}</InfoHint>}
      </p>
      <p className="text-lg font-bold tabular-nums">
        {value}
      </p>
    </div>
  );
}

function OwedPart({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-hair bg-panel-2 p-2.5">
      <p className="text-[11px] text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm font-bold tabular-nums">
        {value}
        <span className="text-[10px] font-medium text-muted-foreground ml-1">GEN</span>
      </p>
    </div>
  );
}
