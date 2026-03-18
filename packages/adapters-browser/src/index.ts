import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  createHelloWorldResponse,
  createSnapshotArtifactName,
  type BoundingBox,
  type JourneyStep,
  type TargetRecipe,
  type ViewSpec,
  type Viewport,
} from '@seem/core';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type LaunchOptions,
  type Locator,
  type Page,
} from 'playwright';

export const browserAdapterKind = 'browser';
export const defaultBrowserViewport: Viewport = [1440, 900];

const defaultActionTimeoutMs = 5_000;
const defaultReadyTimeoutMs = 10_000;
const defaultStabilityWindowMs = 200;
const defaultStabilityPollMs = 100;
const defaultScrollDistancePx = 480;

interface InternalBrowserSession {
  page: Page;
  context: BrowserContext;
  recipe: TargetRecipe;
  session_id: string;
  target_id: string;
  view: ResolvedBrowserView;
}

interface LocatorCandidate {
  create: () => Locator;
  strategy: string;
}

interface LayoutSnapshot {
  client_height: number;
  client_width: number;
  ready_state: string;
  scroll_height: number;
  scroll_width: number;
  url: string;
  viewport: Viewport;
}

export interface BrowserAdapterOptions {
  default_timeout_ms?: number;
  headless?: boolean;
  launch_options?: LaunchOptions;
  stability_poll_ms?: number;
  stability_window_ms?: number;
}

export interface BrowserDocumentMetrics {
  client_height: number;
  client_width: number;
  device_pixel_ratio: number;
  horizontal_overflow: boolean;
  scroll_height: number;
  scroll_width: number;
  title: string;
  url: string;
  vertical_overflow: boolean;
  viewport: Viewport;
}

export interface BrowserNodeGeometry {
  bbox: BoundingBox;
  id?: string;
  label?: string;
  node_id: string;
  region_label?: string;
  role?: string;
  selector_hint?: string;
  tag_name: string;
  test_id?: string;
  text?: string;
  visible: boolean;
}

export interface BrowserInspectionData {
  metrics: BrowserDocumentMetrics;
  nodes: BrowserNodeGeometry[];
}

export interface BrowserCapture {
  capture_id: string;
  created_at: string;
  image: Buffer;
  image_path?: string;
  inspection: BrowserInspectionData;
  session_id: string;
  step_id?: string;
  step_index?: number;
  target_id: string;
  view: ResolvedBrowserView;
}

export interface BrowserActionResult {
  action: JourneyStep['action'];
  after: BrowserDocumentMetrics;
  before: BrowserDocumentMetrics;
  elapsed_ms: number;
  locator_strategy?: string;
  session_id: string;
  step_id: string;
  target?: string;
  view: ResolvedBrowserView;
}

export interface BrowserStepRun {
  action: BrowserActionResult;
  capture: BrowserCapture;
  step: JourneyStep;
}

export interface BrowserViewRun {
  baseline: BrowserCapture;
  session_id: string;
  steps: BrowserStepRun[];
  view: ResolvedBrowserView;
}

export interface BrowserJourneyRunResult {
  target_id: string;
  views: BrowserViewRun[];
}

export interface OpenBrowserTargetInput {
  recipe: TargetRecipe;
  timeout_ms?: number;
  view?: ViewSpec;
  view_index?: number;
}

export interface BrowserSessionHandle {
  session_id: string;
  surface_url: string;
  target_id: string;
  view: ResolvedBrowserView;
}

export interface BrowserCaptureInput {
  output_dir?: string;
  session_id: string;
  step_id?: string;
  step_index?: number;
}

export interface PerformBrowserActionInput {
  session_id: string;
  step: JourneyStep;
}

export interface InspectBrowserSessionInput {
  session_id: string;
}

export interface RunBrowserJourneyInput {
  output_dir?: string;
  recipe: TargetRecipe;
  timeout_ms?: number;
}

export interface ResolvedBrowserView extends ViewSpec {
  density: number;
  viewport: Viewport;
}

function clampPositiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

function createDefaultViewId(viewport: Viewport, viewIndex: number): string {
  return `view_${String(viewIndex + 1).padStart(2, '0')}_${viewport[0]}x${viewport[1]}`;
}

