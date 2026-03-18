import { z } from 'zod';

const nonEmptyStringSchema = z.string().trim().min(1);
const finiteNumberSchema = z.number().finite();
const positiveIntegerSchema = z.number().int().positive();
const timestampSchema = nonEmptyStringSchema.refine(
  (value) => !Number.isNaN(Date.parse(value)),
  'Expected an ISO-8601 timestamp.',
);

export const adapterKindSchema = z.enum([
  'browser',
  'renderer',
  'simulator',
  'window',
  'stream',
]);
export type AdapterKind = z.output<typeof adapterKindSchema>;

export const themeSchema = z.enum(['light', 'dark', 'system']);
export type Theme = z.output<typeof themeSchema>;

export const reviewPolicyModeSchema = z.enum(['off', 'advisory', 'required']);
export type ReviewPolicyMode = z.output<typeof reviewPolicyModeSchema>;

export const severitySchema = z.enum(['low', 'medium', 'high', 'critical']);
export type Severity = z.output<typeof severitySchema>;

export const reviewStatusSchema = z.enum(['pass', 'fail', 'unverified']);
export type ReviewStatus = z.output<typeof reviewStatusSchema>;

export const reviewCheckStatusSchema = z.enum([
  'pass',
  'fail',
  'warn',
  'unverified',
]);
export type ReviewCheckStatus = z.output<typeof reviewCheckStatusSchema>;

export const transitionFindingStatusSchema = z.enum(['pass', 'fail', 'warn']);
export type TransitionFindingStatus = z.output<
  typeof transitionFindingStatusSchema
>;

export const gateDecisionSchema = z.enum(['open', 'blocked', 'advisory']);
export type GateDecision = z.output<typeof gateDecisionSchema>;

export const resolutionSourceSchema = z.enum([
  'explicit',
  'manifest',
  'convention',
  'heuristic',
]);
export type ResolutionSource = z.output<typeof resolutionSourceSchema>;

export const viewportSchema = z.tuple([
  positiveIntegerSchema,
  positiveIntegerSchema,
]);
export type Viewport = z.output<typeof viewportSchema>;

export const bboxSchema = z.tuple([
  finiteNumberSchema,
  finiteNumberSchema,
  finiteNumberSchema,
  finiteNumberSchema,
]);
export type BoundingBox = z.output<typeof bboxSchema>;

export const launchConfigSchema = z
  .object({
    cmd: nonEmptyStringSchema,
    cwd: nonEmptyStringSchema.optional(),
    env: z.record(z.string(), z.string()).default({}),
    ready_selector: nonEmptyStringSchema.optional(),
    ready_timeout_ms: positiveIntegerSchema.optional(),
  })
  .strict();
export type LaunchConfig = z.output<typeof launchConfigSchema>;

export const surfaceConfigSchema = z
  .object({
    url: nonEmptyStringSchema.optional(),
    files: z.array(nonEmptyStringSchema).min(1).optional(),
    screen: nonEmptyStringSchema.optional(),
    window_title: nonEmptyStringSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.url === undefined &&
      value.files === undefined &&
      value.screen === undefined &&
      value.window_title === undefined
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'surface must declare at least one of url, files, screen, or window_title.',
        path: ['surface'],
      });
    }
  });
export type SurfaceConfig = z.output<typeof surfaceConfigSchema>;

export const viewSpecSchema = z
  .object({
    view_id: nonEmptyStringSchema.optional(),
    viewport: viewportSchema.optional(),
    page: positiveIntegerSchema.optional(),
    frame: nonEmptyStringSchema.nullable().optional(),
    camera: nonEmptyStringSchema.nullable().optional(),
    theme: themeSchema.optional(),
    density: z.number().positive().optional(),
  })
  .strict();
export type ViewSpec = z.output<typeof viewSpecSchema>;

export const journeyActionSchema = z.enum([
  'click',
  'tap',
  'type',
  'scroll',
  'hover',
  'focus',
  'resize',
  'wait_for',
]);
export type JourneyAction = z.output<typeof journeyActionSchema>;

