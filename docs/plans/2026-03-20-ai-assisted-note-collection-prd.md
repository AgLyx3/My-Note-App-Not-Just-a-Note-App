# PRD: AI-Assisted Note Collection (UI-First, Non-Chat)

## Document Control
- Date: 2026-03-20
- Product: AI-assisted note collection app (iOS + Android)
- Stage: Pre-MVP / Founder validation
- Author: Founder draft (simulated execution)

## 1) Product Summary
This product helps people capture random thoughts and images, then places each item into the right living collection with minimal effort. Links and posts are captured in text form and enriched by the backend when useful. The app is not chat-first. It is UI-first, with a confidence-guided review sheet that lets users confirm placement in one tap, pick another collection, or create a new collection.

Core promise: users should always see what they are actively working on without relying on search.

## 2) Problem Statement
General consumers, especially users with high-context switching and ADHD-style brain dump behavior, capture many small ideas but struggle to organize and retrieve them later. Existing note tools often create organization debt (folders/tags/search burden), leading to lost context and frustration.

## 3) Target User and Scope
- Primary user segment: general consumers (not professional team workflow)
- Primary behavior: random thought capture throughout the day
- In-scope capture types (V1): text and images (URLs included in text input)
- Platform scope (V1): iOS and Android

## 4) Product Decisions Made
1. **Interaction model**
   - UI-first, not chat assistant.
   - No required natural-language prompting to organize.
2. **Core information model**
   - `Collection`: persistent topic container.
   - `Entry`: individual captured item.
3. **Home model**
   - Home is an active collection feed/gallery, not search-first inbox.
   - Recently updated collections rise to top (forum reply bump behavior).
4. **Placement model**
   - New capture always goes through a quick review sheet (default preference selected by founder).
   - Review sheet includes:
     - top AI match with confidence
     - ranked alternatives
     - always-visible "Create new collection"
5. **Confidence behavior**
   - High confidence: review sheet still shown, top choice preselected.
   - Medium confidence: show top options + create-new as peer option.
   - Low confidence: create-new is highlighted by default.
6. **Recovery model**
   - Undo after placement.
   - Move entry to another collection in one quick action.
7. **Search stance**
   - Search is not the primary workflow.
   - Feed ranking and collection visibility should reduce search dependence.

## 5) UX Requirements (V1)
### 5.1 Primary Screens
- Home feed (collection cards sorted by activity and relevance)
- Capture entry point
- Quick review sheet
- Collection detail screen

### 5.2 Quick Review Sheet Requirements
- Must show top suggested collection and confidence indicator
- Must provide alternative existing collections
- Must provide "Create new collection" as first-class action
- Should prefill suggested name for new collection
- Must require minimal typing (rename optional)

### 5.3 Cognitive Load Constraints
- Keep decision options low (3-5 visible options)
- Prefer one-tap actions
- Avoid modal chains and verbose prompts
- Keep correction path faster than initial placement when possible

## 6) Functional Requirements (V1)
1. User can capture text note quickly.
2. User can capture text and paste link/social URLs directly in the same input.
3. User can capture/import images.
4. System computes ranked collection suggestions with confidence score.
5. System shows review sheet before final placement.
6. User can select suggested collection, select another collection, or create new collection.
7. Confirmed placement updates collection and bumps it in feed.
8. User can undo last placement action.
9. User can move entry to another collection from entry actions.

## 7) Non-Functional Requirements (V1)
- Fast perceived response for capture -> review flow
- Stable mobile UX on iOS/Android
- Graceful handling of uncertain classification
- Offline-safe capture queue is preferred when feasible

## 8) Ranking and Placement Logic (Product Level)
- Feed rank should prioritize:
  - recent confirmed updates
  - current interaction recency
  - unresolved/fresh entries (if used)
- Placement suggestion should prioritize:
  - semantic similarity to collection context
  - recency bias for actively edited collections
  - user correction history

## 9) Metrics and Success Criteria
Primary KPI candidates:
- First-choice acceptance rate (suggested collection accepted)
- Misplacement correction rate within 24h
- Median capture-to-placement time
- Sessions completed without search
- Weekly active collections viewed/updated

Pre-MVP validation gates:
- >= 70% acceptable suggestion acceptance on synthetic and founder data
- <= 2 taps median from capture to final placement decision
- Strong evidence that active feed reduces search reliance

## 10) Risks and Mitigations
1. **Risk:** Low trust from wrong routing
   - **Mitigation:** review sheet default + undo + quick move
