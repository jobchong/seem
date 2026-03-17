# Visual Verification Tool Architecture

## Summary

This document describes a harness-independent tool that helps a model visually verify its own changes before claiming success. The tool is designed to work across any human-visible artifact that can be rendered into pixels: web pages, mobile simulators, desktop windows, office documents, PDFs, and 3D renders.

The tool must support both static review and stateful interaction review. Many important bugs only appear after a user action such as opening a modal, expanding an accordion, resizing a screen, or navigating to a later state.

The core design choice is:

- Standardize on a small set of surface adapters that can produce pixels.
- Standardize on one review pipeline once pixels are available.
- Make visual verification an explicit completion gate for human-visible changes.

This avoids writing a large number of format-specific review tools while still supporting many artifact types.

## Goals

- Detect when a model change affects something intended to be seen by humans.
- Capture the resulting visual state in a consistent way.
- Detect interaction regressions that appear only after user actions.
- Let the model or a sidecar reviewer evaluate whether the result matches the task.
- Support multiple harnesses through a stable CLI or MCP interface.
- Separate rendering mechanics from review logic.
- Provide an enforceable completion gate so visually meaningful changes are not accepted on faith.

## Non-Goals

- Replace all app-specific automation with one universal renderer.
- Guarantee full semantic correctness from pixels alone.
- Eliminate all adapter work. Some adapter layer is unavoidable because different systems render differently.
- Act as a general-purpose test runner for non-visual correctness.

## Design Principles

- Outcome over implementation. The model should verify the visual result, not infer success from the code change.
- Render once, review uniformly. Normalize all captures into a shared snapshot format.
- Use surface-class adapters, not format-specific reviewers.
- Keep policy separate from mechanism. Visual review can be optional or enforced, but the enforcement logic must be explicit.
- Preserve uncertainty. If the tool cannot verify visually, it must report that directly rather than silently passing.

## Core Architecture

The system consists of six major parts:

1. Change assessor
   - Determines whether a task or diff is human-visible.
   - Decides whether visual review is required.
   - Identifies likely targets to render.

2. Target resolver
   - Maps a task or changed files to one or more visual targets.
   - Uses manifests, conventions, heuristics, or explicit user hints.

3. Surface adapters
   - Open or render a target into pixels.
   - Provide minimal interaction capabilities when needed.

4. Snapshot pipeline
   - Produces a normalized `SnapshotBundle` for every captured view.
   - Adds OCR, bounding boxes, metadata, and optional semantic structure.

5. Review engine
   - Runs deterministic, structural, and vision-model-based checks.
   - Produces a pass, fail, or unverified verdict with findings.

6. Completion gate
   - Prevents the harness from marking a task complete when required visual review has not passed.

## High-Level Flow

```text
User task
  -> model plans work
  -> assess_change(task, repo context, optional diff)
  -> if human_visible: resolve target(s)
  -> model edits code or artifact
  -> open/render target via adapter
  -> execute optional interaction journey
  -> capture canonical view(s)
  -> normalize to snapshot bundle
  -> review against task, rubric, and invariants
  -> pass: allow completion
  -> fail: return findings and continue iteration
  -> unverified: allow completion only if policy permits and tool reports lack of verification explicitly
```

## Execution Flow

### 1. Task intake

The harness receives a user request such as:

- "change this button colour to blue"
- "fix the layout on mobile"
- "preserve the table layout in the PowerPoint parser output"
- "make the iOS settings screen match the design"

The harness sends the task to the tool before or during planning:

```json
{
  "task": "change this button colour to blue",
  "repo_context": {
    "cwd": "/repo",
    "branch": "feature/button-color"
  }
}
```

### 2. Change assessment

The tool classifies the work:

- `human_visible`
- `visual_relevance`
- `review_required`
- candidate target identifiers

Signals include:

- Prompt intent: words like `colour`, `layout`, `spacing`, `render`, `slide`, `screen`, `UI`.
- Changed files: `tsx`, `jsx`, `css`, `html`, templates, renderers, parser outputs, assets.
- Known repo targets from a manifest.
- Historical mappings from paths to targets.

