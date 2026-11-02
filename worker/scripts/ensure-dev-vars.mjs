// Creates worker/.dev.vars from .dev.vars.example on first run, so `npm run dev` works without setup.
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, '.dev.vars');
if (!existsSync(target)) {
    copyFileSync(join(root, '.dev.vars.example'), target);
    console.log('Created worker/.dev.vars from .dev.vars.example (local development secrets only).');
}
