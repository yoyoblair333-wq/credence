"use client";

import { useMemo, useState } from "react";
import {
  Radar,
  Search,
  ShieldCheck,
  ShieldX,
  Gauge,
  CircleCheck,
  CircleX,
  Clock,
  Boxes,
} from "lucide-react";
import { useCreditOf, useIsCreditworthy } from "@/lib/hooks/useCredence";
import { GradeBadge } from "./GradeBadge";
import { AddressDisplay } from "./AddressDisplay";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { formatTokens, formatDueDate, GRADE_TAGLINE } from "@/lib/utils/format";
import type { Grade } from "@/lib/contracts/types";

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

/** Sample addresses (the demo roster) so the oracle is one tap from a result. */
const SAMPLES: { label: string; addr: string }[] = [
  { label: "AAA", addr: "0xA9e77000000000000000000000000000000B07cE" },
  { label: "A", addr: "0xA11ce0000000000000000000000000000000Cafe" },
  { label: "in default", addr: "0xDefa017000000000000000000000000000000Bad" },
];

const GATE_GRADES: Grade[] = ["C", "B", "A", "AA", "AAA"];

/**
 * Credit oracle — the showcase moment. Credence exposes any address's live
 * on-chain credit (credit_of) and a one-call gate (is_creditworthy) as a clean
 * read other contracts and chains can consume: creditworthiness as a composable,
 * judgment-as-a-service primitive.
 */
