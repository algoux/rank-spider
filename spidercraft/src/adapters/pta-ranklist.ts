import Axios from 'axios';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import cheerio from 'cheerio';
import * as srk from '@algoux/standard-ranklist';
import { SrkGeneratorSolution, UniversalSrkGenerator } from '../generators/universal';
import { numberToAlphabet } from '@algoux/standard-ranklist-utils';

// 用于爬取传统 PTA 榜单（如 https://ccpc.pintia.cn/ 下的榜单）

const req = Axios.create({
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

type PTARun = [
  /** 提交者 ID（已预先转为 string） */ string,
  /** 字母题号 */ string,
  /** 相对提交时间（毫秒） */ number,
  /** 提交结果 */ 'AC' | 'NO',
];

interface PTATeam {
  /** 顿号分隔的成员字符串 */
  members: string;
  /** 学校名称 */
  school: string;
  /** 队伍名称 */
  team: string;
  /** 分组 ID */
  type?: string;
}

async function fetchRankData(url: string) {
  const res = await req.get(url);
  const finalUrl = res.request.res.responseUrl;
  const $ = cheerio.load(res.data);
  const title = $('title').text();
  const contestDurationSec = parseInt($('#time_elapsed').attr('sec') || '0');

  const types = $('#mask a')
    .filter((i, el) => {
      const href = $(el).attr('href');
      return !!(href && href.includes('filter') && !href.includes('concerned'));
    })
    .map((i, el) => {
      const href = $(el).attr('href');
      return {
        id: href?.split('?filter=')[1],
        label: $(el).children('img').attr('alt') || '',
      };
    })
    .get();
  const markerPresetList = ['blue', 'green', 'yellow', 'orange', 'red', 'purple'];
  let marketPresetUsingIndex = 0;
  const typeToMarkerIdMap = new Map<string, string>();
  const markers: srk.Marker[] = types
    .map((t) => {
      if (t.label === '女队') {
        typeToMarkerIdMap.set(t.id, 'female');
        return {
          id: 'female',
          label: t.label,
          style: 'pink',
        };
      }
      if (t.id === 'unofficial' || t.label === '正式队') {
        return;
      }
      typeToMarkerIdMap.set(t.id, t.id);
      return {
        id: t.id,
        label: t.label,
        style: markerPresetList[marketPresetUsingIndex++],
      };
    })
    .filter(Boolean) as srk.Marker[];

  const problemsNum = parseInt((res.data as string).match(/var problemNum = (\d+)/)?.[1] || '0');
  const problems = Array.from({ length: problemsNum }, (_, i) => ({
    alias: numberToAlphabet(i),
  }));

  const urlPath = finalUrl.split('/').slice(0, -1).join('/') + '/';
  const runsUrl = urlPath + 'js/runs.js';
  const teamsUrl = urlPath + 'js/teams.js';
  const runRes = await req.get(runsUrl);
  const teamsRes = await req.get(teamsUrl);
  const runsLines = (runRes.data as string)
    .trim()
    .replace(/^var runs = \[/, '')
    .replace(/\];$/, '')
    .trim()
    .replace(/,$/, '')
    .replace(/\'/g, '"')
    .split('\n')
    .map((line) => line.trim());
  const runs = '[' + runsLines.map((line) => line.replace(/^\[(\d+),/, '["$1",')).join('\n') + ']';

  const teams =
    '{' +
    teamsRes.data
      .trim()
      .replace(/^var teams = {/, '')
      .replace(/};$/, '')
      .trim()
      // 去除 ",\n{space}}," 这样 case 中的第一行行尾逗号，其中 {space} 为任意数量的空格
      .replace(/,\n\s*},/g, '},')
      .replace(/,$/, '')
      .replace(/\'/g, '"') +
    '}';
  const runsData = JSON.parse(runs) as PTARun[];
  const teamsData = JSON.parse(teams) as Record<string, PTATeam>;

  const members = Object.keys(teamsData).map((teamId) => {
    const team = teamsData[teamId];
    const types = team.type?.split(' ') || [];
    const userMarkers = types
      .map((type) => typeToMarkerIdMap.get(type))
      .filter(Boolean) as string[];
    return {
      id: teamId,
      name: team.team,
      organization: team.school,
      teamMembers: team.members.split('、').map((member) => ({
        name: member,
      })),
      markers: userMarkers || undefined,
      official: !types.includes('unofficial'),
    };
  });

  const solutions: SrkGeneratorSolution[] = runsData.map((run) => {
    const [userId, problem, time, result] = run;
    return {
      userId,
      problemIndexOrAlias: problems.findIndex((p) => p.alias === problem),
      result: result === 'AC' ? 'AC' : result === 'NO' ? 'RJ' : '?',
      time: [Math.floor(time / 1000), 's'],
    };
  });

  return {
    title,
    contestDurationSec,
    problems,
    markers,
    members,
    solutions,
  };
}

export async function run(url: string) {
  const { title, contestDurationSec, problems, markers, members, solutions } = await fetchRankData(
    url,
  );

  const generator = new UniversalSrkGenerator();
  generator.init({
    contest: {
      title: {
        'zh-CN': title,
        fallback: title,
      },
      startAt: '2000-01-01T00:00:00+08:00',
      duration: [contestDurationSec, 's'],
      frozenDuration: [0, 's'],
      refLinks: [
        {
          link: url,
          title: '原始榜单',
        },
      ],
    },
    problems,
    contributors: ['algoUX (https://algoux.org)'],
    useICPCPreset: true,
    icpcPresetOptions: {
      sorterNoPenaltyResults: ['FB', 'AC', '?', 'CE', 'UKE', null],
      mainRankSeriesRule: {
        count: {
          value: [0, 0, 0],
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
  generator.setMembers(members);
  generator.setSolutions(solutions);

  generator.build({
    calculateFB: true,
    disableFBIfConflict: false,
    useSolutionAbsoluteOrderForFB: true,
  });
  return generator.getSrk();
}
