# WCAG 2.1 AA Accessibility Audit & Remediation Report

**Target Standard:** WCAG 2.1 Level AA  
**Audited Target:** SupportMe Web Application (`frontend/`)  
**Core Pages Audited:**
1. Landing Page (`/` - `frontend/app/page.jsx`)
2. Creator Profile (`/[username]` - `frontend/app/[username]/CreatorProfileClient.tsx`)
3. Creator Dashboard (`/dashboard` - `frontend/app/dashboard/page.tsx`)
4. Donation & Subscription Flow (`frontend/app/[username]/CreatorProfileClient.tsx`)
5. Account Settings (`/settings` - `frontend/app/settings/page.tsx`)

---

## 1. Executive Summary

An accessibility audit was conducted on SupportMe's core user flows to evaluate compliance with the **Web Content Accessibility Guidelines (WCAG) 2.1 Level AA**. SupportMe features a distinctive neobrutalist aesthetic characterized by hard black/ink borders, saturated flat fills, and offset shadows. While neobrutalism naturally provides strong edge contrast, several specific areas required remediation:

1. **Focus Indicators & Keyboard Operability (WCAG 2.4.7, 2.4.11):** Interactive elements (buttons, inputs) had default focus states suppressed (`outline-none`) or relied purely on small drop shadows, which did not provide adequate visibility or contrast for keyboard-only users.
2. **Landmark Hierarchy & Skip Navigation (WCAG 1.3.1, 2.4.1):** Key pages lacked landmark `<main id="main-content">` wrappers, multiple `<nav>` elements lacked distinguishing accessible labels, and no "Skip to main content" link existed for keyboard and screen reader users.
3. **Contrast Ratios (WCAG 1.4.3):** Subdued helper text (e.g. `text-background/40` on dark ink backgrounds) dipped below the required 4.5:1 contrast threshold for normal body text.
4. **ARIA Attributes & States (WCAG 4.1.2):** Navigation toggles, preset amount buttons, and asset selection tabs lacked explicit ARIA state declarations (`aria-expanded`, `aria-controls`, `aria-pressed`, `aria-label`).

All high-impact and critical findings have been remediated in this branch.

---

## 2. Prioritized Findings & Remediation Matrix

