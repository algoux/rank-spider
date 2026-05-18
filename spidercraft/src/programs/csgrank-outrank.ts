#!/usr/bin/env -S npx tsx

import path from 'path';
import fs from 'fs-extra';
import { program } from 'commander';
import { run, CSGRankOutrankAsset } from '../adapters/csgrank-outrank';

function isHttpUrl(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

function toRelativeAssetPath(outputPath: string, assetPath: string): string {
  return path.relative(path.dirname(outputPath), assetPath).split(path.sep).join('/');
}

function decodeDataUrl(dataUrl: string): Buffer {
  const match = dataUrl.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.*)$/i);
  if (!match) {
    throw new Error('Invalid base64 data URL asset');
  }
  return Buffer.from(match[2], 'base64');
}

function createAssetHandler(outputPath: string) {
  const assetsDir = path.join(path.dirname(outputPath), 'assets');
  return async (asset: CSGRankOutrankAsset): Promise<string | undefined> => {
    await fs.ensureDir(assetsDir);
    const destPath = path.join(assetsDir, path.basename(asset.suggestedFilename));

    if (asset.dataUrl) {
      await fs.writeFile(destPath, decodeDataUrl(asset.dataUrl));
    } else if (isHttpUrl(asset.source)) {
      const res = await fetch(asset.source, {
        headers: {
          'user-agent': 'Mozilla/5.0 (compatible; rank-spider CSGRank Outrank program)',
        },
      });
      if (!res.ok) {
        console.warn(`Failed to fetch asset ${asset.source}: HTTP ${res.status}`);
        return undefined;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(destPath, buffer);
    } else {
      console.warn(`Unsupported asset source: ${asset.source}`);
      return undefined;
    }

    return toRelativeAssetPath(outputPath, destPath);
  };
}

program
  .name('csgrank-outrank.ts')
  .argument('<url>', 'Outrank page URL or rank.json URL')
  .option('-o, --output <file>', 'output file path', 'out.srk.json')
  .action(async (url: string, options: { output: string }) => {
    try {
      const outputPath = path.resolve(options.output);
      const srkObject = await run(url, {
        assetHandler: createAssetHandler(outputPath),
      });
      await fs.writeFile(outputPath, JSON.stringify(srkObject, null, 2), 'utf-8');
      console.log(`Output written to ${outputPath}`);
    } catch (e) {
      console.error(e);
      process.exit(1);
    }
  });

program.parse();