Example output:

```json
{
  "human_visible": true,
  "visual_relevance": 0.96,
  "review_required": true,
  "targets": ["storybook:Button/Primary", "route:/settings"]
}
```

### 3. Model edit

The model makes the requested change in code or input data.

At this stage, the model is not allowed to assume success purely from implementation details. The edit only advances the task to the review stage.

### 4. Target resolution

The tool selects one or more targets to inspect.

Resolution order:

1. Explicit target provided by the harness or user
2. Repo manifest
3. Known conventions
4. Heuristic fallback

Examples:

- CSS change in a component -> Storybook story or dev route
- Mobile screen change -> simulator screen recipe
- PPT parser change -> render fixture deck before and after
- Blender change -> deterministic frame render from configured camera

### 5. Surface open or render

The tool launches a surface adapter using a `TargetRecipe`.

Examples:

- Browser adapter opens a route or story in a browser.
- Simulator adapter opens an app screen in iOS or Android.
- Renderer adapter runs a command that outputs images or pages.
- Window adapter attaches to a desktop app and captures the active window.

### 6. Capture

The adapter captures one or more canonical views based on a `ViewSpec`.

A capture may include:

- multiple viewports
- multiple states in a short interaction journey
- multiple pages or frames
- before and after snapshots when a stable baseline exists

### 6a. Journey execution and state transitions

For interactive targets, capture must be driven by a `JourneySpec` rather than by a single final screenshot.

A journey is a short ordered list of user actions such as:

- open modal
- click accordion header
- resize to mobile viewport
- scroll inside a container
- hover or focus a control

The tool should capture:

- the initial state
- the state after each step
- optional intermediate frames for animated or unstable transitions

This allows review to reason about state transitions, not just isolated images.

### 7. Snapshot normalization

Every capture is transformed into a `SnapshotBundle`.

The normalized bundle may include:

- raw image or images
- OCR text
- bounding boxes for text or objects
- accessibility tree or DOM tree when available
- page, frame, or viewport metadata
- cropped regions of likely change
- image hashes and timestamps

This shared structure is the main mechanism that allows a single review engine to work across many artifact types.

### 8. Review

The tool evaluates the snapshots against the task.

The review engine runs three layers:

1. Deterministic checks
   - clipping
   - overflow
   - overlap
   - blank or missing regions
   - changed colour values in target regions
   - contrast thresholds
   - unexpected container growth or shrinkage
   - horizontal viewport scrolling
   - text wrapping failures
   - modal, drawer, or popover bounds violations

2. Structural checks
   - DOM or accessibility tree diffs
   - OCR ordering
   - bounding box drift
   - object counts
   - page or frame consistency
   - step-to-step geometry changes for anchored elements

3. VLM critique
   - "Did the button become blue?"
   - "Did the mobile layout improve?"
   - "Does the reconstructed slide preserve grouping and spacing?"
   - "Did expanding the accordion introduce an unintended layout regression?"

### 9. Completion gate

The tool returns a `ReviewVerdict` plus gate status:

- `pass`
- `fail`
- `unverified`

If `review_required = true`, the harness must not allow the model to claim completion until one of the following is true:

- review passed
- review failed and the model reports the failure
- review was impossible and the model reports that the result was not visually verified

This is the mechanism that prevents "I used the right CSS property, so it must be correct" reasoning.

## Interaction Bugs and Stateful Review

Many bugs are only visible after interaction. A visual verification tool must therefore support review of action sequences, not just single renders.

Example:

- A new accordion is added inside a modal.
- Expanding the accordion reveals long text.
- The modal unexpectedly expands horizontally.
- The viewport begins scrolling sideways.

This is a visually meaningful regression even if the code change looked plausible. The tool should detect it through stateful review.

### Interaction review model

The interaction review pipeline adds three concepts:

1. Journeys
   - Ordered action sequences applied to a target.

2. Invariants
   - Conditions that must remain true as the journey executes.

