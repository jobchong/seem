import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  appendRunEvent,
  createCropArtifactName,
  createOcrArtifactName,
  createRunDirectory,
  createSnapshotArtifactName,
  readRunRecord,
  writeRunAssessment,
  writeRunGate,
  writeRunReview,
  writeRunTargets,
} from '../src/index.js';

describe('run storage', () => {
  it('persists a fake run and reads it back', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'seem-run-'));
    const created = await createRunDirectory({
      cwd,
      task: 'change this button colour to blue',
      run_id: 'run_20260318_000001',
      created_at: '2026-03-18T00:00:00.000Z',
    });

    await writeRunAssessment(created.run_dir, {
      human_visible: true,
      visual_relevance: 0.98,
      review_required: true,
      targets: ['storybook:Button/Primary'],
      reasoning: ['Task refers to colour change', 'Diff touches CSS'],
      target_families: ['browser'],
    });

    await writeRunTargets(created.run_dir, [
      {
        target_id: 'storybook:Button/Primary',
        score: 0.97,
        resolution_source: 'manifest',
        reasoning: ['Exact path match'],
        matched_paths: ['src/components/button/**'],
        recipe: {
          target_id: 'storybook:Button/Primary',
          adapter: 'browser',
          surface: {
            url: 'http://localhost:6006/?path=/story/button--primary',
          },
          views: [
            {
              view_id: 'desktop',
              viewport: [1440, 900],
              density: 1,
            },
          ],
          invariants: [],
        },
      },
    ]);

    await writeRunReview(created.run_dir, {
      status: 'pass',
      confidence: 0.94,
      checks: [
        {
          name: 'target_color',
          status: 'pass',
          details: 'Primary button background is blue.',
        },
      ],
      findings: [],
    });

    await writeRunGate(created.run_dir, {
      status: 'open',
      mode: 'required',
      review_status: 'pass',
      reason: 'Review passed.',
    });

    await appendRunEvent(created.run_dir, {
      timestamp: '2026-03-18T00:00:01.000Z',
      level: 'info',
      type: 'run.created',
      data: {
        run_id: created.manifest.run_id,
      },
    });

    await appendRunEvent(created.run_dir, {
      timestamp: '2026-03-18T00:00:02.000Z',
      level: 'info',
      type: 'review.completed',
      data: {
        status: 'pass',
      },
    });

    const runRecord = await readRunRecord(created.run_dir);

    expect(runRecord.manifest.run_id).toBe('run_20260318_000001');
    expect(runRecord.task).toEqual({
      task: 'change this button colour to blue',
      cwd,
    });
    expect(runRecord.assessment?.review_required).toBe(true);
    expect(runRecord.targets?.[0].recipe.surface.url).toBe(
      'http://localhost:6006/?path=/story/button--primary',
    );
    expect(runRecord.review?.status).toBe('pass');
    expect(runRecord.gate?.status).toBe('open');
    expect(runRecord.events.map((event) => event.type)).toEqual([
      'run.created',
      'review.completed',
    ]);
  });

  it('creates stable artifact names for snapshots, crops, and OCR payloads', () => {
    expect(
      createSnapshotArtifactName({
        step_id: 'Open Settings',
        step_index: 1,
        view_id: 'Mobile',
      }),
    ).toBe('step_01.open_settings.mobile.png');

    expect(
      createCropArtifactName({
        step_id: 'Open Settings',
        step_index: 1,
        view_id: 'Mobile',
        region_label: 'Primary Button',
      }),
    ).toBe('step_01.open_settings.mobile--primary_button.png');

    expect(
      createOcrArtifactName({
        step_id: 'Open Settings',
        step_index: 1,
        view_id: 'Mobile',
      }),
    ).toBe('step_01.open_settings.mobile.json');
  });
});
