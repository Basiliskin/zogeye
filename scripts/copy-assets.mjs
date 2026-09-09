// scripts/copy-assets.mjs
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir } from 'node:fs/promises';

// Single source of truth for the extension icon. Edit this file and rebuild.
const ICON_SOURCE = 'assets/zogeye-icon.png';

await mkdir('dist/sidepanel', { recursive: true });
await mkdir('dist/icons', { recursive: true });
await copyFile('public/manifest.json', 'dist/manifest.json');
await copyFile('src/sidepanel/index.html', 'dist/sidepanel/index.html');

const resize = (size, out) =>
  execFileSync('sips', ['-s', 'format', 'png', '-z', String(size), String(size), ICON_SOURCE, '--out', out], {
    stdio: 'ignore',
  });

for (const size of [16, 32, 48, 128]) {
  resize(size, `dist/icons/icon-${size}.png`);
}
resize(72, 'dist/sidepanel/logo.png');
