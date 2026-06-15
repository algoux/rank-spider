#!/usr/bin/env -S npx tsx

import { program } from 'commander';
import { generateRank, inferPythonStyleOutputPath } from '../adapters/xcpcio';

program
  .name('xcpcio.ts')
  .argument(
    '<contest-url-or-path>',
    'XCPCIO 榜单 URL 或路径，例如 https://board.xcpcio.com/ccpc/12th/guizhou-invitational',
  )
  .option('-o, --output <file>', '输出文件路径；省略时按 Python 脚本规则自动生成')
  .option('--no-download-banner', '不下载 banner 资源到 images/')
  .action(
    async (
      contestUrlOrPath: string,
      options: {
        output?: string;
        downloadBanner: boolean;
      },
    ) => {
      const outputPath = options.output ?? inferPythonStyleOutputPath(contestUrlOrPath);
      const result = await generateRank(contestUrlOrPath, outputPath, {
        downloadBanner: options.downloadBanner,
      });

      for (const warning of result.warnings) {
        console.warn(warning);
      }
      if (Object.keys(result.unknown_statuses).length > 0) {
        console.warn(`unknown_statuses: ${JSON.stringify(result.unknown_statuses)}`);
      }

      if (!result.ok) {
        console.error(result.error);
        process.exit(1);
      }

      console.log(`Output written to ${result.output_path}`);
    },
  );

program.parse();
