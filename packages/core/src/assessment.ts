import { execFile as execFileCallback } from 'node:child_process';
import { matchesGlob } from 'node:path';
import { promisify } from 'node:util';

import {
  loadSeemManifest,
  type ManifestTarget,
  type SeemManifest,
} from './manifest.js';
import {
  changeAssessmentSchema,
  resolvedTargetSchema,
  type AdapterKind,
  type ChangeAssessment,
  type ResolvedTarget,
  type ReviewPolicyMode,
} from './schemas.js';

const execFile = promisify(execFileCallback);

const promptKeywordSets = {
  browser: [
    'button',
    'card',
    'color',
    'colour',
    'css',
    'dialog',
    'drawer',
    'font',
    'header',
    'hero',
    'icon',
    'image',
    'layout',
    'margin',
    'modal',
    'mobile',
    'page',
    'padding',
    'popover',
    'responsive',
    'screen',
    'screenshot',
    'sidebar',
    'spacing',
    'story',
    'storybook',
    'style',
    'table',
    'theme',
    'tooltip',
    'typography',
    'ui',
    'viewport',
    'visual',
  ],
  renderer: [
    'canvas',
    'deck',
    'document',
    'pdf',
    'poster',
    'presentation',
    'render',
    'rendering',
    'slide',
  ],
  simulator: [
    'android',
    'ios',
    'phone',
    'simulator',
    'tablet',
  ],
  window: ['desktop', 'electron', 'window'],
  stream: ['recording', 'stream', 'video'],
} as const satisfies Record<AdapterKind, readonly string[]>;

const strongVisualPathGlobs = [
  '**/*.astro',
  '**/*.css',
  '**/*.gif',
  '**/*.html',
  '**/*.jpeg',
  '**/*.jpg',
  '**/*.jsx',
  '**/*.less',
  '**/*.png',
  '**/*.sass',
  '**/*.scss',
  '**/*.svg',
  '**/*.svelte',
  '**/*.tsx',
  '**/*.vue',
];

const browserPathGlobs = [
  ...strongVisualPathGlobs,
  '**/app/**',
  '**/components/**',
  '**/pages/**',
  '**/public/**',
  '**/routes/**',
  '**/screens/**',
  '**/stories/**',
  '**/styles/**',
  '**/templates/**',
  '**/ui/**',
  '**/views/**',
];

const rendererPathGlobs = [
  '**/*.docx',
  '**/*.pdf',
  '**/*.pptx',
  '**/decks/**',
  '**/pdf/**',
  '**/render/**',
  '**/renders/**',
  '**/slides/**',
];

const simulatorPathGlobs = [
  '**/*.swift',
  '**/*.storyboard',
  '**/*.xib',
  '**/android/**',
  '**/ios/**',
  '**/simulator/**',
];

const windowPathGlobs = ['**/desktop/**', '**/electron/**', '**/windows/**'];
const streamPathGlobs = ['**/*.mp4', '**/*.mov', '**/stream/**', '**/video/**'];

const nonVisualPathGlobs = [
  '**/*.md',
  '**/*.mdx',
  '**/*.spec.*',
  '**/*.test.*',
  '**/__snapshots__/**',
  '**/__tests__/**',
  'docs/**',
];

const familyOrder: AdapterKind[] = [
  'browser',
  'renderer',
  'simulator',
  'window',
  'stream',
];

const renameLikeStatuses = new Set(['R', 'C']);

export interface ResolveChangedFilesInput {
  cwd?: string;
  changed_files?: string[];
  diff?: 'git' | string;
}

export interface ResolveTargetsInput extends ResolveChangedFilesInput {
  cwd?: string;
  task?: string;
  manifest?: SeemManifest;
  manifest_path?: string;
  explicit_targets?: string[];
  limit?: number;
}

export interface AssessChangeInput extends ResolveTargetsInput {
  review_policy?: ReviewPolicyMode;
}

interface PreparedInputs {
  changedFiles: string[];
  manifest?: SeemManifest;
  task: string;
}

interface PrepareInputsRequest extends ResolveChangedFilesInput {
  manifest?: SeemManifest;
  manifest_path?: string;
  task?: string;
}

interface PromptSignals {
  families: Set<AdapterKind>;
  keywords: string[];
  score: number;
}

interface PathSignals {
  examples: string[];
  families: Set<AdapterKind>;
  score: number;
}

