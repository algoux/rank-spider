import { setGlobalDispatcher, Agent } from 'undici';
import { CookieJar } from 'tough-cookie';
import fetchCookie from 'fetch-cookie';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import cheerio from 'cheerio';
import type * as srk from '@algoux/standard-ranklist';
import cryptoRandomString from 'crypto-random-string';
import path from 'path';
import fs from 'fs-extra';
import PQueue from 'p-queue';
import pRetry from 'p-retry';
import { SrkGeneratorSolution, UniversalSrkGenerator } from '../generators/universal';

// CF 所使用的 Cloudflare 防护强制要求 H2
// see: https://github.com/nodejs/undici/issues/2750
setGlobalDispatcher(
  new Agent({
    allowH2: true,
  }),
);

// process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';

const jar = new CookieJar();
const fetchWithCookie = fetchCookie(fetch, jar);
let csrfToken: string;

const CF_GYM_CACHE_VERSION = 1;
const DEFAULT_REQUEST_TIMEOUT_MS = 3 * 60 * 1000;
const DEFAULT_RANK_PAGE_DELAY_MS = 2000;
const DEFAULT_SUBMISSION_DELAY_MS = 2500;
const DEFAULT_RETRY_SLEEP_MS = 10 * 60 * 1000;
const DEFAULT_SHORT_RETRY_SLEEP_MS = 10 * 1000;

dayjs.extend(utc);
dayjs.extend(timezone);

function getDateFromStr(dateString: string): dayjs.Dayjs {
  return dayjs(dateString);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runWithTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(controller.signal), timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function readHTMLFromResponse(res: Response) {
  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error('Failed to get reader');
  }
  const decoder = new TextDecoder('utf-8');
  let html = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
  }
  return html;
}

export type CfGymFetchErrorCode = 'cloudflare_challenge' | 'codeforces_ip_ban' | 'http_error';

export class CfGymFetchError extends Error {
  readonly code: CfGymFetchErrorCode;
  readonly status?: number;

  constructor(code: CfGymFetchErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'CfGymFetchError';
    this.code = code;
    this.status = status;
  }
}

export interface CfGymRetryBehavior {
  retry: boolean;
  sleepMs: number;
  reason: 'cloudflare_challenge' | 'codeforces_ip_ban' | 'short_retry';
}

export function resolveCfGymRetryBehavior(
  error: unknown,
  ipBanRetrySleepMs: number,
  shortRetrySleepMs: number,
): CfGymRetryBehavior {
  if (error instanceof CfGymFetchError) {
    if (error.code === 'cloudflare_challenge') {
      return {
        retry: false,
        sleepMs: 0,
        reason: 'cloudflare_challenge',
      };
    }
    if (error.code === 'codeforces_ip_ban') {
      return {
        retry: true,
        sleepMs: ipBanRetrySleepMs,
        reason: 'codeforces_ip_ban',
      };
    }
  }

  return {
    retry: true,
    sleepMs: shortRetrySleepMs,
    reason: 'short_retry',
  };
}

async function checkResponse(res: Response) {
  if (!res.ok) {
    if (res.status === 403) {
      // 检测是 Cloudflare 防护还是被 CF ban
      const html = await readHTMLFromResponse(res);
      if (res.headers.get('cf-mitigated') === 'challenge') {
        throw new CfGymFetchError(
          'cloudflare_challenge',
          'Cloudflare challenge detected. You may need to open https://codeforces.com/ in browser and copy your cookies then pass cookie txt file to --cookie to resolve challenge or change IP.',
          res.status,
        );
      }
      throw new CfGymFetchError(
        'codeforces_ip_ban',
        'Codeforces has banned our IP temporarily, please try again later or change IP.',
        res.status,
      );
    }
    throw new CfGymFetchError('http_error', `Error occurred: HTTP status ${res.status}`, res.status);
  }
}

async function fetchStandingsPageHtml(
  gymId: string,
  page: number,
  requestTimeoutMs: number,
): Promise<string> {
  const url = `https://codeforces.com/gym/${gymId}/standings/page/${page}`;
  console.log(`[${dayjs().format('YYYY-MM-DD HH:mm:ss.SSS')}] Requesting ${url}`);
  return runWithTimeout(
    async (signal) => {
      const res = await fetchWithCookie(url, {
        signal,
        headers: {
          accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'accept-language': 'zh-CN,zh;q=0.5',
          'cache-control': 'max-age=0',
          priority: 'u=0, i',
          referer: `https://codeforces.com/gym/${gymId}/standings`,
          'sec-ch-ua': '"Brave";v="137", "Chromium";v="137", "Not/A)Brand";v="24"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"macOS"',
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-site': 'none',
          'sec-fetch-user': '?1',
          'sec-gpc': '1',
          'upgrade-insecure-requests': '1',
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
        },
      });
      await checkResponse(res);

      // const html = await res.text();
      // CF html 响应没有包含 Content-Length 头... 导致 res.text() 无法 resolve
      return readHTMLFromResponse(res);
    },
    requestTimeoutMs,
    `Requesting ${url}`,
  );
}