function normalizeViewSpec(
  view: ViewSpec | undefined,
  viewIndex = 0,
): ResolvedBrowserView {
  const viewport = view?.viewport ?? defaultBrowserViewport;

  return {
    ...view,
    density: view?.density ?? 1,
    view_id: view?.view_id ?? createDefaultViewId(viewport, viewIndex),
    viewport,
  };
}

function resolveRecipeViews(recipe: TargetRecipe): ResolvedBrowserView[] {
  if (recipe.views.length === 0) {
    return [normalizeViewSpec(undefined, 0)];
  }

  return recipe.views.map((view, index) => normalizeViewSpec(view, index));
}

function ensureSurfaceUrl(recipe: TargetRecipe): string {
  if (recipe.surface.url === undefined) {
    throw new Error(
      `Browser target "${recipe.target_id}" requires a surface.url value.`,
    );
  }

  return recipe.surface.url;
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}

function looksLikeCssSelector(target: string): boolean {
  return /^[#.[]/.test(target) || target.includes('>') || target.includes(' ');
}

function buildLocatorCandidates(page: Page, target: string): LocatorCandidate[] {
  const trimmed = target.trim();
  const roleMatch = /^role=([a-z0-9_-]+)(?::(.+))?$/i.exec(trimmed);

  if (trimmed.startsWith('css=')) {
    return [
      {
        create: () => page.locator(trimmed.slice(4)),
        strategy: 'css',
      },
    ];
  }

  if (trimmed.startsWith('text=')) {
    return [
      {
        create: () => page.getByText(trimmed.slice(5), { exact: true }),
        strategy: 'text',
      },
    ];
  }

  if (trimmed.startsWith('label=')) {
    return [
      {
        create: () => page.getByLabel(trimmed.slice(6), { exact: true }),
        strategy: 'label',
      },
    ];
  }

  if (trimmed.startsWith('placeholder=')) {
    return [
      {
        create: () => page.getByPlaceholder(trimmed.slice(12), { exact: true }),
        strategy: 'placeholder',
      },
    ];
  }

  if (trimmed.startsWith('testid=')) {
    return [
      {
        create: () => page.getByTestId(trimmed.slice(7)),
        strategy: 'testid',
      },
    ];
  }

  if (roleMatch !== null) {
    const [, role, name] = roleMatch;

    return [
      {
        create: () =>
          page.getByRole(role as Parameters<Page['getByRole']>[0], {
            exact: true,
            name: name?.trim(),
          }),
        strategy: `role=${role}`,
      },
    ];
  }

  const roleCandidates: Parameters<Page['getByRole']>[0][] = [
    'button',
    'link',
    'tab',
    'menuitem',
    'option',
    'checkbox',
    'radio',
    'switch',
    'textbox',
    'combobox',
    'searchbox',
  ];

  const candidates: LocatorCandidate[] = roleCandidates.map((role) => ({
    create: () => page.getByRole(role, { exact: true, name: trimmed }),
    strategy: `role=${role}`,
  }));

  candidates.push(
    {
      create: () => page.getByLabel(trimmed, { exact: true }),
      strategy: 'label',
    },
    {
      create: () => page.getByText(trimmed, { exact: true }),
      strategy: 'text',
    },
  );

  if (looksLikeCssSelector(trimmed)) {
    candidates.push({
      create: () => page.locator(trimmed),
      strategy: 'css-fallback',
    });
  }

  return candidates;
}

async function resolveLocator(
  page: Page,
  target: string,
): Promise<{ locator: Locator; strategy: string }> {
  for (const candidate of buildLocatorCandidates(page, target)) {
    try {
      const locator = candidate.create();
      const count = await locator.count();

      if (count > 0) {
        return {
          locator: locator.first(),
          strategy: candidate.strategy,
        };
      }
    } catch {
      continue;
    }
  }

  throw new Error(`Unable to resolve browser journey target "${target}".`);
}

async function disableAnimations(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-delay: 0s !important;
        animation-duration: 0s !important;
        animation-iteration-count: 1 !important;
        caret-color: transparent !important;
        scroll-behavior: auto !important;
        transition-delay: 0s !important;
        transition-duration: 0s !important;
      }
    `,
  });
}

async function collectLayoutSnapshot(page: Page): Promise<LayoutSnapshot> {
  return page.evaluate(() => ({
    client_height: document.documentElement.clientHeight,
    client_width: document.documentElement.clientWidth,
    ready_state: document.readyState,
    scroll_height: document.documentElement.scrollHeight,
    scroll_width: document.documentElement.scrollWidth,
    url: window.location.href,
    viewport: [window.innerWidth, window.innerHeight] as [number, number],
  }));
}

async function waitForStableLayout(
  page: Page,
  input: {
    poll_ms: number;
    timeout_ms: number;
    window_ms: number;
  },
): Promise<void> {
  const deadline = Date.now() + input.timeout_ms;
  let stableSince = Date.now();
  let previous = JSON.stringify(await collectLayoutSnapshot(page));

  while (Date.now() < deadline) {
    await page.waitForTimeout(input.poll_ms);
    const next = JSON.stringify(await collectLayoutSnapshot(page));

    if (next === previous) {
      if (Date.now() - stableSince >= input.window_ms) {
        return;
      }

      continue;
    }

    previous = next;
    stableSince = Date.now();
  }
}

async function collectInspectionData(page: Page): Promise<BrowserInspectionData> {
  return page.evaluate(() => {
    const round = (value: number): number => Math.round(value * 100) / 100;
    const normalizeText = (value: string | null | undefined): string | undefined => {
      const normalized = value?.replace(/\s+/g, ' ').trim();
      return normalized ? normalized.slice(0, 160) : undefined;
    };
    const slugify = (value: string): string =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 64);
    const inferRole = (element: Element): string | undefined => {
      const explicitRole = element.getAttribute('role');

      if (explicitRole) {
        return explicitRole;
      }

      if (element instanceof HTMLButtonElement) {
        return 'button';
      }

      if (element instanceof HTMLAnchorElement && element.href) {
        return 'link';
      }

      if (element instanceof HTMLInputElement) {
        const type = element.type.toLowerCase();

        if (['button', 'submit', 'reset'].includes(type)) {
          return 'button';
        }

        if (type === 'checkbox') {
          return 'checkbox';
        }

        if (type === 'radio') {
          return 'radio';
        }

        return 'textbox';
      }

      if (element instanceof HTMLTextAreaElement) {
        return 'textbox';
      }

      if (element instanceof HTMLSelectElement) {
        return 'combobox';
      }

      if (element instanceof HTMLDialogElement) {
        return 'dialog';
      }

      if (element instanceof HTMLElement) {
        switch (element.tagName.toLowerCase()) {
          case 'main':
            return 'main';
          case 'nav':
            return 'navigation';
          case 'header':
            return 'banner';
          case 'footer':
            return 'contentinfo';
          default:
            return undefined;
        }
      }

      return undefined;
    };
    const selectorHint = (element: Element): string | undefined => {
      const testId = element.getAttribute('data-testid');

      if (testId) {
        return `[data-testid="${testId}"]`;
      }

      if (element.id) {
        return `#${element.id}`;
      }

      const regionLabel = element.getAttribute('data-seem-region');

      if (regionLabel) {
        return `[data-seem-region="${regionLabel}"]`;
      }

      return undefined;
    };
    const elements = Array.from(
      document.querySelectorAll(
        [
          '[data-seem-region]',
          '[data-testid]',
          '[role]',
          'button',
          'a[href]',
          'input',
          'select',
          'textarea',
          'dialog',
          'main',
          'nav',
          'header',
          'footer',
          'section',
          'article',
          'aside',
          'h1',
          'h2',
          'h3',
          'h4',
          'h5',
          'h6',
        ].join(','),
      ),
    );

    const nodes = elements
      .map((element, index) => {
        const rect = element.getBoundingClientRect();
        const label =
          element.getAttribute('aria-label') ??
          (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
            ? normalizeText(element.labels?.[0]?.textContent)
            : undefined);
        const text =
          normalizeText(element.textContent) ??
          (element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement
            ? normalizeText(element.value)
            : undefined);
        const regionLabel = element.getAttribute('data-seem-region') ?? undefined;
        const testId = element.getAttribute('data-testid') ?? undefined;
        const role = inferRole(element);
        const parts = [
          regionLabel,
          testId,
          element.id || undefined,
          role,
          text,
          `node_${index + 1}`,
        ].filter((value): value is string => Boolean(value));

        return {
          bbox: [
            round(rect.x),
            round(rect.y),
            round(rect.width),
            round(rect.height),
          ] as [number, number, number, number],
          id: element.id || undefined,
          label,
          node_id: slugify(parts.join('_')) || `node_${index + 1}`,
          region_label: regionLabel,
          role,
          selector_hint: selectorHint(element),
          tag_name: element.tagName.toLowerCase(),
          test_id: testId,
          text,
          visible: rect.width > 0 && rect.height > 0,
        };
      })
      .filter((node) => node.visible);

    const metrics = {
      client_height: document.documentElement.clientHeight,
      client_width: document.documentElement.clientWidth,
      device_pixel_ratio: window.devicePixelRatio,
      horizontal_overflow:
        document.documentElement.scrollWidth > document.documentElement.clientWidth,
      scroll_height: document.documentElement.scrollHeight,
      scroll_width: document.documentElement.scrollWidth,
      title: document.title,
      url: window.location.href,
      vertical_overflow:
        document.documentElement.scrollHeight >
        document.documentElement.clientHeight,
      viewport: [window.innerWidth, window.innerHeight] as [number, number],
    };

    return {
      metrics,
      nodes,
    };
  });
}

