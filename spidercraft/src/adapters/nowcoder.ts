import { CookieJar } from 'tough-cookie';
import fetchCookie from 'fetch-cookie';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import cheerio from 'cheerio';
import type * as srk from '@algoux/standard-ranklist';
import pRetry, { AbortError } from 'p-retry';
import PQueue from 'p-queue';
import { UniversalSrkGenerator } from '../generators/universal';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

const SOURCE_TZ = 'Asia/Shanghai';
const BASE_URL = 'https://ac.nowcoder.com';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

// HTML 提交详情页需要 cookie；JSON 接口不需要。这里仅对 HTML 抓取走带 cookie 的 fetch。
const jar = new CookieJar();
const fetchWithCookie = fetchCookie(fetch, jar);

function nowStr(): string {
  return dayjs().format('YYYY-MM-DD HH:mm:ss.SSS');
}

function fmtMs(ms: number): string {
  return dayjs(ms).tz(SOURCE_TZ).format('YYYY-MM-DD HH:mm:ss');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface NowcoderApiResponse<T> {
  msg: string;
  code: number;
  data: T;
}

export interface NowcoderSameContestEntry {
  contestId: number;
  contestType: number;
  endTime: number; // ms
  name: string;
  startTime: number; // ms
  type: number;
}

interface NowcoderSameContestData {
  sameContests: NowcoderSameContestEntry[];
  defaultChooseIds: number[];
}

export interface NowcoderProblemData {
  acceptedCount: number;
  submitCount: number;
  name: string; // 题目 alias，如 "A"
  problemId: number;
}

export interface NowcoderRankScoreItem {
  accepted: boolean;
  acceptedTime: number; // ms epoch；未 AC 时为 -1
  failedCount: number;
  finishJudge: boolean;
  firstBlood: boolean;
  fullScore: number;
  problemId: number;
  score: number;
  submissionId: number; // 仅 AC 时填写
  submit: boolean;
  timeConsumption: number;
  waitingJudgeCount: number;
}

export interface NowcoderRankRow {
  acceptedCount: number;
  colorLevel: number;
  fullScore: number;
  /** 总时间（含罚时）单位毫秒 */
  penaltyTime: number;
  ranking: number;
  school: string;
  scoreList: NowcoderRankScoreItem[];
  team: boolean;
  totalScore: number;
  uid: number;
  userName: string;
}

export interface NowcoderBasicInfo {
  rankCount: number;
  basicUid: number;
  contestId: number;
  pageCount: number;
  contestEndTime: number; // ms
  contestBeginTime: number; // ms
  rankType: string; // "ICPC" / "OI" / ...
  pageSize: number;
  type: number;
  searchUserName: string;
  pageCurrent: number;
}

interface NowcoderRankPageData {
  problemData: NowcoderProblemData[];
  rankData: NowcoderRankRow[];
  isContestFinished: boolean;
  basicInfo: NowcoderBasicInfo;
}

interface NowcoderStatusListItem {
  memory: number;
  length: number;
  index: string;
  languageCategoryName: string;
  language: string;
  userName: string;
  userId: number;
  colorLevel: number;
  languageName: string;
  isTeam: boolean;
  statusMessage: string;
  submissionId: number;
  submitTime: number;
  time: number;
  problemId: number;
}

interface NowcoderStatusListBasicInfo {
  basicUid: number;
  contestId: number;
  pageCount: number;
  pageSize: number;
  /** 总提交数（按当前查询条件） */
  statusCount: number;
  searchUserName: string;
  pageCurrent: number;
}

interface NowcoderStatusListData {
  data: NowcoderStatusListItem[];
  isContestFinished?: boolean;
  basicInfo: NowcoderStatusListBasicInfo;
}

async function fetchJsonAPI<T>(
  url: string,
  label: string,
  opts: { allowAbortOnCode1?: boolean } = {},
): Promise<T> {
  return pRetry(
    async () => {
      console.log(`[API] ${label} → GET ${url}`);
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          accept: 'application/json, text/plain, */*',
        },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${label}`);
      }
      const text = await res.text();
      let body: NowcoderApiResponse<T>;
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error(`Invalid JSON for ${label}: ${text.slice(0, 200)}`);
      }
      if (body.code !== 0) {
        const msg = `API error code=${body.code} msg=${body.msg} for ${label}`;
        if (opts.allowAbortOnCode1 && body.code === 1) {
          throw new AbortError(msg);
        }
        throw new Error(msg);
      }
      return body.data;
    },
    {
      retries: 5,
      factor: 2,
      minTimeout: 2000,
      maxTimeout: 30000,
      async onFailedAttempt(err: any) {
        console.error(
          `[API] ${label} attempt ${err.attemptNumber} failed: ${err.message}`,
        );
        await sleep(1000);
      },
    },
  );
}

async function fetchSameContestInfo(cid: string): Promise<NowcoderSameContestEntry> {
  const url = `${BASE_URL}/acm/contest/rank/same-contest-list?token=&contestId=${cid}&_=${Date.now()}`;
  const data = await fetchJsonAPI<NowcoderSameContestData>(
    url,
    `same-contest-list cid=${cid}`,
    { allowAbortOnCode1: true },
  );
  const cidNum = parseInt(cid, 10);
  const entry = data.sameContests.find((c) => c.contestId === cidNum) || data.sameContests[0];
  if (!entry) {
    throw new Error(`Contest ${cid} not found in same-contest-list`);
  }
  return entry;
}

async function fetchAllRankData(cid: string): Promise<{
  problems: NowcoderProblemData[];
  rows: NowcoderRankRow[];
  basicInfo: NowcoderBasicInfo;
}> {
  const firstUrl = `${BASE_URL}/acm-heavy/acm/contest/real-time-rank-data?token=&id=${cid}&limit=0&_=${Date.now()}`;
  const firstPage = await fetchJsonAPI<NowcoderRankPageData>(
    firstUrl,
    `rank-data cid=${cid} page=1`,
  );
  const problems = firstPage.problemData;
  const allRows: NowcoderRankRow[] = [...firstPage.rankData];
  const totalPages = firstPage.basicInfo.pageCount;
  console.log(
    `Total ranks: ${firstPage.basicInfo.rankCount}, pages: ${totalPages}, pageSize: ${firstPage.basicInfo.pageSize}`,
  );
  for (let page = 2; page <= totalPages; page++) {
    await sleep(200);
    const url = `${BASE_URL}/acm-heavy/acm/contest/real-time-rank-data?token=&id=${cid}&limit=0&page=${page}&_=${Date.now()}`;
    const data = await fetchJsonAPI<NowcoderRankPageData>(
      url,
      `rank-data cid=${cid} page=${page}`,
    );
    allRows.push(...data.rankData);
  }
  console.log(`Fetched ${allRows.length} rank rows`);
  return { problems, rows: allRows, basicInfo: firstPage.basicInfo };
}

// 通过 status-list?searchUserName=... 接口直接拉取每个用户的提交
// 限制：每个用户最多 200 条（pageSize=50, page<=4）。超过的用户仅记录警告并截断
// 时间窗口：submitTime <= contestEndTime 的提交均算作有效提交（nowcoder 行为）
const STATUS_LIST_PAGE_SIZE = 50;
const STATUS_LIST_MAX_PAGES = 4;
const STATUS_LIST_MAX_RECORDS = STATUS_LIST_PAGE_SIZE * STATUS_LIST_MAX_PAGES;

interface UserSubmissionsFetchResult {
  submissions: NowcoderStatusListItem[];
  /** 该用户提交是否被截断（超过 200 上限） */
  truncated: boolean;
  /** 该用户在比赛内的总提交数（来自 basicInfo.statusCount，无法获取时为 -1） */
  totalCount: number;
}

async function fetchUserSubmissionsViaApi(
  cid: string,
  user: { id: string; name: string },
): Promise<UserSubmissionsFetchResult> {
  const userIdNum = parseInt(user.id, 10);
  const all: NowcoderStatusListItem[] = [];
  let truncated = false;
  let totalCount = -1;

  for (let page = 1; page <= STATUS_LIST_MAX_PAGES; page++) {
    const url = `${BASE_URL}/acm-heavy/acm/contest/status-list?token=&id=${cid}&page=${page}&pageSize=${STATUS_LIST_PAGE_SIZE}&orderType=ASC&orderBy=submitTime&searchUserName=${encodeURIComponent(
      user.name,
    )}&_=${Date.now()}`;
    const data = await fetchJsonAPI<NowcoderStatusListData>(
      url,
      `status-list user="${user.name}" page=${page}`,
    );

    if (page === 1) {
      totalCount = data.basicInfo?.statusCount ?? -1;
      const pageCountByApi = data.basicInfo?.pageCount ?? 0;
      if (
        (totalCount > 0 && totalCount > STATUS_LIST_MAX_RECORDS) ||
        pageCountByApi > STATUS_LIST_MAX_PAGES
      ) {
        truncated = true;
      }
    }

    if (!data.data || data.data.length === 0) {
      break;
    }
    // searchUserName 看似精确匹配，仍按 userId 二次过滤兜底
    const items = data.data.filter((s) => s.userId === userIdNum);
    all.push(...items);

    if (data.data.length < STATUS_LIST_PAGE_SIZE) {
      break;
    }
    if (data.basicInfo?.pageCount && page >= data.basicInfo.pageCount) {
      break;
    }
  }

  return { submissions: all, truncated, totalCount };
}

async function fetchAndFillSolutionsViaApi(
  cid: string,
  contestBeginTime: number,
  contestEndTime: number,
  rows: srk.RanklistRow[],
  problems: NowcoderProblemData[],
  concurrency: number,
): Promise<void> {
  const problemIdToIndex = new Map<number, number>();
  problems.forEach((p, i) => problemIdToIndex.set(p.problemId, i));

  let totalSolutions = 0;
  let truncatedUsers = 0;
  let processed = 0;

  console.log(
    `Fetching per-user submissions via status-list API (concurrency=${concurrency}, hard limit=${STATUS_LIST_MAX_RECORDS}/user)`,
  );
  console.log(
    `Time window: submitTime <= ${fmtMs(contestEndTime)} included; > end skipped`,
  );

  const queue = new PQueue({ concurrency });
  await queue.addAll(
    rows.map((row) => async () => {
      // row.user.name 在本 adapter 中始终是从 nowcoder API 拿到的 string
      const userName = typeof row.user.name === 'string' ? row.user.name : String(row.user.name);
      const res = await fetchUserSubmissionsViaApi(cid, {
        id: row.user.id,
        name: userName,
      });
      if (res.truncated) {
        truncatedUsers++;
        console.warn(
          `WARN: user ${row.user.id}/${row.user.name} has totalCount=${res.totalCount} submissions in this contest (>${STATUS_LIST_MAX_RECORDS} limit). Solutions are truncated to first ${STATUS_LIST_MAX_RECORDS}.`,
        );
      }

      let userAdds = 0;
      for (const sub of res.submissions) {
        const pIdx = problemIdToIndex.get(sub.problemId);
        if (pIdx === undefined) {
          console.warn(
            `sid=${sub.submissionId} unknown problemId=${sub.problemId} (user=${row.user.id}/${row.user.name})`,
          );
          continue;
        }

        // 严格大于结束时间：跳过（保险，正常 contest API 不会返回赛后提交）
        if (sub.submitTime > contestEndTime) {
          continue;
        }

        const status = row.statuses[pIdx];
        if (!status.solutions) status.solutions = [];
        const result = convertNowcoderVerdict(sub.statusMessage);
        if (result === null) {
          continue;
        }
        const sec = Math.max(0, Math.floor((sub.submitTime - contestBeginTime) / 1000));
        status.solutions.push({ result, time: [sec, 's'] });
        userAdds++;
      }
      totalSolutions += userAdds;
      processed++;
      if (processed % 25 === 0 || processed === rows.length) {
        console.log(
          `Progress: users=${processed}/${rows.length}, totalSolutions=${totalSolutions}, truncatedUsers=${truncatedUsers}`,
        );
      }
    }),
  );

  // status-list 已按 submitTime ASC 返回，但跨用户拼装后保险按 time 升序排序每个 status
  for (const row of rows) {
    for (const status of row.statuses) {
      if (status.solutions && status.solutions.length > 1) {
        status.solutions.sort((a, b) => {
          const ta = Array.isArray(a.time) ? Number(a.time[0]) : 0;
          const tb = Array.isArray(b.time) ? Number(b.time[0]) : 0;
          return ta - tb;
        });
      }
    }
  }

  console.log(
    `[Stats] users=${rows.length}, totalSolutions=${totalSolutions}, truncatedUsers=${truncatedUsers}`,
  );
}

/**
 * 一致性校验：榜单接口给出的 tries 应当与抓到的 solutions 数量一致。
 */
function verifyTriesConsistency(
  rows: srk.RanklistRow[],
  problemAliases: string[],
): void {
  let mismatchCount = 0;
  for (const row of rows) {
    row.statuses.forEach((status, idx) => {
      const tries = status.tries ?? 0;
      const solCount = status.solutions?.length ?? 0;
      if (tries > solCount) {
        mismatchCount++;
        console.warn(
          `[Mismatch] user ${row.user.id}/${row.user.name} problem ${problemAliases[idx]}: tries=${tries}, solutions.length=${solCount}`,
        );
      }
    });
  }
  if (mismatchCount === 0) {
    console.log(`[Verify] tries <= solutions.length for all (row, problem) pairs.`);
  } else {
    console.warn(
      `[Verify] tries vs solutions.length mismatch on ${mismatchCount} (row, problem) pair(s). See warnings above.`,
    );
  }
}

// Backup：HTML 提交详情页递增枚举（仅当单个选手提交数超过 200 时），需要传入 cookie。
async function fetchFirstSubmissionId(cid: string): Promise<number> {
  const url = `${BASE_URL}/acm-heavy/acm/contest/status-list?token=&id=${cid}&page=1&pageSize=20&orderType=ASC&orderBy=submitTime&searchUserName=&_=${Date.now()}`;
  const data = await fetchJsonAPI<NowcoderStatusListData>(url, `status-list cid=${cid} page=1`);
  if (!data.data || data.data.length === 0) {
    throw new Error(`No submissions found for contest ${cid} via status-list`);
  }
  const minId = data.data.reduce((m, x) => Math.min(m, x.submissionId), data.data[0].submissionId);
  console.log(`First submission id (start of enumeration): ${minId}`);
  return minId;
}

interface ParsedSubmission {
  /** 是否为有效的提交详情页（包含「比赛首页」结构）。错误页（如 服务器错误）时为 false。 */
  ok: boolean;
  contestId?: number;
  userId?: number;
  userName?: string;
  problemAlias?: string;
  /** 提交时间（ms epoch）*/
  submitTime?: number;
  /** 原始运行状态文本，如「答案正确」 */
  verdict?: string;
}

function parseSubmissionHtml(html: string, sid: number): ParsedSubmission {
  const $ = cheerio.load(html);

  const contestHomeAnchors = $('.crumbs-path a').filter((_, el) => {
    return $(el).text().trim() === '比赛首页';
  });
  if (contestHomeAnchors.length === 0) {
    // 已知错误页（如 服务器错误 / 提交不存在）
    if ($('.nk-error').length > 0 || /服务器错误/.test(html)) {
      return { ok: false };
    }
    throw new Error(
      `Unexpected page structure (no 比赛首页 link and no known error) for sid=${sid}`,
    );
  }

  const contestHomeHref = contestHomeAnchors.first().attr('href') || '';
  const contestIdMatch = contestHomeHref.match(/\/acm\/contest\/(\d+)/);
  if (!contestIdMatch) {
    throw new Error(`Cannot parse contestId from "${contestHomeHref}" for sid=${sid}`);
  }
  const parsedContestId = parseInt(contestIdMatch[1], 10);

  const legendBox = $('.coder-cont-legend');
  if (legendBox.length === 0) {
    throw new Error(`No .coder-cont-legend element for sid=${sid}`);
  }
  const legendHtml = legendBox.html() || '';

  const timeText = legendBox
    .find('span')
    .filter((_, el) => /提交时间：/.test($(el).text()))
    .first()
    .text();
  const timeMatch = timeText.match(/提交时间：(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
  if (!timeMatch) {
    throw new Error(`Cannot parse submitTime "${timeText}" for sid=${sid}`);
  }
  const submitTime = dayjs.tz(timeMatch[1], 'YYYY-MM-DD HH:mm:ss', SOURCE_TZ).valueOf();

  const probLinks = $('.crumbs-path a').filter((_, el) => {
    const href = $(el).attr('href') || '';
    return new RegExp(`^/acm/contest/${parsedContestId}/[^/]+$`).test(href);
  });
  if (probLinks.length === 0) {
    throw new Error(`Cannot find problem link for sid=${sid}`);
  }
  const problemAlias = probLinks
    .first()
    .text()
    .trim()
    .split(/\s+/)[0];
  if (!problemAlias) {
    throw new Error(`Cannot parse problemAlias for sid=${sid}`);
  }

  const userLinks = $('.coder-cont-head a').filter((_, el) => {
    const href = $(el).attr('href') || '';
    return /^\/acm\/contest\/profile\/\d+/.test(href);
  });
  if (userLinks.length === 0) {
    throw new Error(`Cannot find user link for sid=${sid}`);
  }
  const userHref = userLinks.first().attr('href') || '';
  const userIdMatch = userHref.match(/\/acm\/contest\/profile\/(\d+)/);
  if (!userIdMatch) {
    throw new Error(`Cannot parse userId for sid=${sid}`);
  }
  const userId = parseInt(userIdMatch[1], 10);
  const userName = userLinks.first().text().trim();

  const verdictMatch = legendHtml.match(/运行状态：\s*<span[^>]*>([^<]+)<\/span>/);
  if (!verdictMatch) {
    throw new Error(`Cannot parse verdict for sid=${sid}`);
  }
  const verdict = verdictMatch[1].trim();

  return {
    ok: true,
    contestId: parsedContestId,
    userId,
    userName,
    problemAlias,
    submitTime,
    verdict,
  };
}

async function fetchSubmissionPage(submissionId: number): Promise<ParsedSubmission> {
  return pRetry(
    async () => {
      const url = `${BASE_URL}/acm/contest/view-submission?submissionId=${submissionId}`;
      const res = await fetchWithCookie(url, {
        headers: {
          'User-Agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'zh-CN,zh;q=0.9',
          referer: `${BASE_URL}/`,
        },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for sid=${submissionId}`);
      }
      const html = await res.text();
      return parseSubmissionHtml(html, submissionId);
    },
    {
      retries: 5,
      factor: 2,
      minTimeout: 2000,
      maxTimeout: 30000,
      async onFailedAttempt(err: any) {
        console.error(
          `[HTML] sid=${submissionId} attempt ${err.attemptNumber} failed: ${err.message}`,
        );
        await sleep(2000);
      },
    },
  );
}