3. Transition findings
   - Findings tied to the specific step that introduced the regression.

Common invariants include:

- no horizontal overflow
- modal width remains within configured bounds
- text wraps within the content container
- anchored elements stay visible
- no unexpected page-level scrollbars appear
- overlay remains centered and on-screen

These checks should be largely deterministic. A VLM can provide backup critique or higher-level judgment, but geometry and overflow regressions should be detected with explicit measurements where possible.

### Journey sources

Journeys may come from:

- explicit target manifest definitions
- user instructions
- model-proposed interaction steps
- generic exploration heuristics for common controls

Examples of generic heuristics:

- click newly added buttons
- expand accordions and disclosures
- open menus and modals
- switch to mobile viewport
- scroll changed containers

### Transition-based review

Each journey step should produce before and after evidence.

The review engine should compare:

- container sizes
- element bounding boxes
- overflow state
- visible text regions
- viewport scroll dimensions
- OCR text and layout drift

This allows the tool to say not just "the UI looks wrong," but "the UI became wrong after step N."

### Harness behavior for interaction bugs

When interaction review fails, the harness should feed the model concrete findings rather than a vague failure:

- which step introduced the regression
- what changed geometrically
- which invariant failed
- what evidence was captured

Example feedback:

- "Expanding the accordion caused modal width to grow from 560px to 812px."
- "Horizontal overflow appeared after step 2."
- "Content is not wrapping within the modal body."

This turns visual review into an actionable debugging loop rather than a binary pass or fail.

## Surface Adapters

The generality of the system comes from keeping the number of adapter classes small.

### Browser adapter

For:

- web apps
- Storybook
- docs sites
- embedded web views

Capabilities:

- open URL
- set viewport
- wait for readiness
- click, type, scroll
- capture screenshot
- optionally expose DOM and accessibility tree

Possible backend implementations:

- Playwright
- browser remote debugging protocol

### Simulator adapter

For:

- iOS simulator
- Android emulator

Capabilities:

- launch app
- select device
- tap, swipe, type
- capture screen
- retrieve accessibility metadata where available

Possible backend implementations:

- `simctl`
- Android emulator tooling
- platform automation frameworks

### Window adapter

For:

- native desktop apps
- design tools
- office apps

Capabilities:

- launch or attach to app window
- focus window
- perform limited scripted input
- capture window screenshot

Possible backend implementations:

- AppleScript or platform UI automation
- WinAppDriver or similar
- desktop accessibility APIs

### Renderer adapter

For:

- PowerPoint parser outputs
- PDF generation
- slide or doc exports
- Blender renders
- chart exporters

Capabilities:

- run deterministic command
- collect output files
- convert pages or frames into images

Examples:

- PPT fixture -> slide images
- PDF -> page PNGs
- Blender scene -> rendered frames

### Stream adapter

For:

- remote surfaces
- VNC or RDP sessions
- already-running external displays

Capabilities:

- subscribe to frames
- capture stills
- send limited control inputs if supported

## Common Data Model

### ChangeAssessment

```json
{
  "human_visible": true,
  "visual_relevance": 0.91,
  "review_required": true,
  "targets": ["route:/settings"],
  "reasoning": ["Task refers to color change", "Diff touches CSS"]
}
```

### TargetRecipe

```json
{
  "target_id": "storybook:Button/Primary",
  "adapter": "browser",
  "launch": {
    "cmd": "pnpm storybook"
  },
  "surface": {
    "url": "http://localhost:6006/?path=/story/button--primary"
  },
  "views": [
    {
      "viewport": [1440, 900]
    },
    {
      "viewport": [390, 844]
    }
  ],
  "journey": []
}
```

### ViewSpec

```json
{
  "viewport": [390, 844],
  "page": 1,
  "frame": null,
  "camera": null,
  "theme": "light",
  "density": 2
}
```

### JourneySpec

```json
{
  "journey_id": "accordion_modal_expand",
  "steps": [
    {
      "id": "open_settings",
      "action": "click",
      "target": "Open settings"
    },
    {
      "id": "expand_advanced",
      "action": "click",
      "target": "Advanced options"
    }
  ]
}
```

