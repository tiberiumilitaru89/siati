const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Generates the favicon and the PWA icons from the inline SVG below.
//
// The hero images (public/images/tulip_hero.webp and tulip_hero-mobile.webp) are committed as
// they are. Their JPG master was removed from the repository (it is still in the git history),
// so this script no longer regenerates them.
async function main() {
  const rootDir = path.resolve(__dirname, '..');

  // Icons dir
  const iconsDir = path.join(rootDir, 'public', 'icons');
  if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

  const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <rect width="512" height="512" rx="110" fill="#1e352b"/>
    <circle cx="256" cy="256" r="210" fill="none" stroke="#c9a66b" stroke-width="4" stroke-dasharray="6 8" opacity="0.6"/>
    <g transform="translate(256, 265)">
      <ellipse cx="0" cy="-50" rx="55" ry="85" fill="#c48278" opacity="0.95"/>
      <ellipse cx="-50" cy="20" rx="55" ry="85" fill="#d99b91" opacity="0.9" transform="rotate(-50, -50, 20)"/>
      <ellipse cx="50" cy="20" rx="55" ry="85" fill="#d99b91" opacity="0.9" transform="rotate(50, 50, 20)"/>
      <ellipse cx="-30" cy="75" rx="50" ry="75" fill="#c48278" opacity="0.85" transform="rotate(-110, -30, 75)"/>
      <ellipse cx="30" cy="75" rx="50" ry="75" fill="#c48278" opacity="0.85" transform="rotate(110, 30, 75)"/>
      <circle cx="0" cy="20" r="32" fill="#c9a66b"/>
      <circle cx="0" cy="20" r="18" fill="#faf7f2"/>
      <path d="M0,60 Q-10,130 0,170" stroke="#2c4c3e" stroke-width="10" stroke-linecap="round" fill="none"/>
      <path d="M0,110 Q-40,90 -50,60 Q-25,95 0,110" fill="#2c4c3e"/>
    </g>
  </svg>`;

  fs.writeFileSync(path.join(iconsDir, 'icon.svg'), svgIcon);
  fs.writeFileSync(path.join(rootDir, 'public', 'favicon.svg'), svgIcon);

  await sharp(Buffer.from(svgIcon))
    .resize(192, 192)
    .png()
    .toFile(path.join(iconsDir, 'icon-192.png'));

  await sharp(Buffer.from(svgIcon))
    .resize(512, 512)
    .png()
    .toFile(path.join(iconsDir, 'icon-512.png'));

  await sharp(Buffer.from(svgIcon))
    .resize(180, 180)
    .png()
    .toFile(path.join(iconsDir, 'apple-touch-icon.png'));

  console.log('PWA icons created successfully in public/icons/');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
