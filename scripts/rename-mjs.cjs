const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '../dist/index.js');
const dest = path.join(__dirname, '../dist/index.mjs');

if (fs.existsSync(src)) {
  fs.renameSync(src, dest);
}
