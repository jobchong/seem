import { createHelloWorldResponse } from '@seem/core';

export const browserAdapterKind = 'browser';

export function describeBrowserAdapterBootstrap(): string {
  const hello = createHelloWorldResponse({ name: 'browser adapter' });

  return `${browserAdapterKind}: ${hello.message}`;
}
