"use client";

import { Landmark, KeyRound, Users, FileText, ArrowUpRight } from "lucide-react";

/**
 * A short, trust-building explainer for CredenceGovernor: the optional M-of-N
 * multisig that can own Credence so no single key controls the treasury or the
 * economics. Links to the in-repo governance spec (docs/GOVERNANCE.md) when a
 * repo base URL is configured; otherwise it names the file so it's still
 * discoverable, never a dead link.
 */
export function GovernanceCard() {
  const repo = (process.env.NEXT_PUBLIC_REPO_URL || "").trim().replace(/\/+$/, "");
  const docHref = repo ? `${repo}/blob/main/docs/GOVERNANCE.md` : "";

  return (
    <section
      id="governance"
      className="brand-card p-5 md:p-6 scroll-mt-24"
      aria-labelledby="governance-heading"
    >
      <div className="flex items-start gap-3 mb-4">
        <span className="gradient-purple-blue rounded-xl p-2.5 flex text-white shadow-lg shadow-accent/20 shrink-0">
          <Landmark className="w-5 h-5" />
        </span>
        <div>
          <h2 id="governance-heading" className="font-bold text-lg md:text-xl">
            Governed by a multisig, not a single key
          </h2>
          <p className="text-sm text-muted-foreground max-w-2xl mt-0.5 leading-relaxed">
            Credence&apos;s owner seat can be handed to{" "}
            <span className="text-accent font-medium">CredenceGovernor</span> — an
            on-chain M-of-N multisig. Every treasury or economic change then needs a
            quorum of independent signers to approve it, with{" "}
            <span className="text-foreground font-medium">zero bespoke access-control code</span>{" "}
            inside Credence itself.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <GovPoint
          icon={<Users className="w-4 h-4" />}
          title="M-of-N approval"
          body="No single signer can pause, re-price, or drain fees. Each owner-only action needs M independent approvals."
        />
        <GovPoint
          icon={<KeyRound className="w-4 h-4" />}
          title="Closed action set"
          body="Only ten mapped owner actions exist; arguments are range-checked at propose time. No arbitrary-call surface."
        />
        <GovPoint
          icon={<FileText className="w-4 h-4" />}
          title="Proven on studionet"
          body="A 2-of-2 quorum took ownership of Credence and changed a live parameter across contracts — end to end."
        />
      </div>

      <div className="mt-4 text-xs text-muted-foreground">
        {docHref ? (
          <a
            href={docHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-accent font-medium hover:gap-2.5 transition-all"
          >
            Read the governance spec (GOVERNANCE.md)
            <ArrowUpRight className="w-3.5 h-3.5" />
          </a>
        ) : (
          <span>
            Full spec in the repository at{" "}
            <code className="font-mono text-foreground/80 bg-panel-2 border border-hair rounded px-1.5 py-0.5">
              docs/GOVERNANCE.md
            </code>
            .
          </span>
        )}
      </div>
    </section>
  );
}

function GovPoint({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-hair bg-panel p-4">
      <div className="flex items-center gap-2 mb-1.5 text-accent">
        {icon}
        <span className="text-sm font-semibold text-foreground">{title}</span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}
