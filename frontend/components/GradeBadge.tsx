"use client";

import { ShieldCheck, ShieldX, Clock } from "lucide-react";
import type { Grade } from "@/lib/contracts/types";
import { GRADE_TOKENS } from "@/lib/contracts/types";
import { GRADE_STYLES } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

/**
 * A colored pill for a bounded credit grade (DENY / C / B / A / AA / AAA),
 * optionally with the line it unlocks. Shared across the assessment result,
 * dashboard and grade-ladder strip so a grade always reads the same way.
 *
 * An empty grade ("") — a borrower still being assessed — renders as a neutral
 * "pending" pill rather than a (misleading) red DENY.
 */
export function GradeBadge({
  grade,
  size = "md",
  showLine = false,
  className,
}: {
  grade: Grade | "";
  size?: "sm" | "md" | "lg";
  showLine?: boolean;
  className?: string;
}) {
  const sizing =
    size === "lg"
      ? "text-2xl px-4 py-1.5 gap-2"
      : size === "sm"
        ? "text-xs px-2 py-0.5 gap-1"
        : "text-sm px-3 py-1 gap-1.5";
  const iconSize = size === "lg" ? "w-5 h-5" : "w-3.5 h-3.5";

  // Pending: no grade yet (assessing / not-yet-underwritten).
  if (!grade || !(grade in GRADE_STYLES)) {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full border font-bold tabular-nums ring-1 border-hair bg-panel text-muted-foreground ring-transparent",
          sizing,
          className
        )}
        title="Pending — not yet assessed"
      >
        <Clock className={iconSize} />
        <span>Pending</span>
        {showLine && <span className="font-medium opacity-80">· no line</span>}
      </span>
    );
  }

  const g = grade as Grade;
  const s = GRADE_STYLES[g];
  const isDeny = g === "DENY";

  return (
    <span
      className={cn(
        "grade-pill inline-flex items-center rounded-full border font-bold tabular-nums ring-1 transition-transform duration-200 hover:scale-[1.04]",
        s.bg,
        s.text,
        s.border,
        s.ring,
        sizing,
        className
      )}
      title={`${g} — ${s.label}`}
    >
      {isDeny ? (
        <ShieldX className={iconSize} />
      ) : (
        <ShieldCheck className={iconSize} />
      )}
      {g}
      {showLine && !isDeny && (
        <span className="font-medium opacity-80">
          · {GRADE_TOKENS[g].toLocaleString()} tokens
        </span>
      )}
      {showLine && isDeny && <span className="font-medium opacity-80">· no line</span>}
    </span>
  );
}
