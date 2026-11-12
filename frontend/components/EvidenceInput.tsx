"use client";

import { FileText, Globe, Image as ImageIcon, Plus, Trash2, ShieldCheck } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import type { EvidenceDraft, EvidenceKind } from "@/lib/contracts/types";

/**
 * Contract-side evidence limits (credence.py). Mirrored here so the form
 * validates before spending a transaction; the contract re-validates on-chain.
 */
export const EVIDENCE_LIMITS = {
  MAX_ITEMS: 8,
  MAX_IMAGE_ITEMS: 1,
  MAX_LABEL_CHARS: 120,
  MAX_TEXT_CHARS: 1200,
  MAX_URL_CHARS: 300,
};

// Mirrors credence.py's _URL_RE: a single https:// URL, min 3 chars of path/host.
const HTTPS_URL_RE = /^https:\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]{3,}$/;
// Mirrors credence.py's _DOMAIN_RE: a bare lower-case hostname (no scheme/path/port).
const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const PROOF_PATH = "/.well-known/credence-verify.txt";

let draftSeq = 0;
function newDraft(kind: EvidenceKind = "text"): EvidenceDraft {
  draftSeq += 1;
  return { id: `ev-${Date.now()}-${draftSeq}`, kind, label: "", content: "" };
}

export function createEvidenceDraft(kind?: EvidenceKind): EvidenceDraft {
  return newDraft(kind);
}

/** First client-side validation message for an item, or "" if it is valid. */
export function validateEvidenceItem(item: EvidenceDraft): string {
  const label = item.label.trim();
  const content = item.content.trim();
  if (!content) return "Evidence content cannot be empty.";
  if (label.length > EVIDENCE_LIMITS.MAX_LABEL_CHARS)
    return `Label exceeds ${EVIDENCE_LIMITS.MAX_LABEL_CHARS} characters.`;
  if (item.kind === "text") {
    if (content.length > EVIDENCE_LIMITS.MAX_TEXT_CHARS)
      return `Text evidence exceeds ${EVIDENCE_LIMITS.MAX_TEXT_CHARS} characters.`;
  } else if (item.kind === "domain") {
    if (!DOMAIN_RE.test(content.toLowerCase().replace(/\.$/, "")))
      return "Enter a bare domain you control, like example.com (no https://, path or port).";
  } else {
    // url AND image both carry a single https URL.
    if (content.length > EVIDENCE_LIMITS.MAX_URL_CHARS || !HTTPS_URL_RE.test(content))
      return `${item.kind === "image" ? "Image" : "URL"} evidence must be a single https:// link.`;
  }
  return "";
}

/** List-level validation (e.g. the at-most-one-image rule). "" when valid. */
export function validateEvidenceList(items: EvidenceDraft[]): string {
  const withContent = items.filter((it) => it.content.trim());
  if (withContent.length > EVIDENCE_LIMITS.MAX_ITEMS)
    return `At most ${EVIDENCE_LIMITS.MAX_ITEMS} evidence items.`;
  const images = withContent.filter((it) => it.kind === "image").length;
  if (images > EVIDENCE_LIMITS.MAX_IMAGE_ITEMS)
    return "At most 1 image evidence item is allowed.";
  if (withContent.filter((it) => it.kind === "domain").length > 2)
    return "At most 2 domain ownership proofs are allowed.";
  return "";
}

/**
 * Serialize the drafts into the `evidence_json` string the contract expects:
 * a JSON array of { kind, label, content }. Returns "" when there is no
 * evidence (the contract treats "" as an empty list).
 */
export function serializeEvidence(items: EvidenceDraft[]): string {
  const cleaned = items
    .map((it) => ({
      kind: it.kind,
      label: it.label.trim(),
      content: it.kind === "domain" ? it.content.trim().toLowerCase() : it.content.trim(),
    }))
    .filter((it) => it.content.length > 0);
  if (cleaned.length === 0) return "";
  return JSON.stringify(cleaned);
}