function createCapturePath(
  outputDir: string | undefined,
  input: {
    step_id?: string;
    step_index?: number;
    view_id?: string;
  },
): string | undefined {
  if (outputDir === undefined) {
    return undefined;
  }

  return resolve(
    outputDir,
    createSnapshotArtifactName({
      step_id: input.step_id,
      step_index: input.step_index,
      view_id: input.view_id,
    }),
  );
}

export class PlaywrightBrowserAdapter {
  readonly kind = browserAdapterKind;

  private browserPromise?: Promise<Browser>;
  private readonly options: Required<BrowserAdapterOptions>;
  private readonly sessions = new Map<string, InternalBrowserSession>();

  constructor(options: BrowserAdapterOptions = {}) {
    this.options = {
      default_timeout_ms: clampPositiveInteger(
        options.default_timeout_ms,
        defaultActionTimeoutMs,
      ),
      headless: options.headless ?? true,
      launch_options: options.launch_options ?? {},
      stability_poll_ms: clampPositiveInteger(
        options.stability_poll_ms,
        defaultStabilityPollMs,
      ),
      stability_window_ms: clampPositiveInteger(
        options.stability_window_ms,
        defaultStabilityWindowMs,
      ),
    };
  }

  async open(input: OpenBrowserTargetInput): Promise<BrowserSessionHandle> {
    if (input.recipe.adapter !== browserAdapterKind) {
      throw new Error(
        `Target "${input.recipe.target_id}" must use the "${browserAdapterKind}" adapter.`,
      );
    }

    const browser = await this.ensureBrowser();
    const view =
      input.view !== undefined
        ? normalizeViewSpec(input.view, input.view_index ?? 0)
        : normalizeViewSpec(input.recipe.views[0], input.view_index ?? 0);
    const context = await browser.newContext({
      colorScheme:
        view.theme === undefined || view.theme === 'system'
          ? undefined
          : view.theme,
      deviceScaleFactor: view.density,
      viewport: {
        height: view.viewport[1],
        width: view.viewport[0],
      },
    });
    const page = await context.newPage();
    const timeoutMs =
      input.timeout_ms ??
      input.recipe.launch?.ready_timeout_ms ??
      defaultReadyTimeoutMs;

    page.setDefaultNavigationTimeout(timeoutMs);
    page.setDefaultTimeout(this.options.default_timeout_ms);

    const surfaceUrl = ensureSurfaceUrl(input.recipe);

    await page.goto(surfaceUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
    await disableAnimations(page);
    await this.waitForReadiness(page, input.recipe, timeoutMs);

    const session: InternalBrowserSession = {
      context,
      page,
      recipe: input.recipe,
      session_id: randomUUID(),
      target_id: input.recipe.target_id,
      view,
    };

    this.sessions.set(session.session_id, session);

    return {
      session_id: session.session_id,
      surface_url: surfaceUrl,
      target_id: session.target_id,
      view,
    };
  }

  async inspect(
    input: InspectBrowserSessionInput,
  ): Promise<BrowserInspectionData> {
    const session = this.getSession(input.session_id);
    const inspection = await collectInspectionData(session.page);

    return {
      metrics: {
        ...inspection.metrics,
        client_height: roundMetric(inspection.metrics.client_height),
        client_width: roundMetric(inspection.metrics.client_width),
        device_pixel_ratio: roundMetric(inspection.metrics.device_pixel_ratio),
        scroll_height: roundMetric(inspection.metrics.scroll_height),
        scroll_width: roundMetric(inspection.metrics.scroll_width),
      },
      nodes: inspection.nodes.map((node) => ({
        ...node,
        bbox: node.bbox.map((value) => roundMetric(value)) as BoundingBox,
      })),
    };
  }

  async capture(input: BrowserCaptureInput): Promise<BrowserCapture> {
    const session = this.getSession(input.session_id);
    const imagePath = createCapturePath(input.output_dir, {
      step_id: input.step_id,
      step_index: input.step_index,
      view_id: session.view.view_id,
    });

    if (imagePath !== undefined) {
      await mkdir(dirname(imagePath), { recursive: true });
    }

    await waitForStableLayout(session.page, {
      poll_ms: this.options.stability_poll_ms,
      timeout_ms: this.options.default_timeout_ms,
      window_ms: this.options.stability_window_ms,
    });

    const image = await session.page.screenshot({
      animations: 'disabled',
      path: imagePath,
      scale: 'css',
      type: 'png',
    });

    return {
      capture_id: randomUUID(),
      created_at: new Date().toISOString(),
      image,
      image_path: imagePath,
      inspection: await this.inspect({ session_id: session.session_id }),
      session_id: session.session_id,
      step_id: input.step_id,
      step_index: input.step_index,
      target_id: session.target_id,
      view: { ...session.view },
    };
  }

  async perform(
    input: PerformBrowserActionInput,
  ): Promise<BrowserActionResult> {
    const session = this.getSession(input.session_id);
    const { page } = session;
    const { step } = input;
    const stepTimeoutMs = step.timeout_ms ?? this.options.default_timeout_ms;
    const before = (await this.inspect({ session_id: session.session_id })).metrics;
    const startedAt = Date.now();
    let locatorStrategy: string | undefined;

    switch (step.action) {
      case 'click':
      case 'tap':
      case 'hover':
      case 'focus':
      case 'wait_for': {
        if (step.target === undefined) {
          throw new Error(`Step "${step.id}" requires a target.`);
        }

        const resolved = await resolveLocator(page, step.target);
        locatorStrategy = resolved.strategy;

        if (step.action === 'click' || step.action === 'tap') {
          await resolved.locator.click({ timeout: stepTimeoutMs });
        } else if (step.action === 'hover') {
          await resolved.locator.hover({ timeout: stepTimeoutMs });
        } else if (step.action === 'focus') {
          await resolved.locator.focus({ timeout: stepTimeoutMs });
        } else {
          await resolved.locator.waitFor({
            state: 'visible',
            timeout: stepTimeoutMs,
          });
        }
        break;
      }

      case 'type': {
        if (step.target === undefined || step.value === undefined) {
          throw new Error(`Step "${step.id}" requires both target and value.`);
        }

        const resolved = await resolveLocator(page, step.target);
        locatorStrategy = resolved.strategy;
        await resolved.locator.fill(step.value, { timeout: stepTimeoutMs });
        break;
      }

      case 'resize': {
        if (step.viewport === undefined) {
          throw new Error(`Step "${step.id}" requires a viewport.`);
        }

        await page.setViewportSize({
          height: step.viewport[1],
          width: step.viewport[0],
        });
        session.view = normalizeViewSpec(
          {
            ...session.view,
            viewport: step.viewport,
          },
          0,
        );
        break;
      }

      case 'scroll': {
        await this.performScrollStep(session, step, stepTimeoutMs);
        break;
      }

      default: {
        const exhaustive: never = step.action;
        throw new Error(`Unsupported browser journey action: ${exhaustive}`);
      }
    }

    await waitForStableLayout(page, {
      poll_ms: this.options.stability_poll_ms,
      timeout_ms: stepTimeoutMs,
      window_ms: this.options.stability_window_ms,
    });

    return {
      action: step.action,
      after: (await this.inspect({ session_id: session.session_id })).metrics,
      before,
      elapsed_ms: Date.now() - startedAt,
      locator_strategy: locatorStrategy,
      session_id: session.session_id,
      step_id: step.id,
      target: step.target,
      view: { ...session.view },
    };
  }

  async runJourney(
    input: RunBrowserJourneyInput,
  ): Promise<BrowserJourneyRunResult> {
    const views = resolveRecipeViews(input.recipe);
    const steps = input.recipe.journey?.steps ?? [];
    const runs: BrowserViewRun[] = [];

    for (const [viewIndex, view] of views.entries()) {
      const session = await this.open({
        recipe: input.recipe,
        timeout_ms: input.timeout_ms,
        view,
        view_index: viewIndex,
      });

      try {
        const baseline = await this.capture({
          output_dir: input.output_dir,
          session_id: session.session_id,
        });
        const stepRuns: BrowserStepRun[] = [];

        for (const [stepIndex, step] of steps.entries()) {
          const action = await this.perform({
            session_id: session.session_id,
            step,
          });
          const capture = await this.capture({
            output_dir: input.output_dir,
            session_id: session.session_id,
            step_id: step.id,
            step_index: stepIndex + 1,
          });

          stepRuns.push({
            action,
            capture,
            step,
          });
        }

        runs.push({
          baseline,
          session_id: session.session_id,
          steps: stepRuns,
          view: session.view,
        });
      } finally {
        await this.close(session.session_id);
      }
    }

    return {
      target_id: input.recipe.target_id,
      views: runs,
    };
  }

  async close(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);

    if (session === undefined) {
      return;
    }

    this.sessions.delete(sessionId);
    await session.context.close();
  }

