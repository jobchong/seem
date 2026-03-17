# Visual Verification Tool Implementation Plan

## Purpose

This document turns the design in `architecture.md` into a concrete implementation plan. It chooses a primary language, development stack, module boundaries, runtime flow, storage model, and phased delivery plan for a harness-independent visual verification tool.

The goal is to build a product that:

- detects when a model change affects a human-visible surface
- renders or opens the relevant target
- captures static and interactive states
- runs deterministic and vision-based review
- returns actionable findings to the harness
- optionally blocks task completion until visual review is complete

The goal is not to build a general test framework first. The implementation should prioritize task-time model feedback, with a later path to persistent reusable review recipes.

## Recommended Stack

### Primary language: TypeScript on Node.js

Use TypeScript as the primary implementation language for the entire MVP:

- core orchestration
- CLI
- MCP server
- browser adapter
- renderer adapter
- manifest parsing
- artifact storage
- deterministic review checks

Use Node.js 22 LTS or newer as the runtime.

### Why TypeScript

TypeScript is the best fit for the first version because:

- The system is orchestration-heavy, not numerics-heavy. Most work is process control, JSON schema handling, adapter dispatch, file IO, and API serving.
- The tool needs both a CLI and an MCP server. Node is a strong fit for both.
- Browser automation is central to the MVP, and Playwright is strongest in the Node ecosystem.
- The system will have many structured contracts such as `ChangeAssessment`, `TargetRecipe`, `SnapshotBundle`, and `ReviewVerdict`. TypeScript helps keep those stable across modules.
- The likely adoption path is via local install, `npx`, or embedding in existing agent tooling. Node packaging is straightforward for that.
- A single language across core runtime and browser adapter keeps the first version simpler than a multi-language design.

### Why not Python as the primary language

Python is attractive for OCR and image tooling, but it is not the best center of gravity for the MVP:

- The browser automation ergonomics are weaker than the Node ecosystem centered around Playwright.
- Packaging a cross-platform CLI plus MCP server is usually rougher in Python for this kind of mixed automation tool.
- The system's hardest early problems are not advanced computer vision; they are target resolution, process control, browser-state capture, and harness integration.
- OCR and image analysis can be isolated behind interfaces later if Python-native libraries become necessary.

Python remains a good future option for narrow worker processes if the product later needs heavier CV or document layout analysis. It should not be the main language initially.

### Why not Go or Rust as the primary language

Go or Rust would improve static binaries and raw performance, but they would slow down MVP delivery:

- Browser automation and UI tooling ecosystems are much thinner.
- More glue code would be required for web and simulator automation.
- The main bottlenecks are external processes and render time, not core runtime speed.
- The product value depends more on adapter breadth and review quality than on low-level performance.

Go or Rust only become compelling if a later version needs a daemon, high-throughput artifact processing, or a portable embedded runtime without Node.

## Core Libraries and Tools

### Package management and repo tooling

- `pnpm`
- `typescript`
- `tsx`
- `tsup`

Justification:

- `pnpm` is fast, disk-efficient, and well-suited to a small monorepo.
- `tsx` is the fastest way to run TypeScript during development without premature bundling work.
- `tsup` is a pragmatic build tool for bundling the CLI and server entrypoints.

### CLI and schemas

- `commander`
- `zod`
- `yaml`
- `micromatch`

Justification:

- `commander` is simple and stable for a multi-command CLI.
- `zod` gives one source of truth for runtime validation and TypeScript types.
- `yaml` supports `seem.yaml` manifests without inventing a config format.
- `micromatch` handles target path resolution against changed-file globs.

### Process execution and runtime control

- `execa`
- built-in `fs/promises`
- built-in `child_process`
- `p-limit`

Justification:

- The tool will launch dev servers, render commands, browser sessions, OCR workers, and platform utilities.
- `execa` provides safer and cleaner process management than ad hoc shelling.
- `p-limit` prevents the tool from oversaturating the machine when multiple captures or OCR jobs run at once.

### Browser automation

- `playwright`

Justification:

- The MVP needs a high-quality browser adapter more than any other adapter.
- Playwright gives screenshot capture, viewport control, interactions, DOM evaluation, accessibility snapshots, traces, and good reliability.
- The product should not expose "Playwright" as its main API, but it should absolutely use Playwright under the hood for browser surfaces.

### Image processing and OCR

- `sharp`
- `pixelmatch`
- `tesseract.js`

Justification:

