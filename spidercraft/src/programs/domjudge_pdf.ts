#!/usr/bin/env -S npx tsx

import path from 'path';
import fs from 'fs-extra';
import { program } from 'commander';
import { run } from '../adapters/domjudge_pdf';

program
  .name('domjudge_pdf.ts')
  .argument('<pdf-file>', 'DomJudge 榜单 PDF 文件路径')
  .option('-p, --prob-num <n>', '题目数量', (v) => parseInt(v, 10))
  .option('-o, --output [file]', '输出文件路径', 'out.srk.json')
  .option('--debug', '启用调试', false)
  .option(
    '--debug-dir <dir>',
    '调试输出目录（默认: 当前工作区/debug）',
    path.join(process.cwd(), 'debug'),
  )
  .action(
    async (
      pdfFile: string,
      options: { probNum: number; output: string; debug: boolean; debugDir: string },
    ) => {
      if (options.probNum == null || !Number.isInteger(options.probNum) || options.probNum < 1) {
        console.error('请通过 -p n 指定题目数量，例如 -p 13');
        process.exit(1);
      }

      try {
        const pdfPath = path.resolve(pdfFile);
        const srkObject = await run(pdfPath, {
          probNum: options.probNum,
          debug: options.debug,
          debugDir: path.resolve(options.debugDir),
        });
        const outputPath = path.resolve(options.output);
        await fs.writeFile(outputPath, JSON.stringify(srkObject, null, 2), 'utf-8');
      } catch (e) {
        console.error(e);
        process.exit(1);
      }
    },
  );

program.parse();
