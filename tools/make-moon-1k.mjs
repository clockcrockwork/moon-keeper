// moon.webp (2048x1024) を 1024x512 に縮小して moon-1k.webp を作る。
//
// 中・低性能階層はこちらを読む。2048x1024 は RGBA 展開＋ミップマップで
// VRAM 約10MB、初回ロードも 612KB あり、低メモリのスマホでは無視できない。
// 月は画面の一部しか占めないので 1024x512 で解像度は足りる。
//
//   npx http-server -p 8080 -c-1 .
//   NODE_PATH=$(npm root -g) node tools/make-moon-1k.mjs
//
// ビルドステップは作らない方針なので、生成物はコミットする。

import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.argv[2] ?? 'http://localhost:8080';
const QUALITY = 0.86;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'load' });

const dataUrl = await page.evaluate(
  async ({ base, quality }) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('moon.webp を読めませんでした'));
      img.src = `${base}/moon.webp`;
    });

    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/webp', quality);
  },
  { base: BASE, quality: QUALITY }
);

if (!dataUrl.startsWith('data:image/webp')) {
  throw new Error('WebP でエンコードできませんでした: ' + dataUrl.slice(0, 40));
}

const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
await writeFile('moon-1k.webp', bytes);
console.log(`moon-1k.webp を書き出しました: 1024x512, ${(bytes.length / 1024).toFixed(0)}KB`);

await browser.close();