- `sharp` is the best practical choice in Node for image resize, crop, metadata, hashing preparation, and basic transforms.
- `pixelmatch` is simple and sufficient for targeted image diffing in controlled cases.
- `tesseract.js` is not perfect, but it is self-contained enough for an MVP and avoids turning OCR into a separate system dependency on day one.

Important implementation note:

- Prefer structural text sources over OCR whenever available.
- In browser targets, use DOM and accessibility trees first.
- Use OCR mainly for renderer targets and image-only surfaces.

If OCR quality becomes a major bottleneck later, replace only the OCR module rather than changing the whole architecture.

### Logging and diagnostics

- `pino`

Justification:

- The tool needs structured logs, run IDs, adapter events, and failure diagnostics.
- `pino` is fast, unobtrusive, and easy to emit as JSON for harness consumption.

### MCP server

- `@modelcontextprotocol/sdk`

Justification:

- The architecture explicitly targets harness independence.
- MCP is the cleanest standard interface for that goal.
- The CLI and MCP server should call the same service layer so behavior stays aligned.

### Testing

- `vitest`
- `@playwright/test`

Justification:

- `vitest` is a good default for unit and service-layer tests in a TypeScript project.
- `@playwright/test` is valuable for integration tests against sample browser fixtures because it already solves browser lifecycle, traces, and screenshots well.

The product should learn from testing frameworks without becoming one by default. Using their good internals for our own verification runtime is a strength, not a conceptual failure.

## High-Level Build Strategy

Build the system as a small monorepo with a shared core and separate entrypoints.

Suggested layout:

```text
/packages
  /core
    /src
      assessment/
      manifest/
      targets/
      journeys/
      review/
      storage/
      types/
      services/
  /adapters-browser
    /src
  /adapters-renderer
    /src
  /cli
    /src
  /mcp
    /src
  /fixtures
    /web
    /render
  /shared-test-utils
    /src
/docs
  architecture.md
  implementation.md
```

### Why a monorepo

- Core types and services should be shared by the CLI, MCP server, and adapters.
- Adapter packages have different dependencies and release cadence.
- The browser adapter will bring in heavier dependencies like Playwright; it should not pollute every package if not needed.
- The split keeps room for later native or platform-specific adapters without forcing them into the base package.

## Product Boundary

The product surface should stay small:

- a CLI for local usage and scripting
- an MCP server for harness integration
- a repo manifest format for target discovery
- an artifact directory for traces and review outputs

Everything else should be internal.

Do not expose Playwright-specific concepts, OCR tuning flags, or internal image-processing switches as user-facing API in the first version. Those should stay as implementation details unless the tool proves they need to be configurable.

## Internal Service Layer

The heart of the system should be a set of pure-ish service methods in `packages/core`.

Recommended service interfaces:

```ts
interface VisualVerificationService {
  assessChange(input: AssessChangeInput): Promise<ChangeAssessment>;
  resolveTargets(input: ResolveTargetsInput): Promise<ResolvedTarget[]>;
  openTarget(input: OpenTargetInput): Promise<OpenTargetResult>;
  runJourney(input: RunJourneyInput): Promise<JourneyRunResult>;
  capture(input: CaptureInput): Promise<SnapshotBundle[]>;
  review(input: ReviewInput): Promise<ReviewVerdict>;
  getGateStatus(input: GateStatusInput): Promise<GateStatus>;
  closeTarget(input: CloseTargetInput): Promise<void>;
}
```

### Why this service shape

- The CLI can map commands directly to these methods.
- The MCP server can map tools directly to these methods.
- Integration tests can call the service layer without going through the shell.
- Adapters stay behind interfaces instead of leaking into the product API.

## Data Model Implementation

The data model described in `architecture.md` should be implemented first as `zod` schemas plus TypeScript types.

Primary types:

- `ChangeAssessment`
- `TargetRecipe`
- `ResolvedTarget`
- `ViewSpec`
- `JourneySpec`
- `SnapshotBundle`
- `InvariantSpec`
- `TransitionFinding`
- `ReviewVerdict`
- `GateStatus`
- `RunManifest`

### Why schema-first

- The tool will receive data from a harness, manifest files, adapters, and VLM outputs.
- Runtime validation is mandatory because many boundaries are untrusted or loosely typed.
- The schemas can later be exported as JSON Schema for external integrations if needed.

## File and Artifact Storage

Use a file-backed artifact store in the MVP.

Suggested layout:

