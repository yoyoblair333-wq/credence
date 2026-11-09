/**
 * Credence brand mark — a shield (trust / underwriting) enclosing an upward
 * credit curve. Pairs with the GenLayer wordmark/footer to signal "powered by
 * GenLayer".
 */
import React from "react";

export type LogoSize = "sm" | "md" | "lg";

const sizeMap: Record<LogoSize, { mark: string; text: string }> = {
  sm: { mark: "w-6 h-6", text: "text-base" },
  md: { mark: "w-8 h-8", text: "text-xl" },
  lg: { mark: "w-10 h-10", text: "text-2xl" },
};

function CredenceMarkGlyph({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-label="Credence"
    >
      {/* shield */}
      <path d="M12 2.5 4.5 5.2v6.1c0 4.6 3.1 8.2 7.5 10.2 4.4-2 7.5-5.6 7.5-10.2V5.2L12 2.5Z" />
      {/* upward credit curve */}
      <path d="M8 14.5 10.7 11l2.1 2 3.2-4" />
      <path d="M14.4 9h1.6v1.6" />
    </svg>
  );
}

export function CredenceLogo({
  size = "md",
  showWordmark = true,
  className = "",
}: {
  size?: LogoSize;
  showWordmark?: boolean;
  className?: string;
}) {
  const { mark, text } = sizeMap[size];
  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <span className="gradient-purple-pink rounded-lg p-1.5 flex items-center justify-center">
        <CredenceMarkGlyph className={`${mark} text-white`} />
      </span>
      {showWordmark && (
        <span
          className={`${text} font-bold text-foreground font-[family-name:var(--font-display)]`}
          style={{ letterSpacing: "-0.02em" }}
        >
          Cred<span className="text-accent">ence</span>
        </span>
      )}
    </div>
  );
}

export function CredenceMark(props: { size?: LogoSize; className?: string }) {
  return <CredenceLogo {...props} showWordmark={false} />;
}