interface EvidenceInputProps {
  items: EvidenceDraft[];
  onChange: (items: EvidenceDraft[]) => void;
  disabled?: boolean;
  /** The connected borrower's current ownership token (ownership_challenge). */
  proofToken?: string;
}

/**
 * Editor for an application's evidence list. Each item is free text, a single
 * https URL, or a single image (an https page the panel renders to a screenshot
 * and vision-judges). URL evidence is the flagship: during the assessment the
 * contract itself opens the link live and EVERY validator independently
 * re-fetches, re-reads it, and checks whether it displays the applicant's wallet
 * address — the on-chain, consensus-checked proof of ownership.
 */
export function EvidenceInput({ items, onChange, disabled, proofToken }: EvidenceInputProps) {
  const atMax = items.length >= EVIDENCE_LIMITS.MAX_ITEMS;
  const imageCount = items.filter((it) => it.kind === "image").length;

  const update = (id: string, patch: Partial<EvidenceDraft>) =>
    onChange(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const remove = (id: string) => onChange(items.filter((it) => it.id !== id));

  const add = () => {
    if (atMax) return;
    onChange([...items, newDraft("text")]);
  };

  const listError = validateEvidenceList(items);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <Label className="text-sm">Evidence of creditworthiness</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Add up to {EVIDENCE_LIMITS.MAX_ITEMS} items — text, an{" "}
            <span className="text-accent">https URL the panel fetches live</span>,
            or one <span className="text-accent">image</span> it reads with vision.
          </p>
        </div>
        <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
          {items.length}/{EVIDENCE_LIMITS.MAX_ITEMS}
        </span>
      </div>

      {/* Identity binding: how to unlock grades above C. */}
      <div className="flex items-start gap-2 rounded-md border border-accent/20 bg-accent/5 p-3">
        <ShieldCheck className="w-4 h-4 text-accent mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="text-foreground font-medium">No proof, no credit line.</span>{" "}
          Showing your address on a page proves nothing, so Credence uses a domain
          check instead. Publish this line at{" "}
          <span className="font-mono text-accent">https://&lt;your-domain&gt;{PROOF_PATH}</span>{" "}
          <em>before</em> you apply, then add a <span className="font-semibold">Domain</span> item:
          <span className="block mt-1.5 font-mono text-[11px] break-all text-foreground">
            {proofToken || "credence-verify=… (connect your wallet to see your token)"}
          </span>
          <span className="block mt-1.5">
            The contract builds that URL itself and every validator checks it. URLs on a
            proven domain count as yours. Without a proven domain you can still get a
            public reputation grade (max C), but your credit limit is zero.
          </span>
        </p>
      </div>

      {items.length > 0 && (
        <ul className="space-y-3">
          {items.map((item, idx) => {
            const msg = validateEvidenceItem(item);
            const showError =
              (item.content.trim().length > 0 || item.label.trim().length > 0) && !!msg;
            const labelId = `ev-label-${item.id}`;
            const contentId = `ev-content-${item.id}`;
            const isTextKind = item.kind === "text";
            return (
              <li
                key={item.id}
                className="rounded-md border border-hair bg-panel p-3 space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-muted-foreground">
                    Item {idx + 1}
                  </span>
                  <div className="flex items-center gap-2">
                    <div
                      role="radiogroup"
                      aria-label={`Evidence item ${idx + 1} kind`}
                      className="inline-flex rounded-md border border-hair overflow-hidden"
                    >
                      <KindToggle
                        active={item.kind === "domain"}
                        onClick={() => update(item.id, { kind: "domain" })}
                        disabled={disabled}
                        icon={<ShieldCheck className="w-3.5 h-3.5" />}
                        label="Domain"
                      />
                      <KindToggle
                        active={item.kind === "text"}
                        onClick={() => update(item.id, { kind: "text" })}
                        disabled={disabled}
                        icon={<FileText className="w-3.5 h-3.5" />}
                        label="Text"
                      />
                      <KindToggle
                        active={item.kind === "url"}
                        onClick={() => update(item.id, { kind: "url" })}
                        disabled={disabled}
                        icon={<Globe className="w-3.5 h-3.5" />}
                        label="URL"
                      />
                      <KindToggle
                        active={item.kind === "image"}
                        onClick={() => update(item.id, { kind: "image" })}
                        // Block switching to image when one already exists elsewhere.
                        disabled={disabled || (item.kind !== "image" && imageCount >= EVIDENCE_LIMITS.MAX_IMAGE_ITEMS)}
                        icon={<ImageIcon className="w-3.5 h-3.5" />}
                        label="Image"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => remove(item.id)}
                      disabled={disabled}
                      aria-label={`Remove evidence item ${idx + 1}`}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={labelId} className="text-xs text-muted-foreground">
                    Label
                  </Label>
                  <Input
                    id={labelId}
                    placeholder={
                      item.kind === "text"
                        ? "e.g. Confirmed purchase order"
                        : item.kind === "image"
                          ? "e.g. Audited dashboard screenshot"
                          : "e.g. Revenue dashboard (public share)"
                    }
                    value={item.label}
                    maxLength={EVIDENCE_LIMITS.MAX_LABEL_CHARS}
                    disabled={disabled}
                    onChange={(e) => update(item.id, { label: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={contentId} className="text-xs text-muted-foreground">
                    {isTextKind ? "Text" : item.kind === "domain" ? "Domain you control" : "https URL"}
                  </Label>
                  {isTextKind ? (
                    <textarea
                      id={contentId}
                      rows={3}
                      placeholder="Describe verifiable, current evidence — income, on-chain history, an invoice, a contract…"
                      value={item.content}
                      maxLength={EVIDENCE_LIMITS.MAX_TEXT_CHARS}
                      disabled={disabled}
                      aria-invalid={showError}
                      onChange={(e) => update(item.id, { content: e.target.value })}
                      className={`placeholder:text-muted-foreground border-input w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:opacity-50 ${
                        showError ? "border-destructive" : ""
                      }`}
                    />
                  ) : (
                    <Input
                      id={contentId}
                      type={item.kind === "domain" ? "text" : "url"}
                      inputMode="url"
                      placeholder={item.kind === "domain" ? "example.com" : "https://…"}
                      value={item.content}
                      maxLength={EVIDENCE_LIMITS.MAX_URL_CHARS}
                      disabled={disabled}
                      aria-invalid={showError}
                      className={`font-mono ${showError ? "border-destructive" : ""}`}
                      onChange={(e) => update(item.id, { content: e.target.value })}
                    />
                  )}
                  {item.kind === "url" && (
                    <p className="text-xs text-muted-foreground flex items-start gap-1">
                      <Globe className="w-3 h-3 text-accent shrink-0 mt-0.5" />
                      Each underwriter opens this link live. It counts as yours only if it
                      is hosted on a domain you prove in the same application.
                    </p>
                  )}
                  {item.kind === "domain" && (
                    <p className="text-xs text-muted-foreground flex items-start gap-1">
                      <ShieldCheck className="w-3 h-3 text-accent shrink-0 mt-0.5" />
                      Validators fetch https://{item.content.trim() || "<domain>"}{PROOF_PATH} and
                      look for your token on its own line. A domain can back only one borrower.
                    </p>
                  )}
                  {item.kind === "image" && (
                    <p className="text-xs text-muted-foreground flex items-start gap-1">
                      <ImageIcon className="w-3 h-3 text-accent shrink-0 mt-0.5" />
                      The panel renders this page to a screenshot and judges it with
                      vision. Great corroboration — but an image can never prove ownership.
                    </p>
                  )}
                  {showError && <p className="text-xs text-destructive">{msg}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {listError && <p className="text-xs text-destructive">{listError}</p>}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        disabled={disabled || atMax}
        className="w-full"
      >
        <Plus className="w-4 h-4 mr-1.5" />
        {atMax ? `Maximum ${EVIDENCE_LIMITS.MAX_ITEMS} items` : "Add evidence"}
      </Button>
    </div>
  );
}

function KindToggle({
  active,
  onClick,
  disabled,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40 ${
        active ? "bg-accent/20 text-accent" : "text-muted-foreground hover:bg-white/5"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
