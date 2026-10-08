// Resolve every import specifier in the web module graph, the way a browser would.
import { readdir, readFile } from 'node:fs/promises';

const roots = ['web/engine', 'web/ui'];
const files = [];
for (const root of roots) {
  for (const entry of await readdir(root)) if (entry.endsWith('.js')) files.push(`${root}/${entry}`);
}

const missing = [];
const edges = [];
for (const file of files) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(/from\s+'([^']+)'/g)) {
    const specifier = match[1];
    const dir = file.replace(/\/[^/]*$/, '');
    // Segment-wise resolution: a `..` drops the segment before it, which is what a browser does.
    // Collapsing `/../` into `/` instead leaves `web/engine/../data/limits.js` as
    // `web/engine/data/limits.js`, a path that exists in neither the repo nor the browser.
    const resolved = [];
    for (const segment of `${dir}/${specifier}`.split('/')) {
      if (segment === '..') resolved.pop();
      else if (segment !== '.' && segment !== '') resolved.push(segment);
    }
    const path = resolved.join('/');
    edges.push(`${file} -> ${specifier}`);
    try {
      await readFile(path);
    } catch (problem) {
      missing.push(`${file} -> ${specifier} (${path})`);
    }
  }
}
console.log(`${edges.length} import edges, ${missing.length} unresolvable`);
for (const m of missing) console.log(m);
