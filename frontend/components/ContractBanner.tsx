"use client";

import { Eye } from "lucide-react";
import { useIsDemoMode } from "@/lib/hooks/useCredence";

/**
 * Graceful-degradation banner. When no contract address is configured, Credence
 * runs as a fully interactive read-only PREVIEW: every panel shows
 * representative data and the apply flow simulates a consensus assessment
 * locally. This banner makes the preview status unmistakable rather than
 * inventing an address or failing silently.
 */
export function ContractBanner() {
  const demo = useIsDemoMode();
  if (!demo) return null;

  return (
    <div
      role="status"
      className="mb-8 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4"
    >
      <div className="flex items-start gap-3">
        <Eye className="w-5 h-5 text-yellow-400 mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p className="font-semibold text-yellow-700 dark:text-yellow-300">
            Preview mode — no contract configured
          </p>
          <p className="text-sm text-foreground/80 leading-relaxed">
            No Credence contract address is set, so the app is running on
            representative sample data and simulates underwriting locally — it
            moves no real value and never hits a chain. Everything below shows
            exactly how the protocol behaves. To go live, deploy{" "}
            <span className="font-mono text-xs">credence.py</span> and set{" "}
            <code className="font-mono text-xs bg-panel-2 border border-hair rounded px-1.5 py-0.5 text-yellow-800 dark:text-yellow-200">
              NEXT_PUBLIC_CREDENCE_CONTRACT_ADDRESS
            </code>{" "}
            in your <span className="font-mono text-xs">.env</span> to the
            deployed address, then reload.
          </p>
        </div>
      </div>
    </div>
  );
}