export const journeyStepSchema = z
  .object({
    id: nonEmptyStringSchema,
    action: journeyActionSchema,
    target: nonEmptyStringSchema.optional(),
    value: nonEmptyStringSchema.optional(),
    viewport: viewportSchema.optional(),
    timeout_ms: positiveIntegerSchema.optional(),
    delta: z.tuple([finiteNumberSchema, finiteNumberSchema]).optional(),
    direction: z.enum(['up', 'down', 'left', 'right']).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      ['click', 'tap', 'hover', 'focus', 'wait_for'].includes(value.action) &&
      value.target === undefined
    ) {
      context.addIssue({
        code: 'custom',
        message: `"${value.action}" steps require a target.`,
        path: ['target'],
      });
    }

    if (value.action === 'type') {
      if (value.target === undefined) {
        context.addIssue({
          code: 'custom',
          message: '"type" steps require a target.',
          path: ['target'],
        });
      }

      if (value.value === undefined) {
        context.addIssue({
          code: 'custom',
          message: '"type" steps require a value.',
          path: ['value'],
        });
      }
    }

    if (value.action === 'resize' && value.viewport === undefined) {
      context.addIssue({
        code: 'custom',
        message: '"resize" steps require a viewport.',
        path: ['viewport'],
      });
    }

    if (
      value.action === 'scroll' &&
      value.target === undefined &&
      value.delta === undefined &&
      value.direction === undefined
    ) {
      context.addIssue({
        code: 'custom',
        message:
          '"scroll" steps require at least one of target, delta, or direction.',
        path: ['target'],
      });
    }
  });
export type JourneyStep = z.output<typeof journeyStepSchema>;

export const journeySpecSchema = z
  .object({
    journey_id: nonEmptyStringSchema,
    steps: z.array(journeyStepSchema).default([]),
  })
  .strict();
export type JourneySpec = z.output<typeof journeySpecSchema>;

export const invariantSpecSchema = z
  .object({
    invariant_id: nonEmptyStringSchema,
    type: nonEmptyStringSchema,
    target_region: nonEmptyStringSchema.optional(),
    threshold: finiteNumberSchema.optional(),
    severity: severitySchema.default('medium'),
  })
  .strict();
export type InvariantSpec = z.output<typeof invariantSpecSchema>;

export const targetRecipeSchema = z
  .object({
    target_id: nonEmptyStringSchema,
    adapter: adapterKindSchema,
    launch: launchConfigSchema.optional(),
    surface: surfaceConfigSchema,
    views: z.array(viewSpecSchema).default([]),
    journey: journeySpecSchema.optional(),
    invariants: z.array(invariantSpecSchema).default([]),
  })
  .strict();
export type TargetRecipe = z.output<typeof targetRecipeSchema>;

export const changeAssessmentSchema = z
  .object({
    human_visible: z.boolean(),
    visual_relevance: z.number().min(0).max(1),
    review_required: z.boolean(),
    targets: z.array(nonEmptyStringSchema).default([]),
    reasoning: z.array(nonEmptyStringSchema).default([]),
    target_families: z.array(nonEmptyStringSchema).default([]),
  })
  .strict();
export type ChangeAssessment = z.output<typeof changeAssessmentSchema>;

export const resolvedTargetSchema = z
  .object({
    target_id: nonEmptyStringSchema,
    score: z.number().min(0).max(1),
    resolution_source: resolutionSourceSchema,
    reasoning: z.array(nonEmptyStringSchema).default([]),
    matched_paths: z.array(nonEmptyStringSchema).default([]),
    recipe: targetRecipeSchema,
  })
  .strict();
export type ResolvedTarget = z.output<typeof resolvedTargetSchema>;

export const ocrEntrySchema = z
  .object({
    text: nonEmptyStringSchema,
    bbox: bboxSchema,
  })
  .strict();
export type OcrEntry = z.output<typeof ocrEntrySchema>;

export const snapshotRegionSchema = z
  .object({
    label: nonEmptyStringSchema,
    bbox: bboxSchema,
  })
  .strict();
export type SnapshotRegion = z.output<typeof snapshotRegionSchema>;

export const snapshotMetadataSchema = z
  .object({
    viewport: viewportSchema.optional(),
    device: nonEmptyStringSchema.optional(),
    timestamp: timestampSchema,
    page: positiveIntegerSchema.optional(),
    frame: nonEmptyStringSchema.nullable().optional(),
    theme: themeSchema.optional(),
    density: z.number().positive().optional(),
  })
  .passthrough();