interface RankedTargetSignals {
  matchedPaths: string[];
  reasoning: string[];
  score: number;
  source: ResolvedTarget['resolution_source'];
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function tokenize(value: string): string[] {
  return normalizeText(value).match(/[a-z0-9]+/g) ?? [];
}

function sortFamilies(families: Set<AdapterKind>): AdapterKind[] {
  return familyOrder.filter((family) => families.has(family));
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function hasGlob(pattern: string): boolean {
  return /[*?[\]{}()!+@]/.test(pattern);
}

function matchPath(filePath: string, pattern: string): boolean {
  return matchesGlob(normalizePath(filePath), normalizePath(pattern));
}

function matchTaskPattern(task: string, pattern: string): boolean {
  const normalizedTask = normalizeText(task);
  const normalizedPattern = normalizeText(pattern);

  if (normalizedTask.length === 0 || normalizedPattern.length === 0) {
    return false;
  }

  if (hasGlob(normalizedPattern)) {
    return matchesGlob(normalizedTask, normalizedPattern);
  }

  return normalizedTask.includes(normalizedPattern);
}

function extractPromptSignals(task: string): PromptSignals {
  const normalizedTask = normalizeText(task);
  const keywords = new Set<string>();
  const families = new Set<AdapterKind>();

  for (const family of familyOrder) {
    for (const keyword of promptKeywordSets[family]) {
      if (normalizedTask.includes(keyword)) {
        keywords.add(keyword);
        families.add(family);
      }
    }
  }

  const matchedKeywords = [...keywords].sort();

  if (
    matchedKeywords.length > 0 &&
    !families.has('renderer') &&
    !families.has('simulator') &&
    !families.has('window') &&
    !families.has('stream')
  ) {
    families.add('browser');
  }

  let score = 0;

  if (matchedKeywords.length > 0) {
    score = clamp(0.35 + (matchedKeywords.length - 1) * 0.08);
  }

  return {
    families,
    keywords: matchedKeywords,
    score,
  };
}

function pathMatchesAny(filePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchPath(filePath, pattern));
}

function extractPathSignals(changedFiles: string[]): PathSignals {
  const visualFiles = changedFiles.filter(
    (filePath) => !pathMatchesAny(filePath, nonVisualPathGlobs),
  );
  const families = new Set<AdapterKind>();

  for (const filePath of visualFiles) {
    if (pathMatchesAny(filePath, browserPathGlobs)) {
      families.add('browser');
    }

    if (pathMatchesAny(filePath, rendererPathGlobs)) {
      families.add('renderer');
    }

    if (pathMatchesAny(filePath, simulatorPathGlobs)) {
      families.add('simulator');
    }

    if (pathMatchesAny(filePath, windowPathGlobs)) {
      families.add('window');
    }

    if (pathMatchesAny(filePath, streamPathGlobs)) {
      families.add('stream');
    }
  }

  const strongMatches = visualFiles.filter((filePath) =>
    pathMatchesAny(filePath, strongVisualPathGlobs),
  );
  const broadMatches = visualFiles.filter((filePath) =>
    !strongMatches.includes(filePath) &&
    pathMatchesAny(filePath, [
      ...browserPathGlobs,
      ...rendererPathGlobs,
      ...simulatorPathGlobs,
      ...windowPathGlobs,
      ...streamPathGlobs,
    ]),
  );

  let score = 0;

  if (strongMatches.length > 0) {
    score = clamp(
      0.45 +
        Math.min(strongMatches.length, 3) * 0.12 +
        Math.min(broadMatches.length, 2) * 0.05,
    );
  } else if (broadMatches.length > 0) {
    score = clamp(0.28 + Math.min(broadMatches.length, 3) * 0.1);
  }

  return {
    examples: visualFiles.slice(0, 3),
    families,
    score,
  };
}

function inferTargetIdMatch(task: string, targetId: string): {
  matchedTerms: string[];
  score: number;
} {
  const taskTokens = new Set(tokenize(task));
  const targetTokens = dedupeStrings(tokenize(targetId)).filter(
    (token) => token.length > 2,
  );
  const matchedTerms = targetTokens.filter((token) => taskTokens.has(token));

  if (matchedTerms.length === 0) {
    return {
      matchedTerms,
      score: 0,
    };
  }

  return {
    matchedTerms,
    score: matchedTerms.length >= Math.min(2, targetTokens.length) ? 0.18 : 0.08,
  };
}

function scoreManifestTarget(
  input: PreparedInputs & {
    explicitTargets: Set<string>;
    inferredFamilies: Set<AdapterKind>;
  },
  target: ManifestTarget,
): RankedTargetSignals {
  const matchedPaths = input.changedFiles.filter((filePath) =>
    target.when.paths.some((pattern) => matchPath(filePath, pattern)),
  );
  const matchedPatterns = target.when.paths.filter((pattern) =>
    input.changedFiles.some((filePath) => matchPath(filePath, pattern)),
  );
  const matchedTaskPatterns = target.when.tasks.filter((pattern) =>
    matchTaskPattern(input.task, pattern),
  );
  const idMatch = inferTargetIdMatch(input.task, target.id);
  const reasoning: string[] = [];

  if (input.explicitTargets.has(target.id)) {
    reasoning.push(`Explicit target request selected "${target.id}".`);

    return {
      matchedPaths,
      reasoning,
      score: 1,
      source: 'explicit',
    };
  }

  let score = 0;
  let source: ResolvedTarget['resolution_source'] = 'heuristic';

  if (matchedPaths.length > 0) {
    const changedFileCoverage =
      input.changedFiles.length === 0
        ? 0
        : matchedPaths.length / input.changedFiles.length;
    const patternCoverage = matchedPatterns.length / target.when.paths.length;

    score += 0.5 + patternCoverage * 0.2 + changedFileCoverage * 0.15;
    source = 'manifest';
    reasoning.push(
      `Matched changed files against manifest paths: ${matchedPaths.join(', ')}.`,
    );
  }

  if (matchedTaskPatterns.length > 0) {
    const taskPatternCoverage =
      matchedTaskPatterns.length / target.when.tasks.length || 1;

    score += 0.16 + taskPatternCoverage * 0.12;
    source = 'manifest';
    reasoning.push(
      `Task matched target patterns: ${matchedTaskPatterns.join(', ')}.`,
    );
  }

  if (idMatch.score > 0) {
    score += idMatch.score;
    reasoning.push(
      `Task references target id terms: ${idMatch.matchedTerms.join(', ')}.`,
    );
  }

  if (input.inferredFamilies.has(target.recipe.adapter)) {
    score += 0.06;
    reasoning.push(
      `Prompt and changed files suggest the ${target.recipe.adapter} adapter.`,
    );
  }

  if (score > 0 && source === 'heuristic' && idMatch.score === 0) {
    source = 'convention';
  }

  return {
    matchedPaths,
    reasoning,
    score: clamp(score, 0, 0.99),
    source,
  };
}

async function maybeLoadManifest(input: {
  cwd?: string;
  manifest?: SeemManifest;
  manifest_path?: string;
}): Promise<SeemManifest | undefined> {
  if (input.manifest !== undefined) {
    return input.manifest;
  }

  try {
    const loaded = await loadSeemManifest({
      cwd: input.cwd,
      manifest_path: input.manifest_path,
    });
    return loaded.manifest;
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === 'ENOENT' &&
      input.manifest_path === undefined
    ) {
      return undefined;
    }

    throw error;
  }
}