```text
.seem/
  config.json
  runs/
    run_20260317_001/
      task.json
      assessment.json
      targets.json
      session.json
      journey.json
      snapshots/
        initial.desktop.png
        step_01.open_modal.desktop.png
        step_02.expand_accordion.desktop.png
      crops/
      ocr/
      review.json
      gate.json
      events.jsonl
  cache/
    ocr/
    hashes/
```

### Why not SQLite first

A file-backed store is the right first tradeoff because:

- It is easy to inspect manually while developing the product.
- It keeps runs portable and debuggable.
- Harnesses can attach or archive raw artifacts without extra export steps.
- The expected MVP scale is interactive, not high-throughput batch processing.

SQLite becomes useful later if the tool needs:

- cross-run querying
- historical scoring
- flaky target tracking
- artifact deduplication at larger scale

That can be added as an index later without changing the run artifact contract.

## Manifest and Target Resolution

Implement `seem.yaml` as the primary explicit configuration surface.

Recommended top-level sections:

- `targets`
- `defaults`
- `policies`
- `environments`

Example shape:

```yaml
defaults:
  review_policy: required
  viewports:
    - [1440, 900]
    - [390, 844]

targets:
  - id: settings-modal
    when:
      paths:
        - 'src/settings/**'
        - 'src/components/modal/**'
    recipe:
      adapter: browser
      launch:
        cmd: 'pnpm dev'
      surface:
        url: 'http://localhost:3000/settings'
      journey:
        - click: 'Open settings'
        - click: 'Advanced options'
      invariants:
        - no_horizontal_overflow
        - modal_no_horizontal_growth

policies:
  browser:
    timeout_ms: 20000
```

### Implementation approach

1. Load and validate the manifest on startup or first use.
2. Resolve changed files from git when available.
3. Score candidate targets by explicit match first, then heuristics.
4. Return one or more ranked targets, not just one winner.

### Why this approach

- Explicit manifests are the only reliable long-term answer for target selection.
- Heuristics are still needed for early adoption and low-setup cases.
- Ranking is better than a single hard pick because some tasks touch multiple surfaces.

## Assessment Engine

The assessment engine determines:

- whether the task is human-visible
- how strongly visual the task is
- whether review should be required
- which target families are likely relevant

Inputs:

- task text
- changed files if available
- diff summary if available
- manifest matches
- optional harness hints

Implementation components:

- keyword classifier
- path classifier
- diff feature extractor
- manifest matcher
- scoring combiner

### MVP implementation details

- Start with hand-authored rules instead of training a classifier.
- Keep the rule engine declarative so it can be tuned without code churn.
- Emit not just a score, but a human-readable explanation list.

This explanation is important because the harness may need to tell the model why visual review was triggered.

## Adapter Architecture

Define a narrow adapter interface:

```ts
interface SurfaceAdapter {
  kind: 'browser' | 'renderer' | 'simulator' | 'window' | 'stream';
  open(input: OpenTargetInput): Promise<AdapterSession>;
  perform(input: PerformActionInput): Promise<ActionResult>;
  capture(input: AdapterCaptureInput): Promise<RawCapture[]>;
  inspect?(input: InspectInput): Promise<InspectionData>;
  close(sessionId: string): Promise<void>;
}
```

### Why a narrow interface

- It keeps the orchestration layer independent from adapter-specific details.
- It makes it possible to add simulator and window adapters later without changing the service contract.
- It forces adapter outputs through the same normalization pipeline.

## Browser Adapter Implementation

The browser adapter is the first and most important adapter.

Use Playwright directly in `packages/adapters-browser`.

Responsibilities:

- launch or connect to a browser
- wait for a route to become stable
- set viewport and theme
- run interactions from a `JourneySpec`
- capture screenshots
- extract DOM geometry and accessibility metadata
- gather browser-native metrics such as `scrollWidth`, `clientWidth`, and bounding boxes

### Important browser adapter behaviors

Implement these from the start:

- disable or reduce animations where possible
- configurable waiting strategy
- multiple viewport capture
- stable screenshot naming
- per-step traces
- DOM locator fallback strategy

### Waiting strategy

Do not rely only on "network idle."

Use a layered wait strategy:

1. page load and route resolution
2. selector readiness if configured
3. optional app-specific ready hook from the manifest
4. short stability window for layout measurements

This is one of the biggest lessons to take from Cypress and Playwright: readiness must be explicit or the tool will be flaky.

### Why not expose raw Playwright scripts in the manifest

That would turn the product into a thin wrapper around browser tests too early.

