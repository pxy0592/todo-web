import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('native web project contains the static entry point and module entry point', async () => {
  await assert.doesNotReject(access(path.join(projectRoot, 'index.html')));
  await assert.doesNotReject(access(path.join(projectRoot, 'src', 'main.js')));
});