function convertNowcoderVerdict(text: string): srk.SolutionResultFull {
  const t = text.trim();
  switch (t) {
    case '答案正确':
      return 'AC';
    case '答案错误':
      return 'WA';
    case '编译错误':
      return 'CE';
    case '格式错误':
    case '输出格式错误':
      return 'PE';
    case '运行超时':
    case '超时':
    case '超出时间限制':
      return 'TLE';
    case '内存超限':
    case '超出内存限制':
      return 'MLE';
    case '输出超限':
    case '超出输出限制':
      return 'OLE';
    case '段错误':
    case '运行错误':
    case '运行时错误':
    case '浮点错误':
    case '非零返回':
    case '执行出错':
      return 'RTE';
    case '等待评测':
    case '评测中':
    case '正在评测':
    case '排队中':
      return '?';
    case '系统错误':
    case '内部错误':
    case '判题失败':
      return 'UKE';
    default:
      console.warn(`Unknown nowcoder verdict: "${t}"`);
      return 'UKE';
  }
}

function buildRowsFromRankData(
  problems: NowcoderProblemData[],
  rankRows: NowcoderRankRow[],
  contestBeginTime: number,
): srk.RanklistRow[] {
  const problemIdToIndex = new Map<number, number>();
  problems.forEach((p, i) => problemIdToIndex.set(p.problemId, i));

  return rankRows.map((nr) => {
    const statuses: srk.RankProblemStatus[] = problems.map(() => ({ result: null }));
    for (const item of nr.scoreList) {
      const idx = problemIdToIndex.get(item.problemId);
      if (idx === undefined) {
        continue;
      }
      if (!item.submit) {
        statuses[idx] = { result: null };
        continue;
      }
      if (item.accepted) {
        const sec = Math.max(0, Math.floor((item.acceptedTime - contestBeginTime) / 1000));
        statuses[idx] = {
          result: item.firstBlood ? 'FB' : 'AC',
          tries: item.failedCount + 1,
          time: [sec, 's'],
          solutions: [],
        };
      } else if (item.failedCount > 0) {
        statuses[idx] = {
          result: 'RJ',
          tries: item.failedCount,
          solutions: [],
        };
      } else {
        // 极端：submit 但 failedCount=0 且未 AC（可能全是 CE 或全在评测中）
        statuses[idx] = { result: null, solutions: [] };
      }
    }

    const row: srk.RanklistRow = {
      user: {
        id: String(nr.uid),
        name: nr.userName,
        organization: nr.school,
        official: true,
      },
      score: {
        value: nr.acceptedCount,
        time: [Math.round(nr.penaltyTime / 1000), 's'],
      },
      statuses,
    };
    return row;
  });
}

