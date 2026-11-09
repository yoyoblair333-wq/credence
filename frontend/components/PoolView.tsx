"use client";

import { useState } from "react";
import {
  Landmark,
  TrendingUp,
  Coins,
  ArrowDownToLine,
  ArrowUpFromLine,
  PiggyBank,
  Activity,
  Receipt,
  Wallet,
  Sparkles,
  Gift,
  Percent,
} from "lucide-react";
import {
  usePool,
  useFund,
  useDefund,
  useClaimYield,
  useLenderBalance,
  useConfig,
  useIsDemoMode,
} from "@/lib/hooks/useCredence";
import { useWallet } from "@/lib/genlayer/wallet";
import {
  formatTokens,
  tokensToBaseUnits,
  baseToTokenNumber,
  formatBps,
} from "@/lib/utils/format";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { InfoHint } from "./InfoHint";

/**
 * The lender "Earn" surface: provide native liquidity that backs every
 * undercollateralized draw and earn a real, compounding position — a share of
 * every origination fee (and any interest) streamed pro-rata (claim_yield),
 * redeemable principal (defund), and full pool observability (get_pool). The
 * lender side of a two-sided market.
 */
export function PoolView() {
  const { data: pool, isLoading } = usePool();
  const { fundAsync, isFunding } = useFund();
  const { defundAsync, isDefunding } = useDefund();
  const { claimYieldAsync, isClaiming } = useClaimYield();
  const { isConnected, address } = useWallet();
  const demo = useIsDemoMode();
  const { data: balance } = useLenderBalance(address || "");
  const { data: config } = useConfig();
  const [amount, setAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");

  const funded = baseToTokenNumber(pool?.total_funded);
  // Live utilization = outstanding principal / total funded (from the contract),
  // i.e. how much of lenders' capital is on loan right now — not cumulative draws.
  const outstanding = baseToTokenNumber(pool?.outstanding_principal);
  const utilizationBps =
    pool?.utilization_bps ??
    (funded > 0 ? Math.round((outstanding / funded) * 10000) : 0);
  const utilization = Math.min(100, Math.round(utilizationBps / 100));

  const lenderShareBps = config?.lender_share_bps ?? 5000;
  const lenderSharePct = lenderShareBps / 100;

  const amountNum = parseFloat(amount);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0;

  // Your position: redeemable principal + accrued, unclaimed yield.
  const myFundedTokens = baseToTokenNumber(balance?.funded);
  const myPendingYield = baseToTokenNumber(balance?.pending_yield);
  const hasYield = myPendingYield > 1e-9;
  const cashTokens = baseToTokenNumber(pool?.cash);
  const withdrawMax = Math.min(myFundedTokens, cashTokens);
  const withdrawNum = parseFloat(withdrawAmount);
  const withdrawValid =
    Number.isFinite(withdrawNum) &&
    withdrawNum > 0 &&
    withdrawNum <= myFundedTokens + 1e-9;
  const withdrawOverCash = withdrawValid && withdrawNum > cashTokens + 1e-9;

  const showPosition = demo || isConnected;

  const handleFund = async () => {
    if (!amountValid) return;
    try {
      await fundAsync({ valueBaseUnits: tokensToBaseUnits(amountNum) });
      setAmount("");
    } catch {
      /* toast handled in hook */
    }
  };

  const handleDefund = async () => {
    if (!withdrawValid) return;
    try {
      await defundAsync({ amountBaseUnits: tokensToBaseUnits(withdrawNum) });
      setWithdrawAmount("");
    } catch {
      /* toast handled in hook */
    }
  };

  const handleClaim = async () => {
    try {
      await claimYieldAsync();
    } catch {
      /* toast handled in hook */
    }
  };

  return (
    <section
      id="pool"
      className="brand-card p-5 md:p-7 scroll-mt-24"
      aria-labelledby="pool-heading"
    >
      <div className="flex items-center gap-3 mb-6">
        <span className="gradient-purple-pink rounded-xl p-2.5 flex text-white shadow-lg shadow-accent/20">
          <Landmark className="w-5 h-5" />
        </span>
        <div>
          <h2 id="pool-heading" className="font-bold text-xl md:text-2xl">
            Earn
          </h2>
          <p className="text-sm text-muted-foreground">
            Provide liquidity, earn a share of every origination fee.
          </p>
        </div>
      </div>

      {/* Lender economics — the headline reason to fund */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <div className="sm:col-span-2 rounded-xl border border-accent/30 bg-gradient-to-br from-accent/10 to-[var(--blue)]/5 p-4 md:p-5">
          <div className="flex items-center gap-2 text-accent mb-1.5">
            <Sparkles className="w-4 h-4" />
            <span className="text-xs font-semibold uppercase tracking-wider">
              Lender yield
            </span>
          </div>
          <p className="text-2xl md:text-3xl font-bold leading-tight">
            Lenders earn{" "}
            <span className="text-gradient">{formatBps(lenderShareBps)}</span> of
            every origination fee
          </p>
          <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
            Each draw pays a risk-priced fee; {lenderSharePct}% of it streams to
            lenders pro-rata through an O(1) accumulator — so your position
            compounds automatically. The rest is protocol revenue.
          </p>
        </div>
        <div className="rounded-xl border border-hair bg-panel p-4 md:p-5 flex flex-col justify-center">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <TrendingUp className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
            <span className="text-xs">Yield distributed to date</span>
          </div>
          <p className="text-2xl md:text-3xl font-bold tabular-nums text-emerald-600 dark:text-emerald-300">
            {isLoading ? "…" : formatTokens(pool?.yield_distributed)}
            <span className="text-xs font-medium text-muted-foreground ml-1">GEN</span>
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Streamed to all lenders, lifetime.
          </p>
        </div>
      </div>

      {/* Utilization */}
      <div className="mb-6">
        <div className="flex items-center justify-between text-sm mb-1.5">
          <span className="text-muted-foreground inline-flex items-center gap-1">
            Pool utilization
            <InfoHint label="What is pool utilization?">
              The share of lenders&apos; capital currently on loan (outstanding
              principal ÷ total funded). Lower utilization means more cash on hand
              for redemptions and yield claims.
            </InfoHint>
          </span>
          <span className="font-semibold tabular-nums">{utilization}%</span>
        </div>
        <div className="h-2.5 w-full rounded-full bg-panel-2 overflow-hidden">
          <div
            className="meter-fill h-full gradient-purple-pink rounded-full transition-[width] duration-700"
            style={{ width: `${utilization}%` }}
          />
        </div>
      </div>

      {/* Pool figures */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <PoolFigure icon={<Coins className="w-4 h-4" />} label="Cash available" value={formatTokens(pool?.cash)} loading={isLoading} highlight />
        <PoolFigure icon={<PiggyBank className="w-4 h-4" />} label="Total funded" value={formatTokens(pool?.total_funded)} loading={isLoading} />
        <PoolFigure icon={<ArrowUpFromLine className="w-4 h-4" />} label="Total drawn" value={formatTokens(pool?.total_drawn)} loading={isLoading} />
        <PoolFigure icon={<ArrowDownToLine className="w-4 h-4" />} label="Total repaid" value={formatTokens(pool?.total_repaid)} loading={isLoading} />
        <PoolFigure icon={<Landmark className="w-4 h-4" />} label="Outstanding principal" value={formatTokens(pool?.outstanding_principal)} loading={isLoading} />
        <PoolFigure icon={<Receipt className="w-4 h-4" />} label="Outstanding fees" value={formatTokens(pool?.outstanding_fees)} loading={isLoading} />
        <PoolFigure icon={<Percent className="w-4 h-4" />} label="Outstanding interest" value={formatTokens(pool?.outstanding_interest)} loading={isLoading} />
        <PoolFigure icon={<TrendingUp className="w-4 h-4" />} label="Protocol revenue" value={formatTokens(pool?.fee_revenue)} loading={isLoading} tone="good" />
        <PoolFigure icon={<Activity className="w-4 h-4" />} label="Active lines" value={(pool?.active_lines ?? 0).toLocaleString()} loading={isLoading} unit="" />
      </div>

      {/* Your position + claim yield */}
      {showPosition && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
          <div className="rounded-xl border border-hair bg-panel p-4 flex items-center gap-3">
            <span className="rounded-lg bg-accent/10 text-accent p-2 flex shrink-0">
              <Wallet className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Your contributed capital</p>
              <p className="text-xl font-bold tabular-nums">
                {formatTokens(balance?.funded)}
                <span className="text-xs font-medium text-muted-foreground ml-1">GEN</span>
              </p>
            </div>
          </div>
          <div
            className={`rounded-xl border p-4 flex items-center gap-3 ${
              hasYield
                ? "border-emerald-500/40 bg-emerald-500/5"
                : "border-hair bg-panel"
            }`}
          >
            <span className="rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 p-2 flex shrink-0">
              <Gift className="w-4 h-4" />
            </span>
            <div className="min-w-0 flex-grow">
              <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
                Claimable yield
                <InfoHint label="What is claimable yield?">
                  Your share of origination fees and interest that borrowers have
                  repaid, accrued pro-rata to your stake. Claim it any time there is
                  pool cash — separate from redeeming your principal.
                </InfoHint>
              </p>
              <p className="text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-300">
                {formatTokens(balance?.pending_yield)}
                <span className="text-xs font-medium text-muted-foreground ml-1">GEN</span>
              </p>
            </div>
            <Button
              variant={hasYield ? "gradient" : "outline"}
              size="sm"
              onClick={handleClaim}
              disabled={isClaiming || (!demo && !hasYield)}
              className="shrink-0 press"
            >
              {isClaiming ? "Claiming…" : "Claim"}
            </Button>
          </div>
        </div>
      )}

      {/* Fund / Withdraw */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-xl border border-hair bg-panel p-4">
          <Label htmlFor="fund-amount" className="text-sm">Fund the pool</Label>
          <p className="text-xs text-muted-foreground mt-0.5 mb-3">
            Provide native-token liquidity and start earning a share of every
            origination fee from the moment a borrower draws.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-grow">
              <Input
                id="fund-amount"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                placeholder="Amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="pr-16"
                aria-invalid={!!amount && !amountValid}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                tokens
              </span>
            </div>
            <Button
              variant="gradient"
              onClick={handleFund}
              disabled={!amountValid || isFunding}
              className="sm:w-32 shrink-0 press"
            >
              {isFunding ? "Funding…" : "Fund pool"}
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-hair bg-panel p-4">
          <Label htmlFor="withdraw-amount" className="text-sm">Withdraw principal</Label>
          <p className="text-xs text-muted-foreground mt-0.5 mb-3">
            Redeem your contributed capital (defund), up to the pool&apos;s
            available cash. Yield is claimed separately — above.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-grow">
              <Input
                id="withdraw-amount"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                placeholder="Amount"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                className="pr-16"
                aria-invalid={!!withdrawAmount && !withdrawValid}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                tokens
              </span>
            </div>
            <Button
              variant="outline"
              onClick={handleDefund}
              disabled={!withdrawValid || isDefunding}
              className="sm:w-32 shrink-0 press"
            >
              {isDefunding ? "Withdrawing…" : "Withdraw"}
            </Button>
          </div>
          {showPosition && (
            <p className="text-[11px] text-muted-foreground mt-2">
              Redeemable now:{" "}
              <button
                type="button"
                className="font-semibold text-foreground underline-offset-2 hover:underline"
                onClick={() => withdrawMax > 0 && setWithdrawAmount(String(withdrawMax))}
              >
                {formatTokens(tokensToBaseUnits(withdrawMax > 0 ? withdrawMax : 0).toString())}
              </button>{" "}
              tokens (your capital, limited by pool cash).
            </p>
          )}
          {withdrawOverCash && (
            <p className="text-[11px] text-amber-600 dark:text-amber-300 mt-1">
              Exceeds available cash — some of your capital is currently lent out.
            </p>
          )}
        </div>
      </div>

      {!demo && !isConnected && (
        <p className="text-xs text-muted-foreground mt-3">
          Connect your wallet to fund, withdraw or claim yield.
        </p>
      )}
      {demo && (
        <p className="text-xs text-muted-foreground mt-3">
          Preview mode — funding, withdrawals and yield claims are simulated and
          move no real value.
        </p>
      )}
    </section>
  );
}

function PoolFigure({
  icon,
  label,
  value,
  loading,
  highlight,
  tone = "default",
  unit = "GEN",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  loading?: boolean;
  highlight?: boolean;
  tone?: "default" | "good";
  unit?: string;
}) {
  return (
    <div
      className={`lift rounded-xl border p-3.5 ${
        highlight ? "border-accent/30 bg-accent/5" : "border-hair bg-panel"
      }`}
    >
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
        <span className="text-accent">{icon}</span>
        <span className="text-xs">{label}</span>
      </div>
      {loading ? (
        <div className="skeleton h-6 w-20 mt-1" />
      ) : (
        <p
          className={`text-lg font-bold tabular-nums ${
            tone === "good" ? "text-emerald-600 dark:text-emerald-300" : "text-foreground"
          }`}
        >
          {value}
          {unit ? (
            <span className="text-xs font-medium text-muted-foreground ml-1">{unit}</span>
          ) : null}
        </p>
      )}
    </div>
  );
}
