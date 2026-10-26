// renders the 96×96 icons for the app-icon shortcuts (mic, plus, clock) — lucide paths, white on teal
import { chromium } from 'playwright';
const glyphs = {
  'sc-voice': '<path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/>',
  'sc-add': '<path d="M5 12h14"/><path d="M12 5v14"/>',
  'sc-shift': '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
};
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const p = await b.newPage({ viewport: { width: 96, height: 96 } });
for (const [name, g] of Object.entries(glyphs)) {
  await p.setContent(`<html><body style="margin:0;background:#0f766e;display:grid;place-items:center;height:96px">
    <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${g}</svg></body></html>`);
  await p.screenshot({ path: `public/${name}.png` });
}
await b.close();
