# Credence — Brand Guide

> Credit the chain can underwrite. **#CreditWithoutCollateral**

This is the single source of truth for the Credence visual identity: the mark, the
palette, the type scale, the voice, and where every asset lives. It documents and
*elevates* the aesthetic already shipping in `frontend/` — the GenLayer dark "keynote"
theme (black/navy) with a purple-to-pink brand gradient — it does not replace it.

All color tokens below are **defined in OKLCH in `frontend/app/globals.css`** — that
file is the runtime source of truth. The hex values here are sRGB-clamped
approximations of those tokens for use in static SVG, print, and tools that do not
speak OKLCH. When they disagree, `globals.css` wins.

---

## 1. The mark

Credence's mark is a **shield** (underwriting, trust, "good for it") enclosing an
**upward credit curve** with an arrowhead (a line that rises — credit extended and
earned). It sits on the signature purple-to-pink gradient chip. The geometry is shared
byte-for-byte with the in-app React component (`frontend/components/CredenceLogo.tsx`),
so the brand files and the product never drift.

### Assets

| Asset | File | Use |
|---|---|---|
| App mark (chip) | `brand/logo.svg` (64x64) | Avatars, app icon, square placements, favicons |
| Wordmark lockup | `brand/wordmark.svg` (248x56) | Headers, docs, README, email signatures |
| Favicon | `brand/favicon.svg` (32x32) | Browser tab / PWA (heavier stroke for small sizes) |
| Social card | `brand/og-image.svg` (1200x630) | Open Graph / Twitter / link unfurls |
| Architecture diagram | `brand/architecture.svg` (960x600) | Four-contract topology |
| Borrower-journey diagram | `brand/flow.svg` (1060x460) | The borrow -> grade -> line -> compound loop |

### Construction

- **Chip:** a squircle (`rx` ~= 22% of side) filled with the brand gradient
  (Purple -> Pink, 135deg). The glyph is white, `stroke-width` 1.75 in 24-unit glyph
  space, round caps and joins.
- **Wordmark:** "Cred" in the theme ink (`currentColor`, so it inherits the host's
  text color and is correct on light **and** dark), "ence" in brand purple `#9B6AF6`.
  Typeface Switzer Bold, letter-spacing -0.02em. Chip to the left, optically centered.

### Clear space and minimum size

- **Clear space:** keep at least the height of the chip's corner radius (about 1/4 of
  the chip) clear on all sides. Nothing crowds the mark.
- **Minimum size:** chip 20px; wordmark 120px wide. Below that, use `favicon.svg`.

### Logo do / don't

- **Do** put the gradient chip on any background — it is self-contained and legible on
  black, white, and photos.
- **Do** let the wordmark's "Cred" ride `currentColor` so it adapts to the surface.
- **Don't** recolor the gradient, add a drop shadow/outline to the glyph, rotate or
  skew the chip, or stretch the lockup non-uniformly.
- **Don't** place the white glyph on a light flat fill without the gradient chip behind
  it (it disappears). Use the chip, always.
- **Don't** substitute the GenLayer origami mark for the Credence shield (see Gem 1).

---

## 2. Color

### 2.1 Signature gradients

The brand gradient is **its own pair of stops** — not equal to any single token — and
should be treated as a named asset. It is the most recognizable element of the identity
(logo chip, primary button, accents).

| Name | Stops (OKLCH) | Stops (hex) | Angle |
|---|---|---|---|
| **Credence Purple -> Pink** (signature) | `oklch(0.62 0.24 300)` -> `oklch(0.72 0.19 330)` | `#A053FD` -> `#E472DC` | 135deg |
| Purple -> Blue | `oklch(0.62 0.24 300)` -> `oklch(0.55 0.30 265)` | `#A053FD` -> `#194BFF` | 135deg |
| Text gradient (headlines) | accent -> pink -> blue | `#BE85F9` -> `#E472DC` -> `#7E8CFF` | ~100deg |

CSS classes that ship these: `.gradient-purple-pink`, `.gradient-purple-blue`,
`.text-gradient`, `.btn-primary` (globals.css).

### 2.2 Semantic tokens (name -> hex, light + dark)

Every value is an sRGB approximation of the OKLCH token in `globals.css`. Dark is the
default "keynote" theme; light is the opt-in.

