import { build } from 'astro';
import { readFile, writeFile, unlink } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const fixtures = [
  ['draft-note.mdx', 'notes/e2e-private-note.mdx'],
  ['draft-project.mdx', 'projects/e2e-private-project.mdx'],
  ['draft-update.mdx', 'updates/e2e-private-update.mdx'],
];
const created = [];

// Exclusive writes preserve any existing user content, even after an interrupted run.
try {
  for (const [fixture, target] of fixtures) {
    const destination = new URL(`src/content/${target}`, root);
    await writeFile(
      destination,
      await readFile(new URL(`tests/fixtures/${fixture}`, root)),
      { flag: 'wx' },
    );
    created.push(destination);
  }
  await build({ root, logLevel: 'warn' });
} finally {
  await Promise.all(created.map((file) => unlink(file)));
}
