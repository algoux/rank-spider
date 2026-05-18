#!/usr/bin/env -S npx tsx

import path from 'path';
import fs from 'fs-extra';
import { program } from 'commander';
import { run, DomjudgeHtmlV8Asset } from '../adapters/domjudge_html_v8';

function stripQueryAndHash(source: string): string {
  return source.split(/[?#]/)[0];
}

function isHttpUrl(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

function toRelativeAssetPath(outputPath: string, assetPath: string): string {
  return path.relative(path.dirname(outputPath), assetPath).split(path.sep).join('/');
}

function resolveLocalAssetPath(htmlPath: string, source: string): string {
  if (/^file:\/\//i.test(source)) {
    return decodeURIComponent(new URL(source).pathname);
  }
  return path.resolve(path.dirname(htmlPath), stripQueryAndHash(source));
}

function createAssetHandler(htmlPath: string, outputPath: string) {
  const assetsDir = path.join(path.dirname(outputPath), 'assets');
  return async (asset: DomjudgeHtmlV8Asset): Promise<string | undefined> => {
    await fs.ensureDir(assetsDir);
    const destPath = path.join(assetsDir, path.basename(asset.suggestedFilename));

    if (isHttpUrl(asset.source)) {
      const res = await fetch(asset.source, {
        headers: {
          'user-agent': 'Mozilla/5.0 (compatible; rank-spider DOMjudge HTML v8 program)',
        },
      });
      if (!res.ok) {
        console.warn(`Failed to fetch asset ${asset.source}: HTTP ${res.status}`);
        return undefined;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(destPath, buffer);
    } else {
      const sourcePath = resolveLocalAssetPath(htmlPath, asset.source);
      if (!(await fs.pathExists(sourcePath))) {
        console.warn(`Asset not found: ${sourcePath}`);
        return undefined;
      }
      await fs.copy(sourcePath, destPath, { overwrite: true });
    }

    return toRelativeAssetPath(outputPath, destPath);
  };
}

program
  .name('domjudge_html_v8.ts')
  .argument('<html-file>', 'DOMjudge v8 HTML file path')
  .option('-o, --output <file>', 'output file path', 'out.srk.json')
  .action(async (htmlFile: string, options: { output: string }) => {
    try {
      const htmlPath = path.resolve(htmlFile);
      const outputPath = path.resolve(options.output);
      const html = await fs.readFile(htmlPath, 'utf-8');
      const srkObject = await run(html, {
        htmlPath,
        assetHandler: createAssetHandler(htmlPath, outputPath),
      });
      await fs.writeFile(outputPath, JSON.stringify(srkObject, null, 2), 'utf-8');
      console.log(`Output written to ${outputPath}`);
    } catch (e) {
      console.error(e);
      process.exit(1);
    }
  });

program.parse();
