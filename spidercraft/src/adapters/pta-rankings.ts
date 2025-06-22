import Axios from 'axios';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import PQueue from 'p-queue';
import pRetry from 'p-retry';
import * as srk from '@algoux/standard-ranklist';
import { numberToAlphabet } from '@algoux/standard-ranklist-utils';
import { UniversalSrkGenerator } from '../generators/universal';
import { stat } from 'fs';

const req = Axios.create({
  baseURL: 'https://pintia.cn/api/competitions',
  timeout: 30000,
  headers: {
    'User-Agent': 'algoUXRankSpiderCraft/1.0',
  },
});

dayjs.extend(utc);
dayjs.extend(timezone);

function getDateFromStr(dateString: string): dayjs.Dayjs {
  return dayjs(dateString);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 队伍信息接口
export interface PTATeamInfo {
  memberNames: string[]; // 队伍成员姓名
  teamName: string; // 队伍名称
  schoolName: string; // 学校名称
  groupFids: string[]; // 队伍所属 group 的 ID 列表
  excluded: boolean; // 是否 unofficial
  girlMajor: boolean; // 意义不明，可能值是否主体为女生，暂时没有用
}

// 题目提交详情接口
export interface PTAUserProblemSubmissionSummary {
  score: number; // 意义不明，可能是 PTA 上的所有测试点总得分，暂时没有用
  validSubmitCount: number; // 有效提交数
  submitCountSnapshot: number; // 提交数快照（封榜前提交数）
  acceptTime: number; // AC 时间，单位分钟
}

// 题目信息接口
export interface PTAProblemInfo {
  label: string; // 题目标签，如 'A'
  acceptCount: number; // AC 用户数
  submitCount: number; // 提交总数
  balloonRgb: string; // 气球颜色（如 '#dc2626'）
  firstAcceptTeamFid: string; // FB 队伍的 ID
}

// 排名条目接口
export interface PTARankingEntry {
  rank: number;
  totalScore: number; // 意义不明，ACM 模式下大概都是 0
  penaltyTime: number; // 总的罚时时间，单位分钟
  solvingTime: number; // 包含罚时的计算好的总时间，单位分钟
  solvedCount: number; // 解题数
  schoolRank: number; // 学校排名，打星为 0
  problemSubmissionDetailsByProblemSetProblemId: Record<string, PTAUserProblemSubmissionSummary>;
  competitionId: string; // 竞赛 ID
  teamInfo: PTATeamInfo; // 队伍信息
  teamFid: string; // 队伍 ID
  updateAt: string; // 更新时间
}

// 竞赛基本信息接口
export interface PTACompetitionBasicInfo {
  name: string; // 竞赛名称
  startAt: string; // 开始时间
  endAt: string; // 结束时间
  logo: string; // 竞赛 logo
  sponsors: string[]; // 赞助商
}

// 公开排名数据接口
export interface PTARankingContestPublic {
  xcpcRankings: {
    rankings: PTARankingEntry[];
    problemInfoByProblemSetProblemId: Record<string, PTAProblemInfo>;
  };
  competitionBasicInfo: PTACompetitionBasicInfo;
  hideScoreboard: boolean;
}

export interface PTARankingGroup {
  fid: string;
  id: string;
  name: string;
}

export interface PTARankingGroups {
  groups: PTARankingGroup[];
  total: number;
}

// 提交记录接口
export interface PTASubmission {
  submissionId: string;
  submitAt: string;
  /**
   * PTA 评测结果
   * - `ACCEPTED`: 答案正确
   * - `COMPILE_ERROR`: 编译错误
   * - `FLOAT_POINT_EXCEPTION`: 浮点错误
   * - `INTERNAL_ERROR`: 内部错误
   * - `JUDGING`: 正在评测
   * - `MEMORY_LIMIT_EXCEEDED`: 内存超限
   * - `MULTIPLE_ERROR`: 多种错误
   * - `NEUTRAL`: 运行结束
   * - `NON_ZERO_EXIT_CODE`: 非零返回
   * - `NO_ANSWER`: 未作答
   * - `OUTPUT_LIMIT_EXCEEDED`: 输出超限
   * - `OVERRIDDEN`: 已被覆盖
   * - `PARTIAL_ACCEPTED`: 部分正确
   * - `PRESENTATION_ERROR`: 格式错误
   * - `REJUDGING`: 正在重测
   * - `RUNTIME_ERROR`: 运行时错误
   * - `SAMPLE_ERROR`: 样例错误
   * - `SEGMENTATION_FAULT`: 段错误
   * - `SKIPPED`: 跳过
   * - `TIME_LIMIT_EXCEEDED`: 运行超时
   * - `TOTAL_TIME_LIMIT_EXCEEDED`: 运行总时长超时
   * - `WAITING`: 等待评测
   * - `WRONG_ANSWER`: 答案错误
   * - `CHECKER_ERROR`: 判题程序错误
   * - `INTERACTOR_ERROR`: 交互程序错误
   */
  status: string;
  problemSetProblemId: string; // 题目 ID
}

// 队伍提交数据接口
export interface PTARankingTeamSubmissions {
  total: number;
  submissions: PTASubmission[];
  teamInfo: PTATeamInfo;
}

function convertPTASolutionResult(result: string): srk.SolutionResultFull {
  switch (result) {
    case 'SKIPPED':
      return null;
    case 'JUDGING':
    case 'REJUDGING':
    case 'WAITING':
      return '?';
    case 'ACCEPTED':
      return 'AC';
    case 'WRONG_ANSWER':
    case 'PARTIAL_ACCEPTED':
    case 'SAMPLE_ERROR':
      return 'WA';
    case 'PRESENTATION_ERROR':
      return 'PE';
    case 'TIME_LIMIT_EXCEEDED':
    case 'TOTAL_TIME_LIMIT_EXCEEDED':
      return 'TLE';
    case 'MEMORY_LIMIT_EXCEEDED':
      return 'MLE';
    case 'OUTPUT_LIMIT_EXCEEDED':
      return 'OLE';
    case 'RUNTIME_ERROR':
    case 'SEGMENTATION_FAULT':
    case 'FLOAT_POINT_EXCEPTION':
      return 'RTE';
    case 'NO_ANSWER':
      return 'NOUT';
    case 'MULTIPLE_ERROR':
    case 'NON_ZERO_EXIT_CODE':
      return 'RJ';
    case 'COMPILE_ERROR':
      return 'CE';
    case 'INTERNAL_ERROR':
    case 'CHECKER_ERROR':
    case 'INTERACTOR_ERROR':
    default:
      console.log(`Unknown solution result: ${result}`);
      return 'UKE';
  }
}

async function fetchRankData(cid: string) {
  console.log(`Fetching public ranking for ${cid}`);
  const res = await req.get<PTARankingContestPublic>(
    `/${cid}/xcpc-rankings/public?filter=%7B%22teamExcluded%22%3A%22NOT_FILTER%22%7D`,
  );
  const groupRes = await req.get<PTARankingGroups>(`/${cid}/groups`);
  const publicRanking = res.data;
  const groups = groupRes.data.groups;
  const concurrency = 10;
  const queue = new PQueue({ concurrency });
  const teamFids = publicRanking.xcpcRankings.rankings.map((entry) => entry.teamFid);
  const teamSubmissionsMap = new Map<string, PTARankingTeamSubmissions>();
  console.log(`Fetching submissions of ${teamFids.length} teams. concurrency: ${concurrency}`);
  await queue.addAll(
    teamFids.map(
      (teamFid, index) => () =>
        pRetry(
          async () => {
            console.log(
              `Fetching submissions of team ${teamFid} (${index + 1}/${teamFids.length})`,
            );
            const res = await req.get<PTARankingTeamSubmissions>(
              `/${cid}/xcpc-rankings/public/team-submissions?team_fid=${teamFid}`,
            );
            await sleep(2000);
            teamSubmissionsMap.set(teamFid, res.data);
            return res.data;
          },
          {
            retries: 5,
            factor: 2,
            minTimeout: 4000,
            maxTimeout: 20000,
            async onFailedAttempt(error: any) {
              if (error.isAxiosError && error.response?.status === 429) {
                console.log(`Rate limited, cooling down...`);
                return;
              }
              console.log(`Failed to fetch team submissions for ${teamFid}: ${error.message}`);
              await sleep(5000);
            },
          },
        ),
    ),
  );
  return {
    publicRanking,
    groups,
    teamSubmissionsMap,
  };
}

export async function run(cid: string) {
  const { publicRanking, groups, teamSubmissionsMap } = await fetchRankData(cid);
  const markerPresets = ['purple', 'blue', 'green', 'yellow', 'orange', 'red'];
  let usedMarkerPresetIndex = 0;
  const femaleMarketFid = groups.find((group) => group.name === '女队')?.fid;

  const ptaProblems: (PTAProblemInfo & { id: string })[] = [];
  const problemIdToIndexMap = new Map<string, number>();
  for (const problemId in publicRanking.xcpcRankings.problemInfoByProblemSetProblemId) {
    ptaProblems.push({
      id: problemId,
      ...publicRanking.xcpcRankings.problemInfoByProblemSetProblemId[problemId],
    });
    problemIdToIndexMap.set(problemId, ptaProblems.length - 1);
  }
  ptaProblems.sort((a, b) => a.label.localeCompare(b.label));
  const problems: srk.Problem[] = ptaProblems.map((problem) => ({
    alias: problem.label,
    style: problem.balloonRgb
      ? {
          backgroundColor: problem.balloonRgb,
        }
      : undefined,
    statistics: {
      accepted: problem.acceptCount,
      submitted: problem.submitCount,
    },
  }));
  const markers: srk.Marker[] = [];
  for (const group of groups) {
    if (['正式', '正式队', '正式队伍'].includes(group.name)) {
      continue;
    }
    if (group.name === '女队') {
      markers.push({
        id: 'female',
        label: group.name,
        style: 'pink',
      });
    } else {
      markers.push({
        id: group.fid,
        label: group.name,
        style: markerPresets[usedMarkerPresetIndex++] as srk.MarkerStylePreset,
      });
    }
  }

  const generator = new UniversalSrkGenerator();
  generator.init({
    contest: {
      title: {
        'zh-CN': publicRanking.competitionBasicInfo.name,
        fallback: publicRanking.competitionBasicInfo.name,
      },
      startAt: getDateFromStr(publicRanking.competitionBasicInfo.startAt).format(
        'YYYY-MM-DDTHH:mm:ssZ',
      ),
      duration: [
        getDateFromStr(publicRanking.competitionBasicInfo.endAt).diff(
          getDateFromStr(publicRanking.competitionBasicInfo.startAt),
          'minutes',
        ),
        'min',
      ],
      frozenDuration: [60, 'min'],
      refLinks: [
        {
          link: `https://pintia.cn/rankings/${cid}`,
          title: '原始榜单',
        },
      ],
    },
    problems,
    contributors: ['algoUX (https://algoux.org)'],
    useICPCPreset: true,
    icpcPresetOptions: {
      mainRankSeriesRule: {
        ratio: {
          value: [0, 0, 0],
          denominator: 'scored',
        },
      },
      sorterTimePrecision: 'min',
      sorterRankingTimePrecision: 'min',
    },
    markers,
    remarks: {
      'zh-CN': '这个榜单缺失奖牌数据，如果您有该比赛的原始榜单或获奖名单，欢迎联系我们补充数据。',
      fallback:
        'This ranklist lacks medal data. If you have the original ranklist or the list of winners, please contact us to supplement the data.',
    },
  });
  const rows = publicRanking.xcpcRankings.rankings.map((entry) => {
    const statuses: srk.RankProblemStatus[] = [];
    const submissions = teamSubmissionsMap.get(entry.teamFid)?.submissions;
    for (const ptaProblem of ptaProblems) {
      const submissionSummary = entry.problemSubmissionDetailsByProblemSetProblemId[ptaProblem.id];
      if (!submissionSummary || submissionSummary.validSubmitCount === 0) {
        statuses.push({
          result: null,
        });
        continue;
      }

      let thisProblemSubmissions = [...(submissions ?? [])]
        .filter((submission) => submission.problemSetProblemId === ptaProblem.id)
        .reverse();
      let submissionEndIndex = thisProblemSubmissions.findIndex(
        (submission) => submission.status === 'ACCEPTED',
      );
      if (submissionEndIndex < 0) {
        submissionEndIndex = thisProblemSubmissions.length - 1;
      }
      thisProblemSubmissions = thisProblemSubmissions.slice(0, submissionEndIndex + 1);
      const solutions = thisProblemSubmissions
        .map((submission) => ({
          result: convertPTASolutionResult(submission.status),
          time: [
            getDateFromStr(submission.submitAt).diff(
              getDateFromStr(publicRanking.competitionBasicInfo.startAt),
              'seconds',
            ),
            's',
          ],
        }))
        .filter((solution) => solution.result !== null) as srk.Solution[];

      let lastValidSubmissionIndex = solutions.length - 1;
      while (
        lastValidSubmissionIndex >= 0 &&
        ['CE', 'UKE'].includes(solutions[lastValidSubmissionIndex].result)
      ) {
        lastValidSubmissionIndex--;
      }
      if (lastValidSubmissionIndex < 0) {
        statuses.push({
          result: null,
        });
        continue;
      }
      const result = solutions[lastValidSubmissionIndex].result;
      // check
      if (result === 'AC') {
        const accurateTimeMin = Math.floor(solutions[lastValidSubmissionIndex].time[0] / 60);
        if (accurateTimeMin !== submissionSummary.acceptTime) {
          console.warn(
            `Accurate time (in minutes) is not equal to submission summary accept time for team ${entry.teamFid} and problem ${ptaProblem.id}`,
          );
        }
      }
      statuses.push({
        result:
          result === 'AC'
            ? publicRanking.xcpcRankings.problemInfoByProblemSetProblemId[ptaProblem.id]
                .firstAcceptTeamFid === entry.teamFid
              ? 'FB'
              : 'AC'
            : result === '?'
            ? '?'
            : 'RJ',
        tries: lastValidSubmissionIndex + 1,
        time: result === 'AC' ? solutions[lastValidSubmissionIndex].time : undefined,
        solutions,
      });
    }

    const markers = entry.teamInfo.groupFids
      .map((fid) =>
        fid === femaleMarketFid ? 'female' : groups.find((group) => group.fid === fid)?.fid,
      )
      .filter(Boolean) as string[];
    const row: srk.RanklistRow = {
      user: {
        id: entry.teamFid,
        name: entry.teamInfo.teamName,
        organization: entry.teamInfo.schoolName,
        teamMembers: entry.teamInfo.memberNames.map((name) => ({
          name,
        })),
        markers: markers.length > 0 ? markers : undefined,
      },
      score: {
        value: entry.solvedCount,
        time: [entry.solvingTime, 'min'],
      },
      statuses,
    };
    return row;
  });
  generator.setRows(rows);
  generator.build({
    calculateFB: false,
  });
  return generator.getSrk();
}
