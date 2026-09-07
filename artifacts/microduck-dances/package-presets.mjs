/** Package the six verified authored sequences; original G1 data and motion targets remain unchanged. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = new URL('./', import.meta.url);
const target = new URL('../../packages/client/ui-robot-lab/src/client/dance-clips/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
mkdirSync(target, { recursive: true });
for (const row of manifest.clips) {
  const bytes = readFileSync(new URL(row.clipFile, root));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), row.clipSha256);
  const sequence = JSON.parse(readFileSync(new URL(row.sequenceFile, root), 'utf8'));
  assert.deepEqual(sequence.clip, JSON.parse(bytes));
  writeFileSync(new URL(row.dance + '.json', target), JSON.stringify({ sequence, guide: row.guideText }, null, 2) + '\n');
}
console.log(`Packaged ${manifest.clips.length} exact sequences with timed guides.`);