function extractPathsFromDiffText(diffText: string): string[] {
  const paths = new Set<string>();

  for (const rawLine of diffText.split('\n')) {
    const line = rawLine.trim();

    if (line.startsWith('diff --git ')) {
      const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      const nextPath = match?.[2];

      if (nextPath !== undefined && nextPath !== '/dev/null') {
        paths.add(normalizePath(nextPath));
      }

      continue;
    }

    if (line.startsWith('+++ b/')) {
      const filePath = line.slice('+++ b/'.length);

      if (filePath !== '/dev/null') {
        paths.add(normalizePath(filePath));
      }

      continue;
    }

    if (line.startsWith('rename to ')) {
      paths.add(normalizePath(line.slice('rename to '.length)));
    }
  }

  return [...paths];
}

async function listGitChangedFiles(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await execFile(
      'git',
      ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
      { cwd, encoding: 'utf8' },
    );
    const entries = stdout.split('\0');
    const changedFiles = new Set<string>();

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index] ?? '';

      if (entry.length === 0) {
        continue;
      }

      const status = entry.slice(0, 2);
      const filePath = normalizePath(entry.slice(3));

      if (
        renameLikeStatuses.has(status[0] ?? '') ||
        renameLikeStatuses.has(status[1] ?? '')
      ) {
        const renamedPath = normalizePath(entries[index + 1] ?? filePath);
        changedFiles.add(renamedPath);
        index += 1;
        continue;
      }

      changedFiles.add(filePath);
    }

    return [...changedFiles].sort();
  } catch (error) {
    const failure = error as Error & { stderr?: string; stdout?: string };
    const stderr = failure.stderr ?? '';

    if (stderr.includes('not a git repository')) {
      return [];
    }

    throw error;
  }
}

