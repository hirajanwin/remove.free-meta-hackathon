#!/usr/bin/env node
// remove.free agent CLI.
// Runs locally on CPU or GPU via @huggingface/transformers. Same model (BiRefNet lite / RMBG, MIT).
//   setup: npm i -s @huggingface/transformers@4.2.0
//   usage: node agent.mjs <input...> [--bg white|black|#hex] [--out dir]
// Writes <name>-no-bg.png next to each input (or into --out). Model downloads once into ~/.cache/huggingface.

import { AutoModel, AutoProcessor, RawImage } from '@huggingface/transformers';
import { basename, dirname, extname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args.splice(i, 2)[1] : null;
};
const bg = opt('--bg');
const outDir = opt('--out');
const inputs = args;

if (!inputs.length) {
  console.error('usage: node agent.mjs <input...> [--bg white|black|#hex] [--out dir]');
  console.error('example: node agent.mjs photo.jpg --bg white --out ./cut');
  process.exit(1);
}

if (outDir) {
  mkdirSync(outDir, { recursive: true });
}

console.log('Loading BiRefNet model...');
const id = 'onnx-community/BiRefNet_lite-ONNX';
const model = await AutoModel.from_pretrained(id, { dtype: 'fp32' });
const processor = await AutoProcessor.from_pretrained(id);

for (const file of inputs) {
  const t0 = Date.now();
  try {
    const image = await RawImage.read(file);
    const { pixel_values } = await processor(image);
    const { output_image } = await model({ input_image: pixel_values });
    const mask = await RawImage.fromTensor(
      output_image[0].sigmoid().mul(255).to('uint8')
    ).resize(image.width, image.height);

    const out = image.rgba().putAlpha(mask);

    if (bg) {
      const hex = { white: '#ffffff', black: '#000000' }[bg] || bg;
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      const d = out.data;
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3] / 255;
        d[i] = d[i] * a + r * (1 - a);
        d[i + 1] = d[i + 1] * a + g * (1 - a);
        d[i + 2] = d[i + 2] * a + b * (1 - a);
        d[i + 3] = 255;
      }
    }

    const dest = join(
      outDir || dirname(file),
      basename(file, extname(file)) + '-no-bg.png'
    );
    await out.save(dest);
    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[OK] ${dest}  ${image.width}x${image.height}  ${sec}s`);
  } catch (err) {
    console.error(`[FAIL] ${file}: ${err.message || err}`);
  }
}
