import path from 'path';
import crypto from 'crypto';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import * as srk from '@algoux/standard-ranklist';
import { numberToAlphabet } from '@algoux/standard-ranklist-utils';
import cheerio from 'cheerio';
import { UniversalSrkGenerator } from '../generators/universal';

dayjs.extend(utc);
dayjs.extend(timezone);

const DEFAULT_SOURCE_TZ = 'Asia/Shanghai';
const USER_AGENT = 'algoUXRankSpiderCraft/1.0 csgrank-outrank';
const GROUP_MARKER_STYLE_PRESETS: srk.MarkerStylePreset[] = [
  'blue',
  'green',
  'yellow',
  'orange',
  'red',
  'purple',
];
const EXTRA_GROUP_MARKER_COLORS = [
  'rgb(20, 184, 166)',
  'rgb(14, 165, 233)',
  'rgb(132, 204, 22)',
  'rgb(236, 72, 153)',
  'rgb(100, 116, 139)',
  'rgb(217, 119, 6)',
];

export interface CSGRankOutrankAsset {
  kind: 'contest-banner' | 'user-avatar';
  source: string;
  dataUrl?: string;
  contentType?: string;
  suggestedFilename: string;
  organization?: string;
  userId?: string;
}

export interface CSGRankOutrankRunOptions {
  assetHandler?: (
    asset: CSGRankOutrankAsset,
  ) => string | undefined | Promise<string | undefined>;
}

interface CSGRankOutrankContest {
  contest_id: number;
  title: string;
  start_time: string;
  end_time: string;
  award_ratio?: number;
  flg_award_qty_mode?: number | string;
  frozen_minute?: number;
  frozen_after?: number;
  contest_group?: CSGRankOutrankContestGroup[];
}

interface CSGRankOutrankProblem {
  problem_id: number;
  title: string;
  num: number;
  color?: string;
  pscore?: number;
}

interface CSGRankOutrankTeam {
  contest_id: number;
  team_id: string;
  name: string;
  name_en?: string;
  coach?: string;
  tmember?: string;
  school?: string;
  region?: string;
  tkind: number;
  room?: string;
  privilege?: string;
  team_global_code?: string;
  group_ids?: string[];
  group_ids_explicit?: boolean;
}

interface CSGRankOutrankSolution {
  solution_id: number;
  contest_id: number;
  problem_id: number;
  team_id: string;
  result: number;
  in_date: string;
}

interface CSGRankOutrankContestGroup {
  group_id?: string | number;
  group_name?: string;
  group_name_en?: string;
  group_order?: string | number;
  award_ratio_gold?: number | string;
  award_ratio_silver?: number | string;
  award_ratio_bronze?: number | string;
  flg_award_qty_mode?: number | string;
}

interface CSGRankOutrankData {
  contest: CSGRankOutrankContest;
  contest_group?: CSGRankOutrankContestGroup[];
  problem: CSGRankOutrankProblem[];
  team: CSGRankOutrankTeam[];
  solution: CSGRankOutrankSolution[];
  time_context?: {
    wall_clock_timezone?: string;
  };
}

interface SourceContext {
  rankJsonUrl: string;
  schoolBadgeBaseUrl: string;
  originalRanklistUrl?: string;
  bannerUrl?: string;
  bannerSuggestedFilename?: string;
}

interface FetchedImage {
  dataUrl: string;
  contentType: string;
  extension: string;
}

function isHttpUrl(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

function stripQueryAndHash(source: string): string {
  return source.split(/[?#]/)[0];
}

function isRankJsonUrl(source: string): boolean {
  if (!isHttpUrl(source)) return false;
  try {
    return new URL(source).pathname.endsWith('.json');
  } catch {
    return false;
  }
}

function filenameFromUrl(source: string, fallback: string): string {
  try {
    const url = new URL(source);
    return path.basename(url.pathname) || fallback;
  } catch {
    return path.basename(stripQueryAndHash(source)) || fallback;
  }
}

function extensionFromContentType(contentType: string | undefined, fallbackSource?: string): string {
  const normalized = (contentType ?? '').split(';')[0].trim().toLowerCase();
  if (normalized === 'image/jpeg') return 'jpg';
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/gif') return 'gif';
  if (normalized === 'image/svg+xml') return 'svg';

  if (fallbackSource) {
    const ext = path.extname(filenameFromUrl(fallbackSource, '')).replace(/^\./, '');
    if (ext) return ext;
  }
  return 'bin';
}

function sanitizeFilenamePart(value: string): string {
  return value
    .trim()
    .replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function hashString(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 10);
}

function makeUniqueFilename(
  filename: string,
  uniqueKey: string,
  usedFilenameToKey: Map<string, string>,
): string {
  const existingKey = usedFilenameToKey.get(filename);
  if (!existingKey) {
    usedFilenameToKey.set(filename, uniqueKey);
    return filename;
  }
  if (existingKey === uniqueKey) {
    return filename;
  }

  const ext = path.extname(filename);
  const base = filename.slice(0, filename.length - ext.length);
  const uniqueFilename = `${base}-${hashString(uniqueKey)}${ext}`;
  usedFilenameToKey.set(uniqueFilename, uniqueKey);
  return uniqueFilename;
}

function extractRankConfigString(html: string, key: string): string | undefined {
  const escapedKey = key.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const match = html.match(new RegExp(`(?:^|[,{\\s])${escapedKey}\\s*:\\s*(['"])(.*?)\\1`, 's'));
  return match ? match[2] : undefined;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'user-agent': USER_AGENT,
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} while fetching ${url}`);
  }
  return res.text();
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: {
      accept: 'application/json, text/plain, */*',
      'user-agent': USER_AGENT,
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} while fetching ${url}`);
  }
  return res.json();
}

