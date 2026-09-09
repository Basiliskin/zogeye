// scripts/copy-assets.mjs
import { copyFile, mkdir } from 'node:fs/promises';

await mkdir('dist/sidepanel', { recursive: true });
await copyFile('public/manifest.json', 'dist/manifest.json');
await copyFile('src/sidepanel/index.html', 'dist/sidepanel/index.html');