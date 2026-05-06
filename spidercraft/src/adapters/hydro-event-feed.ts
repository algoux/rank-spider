import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import type * as srk from '@algoux/standard-ranklist';
import { SrkGeneratorSolution, UniversalSrkGenerator } from '../generators/universal';

dayjs.extend(utc);
dayjs.extend(timezone);

// Hydro OJ CCS API NDJSON event-feed adapter.
// 适配由 hydro-dev/ccs-api 插件输出的 ICPC CCS Contest API NDJSON event feed。
// 参考：https://github.com/hydro-dev/ccs-api（lib/adapter.ts、lib/types.ts）

const CCS_OBSERVERS_GROUP_ID = 'observers';
const UNRANK_DISPLAY_NAME_PREFIX = '⭐';

interface HydroContest {
  id: string;
  name: string;
  formal_name?: string;
  start_time: string;
  duration: string;
  scoreboard_freeze_duration?: string | null;
  penalty_time?: number;
}

interface HydroState {
  started?: string | null;
  ended?: string | null;
  frozen?: string | null;
  thawed?: string | null;
  finalized?: string | null;
  end_of_updates?: string | null;
}

interface HydroJudgementType {
  id: string;
  name?: string;
  penalty?: boolean;
  solved?: boolean;
}

interface HydroProblem {
  id: string;
  label: string;
  name: string;
  ordinal: number;
  color?: string;
  rgb?: string;
  time_limit?: number;
  test_data_count?: number;
}

interface HydroGroup {
  id: string;
  name?: string;
}

interface HydroOrganization {
  id: string;
  name?: string;
  formal_name?: string;
  logo?: any;
}

interface HydroTeam {
  id: string;
  label?: string;
  name?: string;
  display_name?: string;
  group_ids?: string[];
  organization_id?: string;
  photo?: any;
}

interface HydroSubmission {
  id: string;
  team_id: string;
  problem_id: string;
  language_id?: string;
  contest_time: string;
  time?: string;
}

interface HydroJudgement {
  id: string;
  submission_id: string;
  judgement_type_id: string | null;
  start_contest_time?: string;
  end_contest_time?: string;
  start_time?: string;
  end_time?: string;
}

export interface ParsedEventFeed {
  contest?: HydroContest;
  state?: HydroState;
  judgementTypes: Map<string, HydroJudgementType>;
  problems: Map<string, HydroProblem>;
  groups: Map<string, HydroGroup>;
  organizations: Map<string, HydroOrganization>;
  teams: Map<string, HydroTeam>;
  submissions: Map<string, HydroSubmission>;
  /** submission_id -> 最新的非空 judgement（CCS 增量语义：后写覆盖前写） */
  judgementsBySubmission: Map<string, HydroJudgement>;
}

/**
 * 解析 Hydro CCS event-feed NDJSON 文本，按 (type, id) 维护快照（后写覆盖前写）。
 */
export function parseEventFeed(ndjson: string): ParsedEventFeed {
  const result: ParsedEventFeed = {
    judgementTypes: new Map(),
    problems: new Map(),
    groups: new Map(),
    organizations: new Map(),
    teams: new Map(),
    submissions: new Map(),
    judgementsBySubmission: new Map(),
  };

  const lines = ndjson.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    let evt: { type: string; id?: string; data: any; token?: string };
    try {
      evt = JSON.parse(raw);
    } catch (e) {
      console.warn(`Failed to parse line ${i + 1}: ${(e as Error).message}`);
      continue;
    }
    if (!evt || !evt.type) continue;
    switch (evt.type) {
      case 'contest':
        result.contest = evt.data as HydroContest;
        break;
      case 'state':
        result.state = evt.data as HydroState;
        break;
      case 'judgement-types':
        if (evt.data?.id) result.judgementTypes.set(evt.data.id, evt.data as HydroJudgementType);
        break;
      case 'problems':
        if (evt.data?.id) result.problems.set(evt.data.id, evt.data as HydroProblem);
        break;
      case 'groups':
        if (evt.data?.id) result.groups.set(evt.data.id, evt.data as HydroGroup);
        break;
      case 'organizations':
        if (evt.data?.id) result.organizations.set(evt.data.id, evt.data as HydroOrganization);
        break;
      case 'teams':
        if (evt.data?.id) result.teams.set(evt.data.id, evt.data as HydroTeam);
        break;
      case 'submissions':
        if (evt.data?.id) result.submissions.set(evt.data.id, evt.data as HydroSubmission);
        break;
      case 'judgements': {
        const j = evt.data as HydroJudgement;
        if (!j?.submission_id) break;
        // 同一 submission 的多条 judgement 取后到的（CCS 增量语义），跳过 judgement_type_id 仍为空的中间态
        const existed = result.judgementsBySubmission.get(j.submission_id);
        if (j.judgement_type_id || !existed) {
          result.judgementsBySubmission.set(j.submission_id, j);
        }
        break;
      }
      case 'languages':
      case 'runs':
      default:
        break;
    }
  }

  return result;
}

