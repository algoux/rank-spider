#!/usr/bin/env -S npx tsx

import path from 'path';
import fs from 'fs-extra';
import { program } from 'commander';
import { run } from '../adapters/nowcoder';

program
  .name('nowcoder.ts')
  .argument('<cid>', 'Nowcoder 比赛 ID')
  .option('-o, --output <file>', '输出文件路径', 'out.srk.json')
  .option('-c, --cookie <file>', 'Cookie 文件路径（仅单选手提交超出接口数量限制时）')
  .option('--concurrency <n>', '提交抓取并发数（按用户级 status-list 调用）', '2')
  .action(
    async (
      cid: string,
      options: { output: string; cookie?: string; concurrency: string },
    ) => {
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

        const concurrency = parseInt(options.concurrency, 10);
        if (!Number.isFinite(concurrency) || concurrency < 1) {
          console.error(`无效的 concurrency 参数: ${options.concurrency}`);
          process.exit(1);
        }

        const srkObject = await run(cid, {
          cookie: cookieContent,
          concurrency,
        });
        const outputPath = path.resolve(options.output);
        await fs.writeFile(outputPath, JSON.stringify(srkObject, null, 2), 'utf-8');
        console.log(`Output written to ${outputPath}`);
      } catch (e) {
        console.error(e);
        process.exit(1);
      }
    },
  );

program.parse();
