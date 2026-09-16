/**
 * Generates apps/main/icons/icon.icns from an inline SVG.
 * Uses sharp (already present via transformers.js) + macOS iconutil.
 */
import { execSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Lab identity: ultramarine field, white flask, ink bubbles.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3557E8"/>
      <stop offset="1" stop-color="#2340B8"/>
    </linearGradient>
  </defs>
  <rect x="64" y="64" width="896" height="896" rx="200" fill="url(#bg)"/>
  <!-- flask silhouette -->
  <path fill="#FAFAF7" d="
    M 442 250
    L 582 250
    L 582 268 L 560 268
    L 560 430
    L 700 668
    Q 736 730 700 776
    Q 676 806 628 806
    L 396 806
    Q 348 806 324 776
    Q 288 730 324 668
    L 464 430
    L 464 268 L 442 268
    Z"/>
  <!-- liquid line -->
  <path fill="#2340B8" d="
    M 404 620 L 620 620 L 668 702
    Q 686 736 664 758 Q 652 770 628 770
    L 396 770 Q 372 770 360 758 Q 338 736 356 702 Z"/>
  <!-- bubbles -->
  <circle cx="470" cy="560" r="26" fill="#FAFAF7" opacity="0.9"/>
  <circle cx="540" cy="510" r="16" fill="#FAFAF7" opacity="0.75"/>
  <circle cx="512" cy="680" r="20" fill="#FAFAF7" opacity="0.9"/>
</svg>`;

const iconsetDir = path.join(root, "apps/main/icons/icon.iconset");
const iconsDir = path.join(root, "apps/main/icons");

await rm(iconsetDir, { recursive: true, force: true });
await mkdir(iconsetDir, { recursive: true });

const sizes = [16, 32, 64, 128, 256, 512, 1024];
const buffer = Buffer.from(svg);
for (const size of sizes) {
  const png = await sharp(buffer).resize(size, size).png().toBuffer();
  if (size <= 512) {
    await writeFile(path.join(iconsetDir, `icon_${size}x${size}.png`), png);
  }
  if (size >= 32) {
    await writeFile(
      path.join(iconsetDir, `icon_${size / 2}x${size / 2}@2x.png`),
      png
    );
  }
}

execSync(`iconutil -c icns -o "${path.join(iconsDir, "icon.icns")}" "${iconsetDir}"`);
await rm(iconsetDir, { recursive: true, force: true });
console.log("✅ icon.icns written to apps/main/icons/");
