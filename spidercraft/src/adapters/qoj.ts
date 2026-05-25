import vm from 'vm';
import cheerio from 'cheerio';
import type * as srk from '@algoux/standard-ranklist';
import { UniversalSrkGenerator } from '../generators/universal';

export const DEFAULT_QOJ_BASE_URL = 'https://qoj.ac';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

type QojUserTuple = [
  string,
  number,
  number,
  string,
  string,
  number,
  string | null | undefined,
];

type QojStandingsRow = [number, number, QojUserTuple, number, number?];

type QojScoreCell = [
  number,
  number,
  number,
  number,
  number,
  number,
  unknown[],
];

type QojScoreMap = Record<string, Record<string, QojScoreCell> | QojScoreCell[]>;

interface ParsedQojScript {
  standingsVersion: number;
  contestType: string;
  contestId: number | string;
  standings: QojStandingsRow[];
  score: QojScoreMap;
  problems: Array<number | string>;
  problemsId: string[];
}

export interface QojRunOptions {
  baseUrl?: string;
  includeUnofficial?: boolean;
  cookie?: string;
}

export interface QojParseOptions {
  cid: string;
  baseUrl?: string;
  includeUnofficial?: boolean;
}

export interface ParsedQojStandings {
  contestTitle: string;
  problems: srk.Problem[];
  rows: srk.RanklistRow[];
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanupText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function normalizeQojCookie(
  cookie: string | undefined,
  includeUnofficial: boolean,
): string | undefined {
  const pairs = (cookie ?? '')
    .split(';')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .filter((pair) => {
      const key = pair.split('=')[0].trim();
      return key !== 'show_unofficial_mode';
    });

  if (!includeUnofficial) {
    pairs.push('show_unofficial_mode=');
  }

  return pairs.length > 0 ? pairs.join('; ') : undefined;
}

function extractAssignedLiteral(script: string, name: string): string {
  const pattern = new RegExp(`(?:^|[;\\n\\r])\\s*${escapeRegExp(name)}\\s*=`, 'm');
  const match = pattern.exec(script);
  if (!match) {
    throw new Error(`Cannot find QOJ standings variable "${name}"`);
  }

  let start = match.index + match[0].length;
  while (/\s/.test(script[start] ?? '')) start++;

  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let i = start; i < script.length; i++) {
    const ch = script[i];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }

    if (ch === '[' || ch === '{' || ch === '(') {
      depth++;
      continue;
    }
    if (ch === ']' || ch === '}' || ch === ')') {
      depth--;
      continue;
    }
    if (ch === ';' && depth === 0) {
      return script.slice(start, i).trim();
    }
  }

  throw new Error(`Cannot parse QOJ standings variable "${name}"`);
}

function evaluateLiteral<T>(literal: string, name: string): T {
  try {
    const value = vm.runInNewContext(`(${literal})`, Object.create(null), {
      timeout: 1000,
    });
    return JSON.parse(JSON.stringify(value)) as T;
  } catch (e) {
    throw new Error(`Cannot evaluate QOJ standings variable "${name}": ${(e as Error).message}`);
  }
}

function findStandingsScript(html: string): string {
  const $ = cheerio.load(html);
  const scripts = $('script')
    .map((_, el) => $(el).html() ?? '')
    .get();
  const script = scripts.find(
    (item) => item.includes('standings=') && item.includes('score=') && item.includes('problems='),
  );
  if (!script) {
    const title = cleanupText($('title').text());
    const loginHint = /\/login|Login/i.test(html) ? ' The page may require authentication; pass --cookie if needed.' : '';
    throw new Error(
      `QOJ standings data not found in HTML${title ? ` (${title})` : ''}.${loginHint} For Universal Cup, try --base-url https://contest.ucup.ac.`,
    );
  }
  return script;
}

