'use strict';

// A random failing test is not evidence that the old authorization bug ran.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const tap = fs.readFileSync(process.argv[2], 'utf8');
const expectedFailures = [
  'PATCH refuses foreign-project child without changing it: item-b',
  'DELETE refuses foreign-project child without changing it: item-b',
  'step init rejects a different-project run before any mutation',
];
const expectedPasses = [
  'route.ts retains same-project access',
  'PATCH retains same-project operation',
];
const failed = [...tap.matchAll(/^not ok \d+ - (.+)$/gm)].map(match => match[1]);
const passed = [...tap.matchAll(/^ok \d+ - (.+)$/gm)].map(match => match[1]);
assert.deepEqual(failed.sort(), [...expectedFailures].sort());
assert.deepEqual(passed.sort(), [...expectedPasses].sort());
const failureBlocks = [...tap.matchAll(/^not ok \d+ - (.+)\n([\s\S]*?)(?=^# Subtest:|^1\.\.|$(?![\s\S]))/gm)];
assert.equal(failureBlocks.length, expectedFailures.length);
for (const match of failureBlocks) {
  assert.match(match[2], /^  code: 'ERR_ASSERTION'$/m);
  assert.match(match[2], /^  expected: 404$/m);
  assert.match(match[2], /^  actual: 200$/m);
}
assert.match(tap, /^# tests 5$/m);
assert.match(tap, /^# pass 2$/m);
assert.match(tap, /^# fail 3$/m);
assert.match(tap, /^# skipped 0$/m);
console.log(JSON.stringify({ baseline: '062d09ea1420e427769d5c7fe42c589e9d2d6369', expectedAuthorizationFailures: 3, validControlsPassed: 2 }));
