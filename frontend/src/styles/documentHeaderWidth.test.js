// Document headers cap their two columns (sap-ui.css "SAP B1 header" rule) so
// fields keep SAP's width when the side bar collapses or the UDF panel closes.
// An inline `gridTemplateColumns: '1fr 1fr'` or an uncapped page header grid
// makes inputs stretch across the window again.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..');
const files = (dir, ext) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return files(full, ext);
  return entry.name.endsWith(ext) ? [full] : [];
});

test('document field grids do not override the column cap with inline multi-column templates', () => {
  const offenders = files(path.join(src, 'modules'), '.jsx').filter((file) => (
    /className="(po|so|del)-field-grid"\s+style=\{\{\s*gridTemplateColumns:\s*'[^']*1fr[^']*\s[^']*'/.test(fs.readFileSync(file, 'utf8'))
  ));
  expect(offenders.map((file) => path.relative(src, file))).toEqual([]);
});

test('every two-column page header grid is in the shared cap', () => {
  const css = fs.readFileSync(path.join(src, 'styles', 'sap-ui.css'), 'utf8');
  const cap = css.slice(css.indexOf('/* SAP B1 header:'), css.indexOf('/* Same cap for the tab panels'));
  [
    'so-header-columns', 'po-document-header-grid', 'gr-goods-receipt__header-grid',
    'itr-transfer-request__header-grid', 'pr-header-grid', 'jw-header-grid',
    'service-ap-header-grid', 'service-ar-header-grid', 'sap-document-footer-fields',
  ].forEach((className) => expect(cap).toContain(`.${className}`));
});

test('the Header UDF / Form Settings side panel has one shared width on every document page', () => {
  const css = fs.readFileSync(path.join(src, 'styles', 'sap-ui.css'), 'utf8');
  expect(css).toMatch(/--sap-side-panel-width:\s*clamp\(/);
  const shared = css.slice(css.indexOf('/* One size for the right-hand Header UDF / Form Settings panel'));
  ['so-layout', 'del-layout', 'sap-document-layout', 'sap-banking-layout', 'po-layout'].forEach((family) => {
    expect(shared).toContain(`.${family}`);
  });
  expect(shared).toContain('var(--sap-side-panel-width) !important');
});

test('no stronger page-family rule overrides the shared side panel width', () => {
  const css = fs.readFileSync(path.join(src, 'styles', 'sap-ui.css'), 'utf8');
  const sidebarColumns = [...css.matchAll(/([^{}]+is-sidebar-open[^{}]*)\{([^{}]*grid-template-columns:\s*minmax\(0, 1fr\)\s+[^;]+)/g)]
    .map(([, , body]) => body.match(/grid-template-columns:\s*minmax\(0, 1fr\)\s+([^;]+)/)[1].trim())
    .filter((column) => column.includes('!important') && !column.startsWith('!important'));
  sidebarColumns.forEach((column) => expect(column).toBe('var(--sap-side-panel-width) !important'));
});

test('document pages open with the Header UDF panel closed, like SAP B1', () => {
  const openByDefault = files(path.join(src, 'modules'), '.jsx').filter((file) => (
    /\[sidebarOpen, setSidebarOpen\] = useState\(true\)/.test(fs.readFileSync(file, 'utf8'))
  ));
  expect(openByDefault.map((file) => path.relative(src, file))).toEqual([]);
});
