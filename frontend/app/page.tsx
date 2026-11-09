"use client";

import { useState } from "react";
import {
  FileSearch,
  Sparkles,
  TrendingUp,
  ShieldX,
  Building2,
  Users2,
  Radar,
  ShieldCheck,
  Globe,
  ArrowRight,
} from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { ContractBanner } from "@/components/ContractBanner";
import { ConsensusExplainer } from "@/components/ConsensusExplainer";
import { StatsStrip } from "@/components/StatsStrip";
import { ApplyForm } from "@/components/ApplyForm";
import { AssessmentResult } from "@/components/AssessmentResult";
import { Dashboard } from "@/components/Dashboard";
import { PoolView } from "@/components/PoolView";
import { CreditOracle } from "@/components/CreditOracle";
import { BorrowerDirectory } from "@/components/BorrowerDirectory";
import { AdminPanel } from "@/components/AdminPanel";
import { GovernanceCard } from "@/components/GovernanceCard";
import { CredenceLogo } from "@/components/CredenceLogo";
import type { Borrower } from "@/lib/contracts/types";

export default function HomePage() {
  const [assessed, setAssessed] = useState<Borrower | null>(null);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden">
      <Navbar />

      <main className="flex-grow pt-28 pb-12 px-4 md:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          {/* Hero */}
          <section className="text-center mb-14 md:mb-20 animate-fade-in">
            <div className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 py-1.5 text-sm text-accent mb-6">
              <Sparkles className="w-4 h-4" />
              The Adjudication Layer for the Agentic Economy
            </div>
            <h1 className="text-[2.6rem] leading-[1.03] sm:text-6xl lg:text-7xl font-bold mb-5 tracking-[-0.03em]">
              Credit without
              <br className="hidden sm:block" /> collateral.
              <br />
              <span className="text-gradient">Underwritten by AI consensus.</span>
            </h1>
            <p className="text-base md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Submit your own public evidence of creditworthiness. A panel of AI
              underwriters — running inside the contract, by validator consensus —
              fetches it live, judges it, and sets your line. No bank. No committee.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-3 mt-8">
              <button
                onClick={() => scrollTo("apply")}
                className="btn-primary h-12 px-7 text-base inline-flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                Apply for credit
              </button>
              <button
                onClick={() => scrollTo("pool")}
                className="btn-secondary h-12 px-7 text-base inline-flex items-center gap-2"
              >
                <Building2 className="w-4 h-4" />
                Earn as a lender
              </button>
            </div>

            {/* quick jump + trust row */}
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 mt-8 text-sm">
              <HeroChip icon={<ShieldCheck className="w-4 h-4" />} label="No collateral" />
              <HeroChip icon={<Globe className="w-4 h-4" />} label="Live web evidence" />
              <HeroChip icon={<Users2 className="w-4 h-4" />} label="Validator consensus" />
              <button
                onClick={() => scrollTo("oracle")}
                className="inline-flex items-center gap-1.5 text-accent font-medium hover:gap-2.5 transition-all"
              >
                <Radar className="w-4 h-4" />
                Try the credit oracle
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </section>

          {/* The problem, stated plainly */}
          <div className="mb-10 rounded-2xl border border-accent/25 bg-gradient-to-br from-accent/10 to-[var(--blue)]/5 p-5 md:p-6 animate-rise">
            <div className="flex items-start gap-4">
              <span className="gradient-purple-pink rounded-xl p-2.5 flex text-white shrink-0 shadow-lg shadow-accent/20">
                <ShieldX className="w-6 h-6" />
              </span>
              <div>
                <h2 className="font-bold text-lg mb-1">
                  Every loan in DeFi is over-collateralized. That is the bug.
                </h2>
                <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
                  A deterministic smart contract can&apos;t <em>judge</em> a
                  borrower, so today you must lock up more than you borrow — which
                  shuts out exactly the people and agents who need credit most.
                  Credence closes that gap: it puts a panel of AI underwriters{" "}
                  <span className="text-accent font-medium">inside the contract</span>,
                  and they reach consensus on who is good for it. No ordinary chain
                  can do this. GenLayer can.
                </p>
              </div>
            </div>
          </div>

          {/* Degraded / preview banner */}
          <ContractBanner />

          {/* Three-step flow — the real journey, in plain language */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
            <HowStep
              icon={<FileSearch className="w-5 h-5" />}
              step="1"
              title="Submit your own evidence"
              body="Up to 8 public items: text, a live https URL, or an image. To unlock a real line, add a URL whose page shows your wallet address — that proves it is yours."
            />
            <HowStep
              icon={<Users2 className="w-5 h-5" />}
              step="2"
              title="A panel agrees on a grade"
              body="A panel of AI underwriters each re-reads your live evidence and must agree on one bounded grade — DENY, C, B, A, AA or AAA — or it fails closed to DENY."
            />
            <HowStep
              icon={<TrendingUp className="w-5 h-5" />}
              step="3"
              title="Draw, repay, compound"
              body="Your grade opens an undercollateralized line. Draw, repay on time, and your standing, grade and limit grow — while lenders earn the fees and interest as yield."
            />
          </div>

          {/* Consensus explainer */}
          <div className="mb-10 animate-rise">
            <ConsensusExplainer />
          </div>

          {/* Stats + grade ladder */}
          <div className="mb-10 animate-rise" style={{ animationDelay: "60ms" }}>
            <StatsStrip />
          </div>

          {/* Credit oracle — showcase moment */}
          <div className="mb-10 animate-rise" style={{ animationDelay: "80ms" }}>
            <CreditOracle />
          </div>

          {/* Apply + Assessment */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10 animate-rise">
            <ApplyForm onAssessed={setAssessed} />
            <div>
              <AssessmentResult borrower={assessed} onUpdate={setAssessed} />
            </div>
          </div>

          {/* Dashboard */}
          <div className="mb-10 animate-rise" style={{ animationDelay: "80ms" }}>
            <Dashboard />
          </div>

          {/* Earn / pool */}
          <div className="mb-10 animate-rise" style={{ animationDelay: "120ms" }}>
            <PoolView />
          </div>

          {/* Borrower directory */}
          <div className="mb-10 animate-rise">
            <BorrowerDirectory />
          </div>

          {/* Governance (public trust card) */}
          <div className="mb-10 animate-rise">
            <GovernanceCard />
          </div>

          {/* Admin (owner-gated) */}
          <div className="animate-rise">
            <AdminPanel />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-hair py-6 mt-8">
        <div className="max-w-6xl mx-auto px-4 md:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <CredenceLogo size="sm" />
            <div className="flex flex-wrap items-center justify-center gap-5 text-sm text-muted-foreground">
              <a
                href="https://genlayer.com"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-accent transition-colors"
              >
                Powered by GenLayer
              </a>
              <a
                href="https://studio.genlayer.com"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-accent transition-colors"
              >
                Studio
              </a>
              <a
                href="https://docs.genlayer.com"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-accent transition-colors"
              >
                Docs
              </a>
              <span
                className="font-mono text-xs rounded-md border border-hair bg-panel-2 px-2 py-1"
                title="GenLayer builder referral code"
              >
                ref: JTR01FHP
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function HeroChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <span className="text-accent">{icon}</span>
      {label}
    </span>
  );
}

function HowStep({
  icon,
  step,
  title,
  body,
}: {
  icon: React.ReactNode;
  step: string;
  title: string;
  body: string;
}) {
  return (
    <div className="brand-card brand-card-hover p-5">
      <div className="flex items-center gap-3 mb-2">
        <span className="gradient-purple-pink rounded-xl p-2 flex text-white shadow-md shadow-accent/20">
          {icon}
        </span>
        <span className="text-xs font-bold text-accent uppercase tracking-wider">
          Step {step}
        </span>
      </div>
      <h3 className="font-bold mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}