/** 将 "HH:MM:SS.mmm" 或 "HH:MM:SS" 解析为整数秒（向下取 ms）。 */
function parseDurationToSeconds(text: string | undefined | null): number {
  if (!text) return 0;
  const m = text.match(/^(\d+):(\d+):(\d+)(?:\.(\d+))?$/);
  if (!m) {
    const n = Number(text);
    return Number.isFinite(n) ? Math.floor(n) : 0;
  }
  const [, h, mi, s] = m;
  return parseInt(h, 10) * 3600 + parseInt(mi, 10) * 60 + parseInt(s, 10);
}

/**
 * judgement_type_id → srk.SolutionResultFull 映射（包含可选跳过）。
 * - 已知 hydro short-text 直接映射；
 * - 显式跳过 IGN（取消/忽略）；
 * - null/空 → '?' （pending）；
 * - 未知 → 'UKE' 并 warn。
 */
type MappedResult = Exclude<srk.SolutionResultFull, null> | 'SKIP';

function mapJudgementType(
  id: string | null | undefined,
  knownTypes: Map<string, HydroJudgementType>,
): MappedResult {
  if (!id) return '?';
  switch (id) {
    case 'AC':
      return 'AC';
    case 'WA':
      return 'WA';
    case 'PE':
      return 'PE';
    case 'TLE':
      return 'TLE';
    case 'MLE':
      return 'MLE';
    case 'OLE':
      return 'OLE';
    case 'RE':
      return 'RTE';
    case 'CE':
      return 'CE';
    case 'FE':
      return 'PE';
    case 'SE':
      return 'UKE';
    case 'HK':
      return 'RJ';
    case 'IGN':
      return 'SKIP';
    default: {
      const meta = knownTypes.get(id);
      if (meta?.solved) return 'AC';
      if (meta && meta.penalty === false) return 'UKE';
      console.warn(`Unknown judgement_type_id: ${id}, fallback to UKE`);
      return 'UKE';
    }
  }
}

function cleanupDisplayName(displayName: string | undefined, fallback: string): {
  name: string;
  unrankFromName: boolean;
} {
  let name = (displayName ?? '').trim();
  let unrank = false;
  if (name.startsWith(UNRANK_DISPLAY_NAME_PREFIX)) {
    unrank = true;
    name = name.slice(UNRANK_DISPLAY_NAME_PREFIX.length).trim();
  }
  if (!name || name.toLowerCase() === 'undefined') {
    name = fallback;
  }
  return { name, unrankFromName: unrank };
}

export interface HydroEventFeedRunOptions {
  /** 自定义 user 解析器（可改写 organization、name、markers 等）。 */
  userParser?: (
    rawTeam: HydroTeam,
    organization: string,
    inferredOfficial: boolean,
  ) => srk.User;
  /** 比赛标题覆盖（默认使用 contest.name）。 */
  titleOverride?: srk.Text;
  /** 比赛 refLinks。 */
  refLinks?: srk.LinkWithTitle[];
  /** 备注覆盖（默认带"缺失奖牌数据"提示）。 */
  remarks?: srk.Text;
}