Instead, keep the manifest action language constrained at first:

- `click`
- `tap`
- `type`
- `scroll`
- `hover`
- `focus`
- `resize`
- `wait_for`

Allow a low-level escape hatch later, but do not make it the default.

## Renderer Adapter Implementation

The renderer adapter is the second MVP adapter.

Responsibilities:

- run deterministic commands that emit images, PDFs, or other visual artifacts
- collect output files
- convert multi-page formats into page images when needed
- normalize outputs into snapshot bundles

Examples:

- PPT parser fixture renders
- PDF page generation
- chart export validation
- Blender frame renders

### Why renderer adapter before simulator or window adapter

- It covers document and artifact workflows that the browser adapter cannot.
- It keeps the abstraction honest: not everything is a webpage.
- It is simpler and more deterministic than desktop window automation.

### Renderer adapter design choice

Do not attempt to build format-specific renderers into the core. The adapter should mostly orchestrate external commands and normalize their outputs.

That keeps support broad:

- the tool handles orchestration
- repo-specific renderers handle domain specifics

## Snapshot Normalization Pipeline

Build a dedicated normalization step that consumes raw adapter captures and emits `SnapshotBundle`.

Pipeline steps:

1. persist original image
2. compute image metadata
3. create derived crops if configured
4. extract structural data if the adapter provides it
5. run OCR if no better text source exists
6. compute image hash
7. attach step and viewport metadata

### Why normalization is a first-class component

- Review should not care whether input came from Playwright, PDF rendering, or a simulator.
- Most debugging requires a stable artifact format.
- OCR and derived data are expensive enough that they should be cached.

## Journey Execution

Implement journeys as ordered actions with per-step captures.

Execution rules:

- capture a baseline before the first action
- perform one action at a time
- wait for post-action stability
- capture after each step
- optionally capture intermediate frames for animated regions later

### Step result model

Each step should record:

- action attempted
- target resolution details
- elapsed time
- capture IDs
- DOM or adapter metrics before and after
- any action failure or ambiguity

### Why this matters

This is how the system becomes useful for interaction bugs. The review engine must be able to say which step introduced the regression, not just that the final state is bad.

## Deterministic Review Engine

The first serious value should come from deterministic checks, not the VLM.

Initial check families:

- horizontal overflow
- vertical clipping
- container growth beyond threshold
- modal or drawer leaving viewport bounds
- text region escaping container bounds
- element disappearance
- contrast regression
- unexpected full-page scrollbars
- large geometry drift in anchored elements

### Implementation strategy

For browser targets:

- use DOM measurements and computed styles first
- use accessibility tree and bounding boxes next
- use pixels only as supporting evidence

For renderer targets:

- use OCR text boxes
- use image geometry
- use targeted pixel diffs

### Why this ordering

- DOM geometry is more reliable than computer vision for web layout bugs.
- OCR plus geometry is more practical than trying to infer everything visually for document outputs.
- Pure pixel diffs are too brittle in the presence of fonts, anti-aliasing, timestamps, and minor render noise.

## VLM Review Layer

Add a VLM review layer only after deterministic checks exist.

Responsibilities:

- answer task-level questions that rules cannot fully encode
- judge qualitative layout improvement
- summarize the likely regression in natural language
- help triage uncertain cases

### Provider design

Implement a `VisionReviewer` interface in core and keep the concrete provider separate.

```ts
interface VisionReviewer {
  review(input: VisionReviewInput): Promise<VisionReviewResult>;
}
```

### Why a provider interface

- The product should stay harness-independent and model-provider-independent.
- Some environments will use a hosted multimodal model.
- Some environments may forbid network access and use only deterministic checks.
- The VLM layer should be optional, not a hard product dependency.

### Input shaping

Do not send raw full runs to the VLM by default.

Send:

- the task
- a concise target description
- selected before and after snapshots
- focused crops around changed regions
- deterministic findings and uncertainties
- OCR text where useful

This keeps cost, latency, and noise under control.

## Completion Gate

The completion gate should live in core and be driven by policy plus review results.

Gate inputs:

- `review_required`
- review status
- adapter success or failure
- target ambiguity
- policy mode

Policy modes:

- `off`
- `advisory`
- `required`

### Gate behavior

- In `off`, the tool never blocks completion.
- In `advisory`, the tool warns and returns findings.
- In `required`, a task cannot be marked visually verified unless review passed or the final state is explicitly `unverified`.

### Why this belongs in core