| ID | Category | Severity | Component / Location | Description & WCAG Criterion | Remediation Status |
|---|---|---|---|---|---|
| **A11Y-01** | Focus States | **Critical** | `frontend/app/globals.css` | Focus outlines suppressed (`outline-none`) without distinct `:focus-visible` indicator (WCAG 2.4.7 Focus Visible, 2.4.11 Focus Appearance). | **Resolved**: Added dedicated `:focus-visible` styles with a 3px high-contrast focus ring (`--focus-ring`) and 2px offset across light and dark modes. |
| **A11Y-02** | Keyboard Nav | **High** | `frontend/app/layout.tsx` | Missing skip navigation link (WCAG 2.4.1 Bypass Blocks). Keyboard users had to tab through all header links on every page. | **Resolved**: Added a visible-on-focus "Skip to main content" link targeting `#main-content` at the root of `layout.tsx`. |
| **A11Y-03** | Landmarks | **High** | Core pages (`page.jsx`, `[username]`, `dashboard`, `settings`) | Core application pages lacked `<main id="main-content">` landmark elements (WCAG 1.3.1 Info and Relationships). | **Resolved**: Added `<main id="main-content">` to all core page layouts with appropriate semantic structure. |
| **A11Y-04** | Landmarks & Semantics | **Medium** | `frontend/components/AppNav.tsx`, `page.jsx` | Multiple `<nav>` elements without distinguishing `aria-label`s (WCAG 1.3.1). | **Resolved**: Added `aria-label="Main Navigation"` to top nav, preserved `aria-label="Mobile Bottom Navigation"` on mobile bottom bar. |
| **A11Y-05** | ARIA Controls | **Medium** | `frontend/components/AppNav.tsx` | Mobile menu hamburger button lacked `aria-controls` referencing drawer ID (WCAG 4.1.2 Name, Role, Value). | **Resolved**: Added `aria-controls="mobile-menu-drawer"` and linked drawer element with `id="mobile-menu-drawer"`. |
| **A11Y-06** | Color Contrast | **High** | `frontend/app/page.jsx` | Subdued footer text (`text-background/40` on `bg-ink`) produced a contrast ratio of ~4.1:1, failing WCAG 1.4.3 (4.5:1 minimum). | **Resolved**: Updated opacity to `text-background/70` (~10.8:1 contrast ratio) ensuring full compliance. |
| **A11Y-07** | ARIA States | **Medium** | `frontend/app/[username]/CreatorProfileClient.tsx` | Preset donation buttons (e.g. 5, 10, 25, 50) lacked `aria-pressed` to indicate active selection state (WCAG 4.1.2). | **Resolved**: Added `aria-pressed={donationAmount === preset}` to all preset buttons. |
| **A11Y-08** | ARIA & Labels | **Medium** | `frontend/components/WalletMenu.tsx` | Wallet menu dropdown trigger button lacked explicit accessible label (WCAG 4.1.2). | **Resolved**: Added `aria-label="Wallet menu"` and `aria-expanded` state. |
| **A11Y-09** | Dialog Semantics | **Low** | `frontend/components/ShareModal.tsx` | Modal dialog accessibility verification (WCAG 2.1.2 No Keyboard Trap, 2.4.3 Focus Order). | **Verified**: Verified `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, and `Escape` key listeners are in place. |
| **A11Y-10** | Motion | **Medium** | `frontend/components/Skeleton.tsx`, `frontend/app/[username]/CreatorProfileClient.tsx`, `frontend/app/dashboard/page.tsx`, `frontend/app/globals.css` | Skeleton pulses, status-text pulse and the "load more" spinner looped regardless of the OS reduced-motion setting; only `TipJar` checked it, and only after hydration (WCAG 2.3.3 Animation from Interactions). | **Resolved**: Animations use Tailwind's `motion-safe:` variant; a global `@media (prefers-reduced-motion: reduce)` block stops the tip jar keyframes and makes transitions instant before any JS runs. Under reduced motion skeletons stay dimmed (`motion-reduce:opacity-60`) and their regions are marked `aria-busy="true"`, so loading still reads as loading. |

---

## 3. Color Contrast Verification (WCAG 2.1 AA)

All primary text must meet **4.5:1** for normal text and **3.0:1** for large text (>= 18pt or >= 14pt bold). Non-text UI components and borders must meet **3.0:1**.

| UI Element | Foreground Color | Background Color | Calculated Ratio | WCAG AA Threshold | Status |
|---|---|---|---|---|---|
| **Body text (Light Mode)** | `#0a0a0a` (Near-black) | `#fdfcf7` (Warm paper) | **18.9:1** | 4.5:1 | **PASS** |
| **Body text (Dark Mode)** | `#f4f2ec` (Off-white) | `#161412` (Warm charcoal) | **15.4:1** | 4.5:1 | **PASS** |
| **Muted text (Light Mode)** | `#57534e` (Stone) | `#fdfcf7` (Warm paper) | **6.4:1** | 4.5:1 | **PASS** |
| **Muted text (Dark Mode)** | `#a8a29e` (Stone) | `#161412` (Warm charcoal) | **6.6:1** | 4.5:1 | **PASS** |
| **Primary Button Text** | `#ffffff` (White) | `#7c3aed` (Violet) | **5.7:1** | 4.5:1 | **PASS** |
| **Brand Yellow Badge Text** | `#0a0a0a` (Ink) | `#ffd84d` (Yellow) | **14.2:1** | 4.5:1 | **PASS** |
| **Brand Lime Badge Text** | `#0a0a0a` (Ink) | `#b4f461` (Lime) | **15.8:1** | 4.5:1 | **PASS** |
| **Footer Links (Remediated)** | `#fdfcf7` at 70% | `#0a0a0a` (Ink) | **10.8:1** | 4.5:1 | **PASS** |
| **Focus Ring (Light Mode)** | `#7c3aed` (Violet) | `#fdfcf7` (Warm paper) | **5.7:1** | 3.0:1 | **PASS** |
| **Focus Ring (Dark Mode)** | `#c4b5fd` (Lilac) | `#161412` (Warm charcoal) | **10.5:1** | 3.0:1 | **PASS** |

