import { createHandler } from './handler.ts';
// Minimal typing also lets the repository's TypeScript checker validate this Deno entrypoint.
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Promise<Response>): void;
};
Deno.serve(createHandler({ env: (name) => Deno.env.get(name), fetch }));