| Token | Light (hex) | Dark (hex) | Role |
|---|---|---|---|
| `--background` | `#FCFBFE` | `#000000` | Page base (dark adds a black->navy vertical wash) |
| `--foreground` | `#1B1B2B` | `#F8F8F8` | Primary text |
| `--primary` | `#8A3EE0` | `#A664FE` | Primary action purple |
| `--accent` | `#8A3EE0` | `#BE85F9` | Accent / links / active |
| `--blue` | `#194AFF` | `#1416FF`* | Secondary brand blue |
| `--pink` | `#DD6CD6` | `#F689ED` | Gradient terminus / highlight |
| `--muted-foreground` | `#595966` | `#9797A5` | Secondary text, captions |
| `--card` | `#FFFFFF` | `#0E1E47`* | Card surface (dark card is a navy gradient to `#050C1E`) |
| `--muted` / `--secondary` | `#F1F1F8` | `#091123` | Quiet fills |
| `--border` / `--hairline` | `#D6D6DF` | white @ ~10% alpha | Hairlines, dividers |
| `--destructive` | `#E31029` | `#FF2335` | Errors, DENY, danger |
| Brand theme color | `#9B6AF6` | `#9B6AF6` | `theme_color` / PWA / theme-safe accent |

\* These dark tokens use chroma beyond the sRGB gamut in OKLCH; the hex is a clamp.
Trust `globals.css` for the on-screen color and use `#9B6AF6` whenever you need one
purple that is readable on **both** black and white (it is the manifest `theme_color`
and the accent used in the standalone brand SVGs).

### 2.3 The grade ladder

A recurring product motif worth standardizing — the six-value credit grade, weakest to
strongest, rendered as pills with rising purple intensity and `AAA` on the full brand
gradient:

`DENY` (muted/`--destructive`) · `C` · `B` · `A` · `AA` · `AAA` (gradient).

Used in `brand/og-image.svg` and `brand/flow.svg`; mirror it in any grade UI.

### Color do / don't

- **Do** author in OKLCH tokens in the app; use the hex table only for static assets.
- **Do** reserve `--destructive` red for genuine danger/DENY, never for decoration.
- **Don't** introduce purples outside this set; the identity is one gradient, one
  accent. Don't pair purple with a competing saturated hue (teal/orange) in brand art.

---

## 3. Typography

**Typeface: Switzer** (self-hosted woff2, `frontend/public/fonts/`). A geometric
grotesque; modern, financial, calm. Fallback stack:
`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif`.

Loaded weights: **300 Light**, **400 Regular**, **700 Bold** (see Gem 5 re: 500/600).

| Role | Spec |
|---|---|
| Hero display (H1) | 2.6rem -> 6xl -> 7xl, weight 700, tracking -0.03em, line-height 1.03 |
| Headings (H1-H6) | weight 700, tracking -0.02em, line-height 1.1 |
| Body | 1rem / 1.25rem, weight 400, `--muted-foreground` for secondary, relaxed leading |
| Eyebrow / label | 0.875rem, uppercase, tracking wider, weight 700, `--accent` |
| Numeric / code / addresses | monospace (`ui-monospace, Menlo, Consolas, monospace`) |

Font features enabled on `body`: `'rlig' 1, 'calt' 1, 'ss01' 1`, antialiased.

### Type do / don't

- **Do** set headings tight (negative tracking) and body relaxed — the established
  rhythm.
- **Don't** use Switzer below 11px for long text; **don't** center long body copy.

---

## 4. Voice and tone

Credence sells trust in a domain full of hype. The voice is **confident, precise, and
honest about mechanics** — a senior credit officer who ships code.

- **Plainspoken, not salesy.** "No bank. No committee." Short declaratives. State the
  mechanism, then the benefit.
- **Technically honest.** Name the real design: "Consensus is on the *grade*, not the
  bytes." "Fails closed to DENY." Never overclaim; the credibility *is* the product.
- **Builder-to-builder.** Forkable, composable, documented. Invite reuse.
- **Signature lines:** "Credit without collateral." / "Underwritten by AI consensus." /
  "Credit the chain can underwrite." / Hashtag **#CreditWithoutCollateral**.

Do say: undercollateralized, consensus, evidence, grade, line, standing, compound,
fail closed. Avoid: "guaranteed," "risk-free," "trustless lending," hype adjectives.

---

## 5. Asset manifest

