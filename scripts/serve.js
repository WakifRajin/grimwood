// Local static server for public/ that applies the same response headers as
// Firebase Hosting (read from firebase.json), so the CSP is tested before deploying.
//   node scripts/serve.js [port]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../public', import.meta.url)));
const PORT = Number(process.argv[2] || process.env.PORT || 8080);
const config = JSON.parse(await readFile(new URL('../firebase.json', import.meta.url), 'utf8'));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
};

// Firebase-style glob → RegExp: ** any path, * one segment, @(a|b) alternatives.
function globToRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; }
    else if (c === '*') re += '[^/]*';
    else if (c === '@' && glob[i + 1] === '(') { const end = glob.indexOf(')', i); re += `(${glob.slice(i + 2, end)})`; i = end; }
    else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
const rules = (config.hosting.headers || []).map(h => ({ re: globToRe(h.source), headers: h.headers }));

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT + sep) && file !== ROOT) { res.writeHead(403).end(); return; }
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
    const rel = path.replace(/^\//, '');
    for (const r of rules) if (r.re.test(rel)) for (const h of r.headers) res.setHeader(h.key, h.value);
    res.setHeader('Content-Type', TYPES[extname(file).toLowerCase()] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
}).listen(PORT, () => console.log(`Serving public/ on http://localhost:${PORT} (with firebase.json headers)`));