async function fetchImageAsDataUrl(url: string): Promise<FetchedImage | undefined> {
  const res = await fetch(url, {
    headers: {
      accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'user-agent': USER_AGENT,
    },
  });
  if (!res.ok) {
    console.warn(`Failed to fetch avatar asset ${url}: HTTP ${res.status}`);
    return undefined;
  }
  const contentType = (res.headers.get('content-type') ?? 'application/octet-stream')
    .split(';')[0]
    .trim();
  const buffer = Buffer.from(await res.arrayBuffer());
  return {
    dataUrl: `data:${contentType};base64,${buffer.toString('base64')}`,
    contentType,
    extension: extensionFromContentType(contentType, url),
  };
}

async function resolveSourceContext(source: string): Promise<SourceContext> {
  if (isRankJsonUrl(source)) {
    return {
      rankJsonUrl: source,
      schoolBadgeBaseUrl: new URL('/static/image/school_badge', source).href.replace(/\/+$/, ''),
      originalRanklistUrl: source,
    };
  }

  const html = await fetchText(source);
  const apiUrl = extractRankConfigString(html, 'api_url');
  if (!apiUrl) {
    throw new Error('Cannot find window.RANK_CONFIG.api_url in Outrank page HTML');
  }

  const schoolBadgeUrl =
    extractRankConfigString(html, 'school_badge_url') ?? '/static/image/school_badge';
  const $ = cheerio.load(html);
  const bannerSrc = $('img.outrank-sponsor-banner__media[src]').first().attr('src');
  const bannerUrl = bannerSrc ? new URL(bannerSrc, source).href : undefined;

  return {
    rankJsonUrl: new URL(apiUrl, source).href,
    schoolBadgeBaseUrl: new URL(schoolBadgeUrl, source).href.replace(/\/+$/, ''),
    originalRanklistUrl: isHttpUrl(source) ? source : undefined,
    bannerUrl,
    bannerSuggestedFilename: bannerUrl ? filenameFromUrl(bannerUrl, 'contest-banner') : undefined,
  };
}

function normalizeProblem(item: any): CSGRankOutrankProblem {
  if (Array.isArray(item)) {
    return {
      problem_id: item[0],
      title: item[1],
      num: item[2],
      color: item[3] || undefined,
      pscore: item[4] || undefined,
    };
  }
  return item;
}

function normalizeTeam(item: any): CSGRankOutrankTeam {
  if (Array.isArray(item)) {
    return {
      contest_id: item[0],
      team_id: item[1],
      name: item[2],
      name_en: item[3] || undefined,
      coach: item[4] || undefined,
      tmember: item[5] || undefined,
      school: item[6] || undefined,
      region: item[7] || undefined,
      tkind: item[8],
      room: item[9] || undefined,
      privilege: item[10] || undefined,
      team_global_code: item[11] || undefined,
      group_ids: Array.isArray(item[12]) ? item[12].map((groupId) => String(groupId)) : [],
      group_ids_explicit: item[13] === 1 || item[13] === true,
    };
  }
  return item;
}

function normalizeSolution(item: any): CSGRankOutrankSolution {
  if (Array.isArray(item)) {
    return {
      solution_id: item[0],
      contest_id: item[1],
      problem_id: item[2],
      team_id: item[3],
      result: item[4],
      in_date: item[5],
    };
  }
  return item;
}