  async closeAll(): Promise<void> {
    const sessionIds = [...this.sessions.keys()];

    for (const sessionId of sessionIds) {
      await this.close(sessionId);
    }

    if (this.browserPromise !== undefined) {
      const browser = await this.browserPromise;
      await browser.close();
      this.browserPromise = undefined;
    }
  }

  private async ensureBrowser(): Promise<Browser> {
    this.browserPromise ??= chromium.launch({
      ...this.options.launch_options,
      headless:
        this.options.launch_options.headless ?? this.options.headless,
    });

    return this.browserPromise;
  }

  private getSession(sessionId: string): InternalBrowserSession {
    const session = this.sessions.get(sessionId);

    if (session === undefined) {
      throw new Error(`Browser session "${sessionId}" was not found.`);
    }

    return session;
  }

  private async performScrollStep(
    session: InternalBrowserSession,
    step: JourneyStep,
    timeoutMs: number,
  ): Promise<void> {
    const delta =
      step.delta ??
      (step.direction === undefined
        ? [0, defaultScrollDistancePx]
        : step.direction === 'up'
          ? [0, -defaultScrollDistancePx]
          : step.direction === 'down'
            ? [0, defaultScrollDistancePx]
            : step.direction === 'left'
              ? [-defaultScrollDistancePx, 0]
              : [defaultScrollDistancePx, 0]);

    if (step.target !== undefined) {
      const resolved = await resolveLocator(session.page, step.target);
      await resolved.locator.scrollIntoViewIfNeeded({ timeout: timeoutMs });

      if (step.delta !== undefined) {
        await resolved.locator.evaluate(
          (element, value) => {
            if (element instanceof HTMLElement) {
              element.scrollBy(value[0], value[1]);
            }
          },
          delta,
        );
      }

      return;
    }

    await session.page.mouse.wheel(delta[0], delta[1]);
  }

  private async waitForReadiness(
    page: Page,
    recipe: TargetRecipe,
    timeoutMs: number,
  ): Promise<void> {
    const readySelector = recipe.launch?.ready_selector;

    if (readySelector !== undefined) {
      await page.waitForSelector(readySelector, {
        state: 'visible',
        timeout: recipe.launch?.ready_timeout_ms ?? timeoutMs,
      });
    }

    await waitForStableLayout(page, {
      poll_ms: this.options.stability_poll_ms,
      timeout_ms: timeoutMs,
      window_ms: this.options.stability_window_ms,
    });
  }
}

export function describeBrowserAdapterBootstrap(): string {
  const hello = createHelloWorldResponse({ name: 'browser adapter' });

  return `${browserAdapterKind}: ${hello.message}`;
}
