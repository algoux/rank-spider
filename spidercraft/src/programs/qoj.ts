#!/usr/bin/env -S npx tsx

import path from 'path';
import fs from 'fs-extra';
import { Command } from 'commander';
import { DEFAULT_QOJ_BASE_URL, run } from '../adapters/qoj';

export function readCookieFirstLine(content: string): string {
  return content.split(/\r?\n/)[0] ?? '';
}

async function readCookieFile(file: string): Promise<string> {
  const cookiePath = path.resolve(file);
  try {
    return readCookieFirstLine(await fs.readFile(cookiePath, 'utf-8'));
  } catch (e) {
    throw new Error(`读取 cookie 文件失败: ${cookiePath}`, { cause: e });
  }
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = new Command();

  program
    .name('qoj.ts')
    .argument('<cid>', 'QOJ 比赛 ID')
    .option('-o, --output <file>', '输出文件路径', 'out.srk.json')
    .option('-b, --base-url <url>', 'QOJ base URL', DEFAULT_QOJ_BASE_URL)
    .option('--include-unofficial', '包含 unofficial 参赛者', false)
    .option('-c, --cookie <file>', 'Cookie 文本文件路径（只读取第一行）')
    .action(
      async (
        cid: string,
        options: {
          output: string;
          baseUrl: string;
          includeUnofficial: boolean;
          cookie?: string;
        },
      ) => {
        let cookie: string | undefined;
        if (options.cookie) {
          cookie = await readCookieFile(options.cookie);
        }

        const srkObject = await run(cid, {
          baseUrl: options.baseUrl,
          includeUnofficial: options.includeUnofficial,
          cookie,
        });
        const outputPath = path.resolve(options.output);
        await fs.writeFile(outputPath, JSON.stringify(srkObject, null, 2), 'utf-8');
        console.log(`Output written to ${outputPath}`);
      },
    );

  await program.parseAsync(argv);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
