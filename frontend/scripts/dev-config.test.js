const assert = require('node:assert/strict');
const test = require('node:test');
const config = require('../craco.config');

test('development compiles pages ahead of navigation by default and skips production asset processing', () => {
  const previous = process.env.DEV_LAZY_COMPILATION;
  delete process.env.DEV_LAZY_COMPILATION;
  try {
    const optimization = { runtimeChunk: false };
    const output = { filename: 'static/js/bundle.js' };
    const result = config.webpack.configure({ mode: 'development', optimization, output, plugins: [] });
    assert.equal(result.experiments?.lazyCompilation, undefined);
    assert.equal(result.optimization, optimization);
    assert.equal(result.output, output);
    assert.equal(result.plugins.some(plugin => plugin.constructor.name === 'CompressionPlugin'), false);
  } finally {
    if (previous === undefined) delete process.env.DEV_LAZY_COMPILATION;
    else process.env.DEV_LAZY_COMPILATION = previous;
  }
});

test('production keeps chunking and gzip without lazy compilation', () => {
  const result = config.webpack.configure({ mode: 'production', optimization: {}, output: {}, plugins: [] });
  assert.equal(result.experiments?.lazyCompilation, undefined);
  assert.equal(result.optimization.splitChunks.cacheGroups.reactVendor.name, 'vendor-react');
  assert.equal(result.output.filename, 'static/js/[name].[contenthash:8].js');
  assert.equal(result.plugins.some(plugin => plugin.constructor.name === 'CompressionPlugin'), true);
});

test('remote-browser development can disable localhost lazy compilation', () => {
  const previous = process.env.DEV_LAZY_COMPILATION;
  process.env.DEV_LAZY_COMPILATION = 'false';
  try {
    const result = config.webpack.configure({ mode: 'development', optimization: {}, output: {}, plugins: [] });
    assert.equal(result.experiments?.lazyCompilation, undefined);
  } finally {
    if (previous === undefined) delete process.env.DEV_LAZY_COMPILATION;
    else process.env.DEV_LAZY_COMPILATION = previous;
  }
});

test('localhost lazy compilation requires explicit opt-in and never applies to production', () => {
  const previous = process.env.DEV_LAZY_COMPILATION;
  process.env.DEV_LAZY_COMPILATION = 'true';
  try {
    const development = config.webpack.configure({ mode: 'development', optimization: {}, output: {}, plugins: [] });
    assert.deepEqual(development.experiments.lazyCompilation, { entries: false, imports: true });
    const production = config.webpack.configure({ mode: 'production', optimization: {}, output: {}, plugins: [] });
    assert.equal(production.experiments?.lazyCompilation, undefined);
  } finally {
    if (previous === undefined) delete process.env.DEV_LAZY_COMPILATION;
    else process.env.DEV_LAZY_COMPILATION = previous;
  }
});