function parseQojScript(html: string): ParsedQojScript {
  const script = findStandingsScript(html);
  return {
    standingsVersion: evaluateLiteral<number>(
      extractAssignedLiteral(script, 'standings_version'),
      'standings_version',
    ),
    contestType: evaluateLiteral<string>(
      extractAssignedLiteral(script, 'contest_type'),
      'contest_type',
    ),
    contestId: evaluateLiteral<number | string>(
      extractAssignedLiteral(script, 'contest_id'),
      'contest_id',
    ),
    standings: evaluateLiteral<QojStandingsRow[]>(
      extractAssignedLiteral(script, 'standings'),
      'standings',
    ),
    score: evaluateLiteral<QojScoreMap>(extractAssignedLiteral(script, 'score'), 'score'),
    problems: evaluateLiteral<Array<number | string>>(
      extractAssignedLiteral(script, 'problems'),
      'problems',
    ),
    problemsId: evaluateLiteral<string[]>(
      extractAssignedLiteral(script, 'problems_id'),
      'problems_id',
    ),
  };
}

function getContestTitle(html: string, cid: string): string {
  const $ = cheerio.load(html);
  const titleFromHeading = cleanupText($('.uoj-content .text-center h1').first().text());
  if (titleFromHeading) return titleFromHeading;

  const pageTitle = cleanupText($('title').text());
  if (pageTitle) {
    return pageTitle.replace(/\s+-\s+Standings\b.*$/i, '').trim() || pageTitle;
  }

  return `QOJ Contest ${cid}`;
}

function splitMemberNames(text: string): srk.ExternalUser[] {
  return text
    .split(/[,，、;；]/)
    .map((name) => cleanupText(name))
    .filter(Boolean)
    .map((name) => ({ name }));
}

function looksLikeMemberList(text: string, members: srk.ExternalUser[]): boolean {
  if (members.length > 1) return true;
  if (/[，,、;；]/.test(text)) return true;
  const onlyMember = typeof members[0]?.name === 'string' ? members[0].name : undefined;
  if (!onlyMember) return false;
  if (/\s/.test(onlyMember)) return true;
  if (/^[\u4e00-\u9fff·]{2,12}$/.test(onlyMember)) return true;
  return false;
}

function parseTeamDisplayName(rawName: string): {
  name: string;
  teamMembers?: srk.ExternalUser[];
} {
  const cleanedName = cleanupText(rawName).replace(/^\*/, '').trim();
  const match = cleanedName.match(/^(.*?)[\s]*[\(（]([^()（）]+)[\)）]\s*$/);
  if (!match) {
    return { name: cleanedName };
  }

  const teamName = cleanupText(match[1]);
  const memberText = match[2];
  const teamMembers = splitMemberNames(memberText);
  if (!teamName || !looksLikeMemberList(memberText, teamMembers)) {
    return { name: cleanedName };
  }

  return { name: teamName, teamMembers };
}

function getScoreCell(
  score: QojScoreMap,
  userId: string,
  problemIndex: number,
): QojScoreCell | undefined {
  const userScore = score[userId];
  if (!userScore) return undefined;
  if (Array.isArray(userScore)) {
    return userScore[problemIndex];
  }
  return userScore[String(problemIndex)];
}

function isAcceptedCell(cell: QojScoreCell): boolean {
  return cell[0] === cell[4] || cell[0] === 97;
}

function convertStatus(cell: QojScoreCell | undefined): srk.RankProblemStatus {
  if (!cell) {
    return { result: null };
  }

  const scoreValue = Number(cell[0]);
  const timeSec = Number(cell[1]);
  const failedCount = Number(cell[3]);
  const pending = Number(cell[5]) === 1;
  const tries = Number.isFinite(failedCount) ? failedCount + 1 : undefined;

  if (pending) {
    return {
      result: '?',
      tries,
    };
  }

  if (isAcceptedCell(cell)) {
    const time: srk.TimeDuration = [timeSec, 's'];
    return {
      result: 'AC',
      time,
      tries,
    };
  }

  if (scoreValue === 0) {
    return {
      result: 'RJ',
      tries,
    };
  }

  console.warn(`Unknown QOJ ICPC score cell: ${JSON.stringify(cell)}, fallback to RJ.`);
  return {
    result: 'RJ',
    tries,
  };
}

