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

const SRK_DEFAULT_BALLOON_COLORS = [
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

function makeContest(config: AnyObject): AnyObject {
  let startTime = config.start_time;
  let endTime = config.end_time;
  const frozenTime = config.frozen_time ?? 0;
  const link = config.link ?? null;
  const banner = config.banner ?? null;

  if (startTime > 946684800000) {
    startTime = Math.floor(startTime / 1000);
  }
  if (endTime > 946684800000) {
    endTime = Math.floor(endTime / 1000);
  }

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
  let processedBanner: AnyObject | null = null;
  if (banner !== null && typeof banner === 'object' && !Array.isArray(banner)) {
    const originalLink = banner.url;
    if (originalLink) {
      processedBanner = {
        image: originalLink,
        link: originalLink,
      };
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
  if (markers !== undefined) {
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
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext.toLowerCase())) {
      return ext;
    }
  }
  return defaultExt;
}

async function downloadImage(
  url: string,
  savePath: string,
  baseUrl = `${XCPCIO_DATA_BASE_URL}/`,
): Promise<string | null> {
  if (!url) return null;
  const imageUrl = /^https?:\/\//i.test(url) ? url : `${baseUrl}${url}`;
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

async function downloadBanner(bannerData: any, contestId: string, baseDir = 'images'): Promise<string | null> {
  if (!bannerData || typeof bannerData !== 'object' || Array.isArray(bannerData)) {
    return null;
  }

  const url = bannerData.url;
  if (!url) return null;

  const ext = extractExtension(url);
  const savePath = `${baseDir}/${contestId}/assets/banner.${ext}`;
  return downloadImage(url, savePath);
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
    if (!Array.isArray(group)) group = [group];

    let teamMarkers = team.markers ?? [];
    if (teamMarkers === null) teamMarkers = [];
    if (!Array.isArray(teamMarkers)) teamMarkers = [teamMarkers];

    return group.concat(teamMarkers.filter((marker: any) => !group.includes(marker)));
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

  private setEquals(left: Set<any>, right: Set<any>): boolean {
    if (left.size !== right.size) return false;
    for (const value of left) {
      if (!right.has(value)) return false;
    }
    return true;
  }

  private hasSpecialOfficialGroup(): boolean {
    return (
      objectHas(this.group, 'official') &&
      this.setEquals(this.groupTeamIdSet('official'), this.officialTeamIdSet())
    );
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

  contest(): AnyObject {
    return makeContest(this.config);
  }

  problems(): AnyObject[] {
    const problems: AnyObject[] = [];
    let f = 1;
    for (let i = 0; i < this.problemIdList.length; i++) {
      if (this.config.balloon_color !== null && this.config.balloon_color !== undefined) {
        const color = this.config.balloon_color[i];
        if (i <= 12 && color.background_color !== SRK_DEFAULT_BALLOON_COLORS[i]) {
          f = 0;
          break;
        }
      }
    }

    for (let i = 0; i < this.problemIdList.length; i++) {
      let style: [string?] | undefined;
      if (this.config.balloon_color !== null && this.config.balloon_color !== undefined) {
        const color = this.config.balloon_color[i];
        style = [color.background_color];
      }
      if (f === 1) {
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
    const specialOfficialGroup = this.hasSpecialOfficialGroup();

    if (
      specialOfficialGroup &&
      medalConfig !== null &&
      typeof medalConfig === 'object' &&
      !Array.isArray(medalConfig) &&
      medalConfig.official !== null &&
      medalConfig.official !== undefined
    ) {
      gold = medalConfig.official.gold;
      silver = medalConfig.official.silver;
      bronze = medalConfig.official.bronze;
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
        if (key === 'all' || (key === 'official' && specialOfficialGroup)) continue;
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
    const specialOfficialGroup = this.hasSpecialOfficialGroup();
    for (const [key, value] of Object.entries(this.group)) {
      if (key === 'unofficial') continue;
      if (key === 'official' && specialOfficialGroup) continue;
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
    const specialOfficialGroup = this.hasSpecialOfficialGroup();

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
          !(t === 'official' && specialOfficialGroup) &&
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
        if (objectHas(team, marker.id) && !userMarkers.includes(marker)) {
          userMarkers.push(marker);
        }
      }

      const originalGirl = team.girl === 1;
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

      let xPhoto: string | null = null;
      const missingPhoto = team.missing_photo ?? false;
      if (!missingPhoto) {
        const teamPhotoTemplate = this.config.options?.team_photo_url_template ?? {};
        if (teamPhotoTemplate && objectHas(teamPhotoTemplate, 'url')) {
          const templateUrl = teamPhotoTemplate.url;
          let extension: string;
          if (String(templateUrl).includes('.')) {
            extension = `.${String(templateUrl).split('.').pop()}`;
          } else {
            extension = '.jpg';
          }
          xPhoto = `${k}${extension}`;
        } else {
          xPhoto = `${k}.jpg`;
        }
      }
      if (xPhoto !== null) {
        user.x_photo = xPhoto;
      }

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

          const actualSolveTime = status.duration - 20 * 60 * status.tries;
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
    const firstBlood = this.problemIdList.map(() => 0);

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
        if (firstBlood[problemIdx] === 0 || firstBlood[problemIdx] === tt) {
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

async function loadAndBuildRank(contestPath: string, options: Required<Pick<XcpcioGenerateOptions, 'downloadBanner'>> & { resolvedOutputPath?: string }): Promise<XcpcioBuildResult> {
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

  if (options.downloadBanner) {
    const banner = config.banner ?? null;
    if (banner !== null && options.resolvedOutputPath) {
      const contestId = path.basename(options.resolvedOutputPath).replace('.srk.json', '');
      const bannerPath = await downloadBanner(banner, contestId);
      if (bannerPath === null) {
        warnings.push(`${contestPath} 下载 banner 失败`);
      }
    }
  }

  setContestUrl(contestPath, config);
  runs.sort((a, b) => a.timestamp - b.timestamp);
  if (runs.length === 0) {
    throw new XcpcioBuildError(`${contestPath} 获取提交记录为空`, warnings, contestName);
  }

  XcpcioParser.timeUnit = 'ms';
  if (runs[0].timestamp / 1000 < 1) {
    warnings.push(`获取 runs 失败, ${runs[0].timestamp}，按秒级时间戳处理`);
    XcpcioParser.timeUnit = 's';
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
    srkObject = buildRank(
      contest,
      problems,
      series.rows,
      rows,
      markers,
      ['XCPCIO (https://xcpcio.com)', 'algoUX (https://algoux.org)'],
      useAccumulateInSeconds ? 's' : 'min',
      series.remarks,
    );
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
