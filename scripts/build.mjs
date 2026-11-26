import { readFile } from 'node:fs/promises';
import { context } from 'esbuild';

const header = (await readFile(new URL('../src/userscript-header.txt', import.meta.url), 'utf8')).trim();
if (!header.startsWith('// ==UserScript==') || !header.includes('// @match https://appslog.sampoernakayoe.co.id/*')) {
  throw new Error('Userscript metadata header is missing or invalid.');
}

const buildContext = await context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['es2020'],
  outfile: 'dist/appslogtools.user.js',
  banner: { js: header },
  minify: process.argv.includes('--minify'),
  treeShaking: true,
  legalComments: 'none',
  charset: 'utf8',
  sourcemap: false,
});

if (process.argv.includes('--watch')) {
  await buildContext.watch();
  console.log('Watching source files; output: dist/appslogtools.user.js');
} else {
  try {
    await buildContext.rebuild();
    console.log(`Built ${process.argv.includes('--minify') ? 'minified' : 'readable'} dist/appslogtools.user.js`);
  } finally {
    await buildContext.dispose();
  }
}
