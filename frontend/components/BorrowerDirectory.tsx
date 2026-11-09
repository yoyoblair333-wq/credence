"use client";

import { useState } from "react";
import { Users2, ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { usePageBorrowers } from "@/lib/hooks/useCredence";
import { GradeBadge } from "./GradeBadge";
import { AddressDisplay } from "./AddressDisplay";
import { Button } from "./ui/button";
import { formatTokens } from "@/lib/utils/format";
import type { BorrowerSummary } from "@/lib/contracts/types";

const PAGE_SIZE = 8;

const STATUS_TONE: Record<string, string> = {
  approved: "text-emerald-700 dark:text-emerald-300 border-emerald-500/40 bg-emerald-500/10",
  defaulted: "text-red-700 dark:text-red-300 border-red-500/40 bg-red-500/10",
  denied: "text-red-700 dark:text-red-300 border-red-500/40 bg-red-500/10",
  assessing: "text-amber-700 dark:text-amber-300 border-amber-500/40 bg-amber-500/10",
  none: "text-muted-foreground border-hair bg-panel-2",
};

/**
 * Browsable, paginated borrower directory backed by page_borrowers(offset,
 * limit) — a bounded read so indexers/UIs never force an unbounded roster scan.
 * Demonstrates that Credence is a living, repeat-use loan book.
 */
export function BorrowerDirectory() {
  const [offset, setOffset] = useState(0);
  const { data, isLoading } = usePageBorrowers(offset, PAGE_SIZE);

  const total = data?.total ?? 0;
  const items = data?.items ?? [];
  const nextOffset = data?.next_offset ?? -1;
  const hasPrev = offset > 0;
  const hasNext = nextOffset >= 0;

  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = offset + items.length;

  return (
    <section
      id="borrowers"
      className="brand-card p-5 md:p-7 scroll-mt-24"
      aria-labelledby="borrowers-heading"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <span className="gradient-purple-pink rounded-xl p-2.5 flex text-white shadow-lg shadow-accent/20">
            <Users2 className="w-5 h-5" />
          </span>
          <div>
            <h2 id="borrowers-heading" className="font-bold text-xl md:text-2xl">
              Borrower directory
            </h2>
            <p className="text-sm text-muted-foreground">
              The live loan book — every opted-in borrower and their standing.
            </p>
          </div>
        </div>
        {total > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums shrink-0">
            {rangeStart}–{rangeEnd} of {total.toLocaleString()}
          </span>
        )}
      </div>

      {isLoading ? (
        <DirectorySkeleton />
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-hair-strong bg-panel/50 p-8 text-center">
          <div className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-accent/10 text-accent mb-2">
            <Inbox className="w-5 h-5" />
          </div>
          <p className="font-semibold mb-0.5">No borrowers yet</p>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            When the first applicant is underwritten, they&apos;ll appear here.
          </p>
        </div>
      ) : (
        <>
          {/* Desktop: table. Mobile: stacked cards. */}
          <div className="hidden md:block overflow-hidden rounded-xl border border-hair">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-panel text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Borrower</th>
                  <th className="px-4 py-2.5 font-medium">Grade</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Standing</th>
                  <th className="px-4 py-2.5 font-medium text-right">Drawn</th>
                  <th className="px-4 py-2.5 font-medium text-right">Limit</th>
                </tr>
              </thead>
              <tbody>
                {items.map((b, i) => (
                  <tr
                    key={b.addr}
                    className={`border-t border-hair transition-colors hover:bg-panel/60 ${
                      i % 2 ? "bg-panel/30" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <AddressDisplay address={b.addr} maxLength={16} showCopy />
                    </td>
                    <td className="px-4 py-3">
                      <GradeBadge grade={b.grade} size="sm" />
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={b.status} />
                    </td>
                    <td className="px-4 py-3 w-40">
                      <StandingBar value={b.standing} />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatTokens(b.principal)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatTokens(b.credit_limit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="md:hidden space-y-2.5">
            {items.map((b) => (
              <li key={b.addr} className="rounded-xl border border-hair bg-panel p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <AddressDisplay address={b.addr} maxLength={14} showCopy className="text-sm" />
                  <GradeBadge grade={b.grade} size="sm" />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <StatusPill status={b.status} />
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatTokens(b.principal)} / {formatTokens(b.credit_limit)} GEN
                  </span>
                </div>
                <StandingBar value={b.standing} showLabel />
              </li>
            ))}
          </ul>

          {/* Pagination */}
          {(hasPrev || hasNext) && (
            <div className="flex items-center justify-between mt-4">
              <Button
                variant="outline"
                size="sm"
                className="press"
                disabled={!hasPrev}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                Previous
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums">
                Page {Math.floor(offset / PAGE_SIZE) + 1} of{" "}
                {Math.max(1, Math.ceil(total / PAGE_SIZE))}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="press"
                disabled={!hasNext}
                onClick={() => hasNext && setOffset(nextOffset)}
              >
                Next
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function StatusPill({ status }: { status: BorrowerSummary["status"] }) {
  const tone = STATUS_TONE[status] ?? STATUS_TONE.none;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${tone}`}
    >
      {status}
    </span>
  );
}

function StandingBar({ value, showLabel }: { value: number; showLabel?: boolean }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 flex-grow rounded-full bg-panel-2 overflow-hidden"
        role="meter"
        aria-valuenow={v}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Standing"
      >
        <div
          className="h-full gradient-purple-pink rounded-full"
          style={{ width: `${v}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums w-7 text-right">
        {v}
      </span>
      {showLabel && <span className="text-[11px] text-muted-foreground">standing</span>}
    </div>
  );
}

function DirectorySkeleton() {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="skeleton h-12 w-full rounded-xl" />
      ))}
    </div>
  );
}
