import { z } from 'zod';

export const seemVersion = '0.0.0';
export const corePackageName = '@seem/core';

export const helloWorldInputSchema = z.object({
  name: z.string().trim().min(1).default('world'),
});

export type HelloWorldInput = z.input<typeof helloWorldInputSchema>;

export const helloWorldResponseSchema = z.object({
  message: z.string().min(1),
  packageName: z.literal(corePackageName),
  version: z.literal(seemVersion),
});

export type HelloWorldResponse = z.output<typeof helloWorldResponseSchema>;

export function createHelloWorldResponse(
  input: HelloWorldInput = {},
): HelloWorldResponse {
  const { name } = helloWorldInputSchema.parse(input);

  return helloWorldResponseSchema.parse({
    message: `Hello, ${name}.`,
    packageName: corePackageName,
    version: seemVersion,
  });
}
