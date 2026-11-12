"use client";

import { useState } from "react";
import {
  Gavel,
  Globe,
  FileText,
  Image as ImageIcon,
  Hash,
  Quote,
  ShieldAlert,
  ShieldCheck,
  Users,
  Scale,
  ArrowUpRight,
} from "lucide-react";
import type { Borrower, EvidenceDraft, Grade } from "@/lib/contracts/types";
import { GRADE_TOKENS } from "@/lib/contracts/types";
import { GradeBadge } from "./GradeBadge";
import { InfoHint } from "./InfoHint";
import {
  PANEL,
  mockAssess,
  tokensToBaseString,
  APPEAL_PANEL_SIZE,
} from "@/lib/contracts/mock";
import { useAppeal, useIsDemoMode, useConfig } from "@/lib/hooks/useCredence";
import { useWallet } from "@/lib/genlayer/wallet";
import { BASE } from "@/lib/utils/format";

/**
 * The verdict: the bounded grade the consensus panel reached, the per-underwriter
 * votes behind it, the rationale (the WHY), whether ownership was proven, the
 * resulting credit line, and — for url/image evidence — what each validator
 * fetched live plus its sha256. A borrower can escalate the verdict once to a
 * larger, independent appeal panel.
 */
export function AssessmentResult({
  borrower,
  onUpdate,
}: {
  borrower: Borrower | null;
  onUpdate?: (b: Borrower) => void;
}) {
  const demo = useIsDemoMode();
  const { address } = useWallet();
  const { data: config } = useConfig();
  const { appealAsync, isAppealing } = useAppeal();
  const [localAppealing, setLocalAppealing] = useState(false);
  const [appealError, setAppealError] = useState("");

  if (!borrower || !borrower.grade) {
    return (
      <div className="brand-card p-6 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-accent/10 text-accent mb-3">
          <Gavel className="w-6 h-6" />
        </div>
        <h3 className="font-semibold mb-1">Your assessment will appear here</h3>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          Submit an application and the on-chain panel of underwriters returns a
          bounded grade, the votes behind it, the reason why, and the credit line
          it unlocks.
        </p>
      </div>
    );
  }

  const grade = borrower.grade as Grade;
  const isDeny = grade === "DENY";
  const lineTokens = borrower.ownership_proven ? (GRADE_TOKENS[grade] ?? 0) : 0;
  const ownershipProven = !!borrower.ownership_proven;
  const votes = borrower.grade_votes ?? [];
  const nPanel = votes.length || config?.panel_size || 3;
  const majorityNeeded = Math.floor(nPanel / 2) + 1;
  const backing = votes.filter(
    (v) => GRADE_RANK(v) >= GRADE_RANK(grade)
  ).length;
  const appealPanel = config?.appeal_panel_size ?? APPEAL_PANEL_SIZE;
  const appealed = (borrower.appeal_tier ?? 0) > 0;

  // Appeal eligibility: assessed, not yet appealed, no outstanding balance. In
  // live mode it must be the connected wallet's own assessment.
  const noDebt =
    BigInt(borrower.principal || "0") === 0n &&
    BigInt(borrower.fee_accrued || "0") === 0n &&
    BigInt(borrower.interest_accrued || "0") === 0n;
  const isOwnLive =
    !!address && address.toLowerCase() === (borrower.addr || "").toLowerCase();
  const canAppeal =
    !appealed &&
    noDebt &&
    (borrower.status === "approved" || borrower.status === "denied") &&
    (demo || isOwnLive);

  const runAppeal = async () => {
    setAppealError("");
    if (demo) {
      // Re-run the local consensus stand-in with the larger appeal panel.
      setLocalAppealing(true);
      const requestedTokens = Number(BigInt(borrower.requested || "0") / BASE);
      const drafts: EvidenceDraft[] = (borrower.evidence || []).map((ev, i) => ({
        id: `appeal-${i}`,
        kind: ev.kind,
        label: ev.label,
        content: ev.content,
      }));
      const { grade: g, votes: vv, rationale, ownershipProven: op } = mockAssess(
        borrower.purpose,
        requestedTokens,
        drafts,
        appealPanel,
        true
      );
      const limitTokens = op ? GRADE_TOKENS[g] : 0;
      const now = new Date().toISOString();
      await new Promise((r) => setTimeout(r, 1100));
      setLocalAppealing(false);
      onUpdate?.({
        ...borrower,
        status: g === "DENY" ? "denied" : "approved",
        grade: g,
        credit_limit: tokensToBaseString(limitTokens),
        available: tokensToBaseString(limitTokens),
        ownership_proven: op,
        appeal_tier: 1,
        grade_votes: vv,
        rationale,
        assessed_at: now,
        updated_at: now,
      });
      return;
    }
    try {
      const updated = await appealAsync();
      onUpdate?.(updated);
    } catch (err: any) {
      setAppealError(err?.message || "The appeal could not be completed.");
    }
  };

  const appealing = demo ? localAppealing : isAppealing;

  return (
    <div className="brand-card p-5 md:p-6 space-y-5">
      {/* Verdict header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-hair">
        <div className="flex items-center gap-3">
          <span className="gradient-purple-pink rounded-lg p-2 flex text-white">
            <Gavel className="w-5 h-5" />
          </span>
          <div>
            <h2 className="font-bold text-lg leading-tight">Assessment</h2>
            <p className="text-xs text-muted-foreground">
              Decided by validator consensus
              {appealed && (
                <span className="ml-1 inline-flex items-center gap-1 text-accent font-medium">
                  · appeal panel of {appealPanel}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <GradeBadge grade={grade} size="lg" />
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Credit line</p>
            <p className="text-lg font-bold tabular-nums">
              {isDeny ? "—" : `${lineTokens.toLocaleString()}`}
              {!isDeny && (
                <span className="text-xs font-medium text-muted-foreground ml-1">
                  tokens
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* One-line outcome narration */}
      <p className="text-sm text-foreground/85 leading-relaxed">
        {isDeny ? (
          <>
            A strict majority of the panel did <span className="font-semibold">not</span>{" "}
            support a line on this evidence, so the safe default applies:{" "}
            <span className="font-semibold">no credit</span>.
          </>
        ) : (
          <>
            {backing} of {nPanel} underwriters backed{" "}
            <span className="font-semibold">{grade}</span> or higher — a strict
            majority — unlocking an undercollateralized line of{" "}
            <span className="font-semibold">{lineTokens.toLocaleString()} tokens</span>.
          </>
        )}
      </p>

      {/* Identity-binding (ownership) status */}
      {!isDeny &&
        (ownershipProven ? (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
            <ShieldCheck className="w-4 h-4 text-emerald-500 dark:text-emerald-400 mt-0.5 shrink-0" />
            <p className="text-xs text-emerald-800 dark:text-emerald-200/90 leading-relaxed">
              <span className="font-semibold">Ownership verified.</span> The applicant
              published their one-time token at a domain&apos;s /.well-known path, so
              evidence on that domain is proven theirs — the grade is not capped and the
              credit line is live.
            </p>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <ShieldAlert className="w-4 h-4 text-amber-500 dark:text-amber-400 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-800 dark:text-amber-200/90 leading-relaxed">
              <span className="font-semibold">Unverified — no credit line.</span> No domain
              ownership proof was verified, so this is a public reputation grade only
              (max C) and the credit limit is zero. Publish your token at
              /.well-known/credence-verify.txt on a domain you control and reapply.
            </p>
          </div>
        ))}

      {/* Sybil flag */}
      {borrower.sybil_flag && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <ShieldAlert className="w-4 h-4 text-amber-500 dark:text-amber-400 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-800 dark:text-amber-200/90 leading-relaxed">
            Some evidence here was previously submitted by a different account. The
            panel was told — this is a strong negative signal, not an automatic
            denial.
          </p>
        </div>
      )}

      {/* Per-underwriter votes */}
      <div>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Users className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-semibold">Panel votes</h3>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            binding grade = strongest a strict majority backs
            <InfoHint label="What is the binding grade?">
              Each underwriter returns one grade. The binding grade is the highest
              grade that at least {majorityNeeded} of {nPanel} back (a strict
              majority). If no majority agrees, it fails safe to DENY.
            </InfoHint>
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {votes.map((vote, i) => {
            const persona = PANEL[i];
            return (
              <div
                key={i}
                className="rounded-lg border border-hair bg-panel p-3"
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-xs font-semibold text-muted-foreground truncate">
                    {persona
                      ? persona.name.replace("UNDERWRITER_", "").toLowerCase()
                      : `panelist ${i + 1}`}
                  </span>
                  <GradeBadge grade={vote} size="sm" />
                </div>
                {persona && (
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    {persona.lens}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Rationale — the WHY */}
      {borrower.rationale && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Quote className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-semibold">Why — the binding rationale</h3>
          </div>
          <p className="text-sm text-foreground/85 leading-relaxed rounded-lg border border-hair bg-panel p-3">
            {borrower.rationale}
          </p>
        </div>
      )}

      {/* Evidence + fetched excerpts */}
      {borrower.evidence.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Globe className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-semibold">Evidence the panel judged</h3>
          </div>
          <ul className="space-y-2.5">
            {borrower.evidence.map((ev, i) => (
              <li
                key={i}
                className="rounded-lg border border-hair bg-panel p-3 space-y-2"
              >
                <div className="flex items-center gap-2">
                  {ev.kind === "url" ? (
                    <Globe className="w-3.5 h-3.5 text-accent shrink-0" />
                  ) : ev.kind === "image" ? (
                    <ImageIcon className="w-3.5 h-3.5 text-accent shrink-0" />
                  ) : (
                    <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  )}
                  <span className="text-sm font-medium truncate">
                    {ev.label ||
                      (ev.kind === "url"
                        ? "URL evidence"
                        : ev.kind === "image"
                          ? "Image evidence"
                          : "Text evidence")}
                  </span>
                  {ev.kind === "url" && (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
                        ev.ownership_proven
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                          : "border-hair bg-panel text-muted-foreground"
                      }`}
                      title={
                        ev.ownership_proven
                          ? "The fetched page displayed this wallet's address"
                          : "The fetched page did not display this wallet's address"
                      }
                    >
                      {ev.ownership_proven ? (
                        <ShieldCheck className="w-3 h-3" />
                      ) : (
                        <ShieldAlert className="w-3 h-3" />
                      )}
                      {ev.ownership_proven ? "owner-verified" : "unverified"}
                    </span>
                  )}
                  {ev.kind === "image" && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-hair bg-panel px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      <ImageIcon className="w-3 h-3" />
                      vision-judged
                    </span>
                  )}
                  <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">
                    {ev.kind}
                  </span>
                </div>

                {ev.kind === "text" ? (
                  <p className="text-xs text-foreground/75 leading-relaxed whitespace-pre-wrap">
                    {ev.content}
                  </p>
                ) : (
                  <p className="text-xs font-mono text-accent/90 break-all">
                    {ev.content}
                  </p>
                )}

                {ev.fetched_excerpt && (
                  <div className="rounded-md border border-accent/20 bg-accent/5 p-2.5 space-y-1.5">
                    <p className="text-[10px] uppercase tracking-wider text-accent flex items-center gap-1">
                      <Globe className="w-3 h-3" /> Fetched live by the chain
                    </p>
                    <p className="text-xs text-foreground/80 leading-relaxed">
                      {ev.fetched_excerpt}
                    </p>
                    {ev.fetched_sha256 && (
                      <p className="text-[10px] font-mono text-muted-foreground flex items-start gap-1 break-all">
                        <Hash className="w-3 h-3 mt-0.5 shrink-0" />
                        {ev.fetched_sha256}
                      </p>
                    )}
                  </div>
                )}

                {ev.sha256 && (
                  <p className="text-[10px] font-mono text-muted-foreground flex items-start gap-1 break-all">
                    <Hash className="w-3 h-3 mt-0.5 shrink-0" />
                    commit {ev.sha256}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!isDeny && (
        <p className="text-xs text-muted-foreground">
          Your line is open. Draw against it, then repay on time to raise your
          standing and unlock a larger line next round.
        </p>
      )}

      {/* Appeal — due process */}
      {canAppeal && (
        <div className="rounded-lg border border-accent/25 bg-accent/5 p-3.5 space-y-2.5">
          <div className="flex items-start gap-2">
            <Scale className="w-4 h-4 text-accent mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold flex items-center gap-1.5">
                Think the panel got it wrong?
                <InfoHint label="What is an appeal?">
                  Due process: escalate this verdict once to a larger, independent
                  panel of {appealPanel} underwriters that re-reads the same evidence
                  from scratch. Allowed only while you owe nothing (the new grade may
                  change your line).
                </InfoHint>
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Escalate to a larger, independent panel of {appealPanel} underwriters.
                Allowed once, only with no outstanding balance.
              </p>
            </div>
          </div>
          {appealError && (
            <p className="text-xs text-destructive">{appealError}</p>
          )}
          <button
            type="button"
            onClick={runAppeal}
            disabled={appealing}
            className="btn-secondary inline-flex items-center gap-1.5 h-9 px-4 text-sm disabled:opacity-60"
          >
            {appealing ? (
              <>Appeal panel deliberating…</>
            ) : (
              <>
                <ArrowUpRight className="w-4 h-4" />
                Appeal to a {appealPanel}-underwriter panel
              </>
            )}
          </button>
        </div>
      )}
      {appealed && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Scale className="w-3.5 h-3.5 text-accent" />
          This assessment was decided on appeal by a larger panel of {appealPanel}.
          An assessment can be appealed once.
        </p>
      )}
    </div>
  );
}

const RANK: Record<string, number> = { DENY: 0, C: 1, B: 2, A: 3, AA: 4, AAA: 5 };
function GRADE_RANK(g: string): number {
  return RANK[g] ?? 0;
}
