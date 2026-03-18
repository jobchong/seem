import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import {
  assessChange,
  parseSeemManifest,
  resolveChangedFiles,
  resolveTargets,
} from '../src/index.js';

const execFile = promisify(execFileCallback);

const fixtureManifestSource = `
defaults:
  review_policy: required
targets:
  - id: settings-modal
    when:
      paths:
        - src/settings/**
        - src/components/modal/**
      tasks:
        - '*settings*modal*'
        - '*mobile*'
    recipe:
      adapter: browser
      surface:
        url: http://localhost:3000/settings
  - id: marketing-home
    when:
      paths:
        - src/marketing/**
      tasks:
        - '*marketing*home*'
    recipe:
      adapter: browser
      surface:
        url: http://localhost:3000/
`;

async function writeTextFile(filePath: string, contents: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, 'utf8');
}

async function runGit(cwd: string, args: string[]): Promise<void> {
  await execFile('git', args, { cwd });
}

async function createFixtureRepo(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'seem-phase-2-'));

  await writeTextFile(join(cwd, 'seem.yaml'), fixtureManifestSource);
  await writeTextFile(
    join(cwd, 'src/settings/page.tsx'),
    'export const SettingsPage = () => null;\n',
  );
  await writeTextFile(
    join(cwd, 'src/components/modal/index.tsx'),
    'export const Modal = () => null;\n',
  );
  await writeTextFile(
    join(cwd, 'src/marketing/home.tsx'),
    'export const MarketingHome = () => null;\n',
  );

  await runGit(cwd, ['init']);
  await runGit(cwd, ['config', 'user.email', 'seem@example.com']);
  await runGit(cwd, ['config', 'user.name', 'Seem Tests']);
  await runGit(cwd, ['add', '.']);
  await runGit(cwd, ['commit', '-m', 'Initial fixture']);

  return cwd;
}

describe('phase 2 assessment and target resolution', () => {
  it('assesses visible work and emits explanations for the matching target', async () => {
    const manifest = parseSeemManifest(fixtureManifestSource);

    const assessment = await assessChange({
      task: 'Fix the settings modal layout on mobile',
      manifest,
      changed_files: [
        'src/settings/page.tsx',
        'src/components/modal/index.tsx',
      ],
    });

    expect(assessment.human_visible).toBe(true);
    expect(assessment.review_required).toBe(true);
    expect(assessment.visual_relevance).toBeGreaterThan(0.8);
    expect(assessment.targets[0]).toBe('settings-modal');
    expect(assessment.target_families).toContain('browser');
    expect(assessment.reasoning).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Task mentions visual terms'),
        expect.stringContaining('Changed files include visual surface paths'),
        expect.stringContaining('Top target candidate is "settings-modal"'),
      ]),
    );
  });

  it('ranks manifest targets by path and task matches', async () => {
    const manifest = parseSeemManifest(fixtureManifestSource);

    const targets = await resolveTargets({
      task: 'Fix the settings modal layout on mobile',
      manifest,
      changed_files: [
        'src/settings/page.tsx',
        'src/components/modal/index.tsx',
      ],
    });
    const [firstTarget] = targets;

    expect(targets).toHaveLength(1);
    expect(firstTarget?.target_id).toBe('settings-modal');
    expect(firstTarget?.resolution_source).toBe('manifest');
    expect(firstTarget?.score).toBeGreaterThan(0.9);
    expect(firstTarget?.matched_paths).toEqual([
      'src/components/modal/index.tsx',
      'src/settings/page.tsx',
    ]);
    expect(firstTarget?.reasoning).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Matched changed files against manifest paths'),
        expect.stringContaining('Task matched target patterns'),
      ]),
    );
  });

  it('extracts changed file paths from diff text', async () => {
    const changedFiles = await resolveChangedFiles({
      diff: `
diff --git a/src/settings/page.tsx b/src/settings/page.tsx
index a1b2c3d..e4f5g6h 100644
--- a/src/settings/page.tsx
+++ b/src/settings/page.tsx
@@ -1 +1 @@
-old
+new
diff --git a/src/components/old-modal.tsx b/src/components/new-modal.tsx
similarity index 100%
rename from src/components/old-modal.tsx
rename to src/components/new-modal.tsx
`,
    });

    expect(changedFiles).toEqual([
      'src/components/new-modal.tsx',
      'src/settings/page.tsx',
    ]);
  });

  it('uses git working tree changes when diff is set to git', async () => {
    const cwd = await createFixtureRepo();

    await writeTextFile(
      join(cwd, 'src/settings/page.tsx'),
      'export const SettingsPage = () => "updated";\n',
    );
    await writeTextFile(
      join(cwd, 'src/components/modal/index.tsx'),
      'export const Modal = () => "updated";\n',
    );

    const changedFiles = await resolveChangedFiles({
      cwd,
      diff: 'git',
    });
    const targets = await resolveTargets({
      cwd,
      diff: 'git',
      task: 'Fix the settings modal layout on mobile',
    });

    expect(changedFiles).toEqual([
      'src/components/modal/index.tsx',
      'src/settings/page.tsx',
    ]);
    expect(targets[0]?.target_id).toBe('settings-modal');
    expect(targets[0]?.matched_paths).toEqual(changedFiles);
  });
});