- Gate behavior must be identical across CLI and MCP entrypoints.
- The harness should not have to reimplement policy logic.

## CLI Design

Recommended commands:

- `seem assess-change`
- `seem resolve-targets`
- `seem open-target`
- `seem run-journey`
- `seem capture`
- `seem review`
- `seem run`
- `seem gate-status`
- `seem doctor`

### MVP command to prioritize

Implement `seem run` first as the end-to-end path:

```bash
seem run \
  --task "change this button colour to blue" \
  --cwd /repo \
  --diff git
```

This command should:

1. assess the change
2. resolve targets
3. open the first ranked target
4. execute its journey if any
5. capture snapshots
6. review the result
7. write artifacts
8. return machine-readable output

### Why start with one end-to-end command

- It exercises the whole product loop early.
- It is easier to integrate into a harness initially.
- Fine-grained commands can still be added on top of the same service methods.

## MCP Server Design

Expose the same functionality through MCP tools.

Recommended tools:

- `assess_change`
- `resolve_targets`
- `open_target`
- `run_journey`
- `capture_view`
- `review_visual`
- `run_visual_verification`
- `get_gate_status`
- `close_target`

### Why expose both fine-grained and end-to-end tools

- Some harnesses will want one-shot verification.
- Others will want tighter control around when edits happen and when capture occurs.
- The one-shot method is easier to adopt.
- The fine-grained methods make debugging and advanced orchestration possible.

## Harness Integration Plan

Support two harness integration patterns from the start.

### Pattern 1: wrapper mode

The harness calls one command or one MCP tool after a model edit:

- model edits files
- harness calls `run_visual_verification`
- tool returns verdict and findings

This is the easiest integration path.

### Pattern 2: managed loop mode

The harness calls the tool at multiple points:

1. assess task before editing
2. resolve targets
3. let the model edit
4. run review
5. re-enter the model loop on failure

This gives better control and clearer user messaging.

### Recommendation

Implement wrapper mode first for simplicity, but design the internals so managed loop mode uses the same core services.

## Reporting Format

Every run should produce:

- machine-readable JSON
- a plain-text summary
- raw artifacts on disk

Recommended top-level JSON output:

```json
{
  "run_id": "run_20260317_001",
  "assessment": {
    "human_visible": true,
    "review_required": true
  },
  "target": {
    "id": "settings-modal",
    "adapter": "browser"
  },
  "review": {
    "status": "fail",
    "confidence": 0.92
  },
  "findings": [
    {
      "severity": "high",
      "step_id": "expand_advanced",
      "reason": "Modal width increased from 560px to 812px"
    }
  ],
  "gate": {
    "status": "blocked"
  }
}
```

### Why structured reporting matters

- The harness needs to feed findings back to the model cleanly.
- CI or logging systems may consume the output later.
- Users need a stable shape to automate around.

## Testing Strategy

Test the product as software while keeping the product itself task-oriented.

### Unit tests with Vitest

Cover:

- manifest validation
- target ranking
- rule-based change assessment
- invariant evaluation
- review verdict merging
- gate policy behavior

### Integration tests with Playwright fixtures

Create small sample apps and rendered outputs that intentionally contain:

- clipped text
- modal overflow
- missing contrast
- accordion-induced layout regressions
- before and after button color changes

Use these fixtures to verify that:

- the browser adapter captures correctly
- journeys execute deterministically
- invariants catch regressions
- artifact bundles are written correctly

### Golden artifact tests

Keep a limited set of expected review outputs and snapshot metadata for regression testing of the tool itself.

Do not overuse pixel goldens. Prefer golden JSON outputs plus a few representative images.

### What to borrow from Cypress and pytest

Borrow:

- step traces
- explicit waiting
- rich failure artifacts
- fixture isolation
- parametrized runs

Do not borrow:

- the assumption that humans will hand-author every verification flow
- a pass-fail-only UX with weak diagnostic context

## Phase Plan

Assume one strong engineer for implementation, with optional design help on manifests and sample fixtures.

### Phase 0: repository bootstrap

Deliverables:

- monorepo scaffolding
- TypeScript config
- build and test setup
- lint and formatting
- shared schemas package

Exit criteria:

- `pnpm test` runs
- CLI hello-world command runs
- MCP server starts

### Phase 1: core types, manifest, and run storage

Deliverables:

- `zod` schemas for all core types
- `seem.yaml` parser and validator
- run directory writer
- event log writer
- artifact naming conventions

Exit criteria:

- a manifest can be loaded and validated
- a fake run can be persisted and read back

### Phase 2: assessment engine and target resolution

Deliverables:

- rule-based assessment engine
- git diff integration
- path and prompt scoring
- ranked target resolution

Exit criteria:

- sample tasks resolve the right targets in fixture repos
- assessment explanations are emitted

### Phase 3: browser adapter MVP

Deliverables:

- Playwright-backed browser session manager
- route open and viewport setup
- baseline screenshot capture
- DOM geometry extraction
- simple journey execution

Exit criteria:

- a demo route can be opened, clicked through, and captured at two viewports

### Phase 4: normalization and deterministic review

Deliverables:

- snapshot normalization pipeline
- OCR fallback
- geometry and overflow invariants
- review verdict assembler

Exit criteria:

- the tool catches modal horizontal growth and button contrast regressions in fixtures

### Phase 5: end-to-end CLI and gate

Deliverables:

- `seem run`
- required, advisory, and off policies
- machine-readable final JSON output
- plain-text review summary

Exit criteria:

- one command can run the full assessment-to-verdict pipeline

### Phase 6: MCP server

Deliverables:

- one-shot tool
- fine-grained tools
- shared service wiring

Exit criteria:

- an MCP-capable harness can invoke the tool without using the CLI

### Phase 7: renderer adapter MVP

Deliverables:

- command-based renderer adapter
- page and image collection
- PDF and image normalization path
- OCR-based document review path

Exit criteria:

- a sample render command can produce a review verdict from generated page images

### Phase 8: VLM review layer

Deliverables:

- provider interface
- one concrete provider implementation
- structured qualitative review output
- fusion of deterministic and VLM findings

Exit criteria:

- the tool can explain uncertain or qualitative visual regressions better than deterministic checks alone

### Phase 9: hardening

Deliverables:

- retries and stabilization rules
- `seem doctor`
- better failure taxonomy
- richer artifact pruning and caching
- docs and example manifests

Exit criteria:

- the tool is usable outside its fixture environments

## Recommendation on Release Order

The first public release should include:

- core schemas
- manifest support
- browser adapter
- renderer adapter
- journeys
- deterministic invariants
- CLI
- MCP
- advisory and required gate modes

The first public release should not include:

- desktop window automation
- iOS or Android simulators
- baseline management across many historical runs
- test export
- complex CV-heavy understanding

## Risks and Mitigations

### Risk: flaky browser captures

Mitigation:

- explicit readiness hooks
- short stability window
- animation suppression
- per-target timeout control

### Risk: target resolution guesses wrong

Mitigation:

- manifest-first design
- ranked candidates
- explicit explanations in assessment output
- harness ability to override target

### Risk: OCR is noisy

Mitigation:

- prefer structural sources when available
- cache OCR results
- use OCR only where necessary
- keep OCR module replaceable

### Risk: VLM output is inconsistent

Mitigation:

- deterministic checks remain primary
- use schema-constrained outputs
- provide the VLM with focused evidence instead of whole runs

### Risk: tool drifts into a test framework too early

Mitigation:

- keep the primary API task-oriented
- keep manifests small and recipe-oriented
- defer persistent suites and CI-first semantics

## Deferred Decisions

Do not lock these in before the MVP proves a need:

- SQLite or database-backed indexing
- native desktop automation helpers
- simulator adapters
- baseline history scoring
- persistent test suite export
- remote artifact storage

## Concrete First Sprint

If implementation started today, the first sprint should produce:

1. monorepo scaffold with `packages/core`, `packages/cli`, and `packages/adapters-browser`
2. `zod` schemas for the core data model
3. `seem.yaml` validation
4. run artifact writing under `.seem/runs`
5. browser adapter that opens a route and captures a screenshot
6. one invariant check for horizontal overflow
7. `seem run` end-to-end path for a fixture app

That is enough to validate the hardest product assumptions:

- can the harness invoke the tool easily
- can the tool discover a target
- can it capture a meaningful state
- can it catch an actual interaction bug

## Bottom Line

The right implementation path is:

- TypeScript and Node as the main runtime
- Playwright as a browser-surface backend, not the public product abstraction
- file-based run artifacts for transparency and ease of debugging
- schema-first contracts and a shared core service layer
- deterministic review first, VLM review second
- browser and renderer adapters before simulator and desktop automation

That stack keeps the MVP small enough to ship while still matching the architecture goal: one visual verification tool that works across many human-visible outputs without becoming a pile of unrelated one-off format checkers.
