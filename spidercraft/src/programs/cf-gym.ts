#!/usr/bin/env -S npx tsx

import path from 'path';
import fs from 'fs-extra';
import { program } from 'commander';
import { run } from '../adapters/cf-gym';

program
  .name('cf-gym.ts')
  .argument('<cid>', 'Codeforces Gym 比赛 ID')
  .option('-o, --output <file>', '输出文件路径', 'out.srk.json')
  .option('-c, --cookie <file>', 'Cookie 文件路径')
  .action(async (cid: string, options: { output: string; cookie?: string }) => {
    try {
      let cookieContent: string | undefined;
      if (options.cookie) {
        const cookiePath = path.resolve(options.cookie);
        try {
          cookieContent = await fs.readFile(cookiePath, 'utf-8');
        } catch (e) {
          console.error(`读取 cookie 文件失败: ${cookiePath}`, e);
          process.exit(1);
        }
      }

      const srkObject = await run(cid, undefined, cookieContent);
      const outputPath = path.resolve(options.output);
      await fs.writeFile(outputPath, JSON.stringify(srkObject, null, 2), 'utf-8');
    } catch (e) {
      console.error(e);
      process.exit(1);
    }
  });

program.parse();
