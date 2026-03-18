import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadSeemManifest, parseSeemManifest } from '../src/index.js';

describe('parseSeemManifest', () => {
  it('normalizes shorthand journey steps, invariants, and default viewports', () => {
    const manifest = parseSeemManifest(`
defaults:
  review_policy: required
  viewports:
    - [1440, 900]
    - [390, 844]
targets:
  - id: settings-modal
    when:
      paths:
        - src/settings/**
        - src/components/modal/**
    recipe:
      adapter: browser
      launch:
        cmd: pnpm dev
      surface:
        url: http://localhost:3000/settings
      journey:
        - click: Open settings
        - click: Advanced options
      invariants:
        - no_horizontal_overflow
        - invariant_id: modal_no_horizontal_growth
          type: max_container_width_delta
          target_region: settings_modal
          threshold: 24
          severity: high
policies:
  browser:
    timeout_ms: 20000
`);

    expect(manifest.defaults.review_policy).toBe('required');
    expect(manifest.targets).toHaveLength(1);
    expect(manifest.targets[0].recipe.target_id).toBe('settings-modal');
    expect(manifest.targets[0].recipe.views).toEqual([
      {
        view_id: 'view_01_1440x900',
        viewport: [1440, 900],
        density: 1,
      },
      {
        view_id: 'view_02_390x844',
        viewport: [390, 844],
        density: 1,
      },
    ]);
    expect(manifest.targets[0].recipe.journey).toEqual({
      journey_id: 'settings_modal_journey',
      steps: [
        {
          id: 'step_01_click_open_settings',
          action: 'click',
          target: 'Open settings',
        },
        {
          id: 'step_02_click_advanced_options',
          action: 'click',
          target: 'Advanced options',
        },
      ],
    });
    expect(manifest.targets[0].recipe.invariants).toEqual([
      {
        invariant_id: 'no_horizontal_overflow',
        type: 'no_horizontal_overflow',
        severity: 'medium',
      },
      {
        invariant_id: 'modal_no_horizontal_growth',
        type: 'max_container_width_delta',
        target_region: 'settings_modal',
        threshold: 24,
        severity: 'high',
      },
    ]);
  });

  it('rejects duplicate target ids', () => {
    expect(() =>
      parseSeemManifest(`
targets:
  - id: duplicate
    when:
      paths: [src/one/**]
    recipe:
      adapter: browser
      surface:
        url: http://localhost:3000/one
  - id: duplicate
    when:
      paths: [src/two/**]
    recipe:
      adapter: browser
      surface:
        url: http://localhost:3000/two
`),
    ).toThrow(/Duplicate target id "duplicate"/);
  });
});

describe('loadSeemManifest', () => {
  it('loads seem.yaml from disk', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'seem-manifest-'));
    const manifestPath = join(cwd, 'seem.yaml');

    await writeFile(
      manifestPath,
      `
targets:
  - id: route-home
    when:
      paths: [src/routes/home.tsx]
    recipe:
      adapter: browser
      surface:
        url: http://localhost:3000/
`,
      'utf8',
    );

    const loaded = await loadSeemManifest({ cwd });

    expect(loaded.manifest_path).toBe(manifestPath);
    expect(loaded.manifest.targets[0].recipe.target_id).toBe('route-home');
  });
});
