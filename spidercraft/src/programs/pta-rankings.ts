#!/usr/bin/env -S npx tsx

// 用于爬取新版 PTA rankings 类型的榜单（https://pintia.cn/rankings/）

import path from 'path';
import fs from 'fs-extra';
import { program } from 'commander';
import { run } from '../adapters/pta-rankings';

program
  .name('pta-rankings.ts')
  .argument('<cid>', 'PTA Rankings 比赛 ID')
  .option('-o, --output <file>', '输出文件路径', 'out.srk.json')
  .action(async (cid: string, options: { output: string }) => {
    try {
      const srkObject = await run(cid);
      const outputPath = path.resolve(options.output);
      await fs.writeFile(outputPath, JSON.stringify(srkObject, null, 2), 'utf-8');
    } catch (e) {
      console.error(e);
      process.exit(1);
    }
  });

program.parse();