2. **Risk:** Feed becomes noisy
   - **Mitigation:** constrained ranking signals and card clarity
3. **Risk:** Too many choices during capture
   - **Mitigation:** strict option limits, preselection, one primary CTA

## 11) Competitive Positioning
Market is validated by products like mymind, Fabric, Mem, and broader note tools with AI layers. Differentiation is not "AI notes" alone; it is a specific UX package:
- non-chat, tap-first placement confirmation
- active collection feed that surfaces current work
- low-friction correction and new-collection creation inline

## 12) Founder Validation Cycle (Simulated Completion)
Note: Real user interviews are not available yet; this is a founder-run pre-validation cycle.

### Day 1 - Positioning and assumption map
- Defined core positioning for messy thought capture.
- Listed top assumptions:
  - users prefer review-sheet confirmation over silent auto-merge
  - active feed reduces search dependency
  - create-new must be visible in same decision surface

### Day 2-3 - Competitive teardown
- Reviewed established and emerging AI notes products.
- Result: broad AI organization exists; specific UX behavior above is still a meaningful wedge.

### Day 4 - Flow and heuristic review
- Locked V1 core flow: capture -> review sheet -> confirm/create -> feed bump.
- Confirmed cognitive-load principles and no forced typing.

### Day 5 - Synthetic routing validation plan
- Planned 50 synthetic captures across text (including URL-rich notes) and image descriptions.
- Intended evaluation: acceptance proxy, confusion patterns, collection drift.

### Day 6 - Founder dogfooding protocol
- Defined personal daily capture run with correction and search-use logging.

### Day 7 - Decision framework
- Decision state: **GO (guarded)** for MVP design and prototyping, pending synthetic/founder metrics.

## 13) MVP Scope (Proposed)
Must-have:
- capture (text/image)
- review sheet with suggestions + create-new
- active collection feed bumping
- undo + move actions

Not in V1:
- advanced chat assistant
- heavy workspace collaboration features
- complex taxonomy editing flows

## 14) Open Questions
1. Initial collection bootstrap: empty state strategy for first-time users.
2. Confidence UI format: numeric score vs qualitative labels.
3. Image parsing depth for V1: OCR-only vs richer multimodal understanding.
4. Notification strategy for resurfacing active collections without overwhelm.

## 15) Next Steps
1. Create low-fidelity wireframes for the 4 primary screens.
2. Build a clickable prototype for founder dogfooding.
3. Run synthetic routing benchmark and document confusion matrix.
4. Prepare recruitment plan for first 5 external discovery interviews.

## 16) Lean UX Canvas (v2) - UX Flow Re-evaluation
Iteration date: 2026-03-20 (best-guess workshop pass)

### Box 1 - Business Problem
Most AI note products rely on chat to organize information, but chat is not the most intuitive interaction for quick note sorting. For everyday users capturing random thoughts, chat adds friction and decision fatigue. This leads to slower capture, poor organization consistency, and weaker habit retention.

### Box 2 - Business Outcomes
Increase percentage of captures completed without extra typing beyond the original note input.

### Box 3 - Users
Consumers with ADHD-style, random, high-frequency thought capture who need low-friction organization without chat.

### Box 4 - User Outcomes and Benefits
Users can drop notes without organizing effort and trust the app to place each note into the right context/collection, so they stay oriented without search.

### Box 5 - Solutions
- Primary solution: review-sheet routing (top AI match + alternatives + create-new, tap to confirm)
- Secondary candidate: hybrid routing (review-sheet default, with selective silent actions later if confidence and trust prove high)

### Box 6 - Hypothesis
We believe capture completion without extra typing will increase if ADHD-style random-capture users can drop notes and trust context-fit placement using a tap-first review sheet with top match, alternatives, and create-new.

### Box 7 - Most Important Thing to Learn First
Is AI matching quality high enough to avoid frequent misplacement?

### Box 8 - Least Work to Learn Next
Run a synthetic matching benchmark first.

Experiment definition:
- Dataset: 50 synthetic captures (text, text+URL, image descriptions)
- Candidate space: 10 collections
- Evaluation:
  - top-1 acceptable match rate
  - top-3 contains-correct-collection rate
  - rate of "create new" expected vs suggested
  - confusion pairs (which collections are frequently mixed)
- Initial pass threshold:
  - top-1 acceptable >= 70%
  - top-3 contains-correct >= 90%

Decision rule:
- Pass: proceed with review-sheet-first UX in prototype
- Fail: improve routing signals and collection schema before broader UX testing
