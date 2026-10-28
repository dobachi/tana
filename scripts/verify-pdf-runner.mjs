// verify-pdf-runner.mjs — PDF プレビューの runner を実ブラウザ（headless Chrome）で確かめる（手動）。
//
//   node scripts/verify-pdf-runner.mjs <拡張pdfjsのフォルダ> <PDF> <スクリーンショット.png>
//
// Tana と同じ CSP を付けて配信し、sandbox="allow-scripts" の iframe で runner を開き、
// エンジンと PDF を postMessage で渡して描かせる。jsdom では iframe 内の描画を確かめられないため。
// 拡張のフォルダは tana-extensions の `node scripts/build-pdfjs.mjs <ver> <dir>` で作れる。
// puppeteer はこのリポジトリの依存に入れていない（`npm i -g puppeteer` 等で用意する）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer');
const [extDir, pdfPath, outPng] = process.argv.slice(2);
if (!extDir || !pdfPath || !outPng) {
  console.error('usage: node scripts/verify-pdf-runner.mjs <extDir> <pdf> <out.png>');
  process.exit(2);
}
const runnerDir = new URL('../src/pdf-runner/', import.meta.url).pathname;
// tauri.conf.json の CSP（asset/ipc の項目はこの検証に関係しないので省く）
const CSP =
  "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' blob:; worker-src blob:; frame-src 'self'; connect-src 'self'; object-src 'none'";
const parentHtml = `<!doctype html><html><body style="margin:0"><iframe id="f" sandbox="allow-scripts" src="/pdf-runner/runner.html" style="width:800px;height:900px;border:0"></iframe><script src="/parent.js"></script></body></html>`;
const parentJs = `
window.__result = null;
const f = document.getElementById('f');
window.addEventListener('message', async (e) => {
  if (e.source !== f.contentWindow) return;
  const m = e.data || {};
  if (m.type === 'ready') {
    const get = async (n) => (await fetch('/ext/' + n)).text();
    const engine = { pdf: await get('pdf.min.mjs'), worker: await get('pdf.worker.js'), cmaps: await get('cmaps.json'), fonts: await get('standard_fonts.json') };
    const data = await (await fetch('/test.pdf')).arrayBuffer();
    f.contentWindow.postMessage({ type: 'show', engine, data, dark: false }, '*', [data]);
  } else window.__result = m;
});`;
const server = http.createServer((req, res) => {
  const send = (body, type) => {
    res.writeHead(200, { 'Content-Type': type, 'Content-Security-Policy': CSP });
    res.end(body);
  };
  const u = req.url;
  if (u === '/') return send(parentHtml, 'text/html');
  if (u === '/parent.js') return send(parentJs, 'text/javascript');
  if (u === '/test.pdf') return send(fs.readFileSync(pdfPath), 'application/pdf');
  if (u.startsWith('/ext/'))
    return send(fs.readFileSync(path.join(extDir, u.slice(5))), 'text/plain');
  if (u.startsWith('/pdf-runner/')) {
    const f = path.join(runnerDir, u.slice(12));
    const t = f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html';
    return send(fs.readFileSync(f), t);
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
await page.goto(`http://localhost:${port}/`);
await page.waitForFunction('window.__result', { timeout: 30000 }).catch(() => {});
const result = await page.evaluate('window.__result');
await new Promise((r) => setTimeout(r, 2500));
const frame = page.frames().find((fr) => fr.url().includes('runner.html'));
const canvases = await frame.evaluate(() =>
  [...document.querySelectorAll('canvas')].map((c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 128) dark++;
    return { w: c.width, h: c.height, dark };
  }),
);
await page.screenshot({ path: outPng });
console.log(JSON.stringify({ result, canvases }, null, 1));
console.log(logs.join('\n'));
await browser.close();
server.close();
