#!/usr/bin/env -S npx tsx

import path from 'path';
import fs from 'fs-extra';
import { program } from 'commander';
import { run } from '../adapters/pta_excel';

program
  .name('pta_excel.ts')
  .argument('<excel-file>', 'PTA 成绩导出 Excel 文件路径')
  .option('-o, --output <file>', '输出文件路径', 'out.srk.json')
  .action(async (excelFile: string, options: { output: string }) => {
    try {
      const excelPath = path.resolve(excelFile);
      const srkObject = await run(excelPath);
      const outputPath = path.resolve(options.output);
      await fs.writeFile(outputPath, JSON.stringify(srkObject, null, 2), 'utf-8');
    } catch (e) {
      console.error(e);
      process.exit(1);
    }
  });

program.parse();
