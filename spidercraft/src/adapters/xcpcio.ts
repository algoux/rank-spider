import path from 'path';
import fs from 'fs-extra';

type AnyObject = Record<string, any>;
type TimeUnit = 'ms' | 's' | 'min' | 'h' | 'd';
type SolutionResult = string | null;

const XCPCIO_BASE_URL = 'https://board.xcpcio.com';
const XCPCIO_DATA_BASE_URL = `${XCPCIO_BASE_URL}/data`;

const SR_FIRST_BLOOD = 'FB';
const SR_ACCEPTED = 'AC';
const SR_REJECTED = 'RJ';
const SR_WRONG_ANSWER = 'WA';
const SR_PRESENTATION_ERROR = 'PE';
const SR_TIME_LIMIT_EXCEEDED = 'TLE';
const SR_MEMORY_LIMIT_EXCEEDED = 'MLE';
const SR_OUTPUT_LIMIT_EXCEEDED = 'OLE';
const SR_RUNTIME_ERROR = 'RTE';
const SR_COMPILATION_ERROR = 'CE';
const SR_UNKNOWN_ERROR = 'UKE';
const SR_FROZEN = '?';
const SR_NO_OUTPUT = 'NOUT';

const STYLE_GOLD = 'gold';
const STYLE_SILVER = 'silver';
const STYLE_BRONZE = 'bronze';
// Old XCPCIO online boards can collapse many accepted runs to the same earliest time.
const MAX_SAME_TIME_ONLINE_FIRST_BLOODS = 10;
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']);
const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
};

const contestUrl = new Map<string, string>();
const unknownContest = new Map<
  string,
  {
    name: any;
    status: Set<string>;
    count: number;
  }
>();

const SR_RESULTS: Record<string, string> = {
  ACCEPTED: SR_ACCEPTED,
  WRONG_ANSWER: SR_WRONG_ANSWER,
  RUNTIME_ERROR: SR_RUNTIME_ERROR,
  TIME_LIMIT_EXCEEDED: SR_TIME_LIMIT_EXCEEDED,
  COMPILATION_ERROR: SR_COMPILATION_ERROR,
  MEMORY_LIMIT_EXCEEDED: SR_MEMORY_LIMIT_EXCEEDED,
  OUTPUT_LIMIT_EXCEEDED: SR_OUTPUT_LIMIT_EXCEEDED,
  PRESENTATION_ERROR: SR_PRESENTATION_ERROR,
  NO_OUTPUT: SR_NO_OUTPUT,
  CORRECT: SR_ACCEPTED,
  INCORRECT: SR_REJECTED,
  PENDING: SR_FROZEN,
  FROZEN: SR_FROZEN,
};

const SRK_DEFAULT_BALLOON_COLOR_PALETTES = [
  [
    'rgba(189, 14, 14, 0.7)',
    'rgba(149, 31, 217, 0.7)',
    'rgba(16, 32, 96, 0.7)',
    'rgba(38, 185, 60, 0.7)',
    'rgba(239, 217, 9, 0.7)',
    'rgba(243, 88, 20, 0.7)',
    'rgba(12, 76, 138, 0.7)',
    'rgba(156, 155, 155, 0.7)',
    'rgba(4, 154, 115, 0.7)',
    'rgba(159, 19, 236, 0.7)',
    'rgba(42, 197, 202, 0.7)',
    'rgba(142, 56, 54, 0.7)',
    'rgba(144, 238, 144, 0.7)',
  ],
  [
    'rgba(189, 14, 14, 0.7)',
    'rgba(255, 144, 228, 0.7)',
    'rgba(255, 255, 255, 0.7)',
    'rgba(38, 185, 60, 0.7)',
    'rgba(239, 217, 9, 0.7)',
    'rgba(243, 88, 20, 0.7)',
    'rgba(12, 76, 138, 0.7)',
    'rgba(156, 155, 155, 0.7)',
    'rgba(4, 154, 115, 0.7)',
    'rgba(159, 19, 236, 0.7)',
    'rgba(42, 197, 202, 0.7)',
    'rgba(142, 56, 54, 0.7)',
    'rgba(0, 0, 0, 0.7)',
  ],
  [
    'rgba(189, 14, 14, 0.7)',
    '#951FD9',
    'rgba(255, 255, 255, 0.7)',
    'rgba(38, 185, 60, 0.7)',
    'rgba(239, 217, 9, 0.7)',
    'rgba(243, 88, 20, 0.7)',
    'rgba(12, 76, 138, 0.7)',
    'rgba(156, 155, 155, 0.7)',
    'rgba(4, 154, 115, 0.7)',
    'rgba(159, 19, 236, 0.7)',
    'rgba(42, 197, 202, 0.7)',
    'rgba(142, 56, 54, 0.7)',
    'rgba(0, 0, 0, 0.7)',
  ],
  [
    '#dc2626',
    '#f59e0b',
    '#fde047',
    '#22c55e',
    '#5eead4',
    '#3b82f6',
    '#a855f7',
    '#f472b6',
    '#ffffff',
    '#edc5f2',
    '#95f4b8',
    '#f2e7b1',
  ],
  [
    '#ff3b30',
    '#ee7528',
    '#fde047',
    '#00aa00',
    '#5eead4',
    '#1b75dc',
    '#a855f7',
    '#f472b6',
    '#A52A2A',
    '#000080',
    '#000000',
    '#ffffff',
    '#f5b7b7',
  ],
  [
    '#ff3b30',
    '#ee7528',
    '#fde047',
    '#00aa00',
    '#5eead4',
    '#1b75dc',
    '#a855f7',
    '#f472b6',
    '#A52A2A',
    '#000080',
    '#000000',
    '#737373',
  ],
];

const MEDAL_MISSING_REMARKS = {
  'zh-CN':
    '这个榜单缺失奖牌数据，如果您有该比赛的原始榜单或获奖名单，欢迎联系我们补充数据。',
  fallback:
    'This ranklist lacks medal data. If you have the original ranklist or the list of winners, please contact us to supplement the data.',
};

export interface XcpcioGenerateResult {
  ok: boolean;
  output_path?: string | null;
  contest_name?: string | null;
  contest_url?: string | null;
  unknown_statuses: AnyObject;
  warnings: string[];
  error?: string | null;
}

export interface XcpcioGenerateOptions {
  downloadBanner?: boolean;
  cwd?: string;
}

interface XcpcioBuildResult {
  srkObject: AnyObject;
  contestName: string | null;
  contestUrl: string;
  warnings: string[];
  unknownStatuses: AnyObject;
}

class XcpcioBuildError extends Error {
  constructor(
    message: string,
    public warnings: string[] = [],
    public contestName: string | null = null,
  ) {
    super(message);
  }
}

class XcpcioStatus {
  result: SolutionResult = null;
  duration = 0;
  tries = 0;
  solutions?: Array<{ result: Exclude<SolutionResult, null>; time: [number, TimeUnit] }>;
}

function objectHas(obj: any, key: string): boolean {
  return obj != null && Object.prototype.hasOwnProperty.call(obj, key);
}

function pythonString(value: any): string {
  if (value === null || value === undefined) return value === null ? 'None' : 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => pythonRepr(item)).join(', ')}]`;
  }
  if (typeof value === 'object') {
    const parts = Object.entries(value).map(
      ([key, item]) => `${pythonRepr(key)}: ${pythonRepr(item)}`,
    );
    return `{${parts.join(', ')}}`;
  }
  return String(value);
}

function pythonRepr(value: any): string {
  if (typeof value === 'string') {
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  }
  return pythonString(value);
}

function pyMapKey(value: any): string {
  return pythonString(value);
}

function toPythonNumber(value: any): number {
  if (typeof value === 'boolean') return value ? 1 : 0;
  return Number(value);
}

function isPythonNumber(value: any): boolean {
  return typeof value === 'number' || typeof value === 'boolean';
}

function makeResult(
  ok: boolean,
  outputPath: string | null = null,
  contestName: string | null = null,
  contestUrlValue: string | null = null,
  unknownStatuses: AnyObject | null = null,
  warnings: string[] | null = null,
  error: string | null = null,
): XcpcioGenerateResult {
  return {
    ok,
    output_path: outputPath,
    contest_name: contestName,
    contest_url: contestUrlValue,
    unknown_statuses: unknownStatuses ?? {},
    warnings: warnings ?? [],
    error,
  };
}

function stringifyLikePythonJson(value: any): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map((item) => stringifyLikePythonJson(item)).join(', ')}]`;
  }
  if (typeof value === 'object') {
    return `{${Object.keys(value)
      .map((key) => `${JSON.stringify(key)}: ${stringifyLikePythonJson(value[key])}`)
      .join(', ')}}`;
  }
  return JSON.stringify(value);
}

