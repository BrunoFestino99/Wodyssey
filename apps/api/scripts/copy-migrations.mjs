import { cp, rm } from 'node:fs/promises';

// Replaced, not merged, so migrations removed from the source never linger in the build.
const target = new URL('../dist/migrations/', import.meta.url);
await rm(target, { recursive: true, force: true });
await cp(new URL('../src/migrations/', import.meta.url), target, { recursive: true });
