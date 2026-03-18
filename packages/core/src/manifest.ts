import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import {
  adapterKindSchema,
  journeyActionSchema,
  invariantSpecSchema,
  journeySpecSchema,
  journeyStepSchema,
  launchConfigSchema,
  reviewPolicyModeSchema,
  surfaceConfigSchema,
  targetRecipeSchema,
  themeSchema,
  viewSpecSchema,
  viewportSchema,
  type InvariantSpec,
  type JourneySpec,
  type JourneyStep,
  type ViewSpec,
} from './schemas.js';

const nonEmptyStringSchema = z.string().trim().min(1);

export const seemManifestFileName = 'seem.yaml';

export const manifestDefaultsSchema = z
  .object({
    review_policy: reviewPolicyModeSchema.default('advisory'),
    viewports: z.array(viewportSchema).default([]),
    theme: themeSchema.optional(),
    density: z.number().positive().default(1),
  })
  .strict();
export type ManifestDefaults = z.output<typeof manifestDefaultsSchema>;

export const manifestWhenSchema = z
  .object({
    paths: z.array(nonEmptyStringSchema).min(1),
    tasks: z.array(nonEmptyStringSchema).default([]),
  })
  .strict();
export type ManifestWhen = z.output<typeof manifestWhenSchema>;

export const manifestPolicySchema = z
  .object({
    timeout_ms: z.number().int().positive().optional(),
    ready_timeout_ms: z.number().int().positive().optional(),
  })
  .passthrough();
export type ManifestPolicy = z.output<typeof manifestPolicySchema>;

export const manifestEnvironmentSchema = z
  .object({
    cwd: nonEmptyStringSchema.optional(),
    env: z.record(z.string(), z.string()).default({}),
  })
  .passthrough();
export type ManifestEnvironment = z.output<typeof manifestEnvironmentSchema>;

export const manifestTargetSchema = z
  .object({
    id: nonEmptyStringSchema,
    when: manifestWhenSchema,
    recipe: targetRecipeSchema,
  })
  .strict();
export type ManifestTarget = z.output<typeof manifestTargetSchema>;

export const seemManifestSchema = z
  .object({
    defaults: manifestDefaultsSchema,
    targets: z.array(manifestTargetSchema).min(1),
    policies: z.record(z.string(), manifestPolicySchema).default({}),
    environments: z.record(z.string(), manifestEnvironmentSchema).default({}),
  })
  .strict();
export type SeemManifest = z.output<typeof seemManifestSchema>;

const rawNormalizedJourneyStepSchema = z
  .object({
    id: nonEmptyStringSchema.optional(),
    action: journeyActionSchema,
    target: nonEmptyStringSchema.optional(),
    value: nonEmptyStringSchema.optional(),
    viewport: viewportSchema.optional(),
    timeout_ms: z.number().int().positive().optional(),
    delta: z.tuple([z.number().finite(), z.number().finite()]).optional(),
    direction: z.enum(['up', 'down', 'left', 'right']).optional(),
  })
  .strict();

type RawJourneyStep =
  | z.output<typeof rawNormalizedJourneyStepSchema>
  | { click: string }
  | { tap: string }
  | { hover: string }
  | { focus: string }
  | { wait_for: string }
  | { resize: z.output<typeof viewportSchema> }
  | { type: { target: string; value: string } }
  | {
      scroll: {
        target?: string;
        delta?: [number, number];
        direction?: 'up' | 'down' | 'left' | 'right';
      };
    };

