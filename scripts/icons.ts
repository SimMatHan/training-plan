// Laver alle ikonstørrelser fra brand/icon.svg og lægger dem i brand/ og public/.
//
//   npm run icons
//
// icon.svg er kilden: figuren på gennemsigtig grund. Hjemmeskærm- og manifestikoner får en
// fuld hvid flade (iOS og Android runder selv hjørnerne); det maskerbare ikon holder figuren
// inden for den sikre zone (cirklen med 80 % diameter).
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const brand = (f: string) => path.join(root, 'brand', f);
const source = readFileSync(brand('icon.svg'), 'utf8');
const inner = source.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

/** Figuren skaleret om midten (1 = hele lærredet), evt. på hvid flade. */
function compose(scale: number, background?: string) {
  const offset = (512 * (1 - scale)) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${
    background ? `<rect width="512" height="512" fill="${background}"/>` : ''
  }<g transform="translate(${offset} ${offset}) scale(${scale})">${inner}</g></svg>`;
}

const png = (svg: string, size: number, file: string) =>
  sharp(Buffer.from(svg), { density: 72 * (size / 512) * 4 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(brand(file));

// Favicon: figuren fylder næsten hele feltet, så den kan læses i 16–32 px.
const favicon = compose(1.08);
writeFileSync(brand('favicon.svg'), favicon);

await Promise.all([
  png(favicon, 32, 'favicon-32.png'),
  png(compose(0.78, '#FFFFFF'), 180, 'apple-touch-icon.png'),
  png(compose(0.78, '#FFFFFF'), 192, 'icon-192.png'),
  png(compose(0.78, '#FFFFFF'), 512, 'icon-512.png'),
  png(compose(0.6, '#FFFFFF'), 512, 'icon-maskable-512.png'),
]);

for (const f of ['icon.svg', 'favicon.svg', 'favicon-32.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'])
  copyFileSync(brand(f), path.join(root, 'public', f));
console.log('Ikoner skrevet til brand/ og public/.');
