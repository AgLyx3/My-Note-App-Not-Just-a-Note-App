# Review Sheet Page Overrides

> **PROJECT:** AI Note Collection
> **Generated:** 2026-03-20 01:41:31
> **Page Type:** General

> ⚠️ **IMPORTANT:** Rules in this file **override** the Master file (`design-system/MASTER.md`).
> Only deviations from the Master are documented here. For all other rules, refer to the Master.

---

## Page-Specific Rules

### Layout Overrides

- **Max Width:** 1200px (standard)
- **Layout:** Full-width sections, centered content
- **Sections:** 1. Hero (product + aggregate rating), 2. Rating breakdown, 3. Individual reviews, 4. Buy/CTA

### Spacing Overrides

- No overrides — use Master spacing

### Typography Overrides

- No overrides — use Master typography

### Color Overrides

- **Strategy:** Trust colors. Star ratings gold. Verified badge green. Review sentiment colors.

### Component Overrides

- Avoid: Expect z-index to work across contexts
- Avoid: Default keyboard for all inputs
- Avoid: Desktop-first causing mobile issues

---

## Page-Specific Components

- No unique components for this page

---

## Recommendations

- Effects: Testimonial carousel animations, logo grid fade-in, stat counter animations (number count-up), review star ratings
- Layout: Understand what creates new stacking context
- Forms: Use inputmode attribute
- Responsive: Start with mobile styles then add breakpoints
- CTA Placement: After reviews summary + Buy button alongside reviews
