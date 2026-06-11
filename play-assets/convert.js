const sharp = require('sharp');
const fs = require('fs');

const svg = fs.readFileSync('./feature-graphic.svg');

sharp(svg, { density: 300 })
  .resize(1024, 500)
  .png()
  .toFile('./feature-graphic.png')
  .then(() => console.log('✅ feature-graphic.png created (1024x500)'))
  .catch(err => console.error('❌', err));
