/** Ship the exact validated v2 artifacts and model fixture, without changing the original dances. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root=new URL('./',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',root),'utf8'));
for(const row of manifest.clips) {
  const raw=readFileSync(new URL(row.clipFile,root));
  if(createHash('sha256').update(raw).digest('hex')!==row.clipSha256) throw new Error('Changed clip '+row.id);
  const asset=JSON.parse(readFileSync(new URL(row.danceFile,root),'utf8'));
  if(JSON.stringify(asset.clip)!==JSON.stringify(JSON.parse(raw))) throw new Error('Mismatched dance wrapper '+row.id);
  writeFileSync(new URL(`../../packages/client/ui-robot-lab/src/client/dance-clips/${row.id}.json`,root),JSON.stringify(asset,null,2)+'\n');
}
writeFileSync(new URL('../../packages/client/ui-robot-lab/tests/fixtures/dance-v2-model.json',root),readFileSync(new URL('model.json',root)));
console.log('Packaged six exact v2 dances and their native kinematic test fixture.');