| Path | What |
|---|---|
| `brand/logo.svg` | Square mark (gradient chip + white shield/curve glyph) |
| `brand/wordmark.svg` | Horizontal lockup (mark + "Credence", `currentColor`-safe) |
| `brand/favicon.svg` | 32px favicon (heavier stroke); **recommended tab/PWA icon** |
| `brand/og-image.svg` | 1200x630 social card |
| `brand/architecture.svg` | Four-contract topology (sync `.view()` vs async `emit`) |
| `brand/flow.svg` | Borrower journey (evidence -> consensus grade -> line -> compound) |
| `frontend/public/og-image.svg` | Deployed copy the site metadata points at |
| `frontend/app/globals.css` | OKLCH token source of truth + brand utility classes |
| `frontend/components/CredenceLogo.tsx` | The in-app mark (shares the glyph geometry) |

All SVGs are valid, standalone-renderable, and theme-safe: the diagrams and the
wordmark use `currentColor` for ink (so they adapt to the host surface) with `#9B6AF6`
for flow accents; the logo/favicon/OG carry their own gradient and are background-
independent. Verified by headless render in both light and dark.

---

## 6. Gems found (and what was done)

Things the audit surfaced while building this kit:

1. **The favicon was GenLayer's logo, not Credence's.** `frontend/public/favicon.svg`
   is the GenLayer origami mark, so the browser tab and PWA icon showed GenLayer's
   identity, not the product's shield. **Fix provided:** `brand/favicon.svg` (the
   Credence mark). Swap it in with one line — copy it to `frontend/public/favicon.svg`.
   (Left in place rather than overwritten, in case the GenLayer tab icon was deliberate;
   recommend the swap.)

2. **There was no Open Graph / social image at all.** `layout.tsx` had `title` +
   `description` but no `openGraph`/`twitter` metadata, so sharing the link produced a
   blank unfurl. **Fixed:** `brand/og-image.svg` created and copied to
   `frontend/public/og-image.svg`; `openGraph` + `twitter` (`summary_large_image`) +
   `metadataBase` wired into `frontend/app/layout.tsx`. Build re-verified (`tsc` and
   `next build` both exit 0).

3. **SVG Open Graph images do not unfurl everywhere.** X/Twitter, Facebook, LinkedIn,
   Slack and iMessage generally will **not** rasterize an SVG `og:image` (Discord and
   Telegram do). The SVG is wired as the spec asked and is production-correct as a
   source. **For universal previews, rasterize it to PNG once** and point the metadata
   at `og-image.png`:
   `chrome --headless=new --screenshot=og-image.png --window-size=1200,630 og-image.svg`
   (or `resvg og-image.svg og-image.png`, or `sharp`). Then set the `images` url to
   `/og-image.png`.

4. **`metadataBase` was unset.** Next.js then warns and resolves absolute OG URLs
   against `localhost`. **Fixed:** `metadataBase` now reads `NEXT_PUBLIC_SITE_URL`
   (fallback `http://localhost:3000`). Set `NEXT_PUBLIC_SITE_URL` to the production
   origin at deploy so the social card resolves to an absolute URL.

5. **Accessibility: the keyboard focus ring is removed.** `globals.css` has
   `:focus-visible { outline: none; }` under a comment that reads "Consistent, visible
   focus for keyboard users across themes" — but nothing replaces the outline, so
   keyboard focus is effectively invisible (WCAG 2.4.7 regression). **Recommend**
   restoring a visible ring, e.g. `:focus-visible { outline: 2px solid var(--ring);
   outline-offset: 2px; border-radius: inherit; }`. (Not changed here — outside the
   build-safe OG edit, and it is a design decision for the app owner.)

6. **Font weights 500/600 are used but not loaded.** `.btn-primary` (`font-weight:600`)
   and `font-medium`/`font-semibold` utilities are used, but only Switzer 300/400/700
   are `@font-face`'d — browsers synthesize those weights. **Recommend** adding
   `Switzer-Medium.woff2` / `Switzer-Semibold.woff2` for crisper mid weights, or
   standardizing on 400/700.

7. **The "credit rising inside a shield" motif is strong — standardize it.** The
   upward-arrow curve under the shield reads as "credit extended under protection." It
   is reused as the subtle watermark in `og-image.svg`. Pair it with the grade ladder
   (Gem in 2.3) as the two canonical Credence motifs.

8. **Minor token hygiene.** `.gradient-purple-pink` and `.btn-primary` hardcode
   `oklch(0.62 0.24 300)/oklch(0.72 0.19 330)` inline rather than referencing a shared
   `--grad-*` custom property. Harmless, but promoting the signature gradient to named
   tokens (`--brand-grad-from` / `--brand-grad-to`) would prevent future drift.

---

*Credence is built on GenLayer. New to GenLayer? Sign up with referral code
**`JTR01FHP`**. #CreditWithoutCollateral*
