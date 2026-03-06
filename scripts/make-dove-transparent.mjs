import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'fs';

const input = readFileSync('public/dove-translucent.png');

const { data, info } = await sharp(input)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

for (let i = 0; i < data.length; i += 4) {
  const r = data[i], g = data[i+1], b = data[i+2];
  // If pixel is white or near-white, make transparent
  if (r > 220 && g > 220 && b > 220) {
    data[i + 3] = 0;
  }
}

const output = await sharp(data, {
  raw: { width: info.width, height: info.height, channels: 4 }
}).png().toBuffer();

writeFileSync('public/dove-transparent.png', output);
console.log('Done! Saved to public/dove-transparent.png');
