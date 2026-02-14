import { setGlobalDispatcher, Agent } from 'undici';
import { CookieJar } from 'tough-cookie';
import fetchCookie from 'fetch-cookie';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import cheerio from 'cheerio';
import type * as srk from '@algoux/standard-ranklist';
import cryptoRandomString from 'crypto-random-string';
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

dayjs.extend(utc);
dayjs.extend(timezone);

function getDateFromStr(dateString: string): dayjs.Dayjs {
  return dayjs(dateString);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function checkResponse(res: Response) {
  if (!res.ok) {
    if (res.status === 403) {
      // 检测是 Cloudflare 防护还是被 CF ban
      const html = await readHTMLFromResponse(res);
      if (res.headers.get('cf-mitigated') === 'challenge') {
        throw new Error(
          'Cloudflare challenge detected. You may need to open https://codeforces.com/ in browser and copy your cookies then pass cookie txt file to --cookie to resolve challenge or change IP.',
        );
      }
      throw new Error(
        'Codeforces has banned our IP temporarily, please try again later or change IP.',
      );
    }
    throw new Error(`Error occurred: HTTP status ${res.status}`);
  }
}

interface CfGymSubmission {
  type: 'SUBMIT';
  problem: string;
  contestTime: string; // like "00:18:08"
  verdict: string; // like "\u003cspan class\u003d\u0027verdict-accepted\u0027\u003eAccepted\u003c/span\u003e" or "\u003cspan class\u003d\u0027verdict-rejected\u0027\u003eRejected\u003c/span\u003e"
  party: string;
  offerChallenge: string; // 'false' or 'true'
  submissionId: number;
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
) {
  let page = 1;
  let hasInit = false;
  let hasMore = true;
  let contestTitle: string = '';
  let problems: srk.Problem[] | undefined;
  let rows: srk.RanklistRow[] = [];

  while (hasMore) {
    const url = `https://codeforces.com/gym/${gymId}/standings/page/${page}`;
    console.log(`[${dayjs().format('YYYY-MM-DD HH:mm:ss.SSS')}] Requesting ${url}`);
    const res = await fetchWithCookie(url, {
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
    const html = await readHTMLFromResponse(res);
    const $ = cheerio.load(html);
    if (!hasInit) {
      const parsedCsrfToken = $('meta[name="X-Csrf-Token"]').attr('content');
      if (!parsedCsrfToken) {
        throw new Error('CSRF token not found');
      }
      csrfToken = parsedCsrfToken;
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
    await sleep(2000);
  }

  if (!problems) {
    throw new Error('No problems detected');
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
            console.log(
              `[${dayjs().format('YYYY-MM-DD HH:mm:ss.SSS')}] Fetching submissions of team ${
                user.id
              } (${index + 1}/${rows.length})`,
            );
            const submissions = await fetchUserSubmissions(gymId, user.id);
            await sleep(2500);
            submissionsMap.set(user.id, submissions);
            return submissions;
          },
          {
            retries: 2,
            factor: 2,
            minTimeout: 1000,
            maxTimeout: 5 * 60 * 1000,
            async onFailedAttempt(error: any) {
              console.error(
                `[${dayjs().format(
                  'YYYY-MM-DD HH:mm:ss.SSS',
                )}] Failed to fetch team submissions for ${row.user.id}: ${error.message}`,
              );
              await sleep(10 * 60 * 1000);
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
) {
  // 如果提供了 cookie 参数，则初始化 jar 设置这些 cookie
  if (cookie) {
    const cookiePairs = cookie.split(';').map((pair) => pair.trim());
    console.log(`Using ${cookiePairs.length} cookies`);
    for (const pair of cookiePairs) {
      await jar.setCookie(pair, 'https://codeforces.com');
    }
  }

  const { contestTitle, problems, rows } = await fetchRankData(gymId, userParser);

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
      sorterNoPenaltyResults: ['FB', 'AC', '?', 'CE', 'NOUT', 'UKE', null],
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
