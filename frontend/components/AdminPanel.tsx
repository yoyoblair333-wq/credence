"use client";

import { useEffect, useState } from "react";
import {
  Settings2,
  Pause,
  Play,
  Bot,
  SlidersHorizontal,
  Banknote,
  UserCog,
  ShieldCheck,
  ShieldAlert,
  Gauge,
  Percent,
  Crown,
} from "lucide-react";
import {
  useConfig,
  usePool,
  useSetPaused,
  useSetAutonomous,
  useSetTerms,
  useSetGuardian,
  useSetRiskLimits,
  useSetInterestBps,
  useWithdrawFees,
  useTransferOwnership,
  useAcceptOwnership,
  useIsDemoMode,
} from "@/lib/hooks/useCredence";
import { useWallet } from "@/lib/genlayer/wallet";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { AddressDisplay } from "./AddressDisplay";
import { InfoHint } from "./InfoHint";
import { formatTokens, tokensToBaseUnits, formatBps } from "@/lib/utils/format";

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
const DAY = 86400;

/**
 * Owner-only control room. Rendered when the connected wallet is the contract
 * owner (full controls) or the nominated pending owner (accept only). In preview
 * mode it is shown read-only as a showcase. Writes are gated by the contract.
 */
export function AdminPanel() {
  const demo = useIsDemoMode();
  const { address, isConnected } = useWallet();
  const { data: config } = useConfig();
  const { data: pool } = usePool();

  const owner = config?.owner?.toLowerCase();
  const pendingOwner = config?.pending_owner?.toLowerCase();
  const me = address?.toLowerCase();

  const isOwner = !!me && !!owner && me === owner;
  const hasPending = !!owner && !!pendingOwner && owner !== pendingOwner;
  const isNominee = hasPending && !!me && me === pendingOwner;

  // Show full controls to the owner (or in preview, as a showcase); show just
  // the accept card to a nominee who is not yet the owner.
  const showOwnerControls = demo || isOwner;
  const showAcceptOnly = !showOwnerControls && isNominee;

  if (!showOwnerControls && !showAcceptOnly) return null;

  return (
    <section
      id="admin"
      className="brand-card p-5 md:p-7 scroll-mt-24 border-accent/25"
      aria-labelledby="admin-heading"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <span className="gradient-purple-blue rounded-xl p-2.5 flex text-white shadow-lg shadow-accent/20">
            <Settings2 className="w-5 h-5" />
          </span>
          <div>
            <h2 id="admin-heading" className="font-bold text-xl md:text-2xl">
              Admin
            </h2>
            <p className="text-sm text-muted-foreground">
              {showAcceptOnly
                ? "You have been nominated as owner."
                : "Owner controls for the protocol."}
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 self-start rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent">
          <Crown className="w-3.5 h-3.5" />
          {demo && !isOwner ? "owner-only · preview" : showAcceptOnly ? "nominee" : "owner"}
        </span>
      </div>

      {showAcceptOnly ? (
        <AcceptOwnershipCard />
      ) : (
        <div className="space-y-4">
          <ConfigSummary config={config} pool={pool} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <PauseCard paused={!!config?.paused} />
            <AutonomousCard on={!!config?.autonomous} />
          </div>
          <TermsCard
            lenderShareBps={config?.lender_share_bps ?? 5000}
            termSeconds={config?.term_seconds ?? 2_592_000}
            graceSeconds={config?.grace_seconds ?? 604_800}
          />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <RiskLimitsCard maxUtilizationBps={config?.max_utilization_bps ?? 10000} />
            <InterestCard interestBps={config?.interest_bps ?? 0} />
          </div>
          <GuardianCard guardian={config?.guardian ?? ""} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <WithdrawCard feeRevenue={pool?.fee_revenue ?? "0"} devAddr={config?.dev ?? ""} />
            <TransferCard />
          </div>
          {(demo || isNominee) && <AcceptOwnershipCard />}
          {demo && !isConnected && (
            <p className="text-xs text-muted-foreground">
              Preview — these controls are owner-gated and simulated; they move no
              real value.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function CardShell({
  icon,
  title,
  desc,
  children,
  danger,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 space-y-3 ${
        danger ? "border-red-500/25 bg-red-500/5" : "border-hair bg-panel"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span className="text-accent mt-0.5">{icon}</span>
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground">{desc}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function ConfigSummary({
  config,
  pool,
}: {
  config: ReturnType<typeof useConfig>["data"];
  pool: ReturnType<typeof usePool>["data"];
}) {
  if (!config) return null;
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: "Owner", value: <AddressDisplay address={config.owner} maxLength={14} showCopy /> },
    { label: "Guardian", value: <AddressDisplay address={config.guardian} maxLength={14} showCopy /> },
    { label: "Relayer", value: <AddressDisplay address={config.relayer} maxLength={14} showCopy /> },
    { label: "Dev / treasury", value: <AddressDisplay address={config.dev} maxLength={14} showCopy /> },
    { label: "Paused", value: config.paused ? "Yes" : "No" },
    { label: "Autonomous", value: config.autonomous ? "On" : "Off" },
    { label: "Lender share", value: formatBps(config.lender_share_bps) },
    { label: "Utilization cap", value: config.max_utilization_bps >= 10000 ? "none" : formatBps(config.max_utilization_bps) },
    { label: "Interest (APR)", value: config.interest_bps > 0 ? `${formatBps(config.interest_bps)}` : "off" },
    { label: "Term", value: `${Math.round(config.term_seconds / DAY)} days` },
    { label: "Grace", value: `${Math.round(config.grace_seconds / DAY)} days` },
    { label: "Protocol revenue", value: `${formatTokens(pool?.fee_revenue)} GEN` },
  ];
  return (
    <div className="rounded-xl border border-hair bg-panel-2 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Current configuration
        </h3>
        {config.version && (
          <span className="text-[10px] font-mono rounded-md border border-hair bg-panel px-1.5 py-0.5 text-muted-foreground">
            v{config.version}
          </span>
        )}
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
        {rows.map((r) => (
          <div key={r.label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{r.label}</dt>
            <dd className="text-sm font-medium truncate">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function PauseCard({ paused }: { paused: boolean }) {
  const { run, isPending } = useSetPaused();
  return (
    <CardShell
      icon={paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
      title={paused ? "Protocol paused" : "Protocol live"}
      desc="Pause halts new applications, assessments, draws and funding. Repayments still work."
      danger={paused}
    >
      <Button
        variant={paused ? "gradient" : "outline"}
        className="w-full press"
        disabled={isPending}
        onClick={() => run(!paused)}
      >
        {isPending ? "…" : paused ? "Unpause protocol" : "Pause protocol"}
      </Button>
    </CardShell>
  );
}

function AutonomousCard({ on }: { on: boolean }) {
  const { run, isPending } = useSetAutonomous();
  return (
    <CardShell
      icon={<Bot className="w-4 h-4" />}
      title={`Autonomous servicing ${on ? "on" : "off"}`}
      desc="When on, service_book re-emits itself as a finalized message so the loan book self-services overdue → default."
    >
      <Button
        variant={on ? "outline" : "gradient"}
        className="w-full press"
        disabled={isPending}
        onClick={() => run(!on)}
      >
        {isPending ? "…" : on ? "Turn off autonomous" : "Turn on autonomous"}
      </Button>
    </CardShell>
  );
}

function TermsCard({
  lenderShareBps,
  termSeconds,
  graceSeconds,
}: {
  lenderShareBps: number;
  termSeconds: number;
  graceSeconds: number;
}) {
  const { run, isPending } = useSetTerms();
  const [share, setShare] = useState(String(lenderShareBps));
  const [termDays, setTermDays] = useState(String(Math.round(termSeconds / DAY)));
  const [graceDays, setGraceDays] = useState(String(Math.round(graceSeconds / DAY)));

  // Re-sync when config resolves/changes.
  useEffect(() => setShare(String(lenderShareBps)), [lenderShareBps]);
  useEffect(() => setTermDays(String(Math.round(termSeconds / DAY))), [termSeconds]);
  useEffect(() => setGraceDays(String(Math.round(graceSeconds / DAY))), [graceSeconds]);

  const shareNum = parseInt(share, 10);
  const termNum = parseFloat(termDays);
  const graceNum = parseFloat(graceDays);
  const shareValid = Number.isInteger(shareNum) && shareNum >= 0 && shareNum <= 10000;
  const termValid = Number.isFinite(termNum) && termNum > 0;
  const graceValid = Number.isFinite(graceNum) && graceNum >= 0;
  const valid = shareValid && termValid && graceValid;

  return (
    <CardShell
      icon={<SlidersHorizontal className="w-4 h-4" />}
      title="Terms"
      desc="Lender share of each origination fee, loan term, and grace period before overdue becomes default."
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label htmlFor="adm-share" className="text-xs text-muted-foreground">
            Lender share (bps) · {shareValid ? formatBps(shareNum) : "—"}
          </Label>
          <Input
            id="adm-share"
            type="number"
            min="0"
            max="10000"
            step="1"
            value={share}
            aria-invalid={!shareValid}
            onChange={(e) => setShare(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="adm-term" className="text-xs text-muted-foreground">
            Term (days)
          </Label>
          <Input
            id="adm-term"
            type="number"
            min="1"
            step="1"
            value={termDays}
            aria-invalid={!termValid}
            onChange={(e) => setTermDays(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="adm-grace" className="text-xs text-muted-foreground">
            Grace (days)
          </Label>
          <Input
            id="adm-grace"
            type="number"
            min="0"
            step="1"
            value={graceDays}
            aria-invalid={!graceValid}
            onChange={(e) => setGraceDays(e.target.value)}
          />
        </div>
      </div>
      <Button
        variant="gradient"
        className="w-full press"
        disabled={!valid || isPending}
        onClick={() =>
          run({
            lenderShareBps: shareNum,
            termSeconds: Math.round(termNum * DAY),
            graceSeconds: Math.round(graceNum * DAY),
          })
        }
      >
        {isPending ? "Updating…" : "Update terms"}
      </Button>
    </CardShell>
  );
}

function RiskLimitsCard({ maxUtilizationBps }: { maxUtilizationBps: number }) {
  const { run, isPending } = useSetRiskLimits();
  const [bps, setBps] = useState(String(maxUtilizationBps));
  useEffect(() => setBps(String(maxUtilizationBps)), [maxUtilizationBps]);
  const n = parseInt(bps, 10);
  const valid = Number.isInteger(n) && n >= 0 && n <= 10000;
  return (
    <CardShell
      icon={<Gauge className="w-4 h-4" />}
      title="Risk limits"
      desc="Cap the share of lender capital that can be lent out at once, holding a liquidity buffer for redemptions. 10000 bps = no cap."
    >
      <div className="space-y-2">
        <Label htmlFor="adm-util" className="text-xs text-muted-foreground inline-flex items-center gap-1">
          Max utilization (bps) · {valid ? (n >= 10000 ? "no cap" : formatBps(n)) : "—"}
          <InfoHint label="What is the utilization cap?">
            The largest fraction of lenders&apos; capital that may be on loan at
            once. A cap below 100% keeps cash on hand so lenders can redeem and
            claim yield even when demand is high.
          </InfoHint>
        </Label>
        <div className="flex gap-2">
          <Input
            id="adm-util"
            type="number"
            min="0"
            max="10000"
            step="1"
            value={bps}
            aria-invalid={!valid}
            onChange={(e) => setBps(e.target.value)}
          />
          <Button
            variant="gradient"
            className="shrink-0 press"
            disabled={!valid || isPending}
            onClick={() => run(n)}
          >
            {isPending ? "…" : "Set"}
          </Button>
        </div>
      </div>
    </CardShell>
  );
}

function InterestCard({ interestBps }: { interestBps: number }) {
  const { run, isPending } = useSetInterestBps();
  const [bps, setBps] = useState(String(interestBps));
  useEffect(() => setBps(String(interestBps)), [interestBps]);
  const n = parseInt(bps, 10);
  const valid = Number.isInteger(n) && n >= 0 && n <= 10000;
  return (
    <CardShell
      icon={<Percent className="w-4 h-4" />}
      title="Interest rate"
      desc="Annual interest on outstanding principal (bps APR). 0 turns it off. Interest is lenders' primary yield; it accrues lazily per borrower."
    >
      <div className="space-y-2">
        <Label htmlFor="adm-interest" className="text-xs text-muted-foreground inline-flex items-center gap-1">
          Interest (bps APR) · {valid ? (n === 0 ? "off" : formatBps(n)) : "—"}
          <InfoHint label="What is the interest rate?">
            Simple interest charged per year on what a borrower still owes. It is
            added to the amount owed and, when repaid, split with lenders as yield.
            Max 10000 bps (100% APR).
          </InfoHint>
        </Label>
        <div className="flex gap-2">
          <Input
            id="adm-interest"
            type="number"
            min="0"
            max="10000"
            step="1"
            value={bps}
            aria-invalid={!valid}
            onChange={(e) => setBps(e.target.value)}
          />
          <Button
            variant="gradient"
            className="shrink-0 press"
            disabled={!valid || isPending}
            onClick={() => run(n)}
          >
            {isPending ? "…" : "Set"}
          </Button>
        </div>
      </div>
    </CardShell>
  );
}

function GuardianCard({ guardian }: { guardian: string }) {
  const { run, isPending } = useSetGuardian();
  const [addr, setAddr] = useState("");
  const valid = ADDR_RE.test(addr.trim());
  return (
    <CardShell
      icon={<ShieldAlert className="w-4 h-4" />}
      title="Guardian"
      desc="A separation-of-duties incident-response role: the guardian can PAUSE the protocol but cannot move funds, change economics, or unpause (only owner/relayer unpause)."
    >
      <div className="space-y-2">
        {guardian && (
          <p className="text-xs text-muted-foreground">
            Current:{" "}
            <AddressDisplay address={guardian} maxLength={16} showCopy className="text-xs" />
          </p>
        )}
        <div className="flex gap-2">
          <Input
            placeholder="Guardian 0x…"
            value={addr}
            spellCheck={false}
            autoComplete="off"
            className="font-mono text-xs"
            aria-invalid={!!addr && !valid}
            onChange={(e) => setAddr(e.target.value)}
          />
          <Button
            variant="outline"
            className="shrink-0 press"
            disabled={!valid || isPending}
            onClick={() => run(addr.trim())}
          >
            {isPending ? "…" : "Set guardian"}
          </Button>
        </div>
      </div>
    </CardShell>
  );
}

function WithdrawCard({ feeRevenue, devAddr }: { feeRevenue: string; devAddr: string }) {
  const { run, isPending } = useWithdrawFees();
  const [to, setTo] = useState("");
  const [amt, setAmt] = useState("");

  const amtNum = parseFloat(amt);
  const amtValid = Number.isFinite(amtNum) && amtNum > 0;
  const toValid = to.trim() === "" || ADDR_RE.test(to.trim());
  const valid = amtValid && toValid;

  return (
    <CardShell
      icon={<Banknote className="w-4 h-4" />}
      title="Withdraw revenue"
      desc={`Withdraw accrued protocol revenue (max ${formatTokens(feeRevenue)} GEN). Blank recipient pays the dev address.`}
    >
      <div className="space-y-2">
        <Input
          placeholder={devAddr ? `Recipient (default ${devAddr.slice(0, 10)}…)` : "Recipient 0x… (optional)"}
          value={to}
          spellCheck={false}
          autoComplete="off"
          className="font-mono text-xs"
          aria-invalid={!toValid}
          onChange={(e) => setTo(e.target.value)}
        />
        <div className="flex gap-2">
          <Input
            type="number"
            min="0"
            step="any"
            placeholder="Amount (tokens)"
            value={amt}
            aria-invalid={!!amt && !amtValid}
            onChange={(e) => setAmt(e.target.value)}
          />
          <Button
            variant="outline"
            className="shrink-0 press"
            disabled={!valid || isPending}
            onClick={() => run({ to: to.trim(), amountBaseUnits: tokensToBaseUnits(amtNum) })}
          >
            {isPending ? "…" : "Withdraw"}
          </Button>
        </div>
      </div>
    </CardShell>
  );
}

function TransferCard() {
  const { run, isPending } = useTransferOwnership();
  const [newOwner, setNewOwner] = useState("");
  const valid = ADDR_RE.test(newOwner.trim());
  return (
    <CardShell
      icon={<UserCog className="w-4 h-4" />}
      title="Transfer ownership"
      desc="Nominate a new owner. They must accept from their own wallet to complete the two-step handover."
      danger
    >
      <div className="flex gap-2">
        <Input
          placeholder="New owner 0x…"
          value={newOwner}
          spellCheck={false}
          autoComplete="off"
          className="font-mono text-xs"
          aria-invalid={!!newOwner && !valid}
          onChange={(e) => setNewOwner(e.target.value)}
        />
        <Button
          variant="outline"
          className="shrink-0 press"
          disabled={!valid || isPending}
          onClick={() => run(newOwner.trim())}
        >
          {isPending ? "…" : "Nominate"}
        </Button>
      </div>
    </CardShell>
  );
}

function AcceptOwnershipCard() {
  const { acceptOwnershipAsync, isAccepting } = useAcceptOwnership();
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-accent/30 bg-accent/10 p-4">
      <ShieldCheck className="w-5 h-5 text-accent shrink-0" />
      <div className="flex-grow">
        <p className="text-sm font-semibold">Accept ownership</p>
        <p className="text-xs text-muted-foreground">
          Complete a pending two-step transfer. Only the nominated wallet can accept.
        </p>
      </div>
      <Button
        variant="gradient"
        className="shrink-0 press"
        disabled={isAccepting}
        onClick={() => {
          void acceptOwnershipAsync().catch(() => {});
        }}
      >
        {isAccepting ? "Accepting…" : "Accept ownership"}
      </Button>
    </div>
  );
}
