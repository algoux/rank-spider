#!/usr/bin/env -S npx tsx

import path from 'path';
import fs from 'fs-extra';
import { program } from 'commander';
import { run } from '../adapters/cf-gym';

function parsePositiveInteger(value: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, got: ${value}`);
  }
  return parsed;
}

program
  .name('cf-gym.ts')
  .argument('<cid>', 'Codeforces Gym 比赛 ID')
  .option('-o, --output <file>', '输出文件路径', 'out.srk.json')
  .option('-c, --cookie <file>', 'Cookie 文件路径（可解决部分 403 问题）')
  .option('--cache <file>', '临时缓存文件路径（默认：<output>.cf-gym-cache.json）')
  .option('--no-cache', '禁用临时缓存')
  .option('--refresh-rank', '忽略缓存中的榜页数据，重新抓取队伍与题目信息')
  .option('--request-timeout-ms <ms>', '单个榜页请求超时时间', parsePositiveInteger)
  .option('--submission-timeout-ms <ms>', '单个队伍 submissions 请求超时时间', parsePositiveInteger)
  .action(
    async (
      cid: string,
      options: {
        output: string;
        cookie?: string;
        cache?: string | boolean;
        refreshRank?: boolean;
        requestTimeoutMs?: number;
        submissionTimeoutMs?: number;
      },
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

        const outputPath = path.resolve(options.output);
        const cachePath =
          options.cache === false
            ? undefined
            : typeof options.cache === 'string'
              ? path.resolve(options.cache)
              : `${outputPath}.cf-gym-cache.json`;
        if (cachePath) {
          console.log(`Using cf-gym temporary cache: ${cachePath}`);
        }

        const srkObject = await run(cid, undefined, cookieContent, {
          cachePath,
          refreshRank: options.refreshRank,
          requestTimeoutMs: options.requestTimeoutMs,
          submissionTimeoutMs: options.submissionTimeoutMs,
        });
        await fs.writeFile(outputPath, JSON.stringify(srkObject, null, 2), 'utf-8');
      } catch (e) {
        console.error(e);
        process.exit(1);
      }
    },
);

program.parse();
