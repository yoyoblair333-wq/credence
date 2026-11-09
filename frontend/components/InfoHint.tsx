"use client";

import { useId } from "react";
import { HelpCircle } from "lucide-react";

/**
 * A small, dependency-free, accessible "explain this" affordance.
 *
 * Renders an info icon that reveals a one-line, plain-language explanation on
 * hover AND on keyboard focus (so a newcomer never meets unexplained jargon).
 * The tooltip is clamped to the viewport width and opens above by default; the
 * page wrapper clips horizontal overflow, so a hint near an edge never produces
 * a horizontal scrollbar. Honors prefers-reduced-motion via the global CSS.
 */
export function InfoHint({
  label,
  children,
  side = "top",
  className = "",
}: {
  /** Accessible name for the trigger, e.g. "What is standing?". */
  label: string;
  /** The plain-language explanation shown in the tooltip. */
  children: React.ReactNode;
  side?: "top" | "bottom";
  className?: string;
}) {
  const id = useId();
  return (
    <span className={`relative inline-flex group align-middle ${className}`}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        className="inline-flex items-center justify-center text-muted-foreground/70 hover:text-accent focus-visible:text-accent transition-colors rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        // Allow tap-to-toggle on touch by letting focus drive visibility; a tap
        // focuses the button and reveals the tooltip, a second tap blurs it.
        onClick={(e) => e.preventDefault()}
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>
      <span
        role="tooltip"
        id={id}
        className={[
          "pointer-events-none absolute left-1/2 -translate-x-1/2 z-50",
          side === "top" ? "bottom-full mb-2" : "top-full mt-2",
          "w-max max-w-[min(18rem,78vw)] rounded-lg border border-hair-strong bg-popover text-popover-foreground",
          "px-3 py-2 text-xs font-normal leading-relaxed normal-case tracking-normal text-left",
          "shadow-xl opacity-0 translate-y-0.5 transition-all duration-150",
          "group-hover:opacity-100 group-hover:translate-y-0",
          "group-focus-within:opacity-100 group-focus-within:translate-y-0",
        ].join(" ")}
      >
        {children}
      </span>
    </span>
  );
}
