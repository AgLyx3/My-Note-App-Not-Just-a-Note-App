# Mobile UI Design Spec: AI-Assisted Note Collection

## Scope
- Product: AI-assisted note collection app
- Platforms: iOS and Android
- Mode: UI-first, non-chat
- Source: `docs/plans/2026-03-20-ai-assisted-note-collection-prd.md`

## Design Goals
- Keep capture-to-placement flow fast and predictable.
- Keep decisions lightweight (3-5 options, one-tap selection).
- Keep correction faster than initial placement (undo + move).
- Make active collections visible so search is secondary.

## UX Approach (Recommended)
Use a hybrid mobile flow:
- Full-screen capture composer for input comfort.
- One consistent quick review bottom sheet for all placement decisions.
- Optimistic placement feedback (toast/snackbar), then feed bump.

Rationale:
- Better text readability than cramped sheet-only capture, while still allowing links inline.
- Preserves one decision surface for trust and repeat behavior.
- Aligns with <=2 tap post-input placement target.

## Information Architecture
- `Collection`: persistent topic container.
- `Entry`: captured text or image (links are part of text capture and enriched by backend).
- `Home`: active collection feed sorted by recency + relevance.

## End-to-End Flow
1. User taps Capture from Home.
2. User captures in one of two formats: Text or Image.
3. User submits capture from composer.
4. Review sheet opens with AI-ranked placement options.
5. User confirms suggested collection, selects alternative, or creates new collection.
6. App places entry, bumps target collection in Home feed.
7. App shows Undo action.
8. User can later Move entry from collection detail.

## Screen Specs

### 1) Home Feed (Primary Screen)
Purpose:
- Show active collections and current work context.

Structure:
- Header: app title + tertiary search icon.
- Primary content: vertically stacked collection cards.
- Persistent primary action: Capture button (bottom anchored).

Collection card content:
- Collection name
- Last updated time
- 1-2 recent entry previews (text/image thumb)
- Optional activity indicator

Interaction:
- Tap card -> open collection detail.
- Capture is always one tap from Home.

States:
- Loading: 3-5 skeleton cards.
- Empty: "Capture your first note" primary CTA.
- Error: inline retry banner.

### 2) Capture Entry
Purpose:
- Fast input with minimal friction.

Structure:
- Top bar: Back + "New capture".
- Type switcher: Text / Image.
- Input area:
  - Text: multiline field (supports pasted links)
  - Image: preview + replace action
- Bottom primary button: Continue

Behavior:
- Continue disabled until minimal valid input exists.
- Use input-type-appropriate keyboard where relevant.
- Preserve in-progress draft if interrupted.

States:
- Link-enrichment preview skeleton (for pasted URLs in text).
- Offline banner with queued state.
- Permission failure inline guidance for image capture.

### 3) Quick Review Sheet (Core Decision Surface)
Purpose:
- Confirm or correct AI placement before final save.

Structure:
- Sheet title: "Place in collection"
- Capture preview summary (collapsed by default)
- Top suggestion row with confidence label
- 2-4 alternative collection rows
- "Create new collection" as peer-level option
- Primary CTA: Confirm

Confidence behavior:
- High: top suggestion preselected.
- Medium: top preselected, create-new equally visible.
- Low: create-new highlighted or preselected.

Create-new behavior:
- Inline expand single name field (prefilled suggestion).
- No extra modal chain.

States:
- AI loading skeleton rows
- AI failure fallback: recents + create-new + retry

### 4) Collection Detail
Purpose:
- Browse entries in one collection and recover misplacements.

Structure:
- Header: Back + collection name + overflow menu.
- Entry list: newest first.
- Entry actions via overflow: Move (primary recovery), optional delete/share.

Recovery:
- Move opens same review sheet pattern with "Move to..." title.
- Keep flow consistent with placement sheet.

States:
- Empty collection with capture CTA.
- Loading skeleton list.
- Inline error + retry.

## Visual Direction
- Style: clean minimal interface with high legibility.
- Tone: calm utility, not playful chat assistant.
- Motion: subtle, 150-300ms transitions.

## Design Tokens (V1)
- Color:
  - Primary: `#2563EB`
  - Accent/CTA: `#F97316`
  - Background: `#F8FAFC`
  - Surface text: `#1E293B`
  - Success: `#16A34A`
  - Warning/uncertain confidence: `#D97706`
- Typography:
  - Family: Atkinson Hyperlegible
  - Body minimum: 16px equivalent on mobile
  - Body line-height: 1.5-1.7
- Radius:
  - Cards/buttons: medium rounded corners
- Elevation:
  - Review sheet elevated above feed with clear separation

## Confidence Indicator Pattern
- Never color-only.
- Show qualitative label:
  - "Likely match"
  - "Possible match"
  - "Uncertain"
- Optional subtle icon/dot + accessible text label.

## Accessibility Requirements (Non-Negotiable)
- Touch targets >= 44x44 (or 48x48 dp equivalent).
- Contrast >= 4.5:1 for normal text.
- Visible focus states for keyboard/switch access.
- Screen reader labels for icon-only controls.
- Selected state announced in review sheet options.
- Reduced-motion mode respected.
- Errors announced near fields and actionable.

## Interaction Rules
- Use tap/press, not hover-dependent interactions.
- Disable primary CTA while async confirm is in progress.
- Show clear inline loading and success feedback.
- Avoid nested modals and deep prompt chains.

## KPI Instrumentation Hooks
- Capture-to-placement latency
- Suggested-option acceptance rate
- Undo usage rate
- Move usage rate
- Sessions completed without search

## Founder Dogfooding Test Plan (7 Days)
- Daily: 10-15 captures across text/image, including mixed text+URL notes.
- Log:
  - Type of capture
  - Suggested option accepted (yes/no)
  - Taps from input complete to placement confirm
  - Undo/Move used
  - Search used (yes/no)
- Success targets:
  - Median <=2 taps post-input to placement confirm
  - >=70% acceptable top suggestion
  - Lower search dependency over days

## Design System Artifacts Generated
- `design-system/ai-note-collection/MASTER.md`
- `design-system/ai-note-collection/pages/home-feed.md`
- `design-system/ai-note-collection/pages/capture-entry.md`
- `design-system/ai-note-collection/pages/review-sheet.md`
- `design-system/ai-note-collection/pages/collection-detail.md`

Note:
- Use this document as the canonical mobile product UX spec for MVP.
- Generated per-page design-system files can be treated as optional supporting references.
