import { chromium } from 'playwright';
import fs from 'node:fs';
const svg = fs.readFileSync('/home/claude/money/public/icon.svg', 'utf8');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const p = await b.newPage();
async function render(size, file, pad = 0, bg = 'transparent') {
  await p.setViewportSize({ width: size, height: size });
  const inner = size - pad * 2;
  await p.setContent(`<html><body style="margin:0;background:${bg}"><div style="padding:${pad}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`);
  await p.screenshot({ path: '/home/claude/money/public/' + file, omitBackground: bg === 'transparent' });
}
await render(192, 'icon-192.png');
await render(512, 'icon-512.png');
await render(180, 'apple-touch-icon.png', 0, '#0f766e');
// maskable: full-bleed background, glyph inside the 80% safe zone
await p.setViewportSize({ width: 512, height: 512 });
await p.setContent(`<html><body style="margin:0;background:#0f766e;display:grid;place-items:center;height:512px">${svg.replace('<svg ', '<svg width="400" height="400" ').replace('rx="116"', 'rx="0"')}</body></html>`);
await p.screenshot({ path: '/home/claude/money/public/icon-maskable-512.png' });
await b.close();