export async function run(ndjson: string, options: HydroEventFeedRunOptions = {}) {
  const parsed = parseEventFeed(ndjson);
  if (!parsed.contest) {
    throw new Error('No contest event found in the event feed.');
  }
  if (parsed.problems.size === 0) {
    throw new Error('No problems found in the event feed.');
  }
  if (parsed.teams.size === 0) {
    throw new Error('No teams found in the event feed.');
  }

  // problems 按 ordinal 排序
  const problemList = Array.from(parsed.problems.values()).sort(
    (a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0),
  );
  const problemIdToAlias = new Map<string, string>();
  const problems: srk.Problem[] = problemList.map((p) => {
    const alias = p.label;
    problemIdToAlias.set(p.id, alias);
    const rgb = (p.rgb || '').trim();
    return {
      alias,
      title: p.name ? { fallback: p.name } : undefined,
      style: rgb
        ? {
            backgroundColor: rgb,
          }
        : undefined,
    };
  });

  // members（rows.user）
  const members: srk.User[] = Array.from(parsed.teams.values()).map((team) => {
    const fallbackName = (team.name || team.label || team.id || '').trim();
    const { name, unrankFromName } = cleanupDisplayName(team.display_name, fallbackName);

    const inObserversGroup = !!team.group_ids?.includes(CCS_OBSERVERS_GROUP_ID);
    const official = !(inObserversGroup || unrankFromName);

    const org = team.organization_id ? parsed.organizations.get(team.organization_id) : undefined;
    const organization = (org?.formal_name || org?.name || '').trim();

    if (options.userParser) {
      return options.userParser(team, organization, official);
    }

    return {
      id: team.id,
      name,
      organization,
      official,
    };
  });

  // solutions：把每个 submission 与其最终 judgement 配对
  const rawSolutions: SrkGeneratorSolution[] = [];
  const submissionList = Array.from(parsed.submissions.values()).sort((a, b) => {
    const ta = parseDurationToSeconds(a.contest_time);
    const tb = parseDurationToSeconds(b.contest_time);
    if (ta !== tb) return ta - tb;
    // 同一秒内按 id 字符串稳定排序，保证可重入
    return a.id.localeCompare(b.id);
  });
  for (const sub of submissionList) {
    const alias = problemIdToAlias.get(sub.problem_id);
    if (!alias) {
      console.warn(`Submission ${sub.id} references unknown problem_id ${sub.problem_id}, skip.`);
      continue;
    }
    if (!parsed.teams.has(sub.team_id)) {
      console.warn(`Submission ${sub.id} references unknown team_id ${sub.team_id}, skip.`);
      continue;
    }
    const judgement = parsed.judgementsBySubmission.get(sub.id);
    const mapped = mapJudgementType(judgement?.judgement_type_id ?? null, parsed.judgementTypes);
    if (mapped === 'SKIP') {
      continue;
    }
    rawSolutions.push({
      userId: sub.team_id,
      problemIndexOrAlias: alias,
      result: mapped,
      time: [parseDurationToSeconds(sub.contest_time), 's'],
    });
  }

  // 比赛时间
  const startAt = parsed.contest.start_time;
  const durationSec = parseDurationToSeconds(parsed.contest.duration);

  // frozenDuration：优先 state.ended - state.frozen，回退到 contest.scoreboard_freeze_duration
  let frozenSec = 0;
  if (parsed.state?.frozen && parsed.state.ended) {
    const diffMs = dayjs(parsed.state.ended).valueOf() - dayjs(parsed.state.frozen).valueOf();
    if (Number.isFinite(diffMs) && diffMs > 0) {
      frozenSec = Math.round(diffMs / 1000);
    }
  }
  if (!frozenSec && parsed.contest.scoreboard_freeze_duration) {
    frozenSec = parseDurationToSeconds(parsed.contest.scoreboard_freeze_duration);
  }

  const penaltyMinutes = typeof parsed.contest.penalty_time === 'number'
    ? parsed.contest.penalty_time
    : 20;

  const sorter: srk.SorterICPC = {
    algorithm: 'ICPC',
    config: {
      noPenaltyResults: ['FB', 'AC', '?', 'NOUT', 'CE', 'UKE', null],
      penalty: [penaltyMinutes, 'min'],
      timePrecision: 'min',
      rankingTimePrecision: 'min',
    },
  };

  const generator = new UniversalSrkGenerator();
  generator.init({
    contest: {
      title:
        options.titleOverride ?? {
          fallback: parsed.contest.name || 'Hydro Contest',
        },
      startAt,
      duration: [durationSec, 's'],
      frozenDuration: [frozenSec, 's'],
      refLinks: options.refLinks,
    },
    problems,
    contributors: ['algoUX (https://algoux.org)'],
    useICPCPreset: true,
    icpcPresetOptions: {
      mainRankSeriesRule: {
        count: {
          value: [0, 0, 0],
        },
      },
    },
    sorter,
    remarks:
      options.remarks ?? {
        'zh-CN':
          '这个榜单缺失奖牌数据，如果您有该比赛的原始榜单或获奖名单，欢迎联系我们补充数据。',
        fallback:
          'This ranklist lacks medal data. If you have the original ranklist or the list of winners, please contact us to supplement the data.',
      },
  });

  generator.setMembers(members);
  generator.setSolutions(rawSolutions);
  generator.build({
    calculateFB: true,
    disableFBIfConflict: true,
  });
  return generator.getSrk();
}
