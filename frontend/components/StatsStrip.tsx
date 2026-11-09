"use client";

import { Users, CheckCircle2, Activity, XCircle, ShieldCheck } from "lucide-react";
import { useStats, useConfig } from "@/lib/hooks/useCredence";
import { GRADES, type Grade } from "@/lib/contracts/types";
import { GRADE_STYLES, feeBpsForGrade, formatBps } from "@/lib/utils/format";
import { InfoHint } from "./InfoHint";

/**
 * Protocol stats strip (from stats()) plus the grade ladder (from get_config()).
 * The ladder is the product's mental model in one glance: each consensus grade
 * maps to a fixed credit line and a risk-priced origination fee, and unproven
 * evidence is capped at C. Shows that Credence is a living, repeat-use book.
 */
export function StatsStrip() {
  const { data: stats } = useStats();
  const { data: config } = useConfig();

  const gradeTokens = config?.grade_tokens ?? {
    DENY: 0,
    C: 100,
    B: 250,
    A: 500,
    AA: 1000,
    AAA: 2500,
  };
  const feeTable = config?.origination_bps_by_grade;
  const cap = config?.unowned_grade_cap ?? "C";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          icon={<Users className="w-4 h-4" />}
          label="Borrowers"
          value={stats?.borrowers ?? 0}
        />
        <StatTile
          icon={<CheckCircle2 className="w-4 h-4" />}
          label="Approved lines"
          value={stats?.approved ?? 0}
          tone="good"
        />
        <StatTile
          icon={<Activity className="w-4 h-4" />}
          label="Active loans"
          value={stats?.active_lines ?? 0}
        />
        <StatTile
          icon={<XCircle className="w-4 h-4" />}
          label="Defaults"
          value={stats?.defaulted ?? 0}
          tone="bad"
        />
      </div>

      <div className="brand-card p-4 md:p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            The grade ladder
            <InfoHint label="What is the grade ladder?">
              Every assessment lands on one of six grades. Each grade maps to a
              fixed credit line (in tokens) and a one-time origination fee — riskier
              grades pay more. DENY means no line.
            </InfoHint>
          </h3>
          <span className="text-xs text-muted-foreground hidden sm:inline">
            consensus grade → credit line → fee
          </span>
        </div>

        {/* A simple visual ladder: grade, the line it unlocks, and its fee. */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {GRADES.map((g: Grade) => {
            const s = GRADE_STYLES[g];
            const tokens = gradeTokens[g] ?? 0;
            const isDeny = g === "DENY";
            const fee = isDeny ? null : feeBpsForGrade(g, feeTable);
            return (
              <div
                key={g}
                className={`rounded-xl border p-3 ${s.bg} ${s.border} flex flex-col gap-1`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-base font-bold ${s.text}`}>{g}</span>
                  {!isDeny && (
                    <span className="text-[10px] font-medium text-muted-foreground tabular-nums">
                      {fee !== null ? `${formatBps(fee)} fee` : ""}
                    </span>
                  )}
                </div>
                <span className="text-sm font-semibold tabular-nums">
                  {isDeny ? "no line" : `${tokens.toLocaleString()}`}
                  {!isDeny && (
                    <span className="text-[10px] font-medium text-muted-foreground ml-1">
                      tokens
                    </span>
                  )}
                </span>
                <span className="text-[10px] text-muted-foreground leading-tight">
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* The identity-proof rule, stated simply. */}
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-accent/20 bg-accent/5 p-3">
          <ShieldCheck className="w-4 h-4 text-accent mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            <span className="text-foreground font-medium">Identity rule:</span> to
            reach a grade above <span className="font-semibold">{cap}</span>, at least
            one cited page must display your wallet address (proof you own it).
            Without that proof the line is capped at{" "}
            <span className="font-semibold">{cap}</span> — you can&apos;t borrow
            against a stranger&apos;s reputation.
          </p>
        </div>
      </div>
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: "default" | "good" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-600 dark:text-emerald-300"
      : tone === "bad"
        ? "text-red-600 dark:text-red-300"
        : "text-foreground";
  return (
    <div className="brand-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground mb-1.5">
        <span className="text-accent">{icon}</span>
        <span className="text-xs">{label}</span>
      </div>
      <p className={`text-2xl font-bold tabular-nums ${toneClass}`}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}
