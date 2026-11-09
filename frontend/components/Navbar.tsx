"use client";

import { useState, useEffect } from "react";
import { AccountPanel } from "./AccountPanel";
import { CredenceLogo } from "./CredenceLogo";
import { ThemeToggle } from "./ThemeToggle";

/**
 * Fixed, glassy navbar. On scroll it condenses into a rounded floating bar.
 * The surface is theme-aware (tokens --nav-bg / --nav-border via .brand-navbar),
 * so it reads correctly in both light and dark.
 */
export function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY;
      const threshold = 80;
      setIsScrolled(scrollY > 20);
      const progress = Math.min(Math.max((scrollY - 10) / threshold, 0), 1);
      setScrollProgress(progress);
    };
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const paddingTop = Math.round(scrollProgress * 14);

  const getBorderRadius = () => {
    if (typeof window !== "undefined" && window.innerWidth >= 768) {
      return Math.round(scrollProgress * 9999);
    }
    return 0;
  };
  const borderRadius = getBorderRadius();

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 transition-all duration-500 ease-out"
      style={{ paddingTop: `${paddingTop}px` }}
    >
      <div
        className="transition-all duration-500 ease-out mx-auto"
        style={{
          width: "100%",
          maxWidth: isScrolled ? "72rem" : "100%",
          borderRadius: `${borderRadius}px`,
        }}
      >
        <div
          className="brand-navbar border transition-all duration-500 ease-out md:rounded-none"
          style={{
            borderRadius: `${borderRadius}px`,
            borderWidth: "1px",
            borderLeftWidth: isScrolled ? "1px" : "0px",
            borderRightWidth: isScrolled ? "1px" : "0px",
            borderTopWidth: isScrolled ? "1px" : "0px",
            boxShadow: isScrolled
              ? "0 20px 48px -24px rgba(0,0,0,0.45)"
              : "none",
          }}
        >
          <div className="px-4 sm:px-6 transition-all duration-500 mx-auto w-full max-w-[112rem]">
            <div className="flex items-center justify-between h-16">
              {/* Left: brand */}
              <div className="flex items-center gap-3">
                <CredenceLogo size="md" />
              </div>

              {/* Center: tagline */}
              <div className="hidden lg:block text-sm text-muted-foreground">
                Undercollateralized credit, underwritten by AI consensus
              </div>

              {/* Right: theme + wallet */}
              <div className="flex items-center gap-2 sm:gap-3">
                <ThemeToggle />
                <AccountPanel />
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
