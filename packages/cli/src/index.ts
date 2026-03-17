#!/usr/bin/env node

import { Command } from 'commander';

import { createHelloWorldResponse, seemVersion } from '@seem/core';

const program = new Command();

program
  .name('seem')
  .description('Harness-independent visual verification tooling.')
  .version(seemVersion);

program
  .command('hello')
  .description('Print the Phase 0 hello-world payload.')
  .option('-n, --name <name>', 'Name to greet', 'world')
  .option('--json', 'Print the full JSON payload', false)
  .action((options: { json: boolean; name: string }) => {
    const response = createHelloWorldResponse({ name: options.name });

    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    console.log(response.message);
  });

program.parseAsync(process.argv);
