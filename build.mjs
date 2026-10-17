import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const output = join(root, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of await readdir(root)) {
  if (file === 'index.html' || file.endsWith('.css') || (file.endsWith('.js') && !file.endsWith('.test.js'))) {
    await cp(join(root, file), join(output, file));
  }
}
for (const folder of ['assets', 'vendor']) await cp(join(root, folder), join(output, folder), { recursive: true });
console.log('Static game built in dist/');
