import http from 'node:http';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const artifact = `Zenblade-${version}-arm64.dmg`;
// Only explicit release assets are served, on loopback only.
const routes = new Map([
  ['/', [join(root, 'docs/index.html'), 'text/html; charset=utf-8']],
  [`/${artifact}`, [join(root, 'dist', artifact), 'application/x-apple-diskimage', artifact]],
  [`/${artifact}.sha256`, [join(root, 'dist', `${artifact}.sha256`), 'text/plain', `${artifact}.sha256`]],
  ['/images/zenblade-icon.png', [join(root, 'docs/images/zenblade-icon.png'), 'image/png']],
  ['/images/zenblade-keyboard.png', [join(root, 'docs/images/zenblade-keyboard.png'), 'image/png']],
]);
statSync(join(root, 'dist', artifact));
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const entry = routes.get(pathname);
  if (!entry || !['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(404).end('Not found');
    return;
  }
  const [file, type, download] = entry;
  try {
    const html = pathname === '/' ? readFileSync(file, 'utf8').replaceAll(
      'https://github.com/edgetr/Zenblade-65-V2-MacOS-App/releases/download/v0.1/', '/'
    ) : null;
    const headers = { 'Content-Type': type, 'Content-Length': html === null ? statSync(file).size : Buffer.byteLength(html), 'Cache-Control': 'no-store' };
    if (download) headers['Content-Disposition'] = `attachment; filename="${download}"`;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') res.end();
    else if (html !== null) res.end(html);
    else createReadStream(file).on('error', () => res.destroy()).pipe(res);
  } catch {
    res.writeHead(404).end('Build the release first with npm run release:dmg.');
  }
});
server.listen(Number(process.env.PORT || 8765), '127.0.0.1', () => {
  console.log(`Local download preview: http://127.0.0.1:${server.address().port}`);
});