async function prepareInputs(
  input: PrepareInputsRequest,
): Promise<PreparedInputs> {
  const manifest = await maybeLoadManifest(input);
  const task = input.task ?? '';
  let changedFiles: string[] = [];

  if (input.changed_files !== undefined) {
    changedFiles = dedupeStrings(input.changed_files.map(normalizePath)).sort();
  } else if (input.diff === 'git') {
    changedFiles = await listGitChangedFiles(input.cwd ?? process.cwd());
  } else if (typeof input.diff === 'string' && input.diff.length > 0) {
    changedFiles = dedupeStrings(extractPathsFromDiffText(input.diff)).sort();
  }

  return {
    changedFiles,
    manifest,
    task,
  };
}

export async function resolveChangedFiles(
  input: ResolveChangedFilesInput = {},
): Promise<string[]> {
  const prepared = await prepareInputs(input);
  return prepared.changedFiles;
}

export async function resolveTargets(
  input: ResolveTargetsInput,
): Promise<ResolvedTarget[]> {
  const prepared = await prepareInputs(input);

  if (prepared.manifest === undefined) {
    return [];
  }

  const promptSignals = extractPromptSignals(prepared.task);
  const pathSignals = extractPathSignals(prepared.changedFiles);
  const inferredFamilies = new Set<AdapterKind>([
    ...promptSignals.families,
    ...pathSignals.families,
  ]);
  const explicitTargets = new Set(input.explicit_targets ?? []);

  const rankedTargets = prepared.manifest.targets
    .map((target) => {
      const rankedSignals = scoreManifestTarget(
        {
          ...prepared,
          explicitTargets,
          inferredFamilies,
        },
        target,
      );

      if (rankedSignals.score < 0.12) {
        return undefined;
      }

      return resolvedTargetSchema.parse({
        target_id: target.id,
        score: rankedSignals.score,
        resolution_source: rankedSignals.source,
        reasoning: rankedSignals.reasoning,
        matched_paths: rankedSignals.matchedPaths,
        recipe: target.recipe,
      });
    })
    .filter((target): target is ResolvedTarget => target !== undefined)
    .sort(
      (left, right) =>
        right.score - left.score || left.target_id.localeCompare(right.target_id),
    );

  return rankedTargets.slice(0, input.limit ?? 5);
}

export async function assessChange(
  input: AssessChangeInput,
): Promise<ChangeAssessment> {
  const prepared = await prepareInputs(input);
  const promptSignals = extractPromptSignals(prepared.task);
  const pathSignals = extractPathSignals(prepared.changedFiles);
  const rankedTargets = await resolveTargets({
    ...input,
    changed_files: prepared.changedFiles,
    manifest: prepared.manifest,
  });
  const families = new Set<AdapterKind>([
    ...promptSignals.families,
    ...pathSignals.families,
    ...rankedTargets.map((target) => target.recipe.adapter),
  ]);
  const reasoning: string[] = [];

  if (promptSignals.keywords.length > 0) {
    reasoning.push(
      `Task mentions visual terms: ${promptSignals.keywords.join(', ')}.`,
    );
  }

  if (pathSignals.examples.length > 0) {
    reasoning.push(
      `Changed files include visual surface paths: ${pathSignals.examples.join(', ')}.`,
    );
  }

  if (rankedTargets[0] !== undefined) {
    reasoning.push(
      `Top target candidate is "${rankedTargets[0].target_id}" with score ${rankedTargets[0].score.toFixed(2)}.`,
    );
  }

  const visualRelevance = clamp(
    Math.max(
      promptSignals.score,
      pathSignals.score,
      rankedTargets[0]?.score ?? 0,
      promptSignals.score * 0.45 +
        pathSignals.score * 0.35 +
        (rankedTargets[0]?.score ?? 0) * 0.35,
    ),
  );
  const humanVisible =
    visualRelevance >= 0.35 ||
    rankedTargets.length > 0 ||
    promptSignals.keywords.length > 0;
  const reviewPolicy =
    input.review_policy ??
    prepared.manifest?.defaults.review_policy ??
    'advisory';
  const reviewRequired = humanVisible && reviewPolicy !== 'off';

  reasoning.push(
    reviewRequired
      ? `Review is required under the ${reviewPolicy} policy.`
      : `Review is not required under the ${reviewPolicy} policy.`,
  );

  return changeAssessmentSchema.parse({
    human_visible: humanVisible,
    visual_relevance: Number(visualRelevance.toFixed(4)),
    review_required: reviewRequired,
    targets: rankedTargets
      .slice(0, input.limit ?? 3)
      .map((target) => target.target_id),
    reasoning,
    target_families: sortFamilies(families),
  });
}
