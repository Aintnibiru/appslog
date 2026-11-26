import assert from 'node:assert/strict';
import { build } from 'esbuild';
import test from 'node:test';

async function loadTypeScriptModule(entryPoint) {
  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
}

const [cacheModule, material, pricing, redirect] = await Promise.all([
  loadTypeScriptModule('src/core/dom-cache.ts'),
  loadTypeScriptModule('src/features/material-parser.ts'),
  loadTypeScriptModule('src/features/price-parser.ts'),
  loadTypeScriptModule('src/features/redirect.ts'),
]);

test('material parser preserves tab-delimited empty cells and names with spaces', () => {
  assert.deepEqual(material.splitRow('SENGON\t\t15\t12\t4'), ['SENGON', '', '15', '12', '4']);
  assert.deepEqual(material.splitRow('Baja Ringan  260  15  12  4'), ['Baja Ringan', '260', '15', '12', '4']);
  assert.deepEqual(material.lengthVariants('260,5M'), ['260,5M', '260,5', '260.5']);
});

test('DOM query cache reuses selector results and invalidates after observed mutations', () => {
  let callback;
  globalThis.MutationObserver = class {
    constructor(onMutation) {
      callback = onMutation;
    }
    observe() {}
    disconnect() {}
  };
  let calls = 0;
  let elements = [{ id: 'first' }];
  const root = {
    querySelectorAll() {
      calls++;
      return elements;
    },
    querySelector() {
      calls++;
      return elements[0] ?? null;
    },
  };
  const cache = new cacheModule.DomQueryCache(root);

  assert.equal(cache.queryAll('input', root)[0].id, 'first');
  assert.equal(cache.queryAll('input', root)[0].id, 'first');
  assert.equal(calls, 1);
  elements = [{ id: 'second' }];
  callback();
  assert.equal(cache.queryAll('input', root)[0].id, 'second');
  assert.equal(calls, 2);
  assert.equal(cache.query('button', root).id, 'second');
  assert.equal(cache.query('button', root).id, 'second');
  assert.equal(calls, 3);
  cache.disconnect();
});

test('price parser handles Indonesian and English grouping without shifting row indexes', () => {
  assert.deepEqual(pricing.parseHargaValues('\n850000').entries, [{ row: 1, value: '850000' }]);
  const parsed = pricing.parseHargaValues('Rp. 1.234.567\n\n1,234.56\n-850000');
  assert.deepEqual(parsed.entries, [
    { row: 0, value: '1234567' },
    { row: 2, value: '1234.56' },
  ]);
  assert.equal(parsed.errors.length, 2);
  assert.equal(parsed.total, 4);
});

test('redirect parser validates dates and builds the expected transaction URL', () => {
  assert.equal(redirect.parseDateToIso('16-Okt-25'), '2025-10-16');
  assert.equal(redirect.parseDateToIso('31-Feb-25'), null);
  assert.equal(redirect.adjustIdForPath('261126006'), '2611266');
  assert.match(
    redirect.buildRedirectUrl('16-Oct-25 261016017'),
    /transaction\/delivery%7C26101617\/detail\?date=2025-10-16&page=1&q=261016017$/,
  );
});