function initializeCsrfTokenFromStandingsHtml(html: string) {
  const $ = cheerio.load(html);
  const parsedCsrfToken = $('meta[name="X-Csrf-Token"]').attr('content');
  if (!parsedCsrfToken) {
    throw new Error('CSRF token not found');
  }
  csrfToken = parsedCsrfToken;
}

export interface CfGymSubmission {
  type: 'SUBMIT';
  problem: string;
  contestTime: string; // like "00:18:08"
  verdict: string; // like "\u003cspan class\u003d\u0027verdict-accepted\u0027\u003eAccepted\u003c/span\u003e" or "\u003cspan class\u003d\u0027verdict-rejected\u0027\u003eRejected\u003c/span\u003e"
  party: string;
  offerChallenge: string; // 'false' or 'true'
  submissionId: number;
}

export interface CfGymCache {
  version: number;
  gymId: string;
  updatedAt: string;
  contestTitle?: string;
  problems?: srk.Problem[];
  rows?: srk.RanklistRow[];
  submissions: Record<string, CfGymSubmission[]>;
}

export interface CfGymRunOptions {
  cachePath?: string;
  refreshRank?: boolean;
  requestTimeoutMs?: number;
  submissionTimeoutMs?: number;
  rankPageDelayMs?: number;
  submissionDelayMs?: number;
  retrySleepMs?: number;
  shortRetrySleepMs?: number;
}

export function createCfGymCache(gymId: string): CfGymCache {
  return {
    version: CF_GYM_CACHE_VERSION,
    gymId,
    updatedAt: new Date().toISOString(),
    submissions: {},
  };
}

function normalizeCfGymCache(value: unknown, gymId: string): CfGymCache | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const cache = value as Partial<CfGymCache>;
  if (cache.version !== CF_GYM_CACHE_VERSION || cache.gymId !== gymId) {
    return null;
  }
  return {
    version: CF_GYM_CACHE_VERSION,
    gymId,
    updatedAt: typeof cache.updatedAt === 'string' ? cache.updatedAt : new Date().toISOString(),
    contestTitle: typeof cache.contestTitle === 'string' ? cache.contestTitle : undefined,
    problems: Array.isArray(cache.problems) ? cache.problems : undefined,
    rows: Array.isArray(cache.rows) ? cache.rows : undefined,
    submissions:
      cache.submissions && typeof cache.submissions === 'object' ? cache.submissions : {},
  };
}

export async function readCfGymCache(cachePath: string, gymId: string): Promise<CfGymCache> {
  try {
    const loaded = normalizeCfGymCache(await fs.readJson(cachePath), gymId);
    if (loaded) {
      return loaded;
    }
    console.warn(`Ignoring incompatible cf-gym cache: ${cachePath}`);
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      console.warn(`Ignoring unreadable cf-gym cache: ${cachePath}: ${error.message}`);
    }
  }
  return createCfGymCache(gymId);
}

export async function writeCfGymCache(cachePath: string, cache: CfGymCache) {
  cache.updatedAt = new Date().toISOString();
  await fs.ensureDir(path.dirname(cachePath));
  const tempPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeJson(tempPath, cache, { spaces: 2 });
  await fs.move(tempPath, cachePath, { overwrite: true });
}

export function rememberCfGymSubmissions(
  cache: CfGymCache,
  participantId: string,
  submissions: CfGymSubmission[],
) {
  cache.submissions[participantId] = submissions;
  cache.updatedAt = new Date().toISOString();
}