/** Backup: HTML 提交详情页递增枚举的填充实现。当前 run() 不调用，仅保留以便回退。 */
async function fetchAndFillSolutionsViaHtml(
  contestId: number,
  contestBeginTime: number,
  contestEndTime: number,
  startSubmissionId: number,
  rows: srk.RanklistRow[],
  problemAliases: string[],
  concurrency: number,
): Promise<void> {
  const userIdToRow = new Map<string, srk.RanklistRow>();
  rows.forEach((r) => userIdToRow.set(r.user.id, r));
  const aliasToIndex = new Map<string, number>();
  problemAliases.forEach((a, i) => aliasToIndex.set(a, i));

  let nextId = startSubmissionId;
  let stopped = false;
  let stopReason = '';
  let totalScanned = 0;
  let inContestCount = 0;
  let solutionsAdded = 0;
  let firstError: any = null;

  console.log(
    `Start scanning submissions from id=${startSubmissionId} with concurrency=${concurrency}`,
  );
  console.log(`Stop condition: any submission's submitTime > ${fmtMs(contestEndTime)}`);

  const worker = async (workerId: number) => {
    while (!stopped) {
      const id = nextId++;
      let parsed: ParsedSubmission;
      try {
        parsed = await fetchSubmissionPage(id);
      } catch (err: any) {
        if (!firstError) firstError = err;
        stopped = true;
        stopReason = `worker ${workerId} permanent failure on sid=${id}: ${err.message}`;
        console.error(`[W${workerId}] ${stopReason}`);
        throw err;
      }

      totalScanned++;
      if (totalScanned % 50 === 0) {
        const tStr = parsed.submitTime ? fmtMs(parsed.submitTime) : 'n/a';
        console.log(
          `Progress: scanned=${totalScanned}, inContest=${inContestCount}, solutions=${solutionsAdded}, lastSid=${id}, lastSubmitTime=${tStr}`,
        );
      }

      if (!parsed.ok) {
        await sleep(150);
        continue;
      }

      // 全局停止条件：任意页面 submitTime > 比赛结束时间 → 后续 ID 不会再有合法提交
      if (parsed.submitTime! > contestEndTime) {
        if (!stopped) {
          stopped = true;
          stopReason = `sid=${id} submitTime=${fmtMs(parsed.submitTime!)} > contestEndTime`;
          console.log(`[W${workerId}] Stop: ${stopReason}`);
        }
        await sleep(150);
        continue;
      }

      if (parsed.contestId !== contestId) {
        await sleep(150);
        continue;
      }

      inContestCount++;

      // submitTime <= contestEndTime：写入 solutions（与主路径一致，含 == end 边界）
      const row = userIdToRow.get(String(parsed.userId));
      const problemIndex = aliasToIndex.get(parsed.problemAlias!);
      if (!row) {
        console.warn(
          `sid=${id} user not in ranking: userId=${parsed.userId}, name=${parsed.userName}`,
        );
        await sleep(150);
        continue;
      }
      if (problemIndex === undefined) {
        console.warn(
          `sid=${id} problem not in problems list: alias=${parsed.problemAlias}`,
        );
        await sleep(150);
        continue;
      }
      const status = row.statuses[problemIndex];
      if (!status.solutions) status.solutions = [];
      const result = convertNowcoderVerdict(parsed.verdict || '');
      if (result !== null) {
        const sec = Math.max(0, Math.floor((parsed.submitTime! - contestBeginTime) / 1000));
        status.solutions.push({ result, time: [sec, 's'] });
        solutionsAdded++;
      }
      await sleep(150);
    }
  };

  const promises: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) {
    promises.push(
      worker(i + 1).catch((err) => {
        if (!firstError) firstError = err;
      }),
    );
  }
  await Promise.all(promises);

  if (firstError) {
    throw firstError;
  }

  // 提交时间天然按 ID 升序近似递增，但并发场景下 push 顺序可能略乱，为稳妥按 time 升序排序
  for (const row of rows) {
    for (const status of row.statuses) {
      if (status.solutions && status.solutions.length > 1) {
        status.solutions.sort((a, b) => {
          const ta = Array.isArray(a.time) ? Number(a.time[0]) : 0;
          const tb = Array.isArray(b.time) ? Number(b.time[0]) : 0;
          return ta - tb;
        });
      }
    }
  }

  console.log(
    `[Stats] scanned=${totalScanned}, inContest=${inContestCount}, solutionsAdded=${solutionsAdded}, stopReason=${stopReason}`,
  );
}

