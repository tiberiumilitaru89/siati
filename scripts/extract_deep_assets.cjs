const fs = require('fs');
const path = require('path');
const https = require('https');
const sharp = require('sharp');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { rejectUnauthorized: false }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          resolve(JSON.parse(d));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { rejectUnauthorized: false }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function main() {
  console.log('=== Extragere Completa Scoala de Flori & Brand Siati ===');

  const appDataDir = path.resolve(__dirname, '..');
  const scoalaImgDir = path.join(appDataDir, 'public/images/scoala');
  const brandImgDir = path.join(appDataDir, 'public/images/brand');
  const dataDir = path.join(appDataDir, 'data');

  [scoalaImgDir, brandImgDir, dataDir].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });

  // 1. Fetch Pages from Scoala de Flori
  console.log('1. Preluare pagini Scoala de Flori...');
  const scoalaPages = await fetchJson('https://www.scoaladeflori.ro/wp-json/wp/v2/pages?per_page=50');
  const scoalaPosts = await fetchJson('https://www.scoaladeflori.ro/wp-json/wp/v2/posts?per_page=50');
  const scoalaMedia = await fetchJson('https://www.scoaladeflori.ro/wp-json/wp/v2/media?per_page=100');

  fs.writeFileSync(path.join(dataDir, 'scoala_pages_raw.json'), JSON.stringify(scoalaPages, null, 2));
  fs.writeFileSync(path.join(dataDir, 'scoala_posts_raw.json'), JSON.stringify(scoalaPosts, null, 2));
  console.log(`Salvat ${scoalaPages.length} pagini si ${scoalaPosts.length} articole Scoala de Flori.`);

  // 2. Fetch Pages from Floraria Siati
  console.log('2. Preluare pagini Floraria Siati...');
  const siatiPages = await fetchJson('https://www.floraria-siati.ro/wp-json/wp/v2/pages?per_page=50');
  const siatiMedia = await fetchJson('https://www.floraria-siati.ro/wp-json/wp/v2/media?per_page=100');

  fs.writeFileSync(path.join(dataDir, 'siati_pages_raw.json'), JSON.stringify(siatiPages, null, 2));
  console.log(`Salvat ${siatiPages.length} pagini Floraria Siati.`);

  // 3. Download & Optimize Scoala de Flori Media
  console.log(`\n3. Descarcare & Optimizare imagini Scoala de Flori (${scoalaMedia.length} fisiere)...`);
  let sCount = 0;
  for (const m of scoalaMedia) {
    const srcUrl = m.source_url;
    const slug = m.slug || path.basename(srcUrl, path.extname(srcUrl));
    if (!srcUrl || !srcUrl.match(/\.(jpeg|jpg|png)$/i)) continue;

    const targetWebp = path.join(scoalaImgDir, `${slug}.webp`);
    if (!fs.existsSync(targetWebp)) {
      try {
        const buf = await downloadBuffer(srcUrl);
        await sharp(buf)
          .resize({ width: 1400, withoutEnlargement: true })
          .webp({ quality: 82, effort: 4 })
          .toFile(targetWebp);
        sCount++;
        process.stdout.write('.');
      } catch (e) {
        // Skip
      }
    }
  }
  console.log(`\nSalvat ${sCount} imagini optimizate in public/images/scoala/`);

  // 4. Download & Optimize Siati Brand Media
  console.log(`\n4. Descarcare & Optimizare imagini Floraria Siati (${siatiMedia.length} fisiere)...`);
  let bCount = 0;
  for (const m of siatiMedia) {
    const srcUrl = m.source_url;
    const slug = m.slug || path.basename(srcUrl, path.extname(srcUrl));
    if (!srcUrl || !srcUrl.match(/\.(jpeg|jpg|png)$/i)) continue;

    const targetWebp = path.join(brandImgDir, `${slug}.webp`);
    if (!fs.existsSync(targetWebp)) {
      try {
        const buf = await downloadBuffer(srcUrl);
        await sharp(buf)
          .resize({ width: 1400, withoutEnlargement: true })
          .webp({ quality: 82, effort: 4 })
          .toFile(targetWebp);
        bCount++;
        process.stdout.write('.');
      } catch (e) {
        // Skip
      }
    }
  }
  console.log(`\nSalvat ${bCount} imagini optimizate in public/images/brand/`);

  console.log('\n=== Extragere completa a fost finalizata cu succes! ===');
}

main().catch(console.error);
