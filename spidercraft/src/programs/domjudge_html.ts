#!/usr/bin/env -S npx tsx

import path from 'path';
import fs from 'fs-extra';
import { program } from 'commander';
import { run } from '../adapters/domjudge_html';

program
  .name('domjudge_html.ts')
  .argument('<html-file>', 'DOMjudge HTML 文件路径')
  .option('-o, --output <file>', '输出文件路径', 'out.srk.json')
  .action(async (htmlFile: string, options: { output: string }) => {
    try {
      const htmlPath = path.resolve(htmlFile);
      const html = await fs.readFile(htmlPath, 'utf-8');
      const srkObject = await run(html);
      const outputPath = path.resolve(options.output);
      await fs.writeFile(outputPath, JSON.stringify(srkObject, null, 2), 'utf-8');
    } catch (e) {
      console.error(e);
      process.exit(1);
    }
  });

program.parse();