function resolveOutputPath(outputPath: string, cwd?: string): string {
  if (!outputPath || outputPath.trim().length === 0) {
    throw new Error('output_path must not be empty');
  }

  const baseDir = path.resolve(cwd ?? process.cwd());
  const resolved = path.resolve(baseDir, outputPath);
  const relative = path.relative(baseDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`output_path must be inside current working directory: ${baseDir}`);
  }
  if (path.basename(resolved) === '') {
    throw new Error('output_path must include a file name');
  }
  return resolved;
}

export function normalizeContestPath(contestPathOrUrl: string): string {
  const input = contestPathOrUrl.trim();
  if (!input) {
    throw new Error('contest path or URL must not be empty');
  }

  let pathname: string;
  if (/^https?:\/\//i.test(input)) {
    let url: URL;
    try {
      url = new URL(input);
    } catch (e) {
      throw new Error(`Invalid XCPCIO URL: ${input}`);
    }

    if (url.hostname !== 'board.xcpcio.com') {
      throw new Error(`XCPCIO URL host must be board.xcpcio.com: ${input}`);
    }
    pathname = url.pathname;
  } else {
    pathname = input;
  }

  if (!pathname.startsWith('/')) {
    pathname = `/${pathname}`;
  }
  if (pathname === '/') {
    throw new Error('contest path must not be root');
  }
  if (pathname === '/data') {
    throw new Error('contest path must include a contest path after /data');
  }
  if (pathname.startsWith('/data/')) {
    pathname = pathname.slice('/data'.length);
  }
  return pathname;
}

export function inferPythonStyleOutputPath(contestPathOrUrl: string): string {
  const normalizedPath = normalizeContestPath(contestPathOrUrl);
  const parts = normalizedPath.split('/').filter(Boolean);
  const category = parts[0];
  const key = parts.slice(1).join('');

  if (!key) {
    throw new Error(`contest path is too short to infer output file name: ${normalizedPath}`);
  }

  if (category === 'icpc') {
    return path.join('icpc', `icpc${key}.srk.json`);
  }
  if (category === 'ccpc') {
    return path.join('ccpc', `ccpc${key}.srk.json`);
  }
  if (category === 'provincial-contest') {
    return path.join('province', `ccpc${key}.srk.json`);
  }

  return path.join('temp', `${key}.srk.json`);
}

function formatUnknownStatuses(url: string | null | undefined): AnyObject {
  if (!url) return {};
  const item = unknownContest.get(url);
  if (!item) return {};
  return {
    name: item.name,
    status: Array.from(item.status).sort(),
    count: item.count,
  };
}

function setContestUrl(contestPath: string, config: AnyObject): void {
  const url = `${XCPCIO_BASE_URL}${contestPath}`;
  contestUrl.set(config.contest_name, url);
  console.log(`name: ${config.contest_name}, url: ${url}`);
}

function addUnknown(contestName: any, status: string): void {
  const url = contestUrl.get(contestName);
  const item = unknownContest.get(url ?? '') ?? {
    name: contestName,
    status: new Set<string>(),
    count: 0,
  };
  item.status.add(status);
  item.count += 1;
  unknownContest.set(url ?? '', item);
}

