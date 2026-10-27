import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// CI installs Node from .node-version while dev/prod use the Docker image:
// both must run the exact same version.
describe('Node version', () => {
  it('is the same in .node-version and docker/web.Dockerfile', () => {
    const pinned = readFileSync('.node-version', 'utf8').trim();
    const dockerfile = readFileSync('docker/web.Dockerfile', 'utf8');
    const fromImage = dockerfile.match(/^FROM node:(\d+\.\d+\.\d+)-/m)?.[1];
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
    expect(fromImage).toBe(pinned);
  });
});
