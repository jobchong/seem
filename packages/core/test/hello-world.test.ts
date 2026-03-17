import { describe, expect, it } from 'vitest';

import { assertStringFields } from '@seem/shared-test-utils';

import { createHelloWorldResponse } from '../src/index.js';

describe('createHelloWorldResponse', () => {
  it('returns the default hello-world payload', () => {
    const response = createHelloWorldResponse();

    assertStringFields(response, ['message', 'packageName', 'version']);
    expect(response).toEqual({
      message: 'Hello, world.',
      packageName: '@seem/core',
      version: '0.0.0',
    });
  });

  it('accepts an explicit name', () => {
    expect(createHelloWorldResponse({ name: 'Phase 0' }).message).toBe(
      'Hello, Phase 0.',
    );
  });
});