async function getJson<T = any>(url: string): Promise<T | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  try {
    const result = await fetch(url, {
      signal: controller.signal,
    });

    if (result.status !== 200) {
      console.log('请求被拒绝，状态码：', result.status);
      return undefined;
    }

    return (await result.json()) as T;
  } catch (e) {
    console.log('请求 URL 发生错误', e);
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

function formatTimestampPlus8(seconds: number): string {
  const date = new Date(seconds * 1000 + 8 * 3600 * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(
    date.getUTCDate(),
  )}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(
    date.getUTCSeconds(),
  )}+08:00`;
}

function normalizeContestTimestampSeconds(value: any): number {
  const timestamp = toPythonNumber(value);
  if (!Number.isFinite(timestamp)) return Number.NaN;
  if (timestamp > 946684800000) {
    return Math.floor(timestamp / 1000);
  }
  return timestamp;
}

function inferRunTimeUnit(config: AnyObject, runs: AnyObject[]): TimeUnit {
  const firstTimestamp = toPythonNumber(runs[0]?.timestamp);
  if (!Number.isFinite(firstTimestamp)) return 'ms';
  if (firstTimestamp / 1000 < 1) return 's';

  const startTime = normalizeContestTimestampSeconds(config.start_time);
  const endTime = normalizeContestTimestampSeconds(config.end_time);
  const contestDurationSeconds = endTime - startTime;
  if (!Number.isFinite(contestDurationSeconds) || contestDurationSeconds <= 0) {
    return 'ms';
  }

  const maxTimestamp = runs.reduce((max, run) => {
    const timestamp = toPythonNumber(run.timestamp);
    return Number.isFinite(timestamp) ? Math.max(max, timestamp) : max;
  }, Number.NEGATIVE_INFINITY);
  if (!Number.isFinite(maxTimestamp)) return 'ms';

  const toleranceSeconds = Math.max(300, contestDurationSeconds * 0.01);
  if (maxTimestamp <= contestDurationSeconds + toleranceSeconds) {
    return 's';
  }
  return 'ms';
}

function isOnlineContest(contestPath: string, config: AnyObject): boolean {
  const text = [
    contestPath,
    config.contest_name,
    config.name,
    config.title,
    config.board_name,
  ]
    .map((value) => {
      if (value === null || value === undefined) return '';
      if (typeof value === 'object') return Object.values(value).join(' ');
      return String(value);
    })
    .join(' ');
  return /网络|online|preliminary/i.test(text);
}

function makeContest(config: AnyObject): AnyObject {
  let startTime = config.start_time;
  let endTime = config.end_time;
  const frozenTime = config.frozen_time ?? 0;
  const link = config.link ?? null;
  const banner = config.__srk_banner ?? config.banner ?? null;
  let bannerLink = config.__srk_banner_link ?? null;

  startTime = normalizeContestTimestampSeconds(startTime);
  endTime = normalizeContestTimestampSeconds(endTime);

  let frozenHours = 0;
  try {
    if (frozenTime == null) {
      frozenHours = 0;
    } else if (isPythonNumber(frozenTime) && toPythonNumber(frozenTime) > 946684800000) {
      const frozenTs = Math.floor(toPythonNumber(frozenTime) / 1000);
      frozenHours = (endTime - frozenTs) / 3600;
    } else if (isPythonNumber(frozenTime) && toPythonNumber(frozenTime) > 1000) {
      frozenHours = toPythonNumber(frozenTime) / 1000.0 / 3600.0;
    } else {
      if (isPythonNumber(frozenTime) && toPythonNumber(frozenTime) > 3600) {
        frozenHours = toPythonNumber(frozenTime) / 3600.0;
      } else {
        frozenHours = toPythonNumber(frozenTime);
      }
    }
    if (!Number.isFinite(frozenHours)) frozenHours = 0;
  } catch {
    frozenHours = 0;
  }

  const duration = (endTime - startTime) / 3600;
  let processedBanner: AnyObject | string | null = null;
  if (banner !== null && banner !== undefined) {
    if (typeof banner === 'string') {
      processedBanner = bannerLink ? { image: banner, link: bannerLink } : banner;
    } else if (typeof banner === 'object' && !Array.isArray(banner)) {
      const originalLink = imageReferenceWithoutDownload(banner);
      bannerLink = bannerLink ?? imageLink(banner);
      if (originalLink) {
        processedBanner = bannerLink ? { image: originalLink, link: bannerLink } : originalLink;
      }
    }
  }

  const contest: AnyObject = {
    title: {
      'zh-CN': config.contest_name,
      fallback: config.contest_name,
    },
    startAt: formatTimestampPlus8(startTime),
    duration: [Math.trunc(duration), 'h'],
    frozenDuration: [Math.trunc(frozenHours), 'h'],
  };
  if (link !== null && link !== undefined) {
    contest.link = link;
  }
  if (processedBanner !== null) {
    contest.banner = processedBanner;
  }
  return contest;
}

function makeProblem(alias: any, statistics?: [number, number], style?: [string?]): AnyObject {
  const problem: AnyObject = {
    alias,
  };
  if (statistics !== undefined) {
    problem.statistics = {
      accepted: statistics[0],
      submitted: statistics[1],
    };
  }
  if (style !== undefined && style !== null) {
    problem.style = {
      backgroundColor: style[0],
    };
  }
  return problem;
}

function makeUser(
  name: any,
  id: any,
  organization: any,
  members: Array<string | AnyObject> | null | undefined,
  official: any,
  markers: AnyObject[] | null | undefined,
  location: any,
  avatar: any,
  photo: any,
): AnyObject {
  const user: AnyObject = { name };
  if (id !== null && id !== undefined) user.id = id;
  if (organization !== null && organization !== undefined) user.organization = organization;
  if (members !== null && members !== undefined) {
    user.teamMembers = members.map((member) => {
      if (member !== null && typeof member === 'object' && !Array.isArray(member)) {
        const teamMember: AnyObject = {
          name: member.name,
        };
        if (member.role !== null && member.role !== undefined) {
          teamMember.role = member.role;
        }
        if (member.avatar !== null && member.avatar !== undefined) {
          teamMember.avatar = member.avatar;
        }
        if (member.link !== null && member.link !== undefined) {
          teamMember.link = member.link;
        }
        return teamMember;
      }
      return { name: member };
    });
  }
  if (official !== null && official !== undefined) user.official = official;
  if (markers !== null && markers !== undefined && markers.length > 0) {
    user.markers = markers.map((marker) => marker.id);
  }
  if (location !== null && location !== undefined) user.location = location;
  if (avatar !== null && avatar !== undefined) user.avatar = avatar;
  if (photo !== null && photo !== undefined) user.photo = photo;
  return user;
}

function makeRow(user: AnyObject, score: [number, number], statuses: XcpcioStatus[], numProblems: number): AnyObject {
  const rowStatuses: AnyObject[] = [];
  if (statuses.length === 0) {
    for (let i = 0; i < numProblems; i++) {
      rowStatuses.push({
        result: null,
        time: [0, 's'],
        tries: 0,
      });
    }
  } else {
    for (const status of statuses) {
      const rowStatus: AnyObject = {
        result: status.result,
        time: [
          Math.max(status.duration - Math.max(status.tries - 1, 0) * 20 * 60, 0),
          's',
        ],
        tries: status.tries,
      };
      if (status.solutions !== undefined) {
        rowStatus.solutions = status.solutions;
      }
      rowStatuses.push(rowStatus);
    }
  }

  return {
    user,
    score: {
      value: score[0],
      time: [score[1], 's'],
    },
    statuses: rowStatuses,
  };
}

function buildRank(
  contest: AnyObject,
  problems: AnyObject[],
  series: AnyObject[],
  rows: AnyObject[],
  markers: AnyObject[] | undefined,
  contributors: string[] | undefined,
  penaltyTimeCalculation: 's' | 'min' = 'min',
  isRemarks = false,
): AnyObject {
  let finalSeries = series;
  const markerLabels = new Set<string>();
  if (markers !== undefined) {
    for (const marker of markers) {
      markerLabels.add(String(marker.label));
    }
  }
  const groupSeries = finalSeries.filter(
    (item) =>
      typeof item.title === 'string' &&
      !['#', 'R#', 'S#'].includes(item.title) &&
      item.title.endsWith('#'),
  );
  const validGroupSeries = groupSeries.filter((item) =>
    markerLabels.has(item.title.slice(0, -1)),
  );
  if (validGroupSeries.length > 1) {
    finalSeries = finalSeries.filter((item) => item.title !== '#');
  }

  const rank: AnyObject = {
    type: 'general',
    version: '0.3.13',
    contest,
    problems,
    series: finalSeries,
    rows,
    sorter: {
      algorithm: 'ICPC',
      config: {
        noPenaltyResults: [SR_FIRST_BLOOD, SR_ACCEPTED, SR_FROZEN, SR_COMPILATION_ERROR, SR_UNKNOWN_ERROR, null],
        penalty: [20, 'min'],
        timePrecision: penaltyTimeCalculation,
        timeRounding: 'floor',
      },
    },
  };

  if (penaltyTimeCalculation === 's') {
    rank.sorter.config.rankingTimePrecision = 'min';
    rank.sorter.config.rankingTimeRounding = 'floor';
  }
  if (markers !== undefined && markers.length > 0) {
    rank.markers = markers;
  }
  if (contributors !== undefined) {
    rank.contributors = contributors;
  }
  if (isRemarks) {
    rank.remarks = MEDAL_MISSING_REMARKS;
  }
  return rank;
}

function timeToMilliseconds(time: any): number {
  if (!Array.isArray(time)) return Number.NaN;
  const value = toPythonNumber(time[0]);
  if (!Number.isFinite(value)) return Number.NaN;
  switch (time[1]) {
    case 'ms':
      return value;
    case 's':
      return value * 1000;
    case 'min':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    default:
      return value;
  }
}

function setAcceptedSolutionResult(status: AnyObject, result: string): void {
  if (!Array.isArray(status.solutions)) return;
  for (let i = status.solutions.length - 1; i >= 0; i--) {
    const solution = status.solutions[i];
    if (solution?.result === SR_ACCEPTED || solution?.result === SR_FIRST_BLOOD) {
      solution.result = result;
      return;
    }
  }
}

function normalizeOnlineFirstBlood(rank: AnyObject): void {
  const bestByProblem = new Map<
    number,
    {
      time: number;
      candidates: AnyObject[];
    }
  >();

  for (const row of rank.rows ?? []) {
    const statuses = row.statuses ?? row.status ?? [];
    if (!Array.isArray(statuses)) continue;
    for (let problemIndex = 0; problemIndex < statuses.length; problemIndex++) {
      const status = statuses[problemIndex];
      if (status === null || status === undefined) continue;

      if (status.result === SR_FIRST_BLOOD) {
        status.result = SR_ACCEPTED;
      }
      if (Array.isArray(status.solutions)) {
        for (const solution of status.solutions) {
          if (solution?.result === SR_FIRST_BLOOD) {
            solution.result = SR_ACCEPTED;
          }
        }
      }

      if (status.result !== SR_ACCEPTED) continue;
      const time = timeToMilliseconds(status.time);
      if (!Number.isFinite(time)) continue;

      const best = bestByProblem.get(problemIndex);
      if (best === undefined || time < best.time) {
        bestByProblem.set(problemIndex, { time, candidates: [status] });
      } else if (time === best.time) {
        best.candidates.push(status);
      }
    }
  }

  for (const { candidates } of bestByProblem.values()) {
    const firstBloods =
      candidates.length > MAX_SAME_TIME_ONLINE_FIRST_BLOODS ? candidates.slice(0, 1) : candidates;
    for (const status of firstBloods) {
      status.result = SR_FIRST_BLOOD;
      setAcceptedSolutionResult(status, SR_FIRST_BLOOD);
    }
  }
}

function extractExtension(url: string, defaultExt = 'png'): string {
  if (!url) return defaultExt;

  let pathname = '';
  try {
    pathname = new URL(url, 'https://board.xcpcio.com').pathname;
  } catch {
    pathname = url.split(/[?#]/)[0];
  }

  const filename = pathname.split('/').pop() ?? '';
  if (filename.includes('.')) {
    const ext = filename.split('.').pop() ?? '';
    const normalizedExt = ext.toLowerCase();
    if (IMAGE_EXTENSIONS.has(normalizedExt)) {
      return normalizedExt;
    }
  }
  return defaultExt;
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function safeFilenameComponent(value: any, fallback = 'image'): string {
  const text = String(value ?? fallback)
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '');
  return text || fallback;
}

function resolveImageUrl(url: string, baseUrl = `${XCPCIO_DATA_BASE_URL}/`): string {
  if (/^https?:\/\//i.test(url)) return url;
  return new URL(url, baseUrl).href;
}

function getImageUrl(imageData: any): string | null {
  if (typeof imageData === 'string') {
    return imageData.startsWith('data:') ? null : imageData;
  }
  if (imageData !== null && typeof imageData === 'object' && !Array.isArray(imageData)) {
    return typeof imageData.url === 'string' && imageData.url ? imageData.url : null;
  }
  return null;
}

function parseBase64Image(imageData: any): { mime: string; base64: string } | null {
  if (typeof imageData === 'string') {
    const match = imageData.match(/^data:([^;,]+)?;base64,([\s\S]*)$/);
    if (!match) return null;
    return { mime: match[1] || 'image/png', base64: match[2] };
  }
  if (imageData === null || typeof imageData !== 'object' || Array.isArray(imageData)) {
    return null;
  }
  if (typeof imageData.base64 !== 'string' || !imageData.base64) {
    return null;
  }
  if (imageData.base64.startsWith('data:')) {
    return parseBase64Image(imageData.base64);
  }
  const mime = imageData.mime ?? `image/${imageData.type ?? 'png'}`;
  return { mime, base64: imageData.base64 };
}

function extractImageExtension(imageData: any, defaultExt = 'png'): string {
  const url = getImageUrl(imageData);
  if (url) {
    const ext = extractExtension(url, '');
    if (ext) return ext;
  }

  const base64Image = parseBase64Image(imageData);
  if (base64Image && MIME_EXTENSIONS[base64Image.mime]) {
    return MIME_EXTENSIONS[base64Image.mime];
  }
  if (imageData !== null && typeof imageData === 'object' && !Array.isArray(imageData)) {
    if (MIME_EXTENSIONS[imageData.mime]) {
      return MIME_EXTENSIONS[imageData.mime];
    }
    if (typeof imageData.type === 'string' && IMAGE_EXTENSIONS.has(imageData.type.toLowerCase())) {
      return imageData.type.toLowerCase();
    }
  }
  return defaultExt;
}

function imageReferenceWithoutDownload(
  imageData: any,
  baseUrl = `${XCPCIO_DATA_BASE_URL}/`,
): string | null {
  if (typeof imageData === 'string') {
    if (imageData.startsWith('data:')) return null;
    return resolveImageUrl(imageData, baseUrl);
  }
  const url = getImageUrl(imageData);
  return url ? resolveImageUrl(url, baseUrl) : null;
}

function imageLink(imageData: any, baseUrl = `${XCPCIO_DATA_BASE_URL}/`): string | null {
  const url = getImageUrl(imageData);
  return url ? resolveImageUrl(url, baseUrl) : null;
}

async function writeBase64Image(imageData: any, savePath: string): Promise<string | null> {
  const parsed = parseBase64Image(imageData);
  if (!parsed) return null;

  try {
    await fs.ensureDir(path.dirname(savePath));
    await fs.writeFile(savePath, Buffer.from(parsed.base64, 'base64'));
    console.log(`图片已保存到: ${savePath}`);
    return savePath;
  } catch (e) {
    console.log(`保存 base64 图片失败: ${savePath}, 错误: ${(e as Error).message}`);
    return null;
  }
}

async function downloadImage(
  url: string,
  savePath: string,
  baseUrl = `${XCPCIO_DATA_BASE_URL}/`,
): Promise<string | null> {
  if (!url) return null;
  const imageUrl = resolveImageUrl(url, baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    await fs.ensureDir(path.dirname(savePath));
    const response = await fetch(imageUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Accept-Language': 'zh-CN,zh;q=0.5',
        Referer: XCPCIO_BASE_URL,
        'Sec-Fetch-Dest': 'image',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'same-origin',
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(savePath, buffer);
    console.log(`图片已保存到: ${savePath}`);
    return savePath;
  } catch (e) {
    console.log(`下载图片失败: ${imageUrl}, 错误: ${(e as Error).message}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function downloadAsset(
  imageData: any,
  contestId: string,
  filenameStem: string,
  assetBaseDir: string,
  defaultExt = 'png',
): Promise<{ path: string | null; ok: boolean }> {
  if (imageData === null || imageData === undefined) {
    return { path: null, ok: false };
  }

  const ext = extractImageExtension(imageData, defaultExt);
  const filename = `${safeFilenameComponent(filenameStem)}.${ext}`;
  const relativePath = toPosixPath(path.join('assets', safeFilenameComponent(contestId), filename));
  const savePath = path.join(assetBaseDir, safeFilenameComponent(contestId), filename);

  if (parseBase64Image(imageData)) {
    const localPath = await writeBase64Image(imageData, savePath);
    return { path: localPath ? relativePath : null, ok: localPath !== null };
  }

  const url = getImageUrl(imageData);
  if (!url) {
    return { path: null, ok: false };
  }

  const localPath = await downloadImage(url, savePath);
  if (localPath === null) {
    return { path: imageReferenceWithoutDownload(imageData), ok: false };
  }
  return { path: relativePath, ok: true };
}

async function prepareImageAsset(
  imageData: any,
  contestId: string,
  filenameStem: string,
  assetBaseDir: string,
  warnings: string[],
  warningLabel: string,
  downloadAssets: boolean,
  defaultExt = 'png',
): Promise<string | null> {
  if (imageData === null || imageData === undefined) return null;

  if (downloadAssets) {
    const result = await downloadAsset(imageData, contestId, filenameStem, assetBaseDir, defaultExt);
    if (!result.ok) {
      warnings.push(
        result.path === null
          ? `${warningLabel} 图片素材处理失败`
          : `${warningLabel} 图片素材下载失败，已回退到远程 URL`,
      );
    }
    return result.path;
  }

  const imagePath = imageReferenceWithoutDownload(imageData);
  if (imagePath === null && parseBase64Image(imageData)) {
    warnings.push(`${warningLabel} 是 base64 图片，已跳过；启用资源下载后可写入 assets/`);
  }
  return imagePath;
}

function templateImageForTeam(template: any, teamId: any): any | null {
  if (!template) return null;
  const teamIdValue = String(teamId);
  if (typeof template === 'string') {
    return template.replace(/\$\{team_id\}/g, teamIdValue);
  }
  if (template !== null && typeof template === 'object' && !Array.isArray(template)) {
    const image = { ...template };
    if (typeof image.url === 'string') {
      image.url = image.url.replace(/\$\{team_id\}/g, teamIdValue);
    }
    return image;
  }
  return null;
}

function teamItems(teams: AnyObject | AnyObject[]): Array<[any, AnyObject]> {
  if (Array.isArray(teams)) {
    return teams.map((team, index): [any, AnyObject] => [team?.id ?? String(index), team]);
  }
  return Object.entries(teams);
}

async function prepareAssets(
  contestPath: string,
  config: AnyObject,
  teams: AnyObject | AnyObject[],
  contestId: string,
  assetBaseDir: string,
  downloadAssets: boolean,
  warnings: string[],
): Promise<void> {
  const banner = config.banner ?? null;
  if (banner !== null && banner !== undefined) {
    const bannerImage = await prepareImageAsset(
      banner,
      contestId,
      'banner',
      assetBaseDir,
      warnings,
      `${contestPath} banner`,
      downloadAssets,
      'png',
    );
    if (bannerImage) {
      config.__srk_banner = bannerImage;
      const link = imageLink(banner);
      if (link) {
        config.__srk_banner_link = link;
      }
    }
  }

  const teamPhotoTemplate = config.options?.team_photo_url_template ?? null;
  for (const [teamKey, team] of teamItems(teams)) {
    if (team === null || typeof team !== 'object' || Array.isArray(team)) {
      continue;
    }

    const teamId = team.team_id ?? team.id ?? teamKey;
    const filenameId = safeFilenameComponent(teamId, 'team');

    const avatarSource = team.avatar ?? team.badge ?? null;
    if (avatarSource !== null) {
      const avatar = await prepareImageAsset(
        avatarSource,
        contestId,
        `team-${filenameId}-avatar`,
        assetBaseDir,
        warnings,
        `${contestPath} team ${teamId} avatar`,
        downloadAssets,
        'png',
      );
      if (avatar) {
        team.avatar = avatar;
      }
    }

    let photoSource = team.photo ?? null;
    if (photoSource === null && !(team.missing_photo ?? false)) {
      photoSource = templateImageForTeam(teamPhotoTemplate, teamId);
    }
    if (photoSource !== null) {
      const photo = await prepareImageAsset(
        photoSource,
        contestId,
        `team-${filenameId}-photo`,
        assetBaseDir,
        warnings,
        `${contestPath} team ${teamId} photo`,
        downloadAssets,
        'jpg',
      );
      if (photo) {
        team.photo = photo;
      }
    }
  }
}

class XcpcioParser {
  static timeUnit: TimeUnit = 'ms';

  private orgMap = new Map<any, string>();
  private problemIdList: any[];
  private numProblems: number;
  private problemIdMap = new Map<any, number>();
  private group: AnyObject;
  private statistics: Array<[number, number]>;
  private statuses = new Map<string, XcpcioStatus[]>();

  constructor(
    private config: AnyObject,
    private teams: AnyObject | AnyObject[],
    private runs: AnyObject[],
    private org?: AnyObject[] | null,
  ) {
    if (org !== null && org !== undefined && Array.isArray(org)) {
      for (const orgItem of org) {
        if (orgItem?.id !== null && orgItem?.id !== undefined) {
          const orgId = orgItem.id;
          const orgNameObj = orgItem.name ?? {};
          const orgName = this.extractOrgName(orgNameObj);
          if (orgName) {
            this.orgMap.set(orgId, orgName);
            this.orgMap.set(String(orgId), orgName);
          }
        }
      }
    }

    if (objectHas(config, 'problem_id')) {
      this.problemIdList = config.problem_id;
    } else if (objectHas(config, 'problems') && Array.isArray(config.problems)) {
      this.problemIdList = [];
      for (const prob of config.problems) {
        if (prob !== null && typeof prob === 'object' && !Array.isArray(prob)) {
          if (objectHas(prob, 'label')) {
            this.problemIdList.push(prob.label);
          } else if (objectHas(prob, 'id')) {
            this.problemIdList.push(prob.id);
          }
        }
      }
      if (this.problemIdList.length === 0) {
        throw new Error('config 中的 problems 数组为空或格式不正确');
      }
    } else {
      throw new Error('config 中既没有 problem_id 数组也没有 problems 数组');
    }

    this.numProblems = this.problemIdList.length;

    if (objectHas(config, 'problems') && Array.isArray(config.problems)) {
      config.problems.forEach((prob: any, idx: number) => {
        if (prob !== null && typeof prob === 'object' && !Array.isArray(prob) && objectHas(prob, 'id')) {
          this.problemIdMap.set(prob.id, idx);
          const numericId = parseInt(prob.id, 10);
          if (!Number.isNaN(numericId)) {
            this.problemIdMap.set(numericId, idx);
          }
        }
      });
    }

    if (this.problemIdMap.size === 0) {
      this.problemIdList.forEach((pid, idx) => {
        this.problemIdMap.set(pid, idx);
        this.problemIdMap.set(idx, idx);
      });
    }

    this.group = config.group ?? {};
    this.statistics = this.problemIdList.map(() => [0, 0]);
    this.calculate();
  }

  private teamItems(): Array<[any, AnyObject]> {
    if (!Array.isArray(this.teams) && this.teams !== null && typeof this.teams === 'object') {
      return Object.entries(this.teams);
    }
    if (Array.isArray(this.teams)) {
      return this.teams.map((team, i) => [team.id !== undefined ? team.id : String(i), team]);
    }
    throw new Error(`Unsupported teams data type: ${typeof this.teams}`);
  }

  private teamGroupIds(team: AnyObject): any[] {
    let group = team.group ?? [];
    if (group === null) group = [];
    if (!Array.isArray(group)) {
      group = [group];
    } else {
      group = [...group];
    }

    let teamMarkers = team.markers ?? [];
    if (teamMarkers === null) teamMarkers = [];
    if (!Array.isArray(teamMarkers)) teamMarkers = [teamMarkers];

    if (objectHas(team, 'official')) {
      if (this.isTrueFlag(team.official) && !group.includes('official')) {
        group.push('official');
      } else if (this.isFalseFlag(team.official) && !group.includes('unofficial')) {
        group.push('unofficial');
      }
    }

    return group.concat(teamMarkers.filter((marker: any) => !group.includes(marker)));
  }

  private isTrueFlag(value: any): boolean {
    if (typeof value === 'string') {
      return ['1', 'true', 'yes'].includes(value.trim().toLowerCase());
    }
    return value === true || value === 1;
  }

  private isFalseFlag(value: any): boolean {
    if (typeof value === 'string') {
      return ['0', 'false', 'no'].includes(value.trim().toLowerCase());
    }
    return value === false || value === 0;
  }

  private starGroupIds(): Set<any> {
    const ids = new Set<any>(['unofficial']);
    const starPattern = /打星/;
    for (const [key, value] of Object.entries(this.group)) {
      if (starPattern.test(String(value))) {
        ids.add(key);
      }
    }
    return ids;
  }

  private isStarTeam(team: AnyObject, group?: any[]): boolean {
    if (Boolean(team.unofficial)) return true;
    const teamGroups = group ?? this.teamGroupIds(team);
    const starGroups = this.starGroupIds();
    return teamGroups.some((groupId) => starGroups.has(groupId));
  }

  private officialTeamIdSet(): Set<any> {
    const ids = new Set<any>();
    for (const [teamId, team] of this.teamItems()) {
      if (!this.isStarTeam(team)) {
        ids.add(teamId);
      }
    }
    return ids;
  }

  private groupTeamIdSet(groupId: string): Set<any> {
    const ids = new Set<any>();
    for (const [teamId, team] of this.teamItems()) {
      if (this.teamGroupIds(team).includes(groupId)) {
        ids.add(teamId);
      }
    }
    return ids;
  }

  private isOfficialGroupLabel(value: any): boolean {
    const label = String(value).trim().toLowerCase();
    return ['正式', '正式队', '正式队伍', '默认队伍组', 'official'].includes(label);
  }

  private officialGroupCandidates(): string[] {
    if (objectHas(this.group, 'official')) {
      return ['official'];
    }
    return Object.entries(this.group)
      .filter(([, value]) => this.isOfficialGroupLabel(value))
      .map(([key]) => key);
  }

  private specialOfficialGroupIds(): Set<string> {
    const officialTeamIds = this.officialTeamIdSet();
    return new Set(
      this.officialGroupCandidates().filter((groupId) =>
        this.setEquals(this.groupTeamIdSet(groupId), officialTeamIds),
      ),
    );
  }

  private setEquals(left: Set<any>, right: Set<any>): boolean {
    if (left.size !== right.size) return false;
    for (const value of left) {
      if (!right.has(value)) return false;
    }
    return true;
  }

  private hasSpecialOfficialGroup(): boolean {
    return this.specialOfficialGroupIds().size > 0;
  }

  private extractLocalizedName(value: any): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && !Array.isArray(value)) {
      if (objectHas(value, 'name')) {
        return this.extractLocalizedName(value.name);
      }
      if (objectHas(value, 'texts')) {
        const fallbackLang = value.fallback_lang ?? 'zh-CN';
        const texts = value.texts ?? {};
        if (texts !== null && typeof texts === 'object' && !Array.isArray(texts)) {
          if (objectHas(texts, 'zh-CN')) return texts['zh-CN'];
          if (objectHas(texts, fallbackLang)) return texts[fallbackLang];
          const values = Object.values(texts);
          if (values.length > 0) return values[0] as string;
        }
        return '';
      }
      if (objectHas(value, 'fallback')) {
        return value.fallback ?? '';
      }
    }
    return pythonString(value);
  }

  private extractOrgName(value: any): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && !Array.isArray(value)) {
      if (objectHas(value, 'name')) {
        return this.extractOrgName(value.name);
      }
      if (objectHas(value, 'texts')) {
        const fallbackLang = value.fallback_lang ?? 'zh-CN';
        const texts = value.texts ?? {};
        if (texts !== null && typeof texts === 'object' && !Array.isArray(texts)) {
          if (objectHas(texts, 'zh-CN')) return texts['zh-CN'];
          if (objectHas(texts, fallbackLang)) return texts[fallbackLang];
          const values = Object.values(texts);
          if (values.length > 0) return values[0] as string;
        }
        return '';
      }
      if (objectHas(value, 'fallback')) {
        return value.fallback ?? '';
      }
      if (Object.keys(value).length > 0) {
        return pythonString(value);
      }
    }
    return '';
  }

  private resolveTeamOrganization(team: AnyObject): string | null {
    let orgName: string | undefined;
    const organizationId = team.organization_id;
    if (organizationId !== null && organizationId !== undefined && this.orgMap.size > 0) {
      orgName = this.orgMap.get(organizationId) ?? this.orgMap.get(String(organizationId));
    }
    if (!orgName) {
      orgName = this.extractOrgName(team.organization);
    }
    return orgName || null;
  }

  private normalizeColor(value: any): string {
    return String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');
  }

  private usesDefaultBalloonColors(): boolean {
    const balloonColors = this.config.balloon_color;
    if (!Array.isArray(balloonColors)) return false;

    const requiredCount = Math.min(this.numProblems, 13);
    if (balloonColors.length < requiredCount) return false;

    const actualColors = Array.from({ length: requiredCount }, (_, index) =>
      this.normalizeColor(balloonColors[index]?.background_color),
    );

    return SRK_DEFAULT_BALLOON_COLOR_PALETTES.some((palette) => {
      if (palette.length < requiredCount) return false;
      const expectedColors = palette
        .slice(0, requiredCount)
        .map((color) => this.normalizeColor(color));
      return actualColors.every((color, index) => color === expectedColors[index]);
    });
  }

  contest(): AnyObject {
    return makeContest(this.config);
  }

  problems(): AnyObject[] {
    const problems: AnyObject[] = [];
    const usesDefaultBalloonColors = this.usesDefaultBalloonColors();

    for (let i = 0; i < this.problemIdList.length; i++) {
      let style: [string?] | undefined;
      if (this.config.balloon_color !== null && this.config.balloon_color !== undefined) {
        const color = this.config.balloon_color[i];
        style = [color.background_color];
      }
      if (usesDefaultBalloonColors) {
        style = undefined;
      }
      problems.push(makeProblem(this.problemIdList[i], this.statistics[i], style));
    }
    return problems;
  }

  series(markers: AnyObject[]): { rows: AnyObject[]; remarks: boolean } {
    let gold = 0;
    let silver = 0;
    let bronze = 0;
    let ccpcFlag = false;
    let toRemarks = true;
    const medalConfig = this.config.medal;
    const specialOfficialGroupIds = this.specialOfficialGroupIds();
    const officialMedalKeys = [
      'official',
      ...[...specialOfficialGroupIds].filter((groupId) => groupId !== 'official'),
    ];
    const officialMedalKey = officialMedalKeys.find(
      (key) =>
        medalConfig !== null &&
        typeof medalConfig === 'object' &&
        !Array.isArray(medalConfig) &&
        medalConfig[key] !== null &&
        medalConfig[key] !== undefined,
    );

    if (
      officialMedalKey !== undefined &&
      medalConfig !== null &&
      typeof medalConfig === 'object' &&
      !Array.isArray(medalConfig) &&
      medalConfig[officialMedalKey] !== null &&
      medalConfig[officialMedalKey] !== undefined
    ) {
      gold = medalConfig[officialMedalKey].gold;
      silver = medalConfig[officialMedalKey].silver;
      bronze = medalConfig[officialMedalKey].bronze;
      toRemarks = false;
    } else if (typeof medalConfig === 'string') {
      if (medalConfig === 'CCPC' || medalConfig === 'ccpc') {
        gold = 0.1;
        silver = 0.2;
        bronze = 0.3;
        ccpcFlag = true;
        toRemarks = false;
      }
    } else if (
      medalConfig !== null &&
      typeof medalConfig === 'object' &&
      !Array.isArray(medalConfig) &&
      medalConfig.all !== null &&
      medalConfig.all !== undefined
    ) {
      gold = medalConfig.all.gold;
      silver = medalConfig.all.silver;
      bronze = medalConfig.all.bronze;
      toRemarks = false;
    } else {
      gold = 0;
      silver = 0;
      bronze = 0;
    }

    const allRank = {
      title: 'R#',
      rule: {
        preset: 'Normal',
      },
    };

    const icpcRule = ccpcFlag === false
      ? {
          preset: 'ICPC',
          options: {
            count: {
              value: [gold, silver, bronze],
            },
          },
        }
      : {
          preset: 'ICPC',
          options: {
            ratio: {
              value: [gold, silver, bronze],
              denominator: 'scored',
            },
          },
        };

    const anotherSeries: AnyObject[] = [];
    if (
      markers.length > 0 &&
      medalConfig !== null &&
      typeof medalConfig === 'object' &&
      !Array.isArray(medalConfig)
    ) {
      for (const [key, value] of Object.entries(medalConfig)) {
        if (key === 'all' || specialOfficialGroupIds.has(key)) continue;
        if (
          value !== null &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          (value as AnyObject).gold !== null &&
          (value as AnyObject).gold !== undefined &&
          (value as AnyObject).silver !== null &&
          (value as AnyObject).silver !== undefined &&
          (value as AnyObject).bronze !== null &&
          (value as AnyObject).bronze !== undefined
        ) {
          let title: string | null = null;
          for (const marker of markers) {
            if (marker.id === key) {
              title = `${marker.label}#`;
              break;
            }
          }
          if (title === null) continue;
          anotherSeries.push({
            title,
            segments: [
              { title: '金奖', style: STYLE_GOLD },
              { title: '银奖', style: STYLE_SILVER },
              { title: '铜奖', style: STYLE_BRONZE },
            ],
            rule: {
              preset: 'ICPC',
              options: {
                count: {
                  value: [
                    (value as AnyObject).gold,
                    (value as AnyObject).silver,
                    (value as AnyObject).bronze,
                  ],
                },
                filter: {
                  byMarker: key,
                },
              },
            },
          });
          toRemarks = false;
        }
      }
    }

    const officialRank = {
      title: '#',
      segments: [
        { title: '金奖', style: STYLE_GOLD },
        { title: '银奖', style: STYLE_SILVER },
        { title: '铜奖', style: STYLE_BRONZE },
      ],
      rule: icpcRule,
    };
    const schoolRank = {
      title: 'S#',
      rule: {
        preset: 'UniqByUserField',
        options: {
          field: 'organization',
          includeOfficialOnly: true,
        },
      },
    };

    const result = [officialRank, ...anotherSeries, allRank, schoolRank];
    return {
      rows: result,
      remarks: toRemarks,
    };
  }

  markers(): AnyObject[] {
    const allMarkers: AnyObject[] = [];
    const colors = ['blue', 'green', 'yellow', 'orange', 'red', 'purple'];
    let index = 0;
    const femalePattern = /女队|女生|女子/;
    const starPattern = /打星/;
    const specialOfficialGroupIds = this.specialOfficialGroupIds();
    for (const [key, value] of Object.entries(this.group)) {
      if (key === 'unofficial') continue;
      if (specialOfficialGroupIds.has(key)) continue;
      if (starPattern.test(String(value))) continue;
      const keyLower = String(key).toLowerCase();
      const isFemale =
        femalePattern.test(String(value)) ||
        keyLower === 'female' ||
        keyLower === 'girl' ||
        keyLower.includes('female') ||
        keyLower.includes('girl');
      const style = isFemale ? 'pink' : colors[index % colors.length];
      allMarkers.push({
        id: key,
        label: value,
        style,
      });
      if (!isFemale) {
        index += 1;
      }
    }

    const femaleMarkers = allMarkers.filter(
      (marker) =>
        String(marker.id).toLowerCase().includes('female') ||
        String(marker.id).toLowerCase().includes('girl') ||
        femalePattern.test(String(marker.label)),
    );
    const normalMarkers = allMarkers.filter((marker) => !femaleMarkers.includes(marker));
    return [...normalMarkers, ...femaleMarkers];
  }

  rows(markers: AnyObject[]): AnyObject[] {
    const data: Array<{
      user: AnyObject;
      score: [number, number];
      status: XcpcioStatus[];
      last_solved_time: number;
      team_name: any;
    }> = [];

    const teamsItems = this.teamItems();
    const specialOfficialGroupIds = this.specialOfficialGroupIds();

    for (const [k, team] of teamsItems) {
      const userMarkers: AnyObject[] = [];

      const coaches: string[] = [];
      if (team.coach !== null && team.coach !== undefined) {
        const coachName = this.extractLocalizedName(team.coach);
        if (coachName) coaches.push(coachName);
      }
      if (team.coaches !== null && team.coaches !== undefined) {
        for (const coachItem of team.coaches) {
          if (coachItem !== null && String(coachItem).toLowerCase() !== 'null') {
            const coachName = this.extractLocalizedName(coachItem);
            if (coachName) coaches.push(coachName);
          }
        }
      }

      const group = this.teamGroupIds(team);
      const official = !this.isStarTeam(team, group);

      for (const t of group) {
        if (
          t !== null &&
          t !== undefined &&
          !specialOfficialGroupIds.has(t) &&
          t !== 'unofficial' &&
          t !== 'girl'
        ) {
          for (const marker of markers) {
            if (marker.id === t && !userMarkers.includes(marker)) {
              userMarkers.push(marker);
            }
          }
        }
      }
      for (const marker of markers) {
        if (
          objectHas(team, marker.id) &&
          this.isTrueFlag(team[marker.id]) &&
          !userMarkers.includes(marker)
        ) {
          userMarkers.push(marker);
        }
      }

      const originalGirl = this.isTrueFlag(team.girl);
      const groupGirl = group.includes('girl');
      const isGirlTeam = originalGirl || groupGirl;
      const femaleMarkers = markers.filter(
        (marker) =>
          String(marker.id).toLowerCase().includes('female') ||
          String(marker.id).toLowerCase().includes('girl') ||
          String(marker.label).includes('女队'),
      );
      const hasAnyFemaleMarker = femaleMarkers.some((marker) => userMarkers.includes(marker));
      if (isGirlTeam && !hasAnyFemaleMarker) {
        for (const marker of femaleMarkers) {
          if (!userMarkers.includes(marker)) {
            userMarkers.push(marker);
          }
        }
      }

      let teamName = team.name ?? '';
      if (teamName !== null && typeof teamName === 'object' && !Array.isArray(teamName)) {
        if (objectHas(teamName, 'texts')) {
          const fallbackLang = teamName.fallback_lang ?? 'zh-CN';
          const texts = teamName.texts ?? {};
          if (objectHas(texts, 'zh-CN')) {
            teamName = texts['zh-CN'];
          } else if (objectHas(texts, fallbackLang)) {
            teamName = texts[fallbackLang];
          } else if (texts && Object.keys(texts).length > 0) {
            teamName = Object.values(texts)[0];
          } else {
            teamName = '';
          }
        } else if (objectHas(teamName, 'fallback')) {
          teamName = teamName.fallback;
        } else {
          teamName = pythonString(teamName);
        }
      }

      let members: Array<string | AnyObject> | null | undefined;
      if (team.members !== null && team.members !== undefined) {
        const processedMembers: AnyObject[] = [];
        for (const member of team.members) {
          if (member !== null && String(member).toLowerCase() !== 'null') {
            const memberName = this.extractLocalizedName(member);
            if (memberName) {
              const processedMember: AnyObject = { name: memberName };
              if (
                member !== null &&
                typeof member === 'object' &&
                !Array.isArray(member) &&
                member.role !== null &&
                member.role !== undefined
              ) {
                processedMember.role = member.role;
              }
              processedMembers.push(processedMember);
            }
          }
        }
        members = processedMembers;
      }
      if (coaches.length > 0) {
        if (!Array.isArray(members)) {
          members = [];
        }
        for (const coach of coaches) {
          members.push({ name: coach, role: 'coach' });
        }
      }

      const orgName = this.resolveTeamOrganization(team);
      const user = makeUser(
        teamName,
        k,
        orgName,
        members,
        official,
        userMarkers,
        team.location ?? null,
        team.avatar ?? null,
        team.photo ?? null,
      );

      let cnt = 0;
      let ctms = 0;
      let lastSolvedTime = 0;
      const statuses = this.statuses.get(pyMapKey(k)) ?? [];
      const useAccumulateInSeconds = this.options();

      for (const status of statuses) {
        status.duration = Math.floor(status.duration / 1000);
        if (status.result === SR_ACCEPTED || status.result === SR_FIRST_BLOOD) {
          cnt += 1;
          if (useAccumulateInSeconds) {
            ctms += status.duration;
          } else {
            ctms += Math.floor(status.duration / 60) * 60;
          }

          const actualSolveTime =
            status.duration - 20 * 60 * Math.max(status.tries - 1, 0);
          if (actualSolveTime > lastSolvedTime) {
            lastSolvedTime = actualSolveTime;
          }
        }
      }

      const score: [number, number] = [
        cnt,
        useAccumulateInSeconds ? Math.floor(ctms / 60) * 60 : ctms,
      ];
      data.push({
        user,
        score,
        status: statuses,
        last_solved_time: lastSolvedTime,
        team_name: teamName,
      });
    }

    data.sort((a, b) => {
      const aKey = [-a.score[0], a.score[1], Math.floor(a.last_solved_time / 60)];
      const bKey = [-b.score[0], b.score[1], Math.floor(b.last_solved_time / 60)];
      for (let i = 0; i < aKey.length; i++) {
        if (aKey[i] !== bKey[i]) return aKey[i] - bKey[i];
      }
      const aName = pythonString(a.team_name);
      const bName = pythonString(b.team_name);
      if (aName < bName) return -1;
      if (aName > bName) return 1;
      return 0;
    });

    return data.map((item) => makeRow(item.user, item.score, item.status, this.numProblems));
  }

  options(): boolean {
    return (
      this.config.options !== null &&
      typeof this.config.options === 'object' &&
      !Array.isArray(this.config.options) &&
      this.config.options.calculation_of_penalty ===
        'accumulate_in_seconds_and_finally_to_the_minute'
    );
  }

  private calculate(): void {
    const firstBlood = this.problemIdList.map((): number | null => null);

    for (const run of this.runs) {
      const rawProblemId = run.problem_id;
      const problemIdx = this.problemIdMap.get(rawProblemId);

      if (problemIdx === undefined) {
        const url = contestUrl.get(this.config.contest_name);
        const item = unknownContest.get(url ?? '') ?? {
          name: this.config.contest_name,
          status: new Set<string>(),
          count: 0,
        };
        item.status.add(`unknown_problem_id:${rawProblemId}`);
        item.count += 1;
        unknownContest.set(url ?? '', item);
        continue;
      }

      const teamKey = pyMapKey(run.team_id);
      if (!this.statuses.has(teamKey)) {
        this.statuses.set(
          teamKey,
          this.problemIdList.map(() => new XcpcioStatus()),
        );
      }
      const status = this.statuses.get(teamKey)![problemIdx];

      let result = SR_RESULTS[String(run.status).toUpperCase()];
      if (result === undefined) {
        addUnknown(this.config.contest_name, run.status);
        continue;
      }

      if (status.result === SR_ACCEPTED || status.result === SR_FIRST_BLOOD) {
        continue;
      }

      const tt = XcpcioParser.timeUnit === 's' ? run.timestamp * 1000 : run.timestamp;
      if (result === SR_ACCEPTED) {
        if (firstBlood[problemIdx] === null || firstBlood[problemIdx] === tt) {
          result = SR_FIRST_BLOOD;
          firstBlood[problemIdx] = tt;
        }
      }

      status.result = result;
      if (status.solutions === undefined) {
        status.solutions = [];
      }
      status.solutions.push({
        result,
        time: [run.timestamp, XcpcioParser.timeUnit],
      });

      if (
        ![SR_FIRST_BLOOD, SR_ACCEPTED, SR_REJECTED, SR_FROZEN].includes(result)
      ) {
        status.result = SR_REJECTED;
      }

      if (result === SR_FIRST_BLOOD || result === SR_ACCEPTED) {
        status.duration = 20 * 60 * 1000 * status.tries + tt;
      }

      if (![SR_COMPILATION_ERROR, SR_PRESENTATION_ERROR, SR_UNKNOWN_ERROR].includes(result)) {
        status.tries += 1;
      }

      this.statuses.get(teamKey)![problemIdx] = status;

      if (result === SR_ACCEPTED || result === SR_FIRST_BLOOD) {
        this.statistics[problemIdx][0] += 1;
      }
      this.statistics[problemIdx][1] += 1;
    }
  }
}

