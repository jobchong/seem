import { createServer } from 'node:http';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { TargetRecipe } from '@seem/core';

import { PlaywrightBrowserAdapter } from '../src/index.js';

async function startFixtureServer(): Promise<{
  close: () => Promise<void>;
  url: string;
}> {
  const html = await readFile(
    new URL('../../fixtures/web/phase-3-browser-demo.html', import.meta.url),
    'utf8',
  );

  const server = createServer((request, response) => {
    if (request.url === '/settings') {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
      });
      response.end(html);
      return;
    }

    response.writeHead(404);
    response.end('not found');
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();

  if (address === null || typeof address === 'string') {
    throw new Error('Expected an address info result from the fixture server.');
  }

  return {
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      }),
    url: `http://127.0.0.1:${address.port}`,
  };
}

describe('PlaywrightBrowserAdapter', () => {
  const adapters = new Set<PlaywrightBrowserAdapter>();

  afterEach(async () => {
    for (const adapter of adapters) {
      await adapter.closeAll();
    }

    adapters.clear();
  });

  it('opens a route, runs a click journey, and captures at two viewports', async () => {
    const fixture = await startFixtureServer();
    const outputDir = await mkdtemp(join(tmpdir(), 'seem-browser-run-'));
    const adapter = new PlaywrightBrowserAdapter();
    adapters.add(adapter);

    const recipe: TargetRecipe = {
      adapter: 'browser',
      invariants: [],
      journey: {
        journey_id: 'settings_modal_journey',
        steps: [
          {
            action: 'click',
            id: 'open_settings',
            target: 'Open settings',
          },
          {
            action: 'click',
            id: 'open_advanced_options',
            target: 'Advanced options',
          },
        ],
      },
      surface: {
        url: `${fixture.url}/settings`,
      },
      target_id: 'settings-modal',
      views: [
        {
          density: 1,
          view_id: 'desktop',
          viewport: [1280, 800],
        },
        {
          density: 1,
          view_id: 'mobile',
          viewport: [390, 844],
        },
      ],
    };

    try {
      const result = await adapter.runJourney({
        output_dir: outputDir,
        recipe,
      });

      expect(result.target_id).toBe('settings-modal');
      expect(result.views).toHaveLength(2);
      expect(result.views.map((view) => view.view.view_id)).toEqual([
        'desktop',
        'mobile',
      ]);

      for (const viewRun of result.views) {
        expect(viewRun.baseline.image.byteLength).toBeGreaterThan(0);
        expect(viewRun.baseline.image_path).toBeDefined();
        expect(viewRun.baseline.inspection.metrics.horizontal_overflow).toBe(
          false,
        );
        expect(viewRun.steps).toHaveLength(2);
        await access(viewRun.baseline.image_path!);
      }

      expect(result.views[0]?.baseline.image_path).toMatch(
        /initial\.desktop\.png$/,
      );
      expect(result.views[1]?.baseline.image_path).toMatch(
        /initial\.mobile\.png$/,
      );
      expect(result.views[0]?.steps[0]?.capture.image_path).toMatch(
        /step_01\.open_settings\.desktop\.png$/,
      );
      expect(result.views[1]?.steps[1]?.capture.image_path).toMatch(
        /step_02\.open_advanced_options\.mobile\.png$/,
      );
      expect(result.views[0]?.baseline.inspection.metrics.viewport).toEqual([
        1280, 800,
      ]);
      expect(result.views[1]?.baseline.inspection.metrics.viewport).toEqual([
        390, 844,
      ]);

      const desktopFinalNodes =
        result.views[0]?.steps[1]?.capture.inspection.nodes ?? [];
      const mobileFinalNodes =
        result.views[1]?.steps[1]?.capture.inspection.nodes ?? [];

      expect(
        desktopFinalNodes.some((node) => node.region_label === 'settings_modal'),
      ).toBe(true);
      expect(
        mobileFinalNodes.some((node) => node.region_label === 'advanced_panel'),
      ).toBe(true);
      expect(
        result.views.every((viewRun) =>
          viewRun.steps.every(
            (stepRun) => stepRun.action.locator_strategy === 'role=button',
          ),
        ),
      ).toBe(true);
    } finally {
      await fixture.close();
    }
  });

  it('supports explicit session lifecycle with inspect, resize, and capture', async () => {
    const fixture = await startFixtureServer();
    const outputDir = await mkdtemp(join(tmpdir(), 'seem-browser-session-'));
    const adapter = new PlaywrightBrowserAdapter();
    adapters.add(adapter);

    const recipe: TargetRecipe = {
      adapter: 'browser',
      invariants: [],
      surface: {
        url: `${fixture.url}/settings`,
      },
      target_id: 'settings-modal',
      views: [],
    };

    try {
      const session = await adapter.open({
        recipe,
        view: {
          view_id: 'desktop',
          viewport: [1280, 800],
        },
      });
      const initialInspection = await adapter.inspect({
        session_id: session.session_id,
      });

      expect(initialInspection.metrics.viewport).toEqual([1280, 800]);

      const action = await adapter.perform({
        session_id: session.session_id,
        step: {
          action: 'resize',
          id: 'resize_mobile',
          viewport: [390, 844],
        },
      });
      const capture = await adapter.capture({
        output_dir: outputDir,
        session_id: session.session_id,
        step_id: 'resize_mobile',
        step_index: 1,
      });

      expect(action.after.viewport).toEqual([390, 844]);
      expect(capture.view.viewport).toEqual([390, 844]);
      expect(capture.image_path).toMatch(/step_01\.resize_mobile\.desktop\.png$/);
      await access(capture.image_path!);
    } finally {
      await fixture.close();
    }
  });
});