### SnapshotBundle

```json
{
  "snapshot_id": "snap_001",
  "target_id": "route:/settings",
  "images": ["/artifacts/snap_001.png"],
  "ocr": [
    {
      "text": "Save",
      "bbox": [120, 540, 210, 580]
    }
  ],
  "regions": [
    {
      "label": "primary_button",
      "bbox": [98, 522, 232, 590]
    }
  ],
  "metadata": {
    "viewport": [390, 844],
    "device": "iPhone 15",
    "timestamp": "2026-03-17T00:00:00Z"
  }
}
```

### InvariantSpec

```json
{
  "invariant_id": "modal_no_horizontal_growth",
  "type": "max_container_width_delta",
  "target_region": "settings_modal",
  "threshold": 24,
  "severity": "high"
}
```

### TransitionFinding

```json
{
  "status": "fail",
  "step_id": "expand_advanced",
  "invariant_id": "modal_no_horizontal_growth",
  "reason": "Modal width increased unexpectedly after accordion expansion",
  "evidence": {
    "before_width": 560,
    "after_width": 812,
    "horizontal_overflow": true
  }
}
```

### ReviewVerdict

```json
{
  "status": "pass",
  "confidence": 0.94,
  "checks": [
    {
      "name": "target_color",
      "status": "pass",
      "details": "Primary button background is blue"
    },
    {
      "name": "text_contrast",
      "status": "pass",
      "details": "Contrast remains above threshold"
    }
  ],
  "findings": []
}
```

## Target Discovery Strategy

The tool should not rely on heuristics alone. It should support an explicit repo-level manifest.

Suggested file:

- `seem.yaml`

Example:

```yaml
targets:
  - id: settings-route
    when:
      paths: ['src/settings/**', 'src/components/button/**', '**/*.css']
    recipe:
      adapter: browser
      launch:
        cmd: pnpm dev
      surface:
        url: http://localhost:3000/settings
      views:
        - viewport: [1440, 900]
        - viewport: [390, 844]
      journey:
        - click: 'Open settings'
        - click: 'Advanced options'
      invariants:
        - no_horizontal_overflow
        - modal_no_horizontal_growth

  - id: fixture-deck
    when:
      paths: ['parser/**', 'ppt/**']
    recipe:
      adapter: renderer
      launch:
        cmd: python scripts/render_fixture.py fixtures/demo.pptx
      surface:
        files: ['/tmp/rendered/*.png']
```

Resolution order should be deterministic:

1. explicit target argument
2. exact manifest match
3. convention-based target
4. heuristic guess
5. ask the harness or user only when ambiguity is too high

## Policy and Enforcement

The policy system should be explicit and configurable.

Modes:

- `off`: tool can be used manually, no gate
- `advisory`: tool reports that visual review is recommended
- `required`: human-visible changes must be reviewed before completion

Recommended default:

- `required` when `human_visible = true` and confidence is high
- `advisory` when visibility is plausible but target resolution is uncertain

If review is required and the tool cannot verify:

- it returns `unverified`
- the harness must surface that state in the model's final answer

## Interfaces

The tool should be accessible through both CLI and MCP.

### CLI

Examples:

```bash
seem assess-change --task "change this button colour to blue" --cwd /repo
seem resolve-targets --cwd /repo --task "change this button colour to blue"
seem open-target --recipe recipe.json
seem capture --session session_123 --view view.json
seem review --task "change this button colour to blue" --snapshot snapshot.json
seem gate-status --run run_123
```

### MCP methods

- `assess_change`
- `resolve_targets`
- `open_target`
- `interact`
- `capture_view`
- `review_visual`
- `get_gate_status`
- `close_target`

## Example End-to-End: Button Colour Change

1. User asks: "change this button colour to blue"
2. Harness calls `assess_change`
3. Tool returns:
   - `human_visible = true`
   - `review_required = true`
   - target `storybook:Button/Primary`