async function loadAndBuildRank(
  contestPath: string,
  options: Required<Pick<XcpcioGenerateOptions, 'downloadBanner'>> & {
    resolvedOutputPath?: string;
    assetBaseDir?: string;
  },
): Promise<XcpcioBuildResult> {
  const warnings: string[] = [];
  const contestUrlValue = `${XCPCIO_BASE_URL}${contestPath}`;
  let contestName: string | null = null;

  const config = await getJson<AnyObject>(`${XCPCIO_DATA_BASE_URL}${contestPath}/config.json`);
  const teams = await getJson<AnyObject | AnyObject[]>(`${XCPCIO_DATA_BASE_URL}${contestPath}/team.json`);
  const runs = await getJson<AnyObject[]>(`${XCPCIO_DATA_BASE_URL}${contestPath}/run.json`);
  const org = await getJson<AnyObject[]>(`${XCPCIO_DATA_BASE_URL}${contestPath}/organizations.json`);

  if (config === undefined) {
    throw new XcpcioBuildError(`${contestPath} 获取 config.json 失败`, warnings, contestName);
  }
  contestName = config.contest_name ?? null;
  if (teams === undefined) {
    throw new XcpcioBuildError(`${contestPath} 获取 team.json 失败`, warnings, contestName);
  }
  if (runs === undefined) {
    throw new XcpcioBuildError(`${contestPath} 获取 run.json 失败`, warnings, contestName);
  }
  if (org === undefined) {
    warnings.push(`${contestPath} 获取 organizations.json 失败，将不写入 organization_id 映射`);
  }

  if (options.resolvedOutputPath && options.assetBaseDir) {
    const contestId = path.basename(options.resolvedOutputPath).replace(/\.srk\.json$/, '');
    await prepareAssets(
      contestPath,
      config,
      teams,
      contestId,
      options.assetBaseDir,
      options.downloadBanner,
      warnings,
    );
  }

  setContestUrl(contestPath, config);
  runs.sort((a, b) => a.timestamp - b.timestamp);
  if (runs.length === 0) {
    throw new XcpcioBuildError(`${contestPath} 获取提交记录为空`, warnings, contestName);
  }

  XcpcioParser.timeUnit = inferRunTimeUnit(config, runs);
  if (XcpcioParser.timeUnit === 's') {
    warnings.push(`检测到 run.timestamp 为秒级时间戳，按秒级处理`);
  }

  let srkObject: AnyObject;
  try {
    const parser = new XcpcioParser(config, teams, runs, org);
    const contest = parser.contest();
    const problems = parser.problems();
    const markers = parser.markers();
    const series = parser.series(markers);
    const rows = parser.rows(markers);
    const useAccumulateInSeconds = parser.options();
    const onlineContest = isOnlineContest(contestPath, config);
    srkObject = buildRank(
      contest,
      problems,
      series.rows,
      rows,
      markers,
      ['XCPCIO (https://xcpcio.com)', 'algoUX (https://algoux.org)'],
      useAccumulateInSeconds ? 's' : 'min',
      series.remarks && !onlineContest,
    );
    if (onlineContest) {
      normalizeOnlineFirstBlood(srkObject);
    }
  } catch (e) {
    if (e instanceof XcpcioBuildError) throw e;
    throw new XcpcioBuildError((e as Error).message, warnings, contestName);
  }

  return {
    srkObject,
    contestName,
    contestUrl: contestUrlValue,
    warnings,
    unknownStatuses: formatUnknownStatuses(contestUrlValue),
  };
}