export function CreditOracle() {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [minGrade, setMinGrade] = useState<Grade>("A");

  const trimmed = input.trim();
  const inputValid = ADDR_RE.test(trimmed);
  const activeAddr = ADDR_RE.test(query) ? query : "";

  const { data: credit, isLoading, isError } = useCreditOf(activeAddr);
  const { data: creditworthy } = useIsCreditworthy(activeAddr, minGrade);

  const run = (addr: string) => {
    setInput(addr);
    setQuery(addr.trim());
  };

  const standing = credit?.standing ?? 0;
  const known = !!credit?.known;

  const statusPill = useMemo(() => {
    const s = credit?.status ?? "none";
    const map: Record<string, string> = {
      approved: "text-emerald-700 dark:text-emerald-300 border-emerald-500/40 bg-emerald-500/10",
      defaulted: "text-red-700 dark:text-red-300 border-red-500/40 bg-red-500/10",
      denied: "text-red-700 dark:text-red-300 border-red-500/40 bg-red-500/10",
      assessing: "text-amber-700 dark:text-amber-300 border-amber-500/40 bg-amber-500/10",
      none: "text-muted-foreground border-hair bg-panel",
    };
    return map[s] ?? map.none;
  }, [credit?.status]);

  return (
    <section
      id="oracle"
      className="brand-card p-5 md:p-7 scroll-mt-24"
      aria-labelledby="oracle-heading"
    >
      <div className="flex items-start gap-3 mb-5">
        <span className="gradient-purple-blue rounded-xl p-2.5 flex text-white shadow-lg shadow-accent/20">
          <Radar className="w-5 h-5" />
        </span>
        <div>
          <h2 id="oracle-heading" className="font-bold text-xl md:text-2xl">
            Credit oracle
          </h2>
          <p className="text-sm text-muted-foreground max-w-xl">
            Check any address&apos;s live, on-chain credit. Credence exposes{" "}
            <code className="font-mono text-xs text-accent">credit_of</code> and{" "}
            <code className="font-mono text-xs text-accent">is_creditworthy</code>{" "}
            as a clean read — judgment-as-a-service any contract or chain can plug into.
          </p>
        </div>
      </div>

      {/* Address input */}
      <div className="space-y-2 mb-3">
        <Label htmlFor="oracle-addr" className="text-sm">
          Address to check
        </Label>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            id="oracle-addr"
            value={input}
            placeholder="0x… (40 hex characters)"
            spellCheck={false}
            autoComplete="off"
            className="font-mono"
            aria-invalid={!!trimmed && !inputValid}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && inputValid) run(trimmed);
            }}
          />
          <Button
            variant="gradient"
            onClick={() => inputValid && run(trimmed)}
            disabled={!inputValid}
            className="sm:w-32 shrink-0 press"
          >
            <Search className="w-4 h-4 mr-1.5" />
            Check
          </Button>
        </div>
        {!!trimmed && !inputValid && (
          <p className="text-xs text-destructive">
            Enter a valid address: 0x followed by 40 hex characters.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs text-muted-foreground">Try:</span>
          {SAMPLES.map((s) => (
            <button
              key={s.addr}
              type="button"
              onClick={() => run(s.addr)}
              className="press rounded-full border border-hair bg-panel px-2.5 py-1 text-xs font-medium hover:border-accent/40 hover:text-accent transition-colors"
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Result */}
      <div className="mt-4" aria-live="polite">
        {!activeAddr ? (
          <OracleEmpty />
        ) : isLoading ? (
          <OracleSkeleton />
        ) : isError ? (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-200">
            Could not read this address from the contract. Please try again.
          </div>
        ) : credit && !known ? (
          <div className="rounded-xl border border-hair bg-panel p-5 text-center">
            <div className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-muted/40 text-muted-foreground mb-2">
              <ShieldX className="w-5 h-5" />
            </div>
            <p className="font-semibold mb-0.5">No credit on record</p>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Credence has never assessed{" "}
              <span className="font-mono">{shortAddr(credit.addr)}</span>. Oracle
              returns a safe{" "}
              <span className="font-mono">DENY</span> / zero record — never an error —
              so any consumer can gate on it.
            </p>
            <div className="mt-3">
              <GateLine addr={credit.addr} minGrade={minGrade} result={false} />
            </div>
          </div>
        ) : credit ? (
          <div className="rounded-xl border border-hair bg-panel p-5 space-y-4">
            {/* top: grade + address + status */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-3">
                <GradeBadge grade={credit.grade} size="lg" />
                <div>
                  <AddressDisplay
                    address={credit.addr}
                    maxLength={16}
                    showCopy
                    className="text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    {GRADE_TAGLINE[credit.grade]}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${statusPill}`}
                >
                  {credit.status}
                </span>
                {credit.defaulted && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">
                    <CircleX className="w-3.5 h-3.5" />
                    defaulted
                  </span>
                )}
                {!credit.defaulted && credit.overdue && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                    <Clock className="w-3.5 h-3.5" />
                    overdue
                  </span>
                )}
                {credit.requires_reassessment && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                    needs re-assessment
                  </span>
                )}
                {!credit.defaulted && credit.ever_defaulted && (
                  <span className="inline-flex items-center rounded-full border border-hair bg-panel px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    prior default
                  </span>
                )}
              </div>
            </div>

            {/* figures */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <OracleFigure
                icon={<Boxes className="w-4 h-4" />}
                label="Credit limit"
                value={`${formatTokens(credit.credit_limit)} GEN`}
              />
              <OracleFigure
                icon={<CircleCheck className="w-4 h-4" />}
                label="Available"
                value={`${formatTokens(credit.available)} GEN`}
                highlight
              />
              <OracleFigure
                icon={<Clock className="w-4 h-4" />}
                label="Assessed"
                value={credit.assessed_at ? formatDueDate(toEpoch(credit.assessed_at)) : "—"}
              />
            </div>

            {/* standing meter */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                  <Gauge className="w-4 h-4 text-accent" /> Standing
                </span>
                <span className="text-sm font-bold tabular-nums">{standing} / 100</span>
              </div>
              <div
                className="h-2 w-full rounded-full bg-panel-2 overflow-hidden"
                role="meter"
                aria-valuenow={standing}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Standing"
              >
                <div
                  className="meter-fill h-full gradient-purple-pink rounded-full transition-[width] duration-700"
                  style={{ width: `${Math.max(0, Math.min(100, standing))}%` }}
                />
              </div>
            </div>

            {/* composable gate */}
            <div className="space-y-2 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  Gate at minimum grade:
                </span>
                <div
                  role="radiogroup"
                  aria-label="Minimum grade"
                  className="inline-flex rounded-lg border border-hair overflow-hidden"
                >
                  {GATE_GRADES.map((g) => (
                    <button
                      key={g}
                      type="button"
                      role="radio"
                      aria-checked={minGrade === g}
                      onClick={() => setMinGrade(g)}
                      className={`px-2.5 py-1 text-xs font-semibold transition-colors ${
                        minGrade === g
                          ? "bg-accent/20 text-accent"
                          : "text-muted-foreground hover:bg-panel-2"
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
              <GateLine
                addr={credit.addr}
                minGrade={minGrade}
                result={!!creditworthy}
              />
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function GateLine({
  addr,
  minGrade,
  result,
}: {
  addr: string;
  minGrade: Grade;
  result: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 font-mono text-xs ${
        result
          ? "border-emerald-500/40 bg-emerald-500/10"
          : "border-hair bg-panel-2"
      }`}
    >
      {result ? (
        <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
      ) : (
        <ShieldX className="w-4 h-4 text-muted-foreground shrink-0" />
      )}
      <span className="truncate min-w-0 text-foreground/80">
        is_creditworthy(<span className="text-accent">{shortAddr(addr)}</span>,{" "}
        <span className="text-accent">&quot;{minGrade}&quot;</span>)
      </span>
      <span className="ml-auto shrink-0">
        →{" "}
        <span
          className={
            result
              ? "font-bold text-emerald-600 dark:text-emerald-300"
              : "font-bold text-muted-foreground"
          }
        >
          {result ? "true" : "false"}
        </span>
      </span>
    </div>
  );
}

function OracleFigure({
  icon,
  label,
  value,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        highlight ? "border-accent/30 bg-accent/5" : "border-hair bg-panel-2"
      }`}
    >
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
        <span className="text-accent">{icon}</span>
        <span className="text-xs">{label}</span>
      </div>
      <p className="text-sm font-bold tabular-nums">{value}</p>
    </div>
  );
}

function OracleEmpty() {
  return (
    <div className="rounded-xl border border-dashed border-hair-strong bg-panel/50 p-6 text-center">
      <div className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-accent/10 text-accent mb-2">
        <Radar className="w-5 h-5" />
      </div>
      <p className="font-semibold mb-0.5">Look up an on-chain credit grade</p>
      <p className="text-sm text-muted-foreground max-w-sm mx-auto">
        Paste any address or tap a sample. You&apos;ll see the grade, limit,
        standing and a composable <span className="font-mono">is_creditworthy</span> gate.
      </p>
    </div>
  );
}

function OracleSkeleton() {
  return (
    <div className="rounded-xl border border-hair bg-panel p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="skeleton h-9 w-20 rounded-full" />
        <div className="space-y-2">
          <div className="skeleton h-4 w-40" />
          <div className="skeleton h-3 w-56" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="skeleton h-16" />
        <div className="skeleton h-16" />
        <div className="skeleton h-16" />
      </div>
      <div className="skeleton h-2 w-full rounded-full" />
    </div>
  );
}

function shortAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Parse an ISO datetime string to epoch seconds for formatDueDate. */
function toEpoch(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}
