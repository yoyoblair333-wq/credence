"use client";

import { Globe, Users, ShieldCheck, Lock } from "lucide-react";
import { useConfig } from "@/lib/hooks/useCredence";

/**
 * "How consensus underwriting works" — the differentiator that only GenLayer can
 * do. Explains that a panel of independent AI underwriters each fetch the live
 * evidence, judge it, and must AGREE on a bounded grade before any token moves.
 */
export function ConsensusExplainer() {
  const { data: config } = useConfig();
  const panelSize = config?.panel_size ?? 3;
  const appealSize = config?.appeal_panel_size ?? 5;

  return (
    <div className="brand-card p-5 md:p-6">
      <div className="flex items-start gap-4 mb-5">
        <span className="gradient-purple-pink rounded-lg p-2.5 flex text-white shrink-0">
          <Users className="w-6 h-6" />
        </span>
        <div>
          <h2 className="font-bold text-lg mb-1">
            How consensus underwriting works
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            A deterministic smart contract cannot <em>judge</em> a borrower — which
            is why all of DeFi is over-collateralized. Credence replaces the
            collateral with an on-chain panel of{" "}
            <span className="text-accent font-medium">{panelSize} AI underwriters</span>{" "}
            that reach consensus on a verdict. That is the primitive only GenLayer
            can run.
          </p>
        </div>
      </div>

      <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <ExplainStep
          icon={<Globe className="w-4 h-4" />}
          n="1"
          title="Fetch live evidence"
          body="Every validator independently opens your https evidence off the web — not a cached copy — and reads (or vision-judges an image of) what is actually there right now."
        />
        <ExplainStep
          icon={<Users className="w-4 h-4" />}
          n="2"
          title={`Judge through ${panelSize} lenses`}
          body="Independent underwriter personas — cash-flow, track record, risk — each return a bounded grade, so no single biased reading can carry a decision."
        />
        <ExplainStep
          icon={<ShieldCheck className="w-4 h-4" />}
          n="3"
          title="Agree on the floor grade"
          body="The binding grade is the strongest grade a strict majority will back. Validators must reach the SAME grade or the assessment fails closed to DENY."
        />
        <ExplainStep
          icon={<Lock className="w-4 h-4" />}
          n="4"
          title="Then — and only then — lend"
          body="A line opens at the consensus grade. Repay on time and your standing, grade and limit grow. Default and they fall. Reputation compounds."
        />
      </ol>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 mt-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="text-foreground font-medium">Tamper-evident & safe.</span>{" "}
          Every evidence item is committed on-chain by a sha256 hash. All borrower
          input and every fetched byte is treated as untrusted data, never
          instructions — anything malformed or any panel disagreement fails closed to{" "}
          <span className="font-mono">DENY</span>, the lender-safe default.
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="text-foreground font-medium">Due process.</span>{" "}
          Disagree with the verdict? A borrower can appeal once to a larger,
          independent panel of{" "}
          <span className="text-accent font-medium">{appealSize} underwriters</span>{" "}
          that re-reads the same evidence from scratch — the on-chain equivalent of a
          second opinion.
        </p>
      </div>
    </div>
  );
}

function ExplainStep({
  icon,
  n,
  title,
  body,
}: {
  icon: React.ReactNode;
  n: string;
  title: string;
  body: string;
}) {
  return (
    <li className="rounded-lg border border-hair bg-panel p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="flex items-center justify-center w-6 h-6 rounded-md bg-accent/15 text-accent text-xs font-bold">
          {n}
        </span>
        <span className="text-accent">{icon}</span>
      </div>
      <h3 className="font-semibold text-sm mb-1">{title}</h3>
      <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
    </li>
  );
}
