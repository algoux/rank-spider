#!/usr/bin/env -S npx tsx

import path from 'path';
import fs from 'fs-extra';
import { program } from 'commander';
import { run } from '../adapters/hydro-event-feed';

program
  .name('hydro-event-feed.ts')
  .argument('<ndjson-file>', 'Hydro OJ CCS event-feed NDJSON 文件路径')
  .option('-o, --output <file>', '输出文件路径', 'out.srk.json')
  .action(async (ndjsonFile: string, options: { output: string }) => {
    try {
      const ndjsonPath = path.resolve(ndjsonFile);
      const ndjson = await fs.readFile(ndjsonPath, 'utf-8');
      const srkObject = await run(ndjson);
      const outputPath = path.resolve(options.output);
      await fs.writeFile(outputPath, JSON.stringify(srkObject, null, 2), 'utf-8');
    } catch (e) {
      console.error(e);
      process.exit(1);
    }
  });

program.parse();