export async function run(contestPath: string): Promise<AnyObject> {
  const normalizedContestPath = normalizeContestPath(contestPath);
  return (await loadAndBuildRank(normalizedContestPath, { downloadBanner: false })).srkObject;
}

export async function generateRank(
  contestPath: string,
  outputPath: string,
  options: XcpcioGenerateOptions = {},
): Promise<XcpcioGenerateResult> {
  const warnings: string[] = [];
  let normalizedContestPath = contestPath;
  let contestUrlValue = `${XCPCIO_BASE_URL}${contestPath}`;
  let resolvedOutputPath: string | null = null;
  let contestName: string | null = null;

  try {
    normalizedContestPath = normalizeContestPath(contestPath);
    contestUrlValue = `${XCPCIO_BASE_URL}${normalizedContestPath}`;
    resolvedOutputPath = resolveOutputPath(outputPath, options.cwd);
    console.log(normalizedContestPath, resolvedOutputPath);

    const built = await loadAndBuildRank(normalizedContestPath, {
      downloadBanner: options.downloadBanner ?? true,
      resolvedOutputPath,
      assetBaseDir: path.resolve(options.cwd ?? process.cwd(), 'assets'),
    });
    contestName = built.contestName;
    warnings.push(...built.warnings);

    const outputDir = path.dirname(resolvedOutputPath);
    if (outputDir) {
      await fs.ensureDir(outputDir);
    }
    await fs.writeFile(resolvedOutputPath, stringifyLikePythonJson(built.srkObject), 'utf-8');

    return makeResult(
      true,
      resolvedOutputPath,
      contestName,
      contestUrlValue,
      built.unknownStatuses,
      warnings,
    );
  } catch (e) {
    if (e instanceof XcpcioBuildError) {
      warnings.push(...e.warnings);
      contestName = e.contestName;
    }
    return makeResult(
      false,
      resolvedOutputPath,
      contestName,
      contestUrlValue,
      formatUnknownStatuses(contestUrlValue),
      warnings,
      (e as Error).message,
    );
  }
}

export async function callRank(contestPath: string, outputPath: string): Promise<XcpcioGenerateResult> {
  const result = await generateRank(contestPath, outputPath);
  if (!result.ok) {
    console.log(result.error);
  }
  return result;
}
