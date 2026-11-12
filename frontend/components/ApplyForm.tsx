"use client";

import { useMemo, useState } from "react";
import { Send, Sparkles, Code2, AlertCircle } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import {
  EvidenceInput,
  serializeEvidence,
  validateEvidenceItem,
  validateEvidenceList,
} from "./EvidenceInput";
import { GradeBadge } from "./GradeBadge";
import { useWallet } from "@/lib/genlayer/wallet";
import {
  useRequestCredit,
  useAssess,
  useIsDemoMode,
  useOwnershipChallenge,
} from "@/lib/hooks/useCredence";
import { mockAssess, tokensToBaseString } from "@/lib/contracts/mock";
import {
  GRADES,
  GRADE_TOKENS,
  type Borrower,
  type EvidenceDraft,
  type Grade,
} from "@/lib/contracts/types";

const MAX_PURPOSE_CHARS = 400;
const MAX_REQUESTED_TOKENS = GRADE_TOKENS.AAA; // 2500
const DEMO_ADDR = "0xA11ce0000000000000000000000000000000Cafe";

type Stage = "idle" | "submitting" | "assessing";

export function ApplyForm({
  onAssessed,
}: {
  onAssessed: (borrower: Borrower) => void;
}) {
  const demo = useIsDemoMode();
  const { address, isConnected } = useWallet();
  const { requestCreditAsync } = useRequestCredit();
  const { assessAsync } = useAssess();
  const { data: challenge } = useOwnershipChallenge(address);

  const [purpose, setPurpose] = useState("");
  const [requested, setRequested] = useState("500");
  const [items, setItems] = useState<EvidenceDraft[]>([]);
  const [stage, setStage] = useState<Stage>("idle");
  const [formError, setFormError] = useState("");

  const requestedTokens = parseInt(requested, 10);
  const requestedValid =
    Number.isInteger(requestedTokens) &&
    requestedTokens > 0 &&
    requestedTokens <= MAX_REQUESTED_TOKENS;

  const purposeClean = purpose.trim();
  const purposeValid = purposeClean.length > 0 && purposeClean.length <= MAX_PURPOSE_CHARS;

  const itemErrors = items
    .map((it, i) => ({ i, msg: validateEvidenceItem(it) }))
    .filter((e) => e.msg);
  const listError = validateEvidenceList(items);
  const evidenceValid = itemErrors.length === 0 && !listError;

  const canSubmit =
    purposeValid && requestedValid && evidenceValid && stage === "idle";

  const evidenceJson = useMemo(() => serializeEvidence(items), [items]);

  // Live preview of exactly what request_credit() receives.
  const payloadPreview = useMemo(() => {
    let parsedEvidence: unknown = [];
    try {
      parsedEvidence = evidenceJson ? JSON.parse(evidenceJson) : [];
    } catch {
      parsedEvidence = [];
    }
    return JSON.stringify(
      {
        purpose: purposeClean,
        requested_tokens: Number.isFinite(requestedTokens) ? requestedTokens : 0,
        evidence: parsedEvidence,
      },
      null,
      2
    );
  }, [purposeClean, requestedTokens, evidenceJson]);

  // The grade a request of this size could unlock (ceiling, not a promise).
  const targetGrade: Grade = useMemo(() => {
    const g = GRADES.find((gr) => GRADE_TOKENS[gr] >= (requestedTokens || 0));
    return (g ?? "AAA") as Grade;
  }, [requestedTokens]);

  const handleSubmit = async () => {
    setFormError("");
    if (!canSubmit) return;

    // ---- Demo / preview: simulate the consensus panel locally. ----
    if (demo) {
      setStage("assessing");
      const { grade, votes, rationale, ownershipProven } = mockAssess(
        purposeClean,
        requestedTokens,
        items
      );
      // No proof, no line (mirrors the contract): unproven -> zero limit.
      const limitTokens = ownershipProven ? GRADE_TOKENS[grade] : 0;
      const now = new Date().toISOString();
      const borrower: Borrower = {
        addr: address || DEMO_ADDR,
        status: grade === "DENY" ? "denied" : "approved",
        purpose: purposeClean,
        requested: tokensToBaseString(requestedTokens),
        grade,
        credit_limit: tokensToBaseString(limitTokens),
        principal: "0",
        available: tokensToBaseString(limitTokens),
        fee_accrued: "0",
        interest_accrued: "0",
        owed: "0",
        rate_bps: 0,
        total_repaid: "0",
        standing: 50,
        defaults: 0,
        on_time: 0,
        opened_at: 0,
        due_at: 0,
        overdue: false,
        sybil_flag: false,
        ownership_proven: ownershipProven,
        requires_reassessment: false,
        appeal_tier: 0,
        grade_votes: votes,
        rationale,
        evidence: items
          .filter((it) => it.content.trim())
          .map((it) => ({
            kind: it.kind,
            label: it.label.trim(),
            content: it.content.trim(),
            sha256: "(committed on-chain in a live assessment)",
            fetched_excerpt:
              it.kind === "url"
                ? "[preview] In a live assessment each validator fetches this URL and judges the page text. It counts as yours only if it is hosted on a domain you proved."
                : it.kind === "image"
                  ? "[preview] In a live assessment each validator renders this page to a screenshot and judges it with vision."
                  : "",
            fetched_sha256: "",
            // Demo mode fetches nothing, so no item can prove ownership.
            ownership_proven: false,
          })),
        created_at: now,
        updated_at: now,
        assessed_at: now,
      };
      // Brief delay so the "panel is deliberating" state is visible.
      await new Promise((r) => setTimeout(r, 1100));
      setStage("idle");
      onAssessed(borrower);
      return;
    }

    // ---- Live: request_credit, then run the consensus panel (assess). ----
    if (!isConnected || !address) {
      setFormError("Connect your wallet to apply for credit.");
      return;
    }
    try {
      setStage("submitting");
      await requestCreditAsync({
        purpose: purposeClean,
        requestedTokens,
        evidenceJson,
      });
      setStage("assessing");
      const borrower = await assessAsync({ borrower: address });
      setStage("idle");
      onAssessed(borrower);
    } catch (err: any) {
      setStage("idle");
      setFormError(err?.message || "Something went wrong. Please try again.");
    }
  };

  const busy = stage !== "idle";

  return (
    <section
      id="apply"
      className="brand-card p-5 md:p-6 scroll-mt-24"
      aria-labelledby="apply-heading"
    >
      <div className="flex items-center gap-3 mb-5">
        <span className="gradient-purple-pink rounded-lg p-2 flex text-white">
          <Send className="w-5 h-5" />
        </span>
        <div>
          <h2 id="apply-heading" className="font-bold text-lg">
            Apply for credit
          </h2>
          <p className="text-sm text-muted-foreground">
            Submit your own public evidence of creditworthiness. No collateral.
          </p>
        </div>
      </div>

      <div className="space-y-5">
        {/* Purpose */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="purpose">What is the credit for?</Label>
            <span className="text-xs text-muted-foreground tabular-nums">
              {purposeClean.length}/{MAX_PURPOSE_CHARS}
            </span>
          </div>
          <textarea
            id="purpose"
            rows={3}
            placeholder="e.g. Working capital to buy inventory ahead of a confirmed wholesale order; repaid from receivables within the term."
            value={purpose}
            maxLength={MAX_PURPOSE_CHARS}
            disabled={busy}
            onChange={(e) => setPurpose(e.target.value)}
            className="placeholder:text-muted-foreground border-input w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:opacity-50"
          />
        </div>

        {/* Requested tokens */}
        <div className="space-y-1.5">
          <Label htmlFor="requested">Requested credit (tokens)</Label>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="relative sm:w-48">
              <Input
                id="requested"
                type="number"
                inputMode="numeric"
                min="1"
                max={MAX_REQUESTED_TOKENS}
                step="1"
                value={requested}
                disabled={busy}
                aria-invalid={!!requested && !requestedValid}
                onChange={(e) => setRequested(e.target.value)}
                className={!requested || requestedValid ? "" : "border-destructive"}
              />
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>could unlock up to</span>
              <GradeBadge grade={targetGrade} size="sm" showLine />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Advisory. The panel decides the actual line; max {MAX_REQUESTED_TOKENS.toLocaleString()} tokens
            (an AAA grade). The grade — not your request — sets the limit.
          </p>
          {!!requested && !requestedValid && (
            <p className="text-xs text-destructive">
              Enter a whole number of tokens between 1 and {MAX_REQUESTED_TOKENS.toLocaleString()}.
            </p>
          )}
        </div>

        {/* Evidence builder */}
        <EvidenceInput items={items} onChange={setItems} disabled={busy} proofToken={challenge?.token} />

        {/* JSON preview */}
        <details className="rounded-lg border border-hair bg-panel-2 overflow-hidden group">
          <summary className="flex items-center gap-2 px-4 py-2.5 cursor-pointer text-sm font-medium hover:bg-white/5 transition-colors">
            <Code2 className="w-4 h-4 text-accent" />
            Request payload (what the contract receives)
            <span className="ml-auto text-xs text-muted-foreground group-open:hidden">
              show
            </span>
            <span className="ml-auto text-xs text-muted-foreground hidden group-open:inline">
              hide
            </span>
          </summary>
          <pre className="px-4 pb-4 pt-1 text-xs font-mono text-foreground/80 overflow-x-auto leading-relaxed">
            {payloadPreview}
          </pre>
        </details>

        {formError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Could not complete</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}

        {/* Submit */}
        <div className="space-y-2">
          <Button
            variant="gradient"
            className="w-full h-12 text-base"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {stage === "submitting" ? (
              "Submitting application…"
            ) : stage === "assessing" ? (
              <>
                <Sparkles className="w-4 h-4 mr-2 animate-pulse" />
                Underwriting panel deliberating…
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Apply &amp; run the underwriting panel
              </>
            )}
          </Button>
          {demo ? (
            <p className="text-xs text-muted-foreground text-center">
              Preview mode — the assessment is simulated locally and moves no real value.
            </p>
          ) : !isConnected ? (
            <p className="text-xs text-muted-foreground text-center">
              Connect your wallet to submit an application on-chain.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground text-center">
              Two on-chain steps: your evidence is committed, then the consensus
              panel underwrites it.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
