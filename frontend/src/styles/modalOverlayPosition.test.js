// Popups are portaled into the scrolling `.app-shell__content`; an `absolute`
// full-cover overlay there only dims the top of the scroll area and opens the
// dialog above the visible screen. Page-level overlays must be `fixed`.
const fs = require('fs');
const path = require('path');

const cssFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return cssFiles(full);
  return entry.name.endsWith('.css') ? [full] : [];
});

test('full-screen modal overlays are position: fixed, not absolute', () => {
  const offenders = [];
  cssFiles(path.join(__dirname, '..')).forEach((file) => {
    const css = fs.readFileSync(file, 'utf8');
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/(overlay|backdrop|-layer)/i.test(selector)
        && /position:\s*absolute/.test(body)
        && /inset:\s*0|top:\s*0/.test(body)) {
        offenders.push(`${path.relative(path.join(__dirname, '..'), file)}: ${selector.trim().split('\n').pop()}`);
      }
    }
  });
  expect(offenders).toEqual([]);
});