function normalizeData(raw: any): CSGRankOutrankData {
  const data = raw && raw.data && (raw.data.contest || raw.data.team || raw.data.problem) ? raw.data : raw;
  if (!data?.contest || !Array.isArray(data.problem) || !Array.isArray(data.team)) {
    throw new Error('Invalid Outrank rank data: missing contest, problem, or team');
  }
  return {
    ...data,
    problem: data.problem.map(normalizeProblem),
    team: data.team.map(normalizeTeam),
    solution: Array.isArray(data.solution) ? data.solution.map(normalizeSolution) : [],
  };
}

function getDateFromStr(dateString: string, timezoneName: string): dayjs.Dayjs {
  return dayjs.tz(dateString, timezoneName || DEFAULT_SOURCE_TZ);
}

function splitNamesString(str: string | undefined): string[] {
  if (!str) return [];
  return str
    .split(/[,;，、 ]/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function convertCSGSolutionResult(result: number): Exclude<srk.SolutionResultFull, null> {
  if (result < 4) {
    return '?';
  }
  switch (result) {
    case 4:
      return 'AC';
    case 5:
      return 'PE';
    case 6:
      return 'WA';
    case 7:
      return 'TLE';
    case 8:
      return 'MLE';
    case 9:
      return 'OLE';
    case 10:
      return 'RTE';
    default:
      return 'RJ';
  }
}

function isIncludedSolution(solution: CSGRankOutrankSolution): boolean {
  return solution.result !== 11;
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function solutionTeamIdCandidates(teamId: string): string[] {
  const raw = String(teamId);
  const withoutContestPrefix = raw.replace(/^#cpc\d+?_/, '');
  return dedupeStrings([
    raw,
    withoutContestPrefix,
    withoutContestPrefix.replace(/^teamteam/, 'team'),
  ]);
}

function resolveSolutionUserId(teamId: string, knownUserIds: Set<string>): string | undefined {
  return solutionTeamIdCandidates(teamId).find((candidate) => knownUserIds.has(candidate));
}

function makeUserName(team: CSGRankOutrankTeam): srk.Text {
  if (team.name_en) {
    return {
      'zh-CN': team.name,
      'en-US': team.name_en,
      fallback: team.name,
    };
  }
  return team.name;
}

interface AwardRatioPack {
  gold: number;
  silver: number;
  bronze: number;
  qtyMode: boolean;
}

function parseInteger(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePackedAwardRatio(awardRatio: unknown): Pick<AwardRatioPack, 'gold' | 'silver' | 'bronze'> {
  let ratio = parseInteger(awardRatio, 30020010);
  const gold = ratio % 1000;
  ratio = Math.floor(ratio / 1000);
  const silver = ratio % 1000;
  ratio = Math.floor(ratio / 1000);
  const bronze = ratio % 1000;
  return { gold, silver, bronze };
}

function parseAwardRatioPack(data: CSGRankOutrankData): AwardRatioPack {
  const group = data.contest_group?.[0];
  if (
    group &&
    group.award_ratio_gold !== undefined &&
    group.award_ratio_silver !== undefined &&
    group.award_ratio_bronze !== undefined
  ) {
    return {
      gold: parseInteger(group.award_ratio_gold, 10),
      silver: parseInteger(group.award_ratio_silver, 15),
      bronze: parseInteger(group.award_ratio_bronze, 20),
      qtyMode: parseInteger(group.flg_award_qty_mode, 0) === 1,
    };
  }

  return {
    ...parsePackedAwardRatio(data.contest.award_ratio),
    qtyMode: parseInteger(data.contest.flg_award_qty_mode, 0) === 1,
  };
}

function makeMainRankSeriesRule(
  data: CSGRankOutrankData,
): srk.RankSeriesRulePresetICPC['options'] {
  const award = parseAwardRatioPack(data);
  if (award.qtyMode) {
    return {
      count: {
        value: [award.gold, award.silver, award.bronze],
      },
    };
  }

  return {
    ratio: {
      value: [award.gold / 100, award.silver / 100, award.bronze / 100],
      denominator: 'scored',
    },
  };
}

function getContestGroups(data: CSGRankOutrankData): CSGRankOutrankContestGroup[] {
  const groups = data.contest_group?.length ? data.contest_group : data.contest.contest_group;
  if (!Array.isArray(groups)) return [];

  const seenGroupIds = new Set<string>();
  return groups
    .map((group, index) => ({
      group,
      index,
      id: String(group.group_id ?? ''),
      order: parseInteger(group.group_order, index),
    }))
    .filter(({ id }) => !!id)
    .sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.index - b.index;
    })
    .filter(({ id }) => {
      if (seenGroupIds.has(id)) return false;
      seenGroupIds.add(id);
      return true;
    })
    .map(({ group }) => group);
}

function makeGroupMarkerLabel(group: CSGRankOutrankContestGroup): srk.Text {
  const label = group.group_name || String(group.group_id);
  if (group.group_name_en) {
    return {
      'zh-CN': label,
      'en-US': group.group_name_en,
      fallback: label,
    };
  }
  return label;
}

function markerStyleByIndex(index: number): srk.Marker['style'] {
  const preset = GROUP_MARKER_STYLE_PRESETS[index];
  if (preset) return preset;
  return {
    backgroundColor: EXTRA_GROUP_MARKER_COLORS[
      (index - GROUP_MARKER_STYLE_PRESETS.length) % EXTRA_GROUP_MARKER_COLORS.length
    ],
  };
}

function buildGroupMarkers(data: CSGRankOutrankData): srk.Marker[] {
  return getContestGroups(data).map((group, index) => ({
    id: String(group.group_id),
    label: makeGroupMarkerLabel(group),
    style: markerStyleByIndex(index),
  }));
}

function buildMarkers(data: CSGRankOutrankData): srk.Marker[] {
  return [
    ...buildGroupMarkers(data),
    {
      id: 'female',
      label: '女队',
      style: 'pink',
    },
  ];
}

function buildUserMarkers(team: CSGRankOutrankTeam, groupMarkerIds: string[]): string[] | undefined {
  const teamGroupIds = new Set((team.group_ids ?? []).map(String));
  const markers = groupMarkerIds.filter((groupId) => teamGroupIds.has(groupId));
  if (team.tkind === 1) {
    markers.push('female');
  }
  return markers.length > 0 ? markers : undefined;
}

function applyFirstBloodBySolutionOrder<T extends { problemIndexOrAlias: string; result: srk.SolutionResultFull }>(
  solutions: T[],
): void {
  const seenAcceptedProblems = new Set<string>();
  solutions.forEach((solution) => {
    if (solution.result !== 'AC') return;
    if (seenAcceptedProblems.has(solution.problemIndexOrAlias)) return;
    solution.result = 'FB';
    seenAcceptedProblems.add(solution.problemIndexOrAlias);
  });
}

async function buildAvatarMap(
  teams: CSGRankOutrankTeam[],
  schoolBadgeBaseUrl: string,
  assetHandler: CSGRankOutrankRunOptions['assetHandler'],
): Promise<Map<string, string>> {
  const avatarByOrganization = new Map<string, string>();
  if (!assetHandler) return avatarByOrganization;

  const organizations = Array.from(
    new Set(teams.map((team) => team.school).filter((school): school is string => !!school)),
  ).sort();
  const usedFilenameToKey = new Map<string, string>();

  for (const organization of organizations) {
    const source = `${schoolBadgeBaseUrl}/${encodeURIComponent(organization)}.webp`;
    const image = await fetchImageAsDataUrl(source);
    if (!image) continue;

    const baseName = sanitizeFilenamePart(organization) || 'organization';
    const filename = makeUniqueFilename(
      `logo-${baseName}.${image.extension}`,
      organization,
      usedFilenameToKey,
    );
    const avatarPath = await assetHandler({
      kind: 'user-avatar',
      source,
      dataUrl: image.dataUrl,
      contentType: image.contentType,
      suggestedFilename: filename,
      organization,
    });
    if (avatarPath) {
      avatarByOrganization.set(organization, avatarPath);
    }
  }

  return avatarByOrganization;
}

export async function run(source: string, options: CSGRankOutrankRunOptions = {}) {
  const context = await resolveSourceContext(source);
  const data = normalizeData(await fetchJson(context.rankJsonUrl));
  const timezoneName = data.time_context?.wall_clock_timezone || DEFAULT_SOURCE_TZ;
  const contestStart = getDateFromStr(data.contest.start_time, timezoneName);

  let banner: string | undefined;
  if (context.bannerUrl && options.assetHandler) {
    banner = await options.assetHandler({
      kind: 'contest-banner',
      source: context.bannerUrl,
      suggestedFilename:
        context.bannerSuggestedFilename || filenameFromUrl(context.bannerUrl, 'contest-banner'),
    });
  }

  const avatarByOrganization = await buildAvatarMap(
    data.team,
    context.schoolBadgeBaseUrl,
    options.assetHandler,
  );
  const teams = data.team.filter((team) => team.team_id && team.name);
  const teamIds = new Set(teams.map((team) => team.team_id));
  const markers = buildMarkers(data);
  const groupMarkerIds = markers
    .map((marker) => marker.id)
    .filter((markerId) => markerId !== 'female');

  const sortedProblems = [...data.problem].sort((a, b) => a.num - b.num);
  const problemIdToAliasMap = new Map<number, string>();
  sortedProblems.forEach((problem, index) => {
    problemIdToAliasMap.set(problem.problem_id, numberToAlphabet(index));
  });

  const contest: srk.Contest = {
    title: {
      'zh-CN': data.contest.title,
      fallback: data.contest.title,
    },
    startAt: contestStart.format('YYYY-MM-DDTHH:mm:ssZ'),
    duration: [
      getDateFromStr(data.contest.end_time, timezoneName).diff(contestStart, 'minutes'),
      'min',
    ],
    frozenDuration: [data.contest.frozen_minute ?? 0, 'min'],
  };
  if (banner) {
    contest.banner = banner;
  }
  if (context.originalRanklistUrl) {
    contest.refLinks = [
      {
        title: '原始榜单',
        link: context.originalRanklistUrl,
      },
    ];
  }

  const generator = new UniversalSrkGenerator();
  generator.init({
    contest,
    problems: sortedProblems.map((problem) => {
      const srkProblem: srk.Problem = {
        title: problem.title,
        alias: problemIdToAliasMap.get(problem.problem_id),
      };
      if (problem.color) {
        srkProblem.style = {
          backgroundColor: problem.color,
        };
      }
      return srkProblem;
    }),
    contributors: ['algoUX (https://algoux.org)'],
    markers,
    useICPCPreset: true,
    icpcPresetOptions: {
      mainRankSeriesRule: makeMainRankSeriesRule(data),
      sorterTimePrecision: 's',
      sorterRankingTimePrecision: 'min',
    },
  });

  generator.setMembers(
    teams.map((team) => {
      const user: srk.User = {
        id: team.team_id,
        name: makeUserName(team),
        organization: team.school,
        location: team.room,
        teamMembers: [
          ...splitNamesString(team.tmember).map((member) => ({
            name: member,
          })),
          ...splitNamesString(team.coach).map((coach) => ({ name: coach, role: 'coach' })),
        ],
        official: team.tkind !== 2,
        markers: buildUserMarkers(team, groupMarkerIds),
      };
      if (team.school) {
        const avatar = avatarByOrganization.get(team.school);
        if (avatar) {
          user.avatar = avatar;
        }
      }
      return user;
    }),
  );

  const skippedUnknownTeamIds = new Map<string, number>();
  const skippedUnknownProblemIds = new Map<number, number>();
  const solutions = data.solution
    .filter(isIncludedSolution)
    .flatMap((solution) => {
      const userId = resolveSolutionUserId(solution.team_id, teamIds);
      if (!userId) {
        skippedUnknownTeamIds.set(
          solution.team_id,
          (skippedUnknownTeamIds.get(solution.team_id) ?? 0) + 1,
        );
        return [];
      }

      const problemIndexOrAlias = problemIdToAliasMap.get(solution.problem_id);
      if (!problemIndexOrAlias) {
        skippedUnknownProblemIds.set(
          solution.problem_id,
          (skippedUnknownProblemIds.get(solution.problem_id) ?? 0) + 1,
        );
        return [];
      }

      return [
        {
          userId,
          problemIndexOrAlias,
          result: convertCSGSolutionResult(solution.result),
          time: [
            getDateFromStr(solution.in_date, timezoneName).diff(contestStart, 'seconds'),
            's',
          ] as srk.TimeDuration,
          solutionId: solution.solution_id,
        },
      ];
    })
    .sort((a, b) => {
      if (a.time[0] !== b.time[0]) return a.time[0] - b.time[0];
      return a.solutionId - b.solutionId;
    });

  applyFirstBloodBySolutionOrder(solutions);

  generator.setSolutions(solutions.map(({ solutionId: _solutionId, ...solution }) => solution));

  if (skippedUnknownTeamIds.size > 0) {
    console.warn(
      'Skipped solutions with unknown team ids:',
      Object.fromEntries(skippedUnknownTeamIds),
    );
  }
  if (skippedUnknownProblemIds.size > 0) {
    console.warn(
      'Skipped solutions with unknown problem ids:',
      Object.fromEntries(skippedUnknownProblemIds),
    );
  }

  const ignoredResultCounts = data.solution
    .filter((s) => [-1, 0, 1, 2, 3, 11, 12, 13, 14, 15].includes(s.result))
    .reduce<Record<string, number>>((acc, solution) => {
      const key = String(solution.result);
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
  Object.keys(ignoredResultCounts).length > 0 &&
    console.warn('Ignored solution result counts:', ignoredResultCounts);

  generator.build({
    calculateFB: false,
  });

  return generator.getSrk();
}
