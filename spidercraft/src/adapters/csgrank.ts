import Axios from 'axios';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import * as srk from '@algoux/standard-ranklist';
import { numberToAlphabet } from '@algoux/standard-ranklist-utils';
import { UniversalSrkGenerator } from '../generators/universal';

const req = Axios.create({
  baseURL: 'https://cpc.csgrandeur.cn/rank',
  timeout: 30000,
  headers: {
    'User-Agent': 'algoUXRankSpiderCraft/1.0',
  },
});

async function fetchCSGRankData(cid: string) {
  const [contestRes, problemRes, teamRes, solutionRes] = await Promise.all([
    req.get<CSGRankContest>(`/contests/${cid}/contest.json`),
    req.get<CSGRankProblem[]>(`/contests/${cid}/problem.json`),
    req.get<CSGRankTeam[]>(`/contests/${cid}/team.json`),
    req.get<ICSGRankSolution[]>(`/contests/${cid}/solution.json`),
  ]);
  return {
    contest: contestRes.data,
    problem: problemRes.data,
    team: teamRes.data,
    solution: solutionRes.data.filter(filterCSGSolutionResult),
  };
}

const SOURCE_TZ = 'Asia/Shanghai';
dayjs.extend(utc);
dayjs.extend(timezone);

function getDateFromStr(dateString: string): dayjs.Dayjs {
  return dayjs.tz(dateString, SOURCE_TZ);
}

export interface CSGRankContest {
  contest_id: number;
  title: string;
  start_time: string;
  end_time: string;
  /** 获奖比例，从低到高每三位代表一个段的比例配置。格式如：30020010 */
  award_ratio: number;
  /** 封榜时长（分钟） */
  frozen_minute: number;
  /** 从第多少分钟开始封榜，似乎赛时会设为封榜开始的分钟数，赛后改为等于比赛时长的分钟数来解封 */
  frozen_after: number;
}

export interface CSGRankProblem {
  problem_id: number;
  contest_id: number;
  title: string;
  num: number;
  pscore: number;
}

export interface CSGRankTeam {
  team_id: string;
  contest_id: number;
  defunct: 'Y' | 'N';
  name: string;
  /** 可能是顿号隔开的字符串 */
  tmember: string;
  /** 0: 常规队伍；1：女队；2：打星队 */
  tkind: number;
  coach: string;
  school: string;
  room: string;
  team_global_code: string;
}

export interface ICSGRankSolution {
  solution_id: number;
  problem_id: number;
  /** 通常格式为 `#cpc${contest_id}_${team_id}` */
  user_id: string;
  in_date: string;
  result: number;
  contest_id: number;
}

function filterCSGSolutionResult(solution: ICSGRankSolution): boolean {
  return solution.result !== 11;
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
      return 'RJ'; // 其他未知枚举视为 RJ
  }
}

function splitNamesString(str: string): string[] {
  if (!str) {
    return [];
  }
  return str
    .split(/[,;，、 ]/)
    .map((name) => name.trim())
    .filter(Boolean);
}

export async function run(cid: string) {
  const {
    contest: contestRes,
    problem: problemRes,
    team: teamRes,
    solution: solutionRes,
  } = await fetchCSGRankData(cid);

  const generator = new UniversalSrkGenerator();

  // csgrandeur 的 award_ratio 格式如：30020010
  // 抽象，为什么不好好设计个数据结构？
  const ratioGold = (contestRes.award_ratio % 1000) / 100;
  const ratioSilver = (Math.floor(contestRes.award_ratio / 1000) % 1000) / 100;
  const ratioBronze = Math.floor(contestRes.award_ratio / 1000000) / 100;

  const problemIdToAliasMap = new Map<number, string>();
  problemRes.forEach((problem, index) => {
    const alias = numberToAlphabet(index);
    problemIdToAliasMap.set(problem.problem_id, alias);
  });

  generator.init({
    contest: {
      title: {
        'zh-CN': contestRes.title,
        fallback: contestRes.title,
      },
      startAt: getDateFromStr(contestRes.start_time).format('YYYY-MM-DDTHH:mm:ssZ'),
      duration: [
        getDateFromStr(contestRes.end_time).diff(getDateFromStr(contestRes.start_time), 'minutes'),
        'min',
      ],
      frozenDuration: [contestRes.frozen_minute, 'min'],
      // refLinks: [
      //   {
      //     link: `https://cpc.csgrandeur.cn/rank/rank.html?cid=${encodeURIComponent(cid)}`,
      //     title: '原始榜单',
      //   },
      // ],
    },
    problems: [...problemRes]
      .sort((a, b) => a.num - b.num)
      .map((problem) => ({
        title: problem.title,
        alias: problemIdToAliasMap.get(problem.problem_id),
      })),
    contributors: ['CSGOJ (https://cpc.csgrandeur.cn/rank/)', 'algoUX (https://algoux.org)'],
    useICPCPreset: true,
    icpcPresetOptions: {
      mainRankSeriesRule: {
        ratio: {
          value: [ratioGold, ratioSilver, ratioBronze],
          denominator: 'scored',
        },
      },
      sorterTimePrecision: 's',
      sorterRankingTimePrecision: 'min',
    },
  });

  generator.setMembers(
    teamRes
      .filter((team) => team.name)
      .map((team) => ({
        id: team.team_id,
        name: team.name,
        organization: team.school,
        teamMembers: [
          ...splitNamesString(team.tmember).map((member) => ({
            name: member,
          })),
          ...splitNamesString(team.coach).map((coach) => ({ name: `${coach} (教练)` })),
        ],
        official: team.tkind !== 2,
        marker: team.tkind === 1 ? 'female' : undefined,
      })),
  );

  generator.setSolutions(
    solutionRes.filter(filterCSGSolutionResult).map((solution) => ({
      userId: solution.user_id.replace(/^#cpc\d+?_/, ''),
      problemIndexOrAlias: problemIdToAliasMap.get(solution.problem_id)!,
      result: convertCSGSolutionResult(solution.result),
      time: [
        getDateFromStr(solution.in_date).diff(getDateFromStr(contestRes.start_time), 'seconds'),
        's',
      ],
    })),
  );

  // debug for unknown results detection
  const debugSolutions = solutionRes.filter((s) =>
    [-1, 0, 1, 2, 3, 11, 12, 13, 14, 15].includes(s.result),
  );
  debugSolutions.length > 0 && console.warn('Unknown result solutions:', debugSolutions);

  generator.build({
    calculateFB: true,
    onlyIncludeOfficialForFB: true,
    disableFBIfConflict: false,
  });

  return generator.getSrk();
}
