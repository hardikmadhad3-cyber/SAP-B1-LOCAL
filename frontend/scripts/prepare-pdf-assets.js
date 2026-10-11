const fs = require('fs');
const path = require('path');

// Serve PDF fonts, character maps and image decoders locally, including offline deployments.
const source = path.dirname(require.resolve('pdfjs-dist/package.json'));
const target = path.resolve(__dirname, '../public/pdfjs-assets');
for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
  fs.cpSync(path.join(source, directory), path.join(target, directory), { recursive: true });
}