4. Model edits the CSS
5. Harness calls `open_target`
6. Browser adapter opens the button story
7. Tool captures the story at desktop and mobile sizes
8. Review engine checks:
   - button region exists
   - background color is blue
   - text contrast is still acceptable
   - layout did not break
9. If pass, completion gate opens
10. If fail, model receives findings and keeps iterating

## Example End-to-End: PPT Parser Output

1. User asks: "fix the parser so grouped text boxes preserve layout"
2. Harness calls `assess_change`
3. Tool marks the change as human-visible
4. Model edits parser code
5. Renderer adapter runs a fixture render:
   - source deck -> canonical slide images
   - parsed output -> reconstructed slide images
6. Snapshot bundles are created for both
7. Review engine compares:
   - OCR text preservation
   - grouping consistency
   - bounding box drift
   - visual similarity
8. Verdict is returned with per-slide findings

## Example End-to-End: Accordion Inside Modal

1. User asks: "add an accordion inside the settings modal"
2. Harness calls `assess_change`
3. Tool marks the change as:
   - `human_visible = true`
   - `review_required = true`
   - `interactive = true`
4. Target resolution selects the settings modal target
5. The target recipe includes a journey:
   - click "Open settings"
   - click "Advanced options"
6. Browser adapter captures:
   - modal closed baseline
   - modal open state
   - post-accordion-expansion state
7. Review engine checks:
   - modal width before and after expansion
   - horizontal overflow in the modal and viewport
   - text wrapping inside the accordion body
   - centered modal positioning
8. Verdict returns a transition finding if the modal expands horizontally
9. Harness feeds the finding back to the model and requires another edit cycle

## Why This Is General

This design is general because it standardizes at the correct abstraction boundary:

- Different artifacts are rendered by different adapters.
- Once rendered, everything is evaluated as a visual surface.
- The review engine operates on normalized snapshots rather than on app-specific internals.

This means the tool grows by adding a small number of adapter classes rather than by creating a custom reviewer for every framework or format.

## MVP Scope

The first useful version should support:

- browser adapter
- renderer adapter
- manifest-based target resolution
- screenshot capture
- OCR
- basic deterministic checks
- VLM review
- required completion gate

This is enough to cover:

- most web UI work
- docs and page generation
- parser outputs that can be rendered to pages or images
- many export pipelines
- interaction bugs on browser-based targets with manifest-defined journeys

## Later Extensions

- simulator adapter for iOS and Android
- window adapter for native desktop apps
- before and after diff clustering
- richer accessibility-tree checks
- automatic fixture synthesis
- persistent baseline image storage
- review rubrics per target
- flaky-render stabilization and retry logic

## Risks and Constraints

- Rendering is inherently environment-specific. Adapters still need per-platform work.
- Pixel-based checks alone can be too brittle. Structural and OCR layers are required.
- Vision models can be noisy. Deterministic checks should be used wherever possible.
- Target discovery may be ambiguous without a manifest. Repo-level hints are important.
- Some surfaces are hard to drive deterministically. The tool must preserve and report uncertainty.
- Interaction coverage is never complete. The tool needs explicit journeys for important states and good heuristics for the rest.

## Recommended Implementation Order

1. Define the common data model and CLI or MCP contract.
2. Implement `assess_change`, `resolve_targets`, and the completion gate.
3. Implement browser adapter and renderer adapter.
4. Implement snapshot normalization with OCR and metadata.
5. Implement journey execution and stepwise capture for browser targets.
6. Implement deterministic review checks, including geometry and overflow invariants.
7. Add VLM review for task-level critique.
8. Add simulator and window adapters later if needed.

## Bottom Line

The system should not be built as "Playwright plus some special-case reviewers." It should be built as a visual verification sidecar with:

- a shared protocol for human-visible targets
- a small set of rendering adapters
- a normalized snapshot bundle
- a unified review engine
- an enforceable completion gate

That combination gives a model a practical way to visually verify its work across many output types without requiring a separate end-to-end solution for every format.