export function getCfGymCachedSubmissions(
  cache: CfGymCache,
  participantId: string,
): CfGymSubmission[] | undefined {
  return cache.submissions[participantId];
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function writeCfGymCacheIfEnabled(cachePath: string | undefined, cache: CfGymCache) {
  if (!cachePath) {
    return;
  }
  await writeCfGymCache(cachePath, cache);
}

function convertCFSolutionVerdict(verdict: string): srk.SolutionResultFull {
  const v = verdict
    .replace(/on test \d+/, '')
    .trim()
    .toLowerCase();
  switch (v) {
    case 'skipped':
      return null;
    case 'pending judgement':
    case 'running':
      return '?';
    case 'accepted':
      return 'AC';
    case 'rejected':
    case 'hacked':
      return 'RJ';
    case 'wrong answer':
      return 'WA';
    case 'presentation error':
      return 'PE';
    case 'time limit exceeded':
      return 'TLE';
    case 'memory limit exceeded':
      return 'MLE';
    case 'idleness limit exceeded':
      return 'IDLE';
    case 'runtime error':
      return 'RTE';
    case 'compilation error':
      return 'CE';
    case 'judgement failed':
      return 'UKE';
    default:
      console.warn(`Unknown solution result: ${verdict}`);
      return 'UKE';
  }
}

async function fetchUserSubmissions(
  gymId: string,
  participantId: string,
  signal?: AbortSignal,
): Promise<CfGymSubmission[]> {
  const url = `https://codeforces.com/data/standings?rv=${cryptoRandomString({
    length: 9,
  })}`;

  const formData = new URLSearchParams();
  formData.append('participantId', participantId);
  formData.append('csrf_token', csrfToken);

  const res = await fetchWithCookie(url, {
    method: 'POST',
    body: formData,
    signal,
    headers: {
      accept: 'application/json, text/javascript, */*; q=0.01',
      'accept-language': 'zh-CN,zh;q=0.9',
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      priority: 'u=1, i',
      'sec-ch-ua': '"Brave";v="137", "Chromium";v="137", "Not/A)Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'sec-gpc': '1',
      origin: 'https://codeforces.com',
      referer: `https://codeforces.com/gym/${gymId}/standings`,
      'x-csrf-token': csrfToken,
      'x-requested-with': 'XMLHttpRequest',
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    },
  });
  await checkResponse(res);

  const body = await res.json();
  if (!body || !Array.isArray(body)) {
    throw new Error(
      `Error occurred when fetching submissions of ${participantId}: invalid response`,
      {
        cause: body,
      },
    );
  }

  return body;
}

async function fetchRankData(
  gymId: string,
  userParser?: (crawledUserName: string, participantId: string) => srk.User | null,
  options: CfGymRunOptions = {},
) {
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const submissionTimeoutMs = options.submissionTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const rankPageDelayMs = options.rankPageDelayMs ?? DEFAULT_RANK_PAGE_DELAY_MS;
  const submissionDelayMs = options.submissionDelayMs ?? DEFAULT_SUBMISSION_DELAY_MS;
  const retrySleepMs = options.retrySleepMs ?? DEFAULT_RETRY_SLEEP_MS;
  const shortRetrySleepMs = options.shortRetrySleepMs ?? DEFAULT_SHORT_RETRY_SLEEP_MS;
  const cache = options.cachePath
    ? await readCfGymCache(options.cachePath, gymId)
    : createCfGymCache(gymId);

  let page = 1;
  let hasInit = false;
  let hasMore = true;
  let contestTitle: string = '';
  let problems: srk.Problem[] | undefined;
  let rows: srk.RanklistRow[] = [];
  let loadedRankFromCache = false;

  if (
    !options.refreshRank &&
    cache.contestTitle &&
    Array.isArray(cache.problems) &&
    Array.isArray(cache.rows)
  ) {
    contestTitle = cache.contestTitle;
    problems = cloneJson(cache.problems);
    rows = cloneJson(cache.rows);
    loadedRankFromCache = true;
    console.log(
      `[${dayjs().format('YYYY-MM-DD HH:mm:ss.SSS')}] Loaded rank data from cf-gym cache`,
    );
  }

  while (!loadedRankFromCache && hasMore) {
    const html = await fetchStandingsPageHtml(gymId, page, requestTimeoutMs);
    const $ = cheerio.load(html);
    if (!hasInit) {
      initializeCsrfTokenFromStandingsHtml(html);
      contestTitle = $('.contest-name').text().trim();
      hasInit = true;
    }

    const curPageRows = $('.standings tr')
      .map((i, el) => {
        if (i === 0) {
          if (!problems) {
            problems = $(el)
              .find('th')
              .slice(4)
              .map((_, el) => {
                let link = $(el).find('a').attr('href');
                if (link) {
                  link = `https://codeforces.com${link}`;
                }
                return {
                  alias: $(el).text().trim(),
                  link,
                };
              })
              .get();
          }
          return;
        }
        const participantId = $(el).attr('participantid');
        if (!participantId) {
          return;
        }
        const tds = $(el).find('td');
        // 只抓取 ghost
        const labelImgTitle = tds.eq(1).find('img')?.attr('title');
        if (!labelImgTitle || !labelImgTitle.includes('Ghost')) {
          return;
        }
        const name = tds.eq(1).find('span').text();
        const user: srk.User | null = userParser
          ? userParser(name, participantId)
          : {
              id: participantId,
              name,
              organization: '',
              official: true,
            };
        if (!user) {
          return null;
        }

        const score = parseInt(tds.eq(2).text().trim(), 10);
        const totalTime = parseInt(tds.eq(3).text().trim(), 10);
        const statuses = tds
          .slice(4)
          .map((pIndex, sEl) => {
            if (!$(sEl).text().trim()) {
              return {
                result: null,
              };
            }

            const acTries = $(sEl).find('.cell-accepted');
            if (acTries.length > 0) {
              const acTriesText = acTries.text().trim().replace(/^\+/, '');
              const tries = acTriesText ? parseInt(acTriesText, 10) + 1 : 1;
              const time = $(sEl).find('.cell-time').text().trim(); // like "04:05" (hh:mm)
              const timeMin =
                parseInt(time.split(':')[0], 10) * 60 + parseInt(time.split(':')[1], 10);
              return {
                result: 'AC',
                time: [timeMin, 'min'],
                tries,
                solutions: [],
              };
            }

            const rjTries = $(sEl).find('.cell-rejected');
            if (rjTries.length > 0) {
              const rjTriesText = rjTries.text().trim().replace(/^-/, '');
              const tries = rjTriesText ? parseInt(rjTriesText, 10) : 1;
              return {
                result: 'RJ',
                tries,
                solutions: [],
              };
            }
            throw new Error(
              `Unknown status: ${$(sEl)
                .text()
                .trim()}, participantId=${participantId}, problemIndex=${pIndex}`,
            );
          })
          .get();
        return {
          user,
          score: {
            value: score,
            time: [totalTime, 'min'],
          },
          statuses,
        };
      })
      .get()
      .filter(Boolean);

    rows.push(...curPageRows);

    hasMore = $('.custom-links-pagination .active').parent().next().length > 0;
    hasMore && page++;
    await sleep(rankPageDelayMs);
  }

  if (!problems) {
    throw new Error('No problems detected');
  }

  cache.contestTitle = contestTitle;
  cache.problems = cloneJson(problems);
  cache.rows = cloneJson(rows);
  await writeCfGymCacheIfEnabled(options.cachePath, cache);

  if (
    loadedRankFromCache &&
    rows.some((row) => !getCfGymCachedSubmissions(cache, row.user.id))
  ) {
    console.log(
      `[${dayjs().format(
        'YYYY-MM-DD HH:mm:ss.SSS',
      )}] Initializing Codeforces session before fetching uncached submissions`,
    );
    const html = await fetchStandingsPageHtml(gymId, 1, requestTimeoutMs);
    initializeCsrfTokenFromStandingsHtml(html);
  }

  // 获取 submissions
  const concurrency = 1;
  const queue = new PQueue({ concurrency });
  const submissionsMap = new Map<string, CfGymSubmission[]>();
  await queue.addAll(
    rows.map(
      (row, index) => () =>
        pRetry(
          async () => {
            const user = row.user;
            const cachedSubmissions = getCfGymCachedSubmissions(cache, user.id);
            if (cachedSubmissions) {
              console.log(
                `[${dayjs().format('YYYY-MM-DD HH:mm:ss.SSS')}] Using cached submissions of team ${
                  user.id
                } (${index + 1}/${rows.length})`,
              );
              submissionsMap.set(user.id, cachedSubmissions);
              return cachedSubmissions;
            }

            console.log(
              `[${dayjs().format('YYYY-MM-DD HH:mm:ss.SSS')}] Fetching submissions of team ${
                user.id
              } (${index + 1}/${rows.length})`,
            );
            const submissions = await runWithTimeout(
              (signal) => fetchUserSubmissions(gymId, user.id, signal),
              submissionTimeoutMs,
              `Fetching submissions of team ${user.id}`,
            );
            rememberCfGymSubmissions(cache, user.id, submissions);
            submissionsMap.set(user.id, submissions);
            await writeCfGymCacheIfEnabled(options.cachePath, cache);
            await sleep(submissionDelayMs);
            return submissions;
          },
          {
            retries: 2,
            factor: 2,
            minTimeout: 1000,
            maxTimeout: 3 * 60 * 1000,
            async onFailedAttempt(error: any) {
              const retryBehavior = resolveCfGymRetryBehavior(
                error,
                retrySleepMs,
                shortRetrySleepMs,
              );
              if (!retryBehavior.retry) {
                console.error(
                  `[${dayjs().format(
                    'YYYY-MM-DD HH:mm:ss.SSS',
                  )}] Failed to fetch team submissions for ${row.user.id}: ${error.message}. This error is not retryable in-process.`,
                );
                throw error;
              }

              const retriesLeft = typeof error.retriesLeft === 'number' ? error.retriesLeft : 0;
              if (retriesLeft <= 0) {
                console.error(
                  `[${dayjs().format(
                    'YYYY-MM-DD HH:mm:ss.SSS',
                  )}] Failed to fetch team submissions for ${row.user.id}: ${error.message}. No retries left.`,
                );
                return;
              }

              console.error(
                `[${dayjs().format(
                  'YYYY-MM-DD HH:mm:ss.SSS',
                )}] Failed to fetch team submissions for ${row.user.id}: ${error.message}. Waiting ${retryBehavior.sleepMs}ms before retry (${retryBehavior.reason}).`,
              );
              await sleep(retryBehavior.sleepMs);
            },
          },
        ),
    ),
  );
  for (const row of rows) {
    const user = row.user;
    const submissions = submissionsMap.get(user.id);
    if (!submissions) {
      console.warn(`No submissions found for user ${user.id}`);
      continue;
    }
    for (const submission of submissions) {
      if (submission.type !== 'SUBMIT') {
        continue;
      }
      const p$ = cheerio.load(submission.problem);
      const problemAlias = p$('a').text().trim();
      const problemIndex = problems.findIndex((p) => p.alias === problemAlias);
      if (problemIndex === -1) {
        console.warn(`No problem found for submission ${p$('a').text().trim()}`);
        continue;
      }
      const status = row.statuses[problemIndex];
      if (!status) {
        console.warn(`No status initialized: ${user.id} ${problemIndex}`);
        continue;
      }
      let verdict = submission.verdict;
      if (verdict.startsWith('<')) {
        const v$ = cheerio.load(verdict);
        verdict = v$('span').text().trim();
      }
      const result = convertCFSolutionVerdict(verdict);
      if (result === 'UKE') {
        console.warn(`UKE found for ${user.id} ${problemIndex}: ${verdict}`, submission);
      }
      if (result === null) {
        continue;
      }
      if (!status.solutions) {
        status.solutions = [];
      }
      const contestTime = submission.contestTime.split(':').map(Number);
      const contestTimeSec = contestTime[0] * 3600 + contestTime[1] * 60 + contestTime[2];
      status.solutions.push({
        result,
        time: [contestTimeSec, 's'],
      });
    }
  }

  return {
    contestTitle,
    problems,
    rows,
    submissionsMap,
  };
}

export async function run(
  gymId: string,
  userParser?: (crawledUserName: string, participantId: string) => srk.User | null,
  cookie?: string,
  options: CfGymRunOptions = {},
) {
  // 如果提供了 cookie 参数，则初始化 jar 设置这些 cookie
  if (cookie) {
    const cookiePairs = cookie.split(';').map((pair) => pair.trim());
    console.log(`Using ${cookiePairs.length} cookies`);
    for (const pair of cookiePairs) {
      await jar.setCookie(pair, 'https://codeforces.com');
    }
  }

  const { contestTitle, problems, rows } = await fetchRankData(gymId, userParser, options);

  const generator = new UniversalSrkGenerator();
  generator.init({
    contest: {
      title: {
        fallback: contestTitle,
      },
      startAt: '2000-01-01T00:00:00+08:00',
      duration: [5, 'h'],
      frozenDuration: [1, 'h'],
      refLinks: [
        {
          title: {
            'zh-CN': '赛题重现',
            fallback: 'Reproduced Contest',
          },
          link: `https://codeforces.com/gym/${gymId}`,
        },
      ],
    },
    problems,
    contributors: ['algoUX (https://algoux.org)'],
    useICPCPreset: true,
    icpcPresetOptions: {
      sorterNoPenaltyResults: ['FB', 'AC', '?', 'NOUT','CE', 'UKE', null],
      mainRankSeriesRule: {
        count: {
          value: [0, 0, 0],
        },
      },
      sorterTimePrecision: 'min',
      sorterRankingTimePrecision: 'min',
    },
    remarks: {
      'zh-CN': '这个榜单缺失奖牌数据，如果您有该比赛的原始榜单或获奖名单，欢迎联系我们补充数据。',
      fallback:
        'This ranklist lacks medal data. If you have the original ranklist or the list of winners, please contact us to supplement the data.',
    },
  });
  generator.setRows(rows);

  generator.build({
    calculateFB: true,
    disableFBIfConflict: true,
  });
  const srkObject = generator.getSrk();
  delete srkObject.markers;
  return srkObject;
}