export type SnapshotMetadata = z.output<typeof snapshotMetadataSchema>;

export const snapshotBundleSchema = z
  .object({
    snapshot_id: nonEmptyStringSchema,
    target_id: nonEmptyStringSchema,
    step_id: nonEmptyStringSchema.optional(),
    images: z.array(nonEmptyStringSchema).min(1),
    ocr: z.array(ocrEntrySchema).default([]),
    regions: z.array(snapshotRegionSchema).default([]),
    metadata: snapshotMetadataSchema,
  })
  .strict();
export type SnapshotBundle = z.output<typeof snapshotBundleSchema>;

export const transitionFindingSchema = z
  .object({
    status: transitionFindingStatusSchema,
    step_id: nonEmptyStringSchema.optional(),
    invariant_id: nonEmptyStringSchema.optional(),
    reason: nonEmptyStringSchema,
    evidence: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export type TransitionFinding = z.output<typeof transitionFindingSchema>;

export const reviewCheckSchema = z
  .object({
    name: nonEmptyStringSchema,
    status: reviewCheckStatusSchema,
    details: nonEmptyStringSchema,
  })
  .strict();
export type ReviewCheck = z.output<typeof reviewCheckSchema>;

export const reviewVerdictSchema = z
  .object({
    status: reviewStatusSchema,
    confidence: z.number().min(0).max(1),
    checks: z.array(reviewCheckSchema).default([]),
    findings: z.array(transitionFindingSchema).default([]),
    summary: nonEmptyStringSchema.optional(),
  })
  .strict();
export type ReviewVerdict = z.output<typeof reviewVerdictSchema>;

export const gateStatusSchema = z
  .object({
    status: gateDecisionSchema,
    mode: reviewPolicyModeSchema,
    review_status: reviewStatusSchema.optional(),
    reason: nonEmptyStringSchema.optional(),
  })
  .strict();
export type GateStatus = z.output<typeof gateStatusSchema>;

export const runArtifactPathsSchema = z
  .object({
    manifest: nonEmptyStringSchema,
    task: nonEmptyStringSchema,
    assessment: nonEmptyStringSchema,
    targets: nonEmptyStringSchema,
    journey: nonEmptyStringSchema,
    review: nonEmptyStringSchema,
    gate: nonEmptyStringSchema,
    events: nonEmptyStringSchema,
    snapshots_dir: nonEmptyStringSchema,
    crops_dir: nonEmptyStringSchema,
    ocr_dir: nonEmptyStringSchema,
  })
  .strict();
export type RunArtifactPaths = z.output<typeof runArtifactPathsSchema>;

export const runStatusSchema = z.enum(['created', 'active', 'completed']);
export type RunStatus = z.output<typeof runStatusSchema>;

export const runManifestSchema = z
  .object({
    schema_version: z.literal(1),
    run_id: nonEmptyStringSchema,
    created_at: timestampSchema,
    cwd: nonEmptyStringSchema,
    task: nonEmptyStringSchema.optional(),
    manifest_path: nonEmptyStringSchema.optional(),
    status: runStatusSchema.default('created'),
    paths: runArtifactPathsSchema,
  })
  .strict();
export type RunManifest = z.output<typeof runManifestSchema>;

export const runTaskSchema = z
  .object({
    task: nonEmptyStringSchema,
    cwd: nonEmptyStringSchema.optional(),
    diff: z.union([z.literal('git'), nonEmptyStringSchema]).optional(),
  })
  .strict();
export type RunTask = z.output<typeof runTaskSchema>;

export const runEventSchema = z
  .object({
    timestamp: timestampSchema,
    level: z.enum(['debug', 'info', 'warn', 'error']),
    type: nonEmptyStringSchema,
    data: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export type RunEvent = z.output<typeof runEventSchema>;

export const runRecordSchema = z
  .object({
    manifest: runManifestSchema,
    task: runTaskSchema.optional(),
    assessment: changeAssessmentSchema.optional(),
    targets: z.array(resolvedTargetSchema).optional(),
    journey: journeySpecSchema.optional(),
    review: reviewVerdictSchema.optional(),
    gate: gateStatusSchema.optional(),
    events: z.array(runEventSchema),
  })
  .strict();
export type RunRecord = z.output<typeof runRecordSchema>;
