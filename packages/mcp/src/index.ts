import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import {
  createHelloWorldResponse,
  helloWorldInputSchema,
  helloWorldResponseSchema,
  seemVersion,
} from '@seem/core';

async function main(): Promise<void> {
  const server = new McpServer({
    name: 'seem',
    version: seemVersion,
  });

  server.registerTool(
    'hello',
    {
      description: 'Return the Phase 0 hello-world payload.',
      inputSchema: helloWorldInputSchema,
      outputSchema: helloWorldResponseSchema,
    },
    async ({ name }: { name?: string }) => {
      const payload = createHelloWorldResponse({ name: name ?? 'world' });

      return {
        content: [
          {
            text: JSON.stringify(payload, null, 2),
            type: 'text',
          },
        ],
        structuredContent: payload,
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('seem MCP server ready');
}

main().catch((error: unknown) => {
  console.error('Failed to start seem MCP server.');
  console.error(error);
  process.exitCode = 1;
});
