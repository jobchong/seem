import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import {
  changeAssessmentSchema,
  gateStatusSchema,
  journeySpecSchema,
  resolvedTargetSchema,
  reviewVerdictSchema,
  runEventSchema,
  runManifestSchema,
  runRecordSchema,
  runTaskSchema,
  type ChangeAssessment,
  type GateStatus,
  type JourneySpec,
  type ResolvedTarget,
  type ReviewVerdict,
  type RunEvent,
  type RunManifest,
  type RunRecord,
  type RunTask,
} from './schemas.js';

const resolvedTargetsSchema = resolvedTargetSchema.array();

export const seemArtifactRootDirName = '.seem';
export const seemRunRootDirName = 'runs';

export const defaultRunArtifactPaths = {
  manifest: 'run.json',
  task: 'task.json',
  assessment: 'assessment.json',
  targets: 'targets.json',
  journey: 'journey.json',
  review: 'review.json',
  gate: 'gate.json',
  events: 'events.jsonl',
  snapshots_dir: 'snapshots',
  crops_dir: 'crops',
  ocr_dir: 'ocr',
} as const;

export interface CreateRunDirectoryInput {
  cwd: string;
  task?: string;
  manifest_path?: string;
  run_id?: string;
  created_at?: string;
}

export interface CreatedRunDirectory {
  manifest: RunManifest;
  run_dir: string;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function padMilliseconds(value: number): string {
  return String(value).padStart(3, '0');
}

function sanitizeSegment(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return sanitized.length > 0 ? sanitized : 'artifact';
}

function toRelativePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

async function writeJsonFile<T>(filePath: string, value: T): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readOptionalJson<T>(
  filePath: string,
  parser: { parse(value: unknown): T },
): Promise<T | undefined> {
  try {
    const contents = await readFile(filePath, 'utf8');
    return parser.parse(JSON.parse(contents));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }

    throw error;
  }
}

export function createRunId(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = pad(now.getUTCMonth() + 1);
  const day = pad(now.getUTCDate());
  const hour = pad(now.getUTCHours());
  const minute = pad(now.getUTCMinutes());
  const second = pad(now.getUTCSeconds());
  const milliseconds = padMilliseconds(now.getUTCMilliseconds());

  return `run_${year}${month}${day}_${hour}${minute}${second}_${milliseconds}`;
}

export function resolveRunDirectory(cwd: string, runId: string): string {
  return resolve(cwd, seemArtifactRootDirName, seemRunRootDirName, runId);
}

export function createSnapshotArtifactName(input: {
  step_id?: string;
  step_index?: number;
  view_id?: string;
  extension?: string;
}): string {
  const extension = sanitizeSegment(input.extension ?? 'png');
  const parts =
    input.step_id === undefined
      ? ['initial']
      : [
          `step_${String(input.step_index ?? 1).padStart(2, '0')}`,
          sanitizeSegment(input.step_id),
        ];

  if (input.view_id !== undefined) {
    parts.push(sanitizeSegment(input.view_id));
  }

  return `${parts.join('.')}.${extension}`;
}

export function createCropArtifactName(input: {
  region_label: string;
  step_id?: string;
  step_index?: number;
  view_id?: string;
  extension?: string;
}): string {
  const snapshotName = createSnapshotArtifactName(input).replace(
    /\.[^.]+$/,
    '',
  );
  return `${snapshotName}--${sanitizeSegment(input.region_label)}.${sanitizeSegment(
    input.extension ?? 'png',
  )}`;
}

export function createOcrArtifactName(input: {
  step_id?: string;
  step_index?: number;
  view_id?: string;
}): string {
  const snapshotName = createSnapshotArtifactName(input).replace(
    /\.[^.]+$/,
    '',
  );
  return `${snapshotName}.json`;
}

export function resolveRunArtifactPath(
  runDir: string,
  relativePath: string,
): string {
  return join(runDir, relativePath);
}

export async function createRunDirectory(
  input: CreateRunDirectoryInput,
): Promise<CreatedRunDirectory> {
  const runId = input.run_id ?? createRunId();
  const runDir = resolveRunDirectory(input.cwd, runId);
  const createdAt = input.created_at ?? new Date().toISOString();

  await mkdir(
    resolveRunArtifactPath(runDir, defaultRunArtifactPaths.snapshots_dir),
    {
      recursive: true,
    },
  );
  await mkdir(
    resolveRunArtifactPath(runDir, defaultRunArtifactPaths.crops_dir),
    {
      recursive: true,
    },
  );
  await mkdir(resolveRunArtifactPath(runDir, defaultRunArtifactPaths.ocr_dir), {
    recursive: true,
  });

  const manifest = runManifestSchema.parse({
    schema_version: 1,
    run_id: runId,
    created_at: createdAt,
    cwd: input.cwd,
    task: input.task,
    manifest_path: input.manifest_path,
    status: 'created',
    paths: {
      manifest: defaultRunArtifactPaths.manifest,
      task: defaultRunArtifactPaths.task,
      assessment: defaultRunArtifactPaths.assessment,
      targets: defaultRunArtifactPaths.targets,
      journey: defaultRunArtifactPaths.journey,
      review: defaultRunArtifactPaths.review,
      gate: defaultRunArtifactPaths.gate,
      events: defaultRunArtifactPaths.events,
      snapshots_dir: defaultRunArtifactPaths.snapshots_dir,
      crops_dir: defaultRunArtifactPaths.crops_dir,
      ocr_dir: defaultRunArtifactPaths.ocr_dir,
    },
  });

  await writeJsonFile(
    resolveRunArtifactPath(runDir, manifest.paths.manifest),
    manifest,
  );

  if (input.task !== undefined) {
    await writeRunTask(runDir, {
      task: input.task,
      cwd: input.cwd,
    });
  }

  return {
    manifest,
    run_dir: runDir,
  };
}