---

## 4. Keyboard Navigation & Focus Ring Details

### 4.1 Visible Skip Link
Implemented in `frontend/app/layout.tsx`:
```tsx
<a
  href="#main-content"
  className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-brand-yellow focus:text-ink focus:font-extrabold focus:border-2 focus:border-ink focus:shadow-brutal focus:rounded-lg"
>
  Skip to main content
</a>
```
- Completely hidden from sighted users during normal scrolling (`sr-only`).
- Becomes prominently visible upon the very first `Tab` key press (`focus:not-sr-only`).
- Jumps focus directly to `<main id="main-content">` bypassing the navigation bar.

### 4.2 High-Contrast `:focus-visible` System
Implemented in `frontend/app/globals.css`:
```css
:root {
  --focus-ring: #7c3aed;
}

.dark {
  --focus-ring: #c4b5fd;
}

:focus-visible {
  outline: 3px solid var(--focus-ring);
  outline-offset: 2px;
}

.btn-brutal:focus-visible {
  outline: 3px solid var(--focus-ring);
  outline-offset: 3px;
}

.input-brutal:focus-visible {
  outline: 3px solid var(--focus-ring);
  outline-offset: 2px;
  box-shadow: var(--shadow-brutal-sm);
}
```
- Uses `:focus-visible` rather than `:focus` so mouse clicks do not trigger disruptive focus rings, but keyboard `Tab`/arrow-key users receive prominent visual indicators.
- Meets WCAG 2.4.11 (Focus Appearance) with a minimum 3px outline thickness and strong contrast against adjacent backgrounds.

---

## 5. Automated Accessibility Testing

Automated test suites are defined in `frontend/app/__tests__/accessibility.test.tsx` verifying:
1. Presence of "Skip to main content" link with correct `#main-content` target.
2. Proper landmark roles across audited views (`main`, `nav`, `footer`).
3. Distinct accessible names (`aria-label`) on icon-only and interactive buttons.
4. Correct ARIA expanded and controls linkage on collapsible navigation.
5. Presence of `role="alert"` and accessible names on form validation messages.

---

## 6. Reduced Motion Check (WCAG 2.3.3)

Run this check whenever adding an animation, transition or loading state.

**Rules for new code**
- Use `motion-safe:animate-*` (never a bare `animate-*`) for anything that loops: pulses, spins, bounces.
- Give the reduced-motion state a static cue that it is loading (e.g. `motion-reduce:opacity-60` on placeholders, `aria-busy="true"` on the loading region, or visible "Loading…" text).
- Custom keyframes in `app/globals.css` must be covered by the `@media (prefers-reduced-motion: reduce)` block at the end of that file.

**Manual check**
1. Turn on reduced motion: macOS *System Settings → Accessibility → Display → Reduce motion*; Windows *Settings → Accessibility → Visual effects → Animation effects* off; or Chrome DevTools *Rendering → Emulate CSS media feature prefers-reduced-motion: reduce*.
2. Load `/[username]` (profile skeleton and donation status), `/dashboard` (dashboard skeleton, "Loading older donations…" spinner), `/activity`, and any page that shows the tip jar loader.
3. Confirm that nothing pulses, spins or slides, and that loading placeholders are still clearly different from loaded content.

**Automated coverage**
- `frontend/components/__tests__/Skeleton.test.tsx` checks that skeletons only animate behind `motion-safe:`, dim under `motion-reduce:`, and mark their region `aria-busy`.
- `frontend/e2e/reduced-motion.spec.ts` uses `page.emulateMedia({ reducedMotion: 'reduce' })` to check that the profile skeleton has no running animation, and that it still pulses when motion is allowed.

