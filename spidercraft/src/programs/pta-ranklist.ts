#!/usr/bin/env -S npx tsx

import path from 'path';
import fs from 'fs-extra';
import { program } from 'commander';
import { run } from '../adapters/pta-ranklist';

program
  .name('pta-ranklist.ts')
  .argument('<url>', 'PTA 传统榜单 URL')
  .option('-o, --output <file>', '输出文件路径', 'out.srk.json')
  .action(async (url: string, options: { output: string }) => {
    try {
      const srkObject = await run(url);
      const outputPath = path.resolve(options.output);
      await fs.writeFile(outputPath, JSON.stringify(srkObject, null, 2), 'utf-8');
    } catch (e) {
      console.error(e);
      process.exit(1);
    }
  });

program.parse();