export async function writeRunTask(
  runDir: string,
  task: RunTask,
): Promise<RunTask> {
  const parsed = runTaskSchema.parse(task);
  await writeJsonFile(
    resolveRunArtifactPath(runDir, defaultRunArtifactPaths.task),
    parsed,
  );
  return parsed;
}

export async function writeRunAssessment(
  runDir: string,
  assessment: ChangeAssessment,
): Promise<ChangeAssessment> {
  const parsed = changeAssessmentSchema.parse(assessment);
  await writeJsonFile(
    resolveRunArtifactPath(runDir, defaultRunArtifactPaths.assessment),
    parsed,
  );
  return parsed;
}

export async function writeRunTargets(
  runDir: string,
  targets: ResolvedTarget[],
): Promise<ResolvedTarget[]> {
  const parsed = resolvedTargetsSchema.parse(targets);
  await writeJsonFile(
    resolveRunArtifactPath(runDir, defaultRunArtifactPaths.targets),
    parsed,
  );
  return parsed;
}

export async function writeRunJourney(
  runDir: string,
  journey: JourneySpec,
): Promise<JourneySpec> {
  const parsed = journeySpecSchema.parse(journey);
  await writeJsonFile(
    resolveRunArtifactPath(runDir, defaultRunArtifactPaths.journey),
    parsed,
  );
  return parsed;
}

export async function writeRunReview(
  runDir: string,
  review: ReviewVerdict,
): Promise<ReviewVerdict> {
  const parsed = reviewVerdictSchema.parse(review);
  await writeJsonFile(
    resolveRunArtifactPath(runDir, defaultRunArtifactPaths.review),
    parsed,
  );
  return parsed;
}

export async function writeRunGate(
  runDir: string,
  gate: GateStatus,
): Promise<GateStatus> {
  const parsed = gateStatusSchema.parse(gate);
  await writeJsonFile(
    resolveRunArtifactPath(runDir, defaultRunArtifactPaths.gate),
    parsed,
  );
  return parsed;
}

export async function appendRunEvent(
  runDir: string,
  event: RunEvent,
): Promise<RunEvent> {
  const parsed = runEventSchema.parse(event);
  const eventPath = resolveRunArtifactPath(
    runDir,
    defaultRunArtifactPaths.events,
  );
  await mkdir(dirname(eventPath), { recursive: true });
  await appendFile(eventPath, `${JSON.stringify(parsed)}\n`, 'utf8');
  return parsed;
}

export async function readRunRecord(runDir: string): Promise<RunRecord> {
  const manifest = await readOptionalJson(
    resolveRunArtifactPath(runDir, defaultRunArtifactPaths.manifest),
    runManifestSchema,
  );

  if (manifest === undefined) {
    throw new Error(`Run manifest not found in ${runDir}.`);
  }

  let events: RunEvent[] = [];

  try {
    const rawEvents = await readFile(
      resolveRunArtifactPath(runDir, defaultRunArtifactPaths.events),
      'utf8',
    );
    events = rawEvents
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => runEventSchema.parse(JSON.parse(line)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  return runRecordSchema.parse({
    manifest,
    task: await readOptionalJson(
      resolveRunArtifactPath(runDir, manifest.paths.task),
      runTaskSchema,
    ),
    assessment: await readOptionalJson(
      resolveRunArtifactPath(runDir, manifest.paths.assessment),
      changeAssessmentSchema,
    ),
    targets: await readOptionalJson(
      resolveRunArtifactPath(runDir, manifest.paths.targets),
      resolvedTargetsSchema,
    ),
    journey: await readOptionalJson(
      resolveRunArtifactPath(runDir, manifest.paths.journey),
      journeySpecSchema,
    ),
    review: await readOptionalJson(
      resolveRunArtifactPath(runDir, manifest.paths.review),
      reviewVerdictSchema,
    ),
    gate: await readOptionalJson(
      resolveRunArtifactPath(runDir, manifest.paths.gate),
      gateStatusSchema,
    ),
    events,
  });
}

export function listRunArtifactPaths(
  manifest: RunManifest,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(manifest.paths).map(([key, value]) => [
      key,
      toRelativePath(value),
    ]),
  );
}