const rawJourneyStepSchema = z.union([
  rawNormalizedJourneyStepSchema,
  z.object({ click: nonEmptyStringSchema }).strict(),
  z.object({ tap: nonEmptyStringSchema }).strict(),
  z.object({ hover: nonEmptyStringSchema }).strict(),
  z.object({ focus: nonEmptyStringSchema }).strict(),
  z.object({ wait_for: nonEmptyStringSchema }).strict(),
  z.object({ resize: viewportSchema }).strict(),
  z
    .object({
      type: z
        .object({
          target: nonEmptyStringSchema,
          value: nonEmptyStringSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      scroll: z
        .object({
          target: nonEmptyStringSchema.optional(),
          delta: z.tuple([z.number().finite(), z.number().finite()]).optional(),
          direction: z.enum(['up', 'down', 'left', 'right']).optional(),
        })
        .strict(),
    })
    .strict(),
]);

const rawJourneySpecSchema = z
  .object({
    journey_id: nonEmptyStringSchema.optional(),
    steps: z.array(rawJourneyStepSchema),
  })
  .strict();

type RawInvariant = z.output<typeof invariantSpecSchema> | string;

const rawRecipeSchema = z
  .object({
    adapter: adapterKindSchema,
    launch: launchConfigSchema.optional(),
    surface: surfaceConfigSchema,
    views: z.array(viewSpecSchema).optional(),
    journey: z
      .union([rawJourneySpecSchema, z.array(rawJourneyStepSchema)])
      .optional(),
    invariants: z
      .array(z.union([invariantSpecSchema, nonEmptyStringSchema]))
      .optional(),
  })
  .strict();

const rawTargetSchema = z
  .object({
    id: nonEmptyStringSchema,
    when: manifestWhenSchema,
    recipe: rawRecipeSchema,
  })
  .strict();

const rawManifestSchema = z
  .object({
    defaults: z.unknown().optional(),
    targets: z.array(rawTargetSchema).min(1),
    policies: z.record(z.string(), manifestPolicySchema).optional(),
    environments: z.record(z.string(), manifestEnvironmentSchema).optional(),
  })
  .strict();

export interface LoadSeemManifestInput {
  cwd?: string;
  manifest_path?: string;
}

export interface LoadedSeemManifest {
  manifest: SeemManifest;
  manifest_path: string;
}

function sanitizeSegment(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return sanitized.length > 0 ? sanitized : 'item';
}

function createDefaultStepId(
  action: string,
  suffix: string,
  index: number,
): string {
  const stepNumber = String(index + 1).padStart(2, '0');
  return `step_${stepNumber}_${action}_${sanitizeSegment(suffix)}`;
}

function normalizeJourneyStep(
  step: RawJourneyStep,
  index: number,
): JourneyStep {
  if ('action' in step) {
    const parsed = rawNormalizedJourneyStepSchema.parse(step);
    return journeyStepSchema.parse({
      ...parsed,
      id:
        parsed.id ??
        createDefaultStepId(
          parsed.action,
          parsed.target ?? parsed.action,
          index,
        ),
    });
  }

  if ('click' in step) {
    return journeyStepSchema.parse({
      id: createDefaultStepId('click', step.click, index),
      action: 'click',
      target: step.click,
    });
  }

  if ('tap' in step) {
    return journeyStepSchema.parse({
      id: createDefaultStepId('tap', step.tap, index),
      action: 'tap',
      target: step.tap,
    });
  }

  if ('hover' in step) {
    return journeyStepSchema.parse({
      id: createDefaultStepId('hover', step.hover, index),
      action: 'hover',
      target: step.hover,
    });
  }

  if ('focus' in step) {
    return journeyStepSchema.parse({
      id: createDefaultStepId('focus', step.focus, index),
      action: 'focus',
      target: step.focus,
    });
  }

  if ('wait_for' in step) {
    return journeyStepSchema.parse({
      id: createDefaultStepId('wait_for', step.wait_for, index),
      action: 'wait_for',
      target: step.wait_for,
    });
  }

  if ('resize' in step) {
    return journeyStepSchema.parse({
      id: createDefaultStepId(
        'resize',
        `${step.resize[0]}x${step.resize[1]}`,
        index,
      ),
      action: 'resize',
      viewport: step.resize,
    });
  }

  if ('type' in step) {
    return journeyStepSchema.parse({
      id: createDefaultStepId('type', step.type.target, index),
      action: 'type',
      target: step.type.target,
      value: step.type.value,
    });
  }

  return journeyStepSchema.parse({
    id: createDefaultStepId(
      'scroll',
      step.scroll.target ?? step.scroll.direction ?? 'scroll',
      index,
    ),
    action: 'scroll',
    target: step.scroll.target,
    delta: step.scroll.delta,
    direction: step.scroll.direction,
  });
}

function normalizeJourney(
  rawJourney:
    | z.output<typeof rawJourneySpecSchema>
    | RawJourneyStep[]
    | undefined,
  targetId: string,
): JourneySpec | undefined {
  if (rawJourney === undefined) {
    return undefined;
  }

  if (!Array.isArray(rawJourney)) {
    return journeySpecSchema.parse({
      journey_id:
        rawJourney.journey_id ?? `${sanitizeSegment(targetId)}_journey`,
      steps: rawJourney.steps.map((step, index) =>
        normalizeJourneyStep(step, index),
      ),
    });
  }

  return journeySpecSchema.parse({
    journey_id: `${sanitizeSegment(targetId)}_journey`,
    steps: rawJourney.map((step, index) => normalizeJourneyStep(step, index)),
  });
}

function normalizeInvariant(invariant: RawInvariant): InvariantSpec {
  if (typeof invariant === 'string') {
    return invariantSpecSchema.parse({
      invariant_id: invariant,
      type: invariant,
      severity: 'medium',
    });
  }

  return invariantSpecSchema.parse(invariant);
}

function normalizeViews(
  views: ViewSpec[] | undefined,
  defaults: ManifestDefaults,
): ViewSpec[] {
  if (views !== undefined) {
    return views.map((view, index) =>
      viewSpecSchema.parse({
        ...view,
        view_id:
          view.view_id ??
          `view_${String(index + 1).padStart(2, '0')}${
            view.viewport !== undefined
              ? `_${view.viewport[0]}x${view.viewport[1]}`
              : ''
          }`,
        ...(view.theme === undefined && defaults.theme === undefined
          ? {}
          : { theme: view.theme ?? defaults.theme }),
        density: view.density ?? defaults.density,
      }),
    );
  }

  return defaults.viewports.map((viewport, index) =>
    viewSpecSchema.parse({
      view_id: `view_${String(index + 1).padStart(2, '0')}_${viewport[0]}x${viewport[1]}`,
      viewport,
      ...(defaults.theme === undefined ? {} : { theme: defaults.theme }),
      density: defaults.density,
    }),
  );
}

export function parseSeemManifest(source: string): SeemManifest {
  const parsedYaml = parseYaml(source);
  const rawManifest = rawManifestSchema.parse(parsedYaml);
  const defaults = manifestDefaultsSchema.parse(rawManifest.defaults ?? {});
  const seenTargetIds = new Set<string>();

  const targets = rawManifest.targets.map((target) => {
    if (seenTargetIds.has(target.id)) {
      throw new Error(`Duplicate target id "${target.id}" in seem.yaml.`);
    }

    seenTargetIds.add(target.id);

    return manifestTargetSchema.parse({
      id: target.id,
      when: target.when,
      recipe: {
        target_id: target.id,
        adapter: target.recipe.adapter,
        launch: target.recipe.launch,
        surface: target.recipe.surface,
        views: normalizeViews(target.recipe.views, defaults),
        journey: normalizeJourney(target.recipe.journey, target.id),
        invariants: (target.recipe.invariants ?? []).map((invariant) =>
          normalizeInvariant(invariant),
        ),
      },
    });
  });

  return seemManifestSchema.parse({
    defaults,
    targets,
    policies: rawManifest.policies ?? {},
    environments: rawManifest.environments ?? {},
  });
}

export async function loadSeemManifest(
  input: LoadSeemManifestInput = {},
): Promise<LoadedSeemManifest> {
  const cwd = input.cwd ?? process.cwd();
  const manifestPath = resolve(
    cwd,
    input.manifest_path ?? seemManifestFileName,
  );
  const source = await readFile(manifestPath, 'utf8');

  return {
    manifest: parseSeemManifest(source),
    manifest_path: manifestPath,
  };
}