export function parseQojStandingsHtml(
  html: string,
  options: QojParseOptions,
): ParsedQojStandings {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_QOJ_BASE_URL);
  const includeUnofficial = options.includeUnofficial ?? false;
  const data = parseQojScript(html);

  if (data.contestType !== 'ICPC') {
    throw new Error(`Unsupported QOJ contest_type "${data.contestType}". Only ICPC is supported.`);
  }
  if (data.standingsVersion < 2) {
    console.warn(`QOJ standings_version=${data.standingsVersion}; parsing with v2-compatible logic.`);
  }

  const problems: srk.Problem[] = data.problems.map((problemId, index) => ({
    alias: data.problemsId[index] ?? String.fromCharCode('A'.charCodeAt(0) + index),
    link: `${baseUrl}/contest/${encodeURIComponent(options.cid)}/problem/${problemId}`,
  }));

  const rows = data.standings.reduce<srk.RanklistRow[]>((acc, row) => {
      const [, totalTimeSec, userTuple] = row;
      const [userId, , userType, rawDisplayName, , , rawOrganization] = userTuple;
      const official = userType === 0;
      if (!includeUnofficial && !official) {
        return acc;
      }

      const statuses = problems.map((_, problemIndex) =>
        convertStatus(getScoreCell(data.score, userId, problemIndex)),
      );
      const acceptedCount = statuses.filter(
        (status) => status.result === 'AC' || status.result === 'FB',
      ).length;
      const parsedName = parseTeamDisplayName(rawDisplayName || userId);
      const user: srk.User = {
        id: userId,
        name: parsedName.name,
        organization: cleanupText(rawOrganization ?? ''),
        official,
      };
      if (parsedName.teamMembers) {
        user.teamMembers = parsedName.teamMembers;
      }

      acc.push({
        user,
        score: {
          value: acceptedCount,
          time: [Number(totalTimeSec), 's'] as srk.TimeDuration,
        },
        statuses,
      });
      return acc;
    }, []);

  return {
    contestTitle: getContestTitle(html, String(data.contestId || options.cid)),
    problems,
    rows,
  };
}

async function fetchStandingsHtml(
  cid: string,
  baseUrl: string,
  includeUnofficial: boolean,
  cookie?: string,
): Promise<string> {
  const url = `${baseUrl}/contest/${encodeURIComponent(cid)}/standings`;
  const normalizedCookie = normalizeQojCookie(cookie, includeUnofficial);
  const headers: Record<string, string> = {
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'en,zh-CN;q=0.9,zh;q=0.8',
    'user-agent': USER_AGENT,
  };
  if (normalizedCookie) {
    headers.cookie = normalizedCookie;
  }

  console.log(`[QOJ] GET ${url}`);
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Failed to fetch QOJ standings: HTTP ${res.status} ${res.statusText}`);
  }
  return res.text();
}

export async function run(
  cid: string,
  options: QojRunOptions = {},
): Promise<srk.Ranklist> {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_QOJ_BASE_URL);
  const includeUnofficial = options.includeUnofficial ?? false;
  const html = await fetchStandingsHtml(cid, baseUrl, includeUnofficial, options.cookie);
  const parsed = parseQojStandingsHtml(html, {
    cid,
    baseUrl,
    includeUnofficial,
  });

  const generator = new UniversalSrkGenerator();
  generator.init({
    contest: {
      title: {
        fallback: parsed.contestTitle,
      },
      startAt: '2000-01-01T00:00:00+08:00',
      duration: [5, 'h'],
      frozenDuration: [1, 'h'],
      refLinks: [
        {
          title: {
            'zh-CN': '原始榜单',
            fallback: 'Original Ranklist',
          },
          link: `${baseUrl}/contest/${encodeURIComponent(cid)}/standings`,
        },
      ],
    },
    problems: parsed.problems,
    contributors: ['algoUX (https://algoux.org)'],
    useICPCPreset: true,
    icpcPresetOptions: {
      sorterNoPenaltyResults: ['FB', 'AC', '?', 'NOUT', 'CE', 'UKE', null],
      mainRankSeriesRule: {
        count: {
          value: [0, 0, 0],
        },
      },
      sorterTimePrecision: 's',
      sorterRankingTimePrecision: 'min',
    },
    remarks: {
      'zh-CN':
        '这个榜单缺失奖牌数据，如果您有该比赛的原始榜单或获奖名单，欢迎联系我们补充数据。',
      fallback:
        'This ranklist lacks medal data. If you have the original ranklist or the list of winners, please contact us to supplement the data.',
    },
  });
  generator.setRows(parsed.rows);
  generator.build({
    calculateFB: true,
    onlyIncludeOfficialForFB: true,
    disableFBIfConflict: true,
  });

  const srkObject = generator.getSrk();
  delete srkObject.markers;
  return srkObject;
}