export interface NowcoderRunOptions {
  /** Cookie 文本（多个 key=value 用 ; 分隔）。HTML 提交页需要 */
  cookie?: string;
  /** 提交抓取并发数（按用户级 status-list 调用）。默认 2 */
  concurrency?: number;
}

export async function run(cid: string, options: NowcoderRunOptions = {}): Promise<srk.Ranklist> {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 2));

  // 主路径不需要 cookie；仅在用户提供时写入 jar，便于切换到 backup HTML 路径时复用
  if (options.cookie) {
    const pairs = options.cookie
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    console.log(`Using ${pairs.length} cookies (only required by HTML backup path)`);
    for (const p of pairs) {
      try {
        await jar.setCookie(p, BASE_URL);
      } catch (e) {
        console.warn(
          `Failed to set cookie "${p}": ${(e as Error).message}`,
        );
      }
    }
  }

  const sameContestEntry = await fetchSameContestInfo(cid);
  console.log(
    `Contest: ${sameContestEntry.name}, start=${fmtMs(
      sameContestEntry.startTime,
    )}, end=${fmtMs(sameContestEntry.endTime)}`,
  );

  const { problems: rawProblems, rows: rawRows, basicInfo } = await fetchAllRankData(cid);
  console.log(
    `Rank type: ${basicInfo.rankType}, contestBegin=${fmtMs(
      basicInfo.contestBeginTime,
    )}, contestEnd=${fmtMs(basicInfo.contestEndTime)}`,
  );
  if (basicInfo.rankType !== 'ICPC') {
    console.warn(
      `WARN: non-ICPC rankType "${basicInfo.rankType}". This adapter targets ICPC mode.`,
    );
  }

  const problems: srk.Problem[] = rawProblems.map((p) => ({
    alias: p.name,
    statistics: { accepted: p.acceptedCount, submitted: p.submitCount },
  }));
  const rows = buildRowsFromRankData(rawProblems, rawRows, basicInfo.contestBeginTime);

  // 主路径：用 status-list?searchUserName=... 接口逐用户拉取提交（无需 HTML / cookie / ID 扫描）
  await fetchAndFillSolutionsViaApi(
    cid,
    basicInfo.contestBeginTime,
    basicInfo.contestEndTime,
    rows,
    rawProblems,
    concurrency,
  );

  // 一致性校验：tries 与 solutions.length 是否一致
  verifyTriesConsistency(
    rows,
    rawProblems.map((p) => p.name),
  );

  const generator = new UniversalSrkGenerator();
  const startAtIso = dayjs(basicInfo.contestBeginTime)
    .tz(SOURCE_TZ)
    .format('YYYY-MM-DDTHH:mm:ssZ');
  const durationSec = Math.round(
    (basicInfo.contestEndTime - basicInfo.contestBeginTime) / 1000,
  );
  generator.init({
    contest: {
      title: { 'zh-CN': sameContestEntry.name, fallback: sameContestEntry.name },
      startAt: startAtIso,
      duration: [durationSec, 's'],
      frozenDuration: [1, 'h'],
      refLinks: [
        {
          link: `${BASE_URL}/acm/contest/${cid}`,
          title: { 'zh-CN': '原始榜单', fallback: 'Original Ranklist' },
        },
      ],
    },
    problems,
    contributors: ['algoUX (https://algoux.org)'],
    useICPCPreset: true,
    icpcPresetOptions: {
      sorterNoPenaltyResults: ['FB', 'AC', '?', 'NOUT', 'CE', 'UKE', null],
      mainRankSeriesRule: { count: { value: [0, 0, 0] } },
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
  generator.build({ calculateFB: false });

  const srkObject = generator.getSrk();
  return srkObject;
}
