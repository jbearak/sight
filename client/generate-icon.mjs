#!/usr/bin/env node
// Renders client/icon.html's 128x128 SVG to client/icon.png at 660x660.
// Usage: bun client/generate-icon.mjs
// Requires: bun add playwright && bunx playwright install chromium

import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const DIR = dirname(fileURLToPath(import.meta.url));
const HTML = resolve(DIR, 'icon.html');
const OUT  = resolve(DIR, 'icon.png');
const SIZE = 660;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: SIZE + 100, height: SIZE + 100 } });

await page.goto('file://' + HTML);

await page.evaluate((size) => {
    // Force all page backgrounds transparent so SVG corners render cleanly
    const style = document.createElement('style');
    style.textContent = '* { background: transparent !important; }';
    document.head.appendChild(style);

    const svg = document.querySelector('svg[viewBox="0 0 128 128"]');
    svg.style.width  = size + 'px';
    svg.style.height = size + 'px';
    svg.setAttribute('width',  size);
    svg.setAttribute('height', size);
    svg.style.position = 'fixed';
    svg.style.top  = '0';
    svg.style.left = '0';
}, SIZE);

await page.screenshot({
    path: OUT,
    clip: { x: 0, y: 0, width: SIZE, height: SIZE },
    omitBackground: true,
});

await browser.close();
console.log('Wrote', OUT);
