import * as srk from '@algoux/standard-ranklist';
import cheerio from 'cheerio';
import { numberToAlphabet } from '@algoux/standard-ranklist-utils';
import { UniversalSrkGenerator } from '../generators/universal';

export async function run(
  html: string,
  userParser?: (
    id: string,
    name: srk.Text,
    organization: string,
    categories: string[],
    location?: string,
    photoUrl?: string,
  ) => srk.User,
) {
  const $ = cheerio.load(html);
  const contestTitle = $('.card-header span').eq(0).text().trim();

  // 主榜表格：取包含 tbody.scorebody 的第一个 scoreboard，排除 cell_legend
  const $scoreboard = $('table.scoreboard').has('tbody.scorebody').first();
  if ($scoreboard.length === 0) {
    throw new Error('Cannot find scoreboard table with tbody.scorebody');
  }

  // problems
  let problemHeaders = Array.from($scoreboard.find('thead tr.scoreheader th[title~=problem] .circle'));
  if (problemHeaders.length === 0) {
    problemHeaders = Array.from(
      $scoreboard.find('thead tr.scoreheader th[title~=problem] .badge'),
    );
  }
  if (problemHeaders.length === 0) {
    console.warn('Cannot find problem headers');
  }
  const problemBgColors = problemHeaders.map((ph) => {
    const style = $(ph).attr('style');
    const match =
      style?.match(/background:\s*([^;]+)/) || style?.match(/background-color:\s*([^;]+)/);
    return match ? match[1].toString().trim() : '';
  });

  const trs = $scoreboard.find('tbody.scorebody > tr');
  const rows: srk.RanklistRow[] = [];

  for (const tr of Array.from(trs)) {
    const $tr = $(tr);
    const userId = $tr.attr('id')!.trim().replace(/^team:/, '');
    const tds = Array.from($tr.find('td'));

    const scoreplIdx = tds.findIndex((td) => $(td).hasClass('scorepl'));
    const scoreafIdx = tds.findIndex((td) => $(td).hasClass('scoreaf'));
    const scoretnIdx = tds.findIndex((td) => $(td).hasClass('scoretn'));
    const scorencIdx = tds.findIndex((td) => $(td).hasClass('scorenc'));
    const scorettIdx = tds.findIndex((td) => $(td).hasClass('scorett'));

    if (
      scoreplIdx < 0 ||
      scoreafIdx < 0 ||
      scoretnIdx < 0 ||
      scorencIdx < 0 ||
      scorettIdx < 0
    ) {
      continue;
    }

    const nameTd = tds[scoretnIdx];
    const teamName = $(nameTd).find('.teamName').text().trim();
    const teamENameRaw = $(nameTd).find('.teamEName').text().trim();
    const teamEName =
      teamENameRaw.length >= 2 ? teamENameRaw.slice(1, -1) : teamENameRaw;
    const name: srk.Text =
      teamEName && teamName
        ? { 'zh-CN': teamName, en: teamEName, fallback: teamEName }
        : teamName || teamEName || '';
    const organization = $(tds[scoreafIdx]).text().trim().replace(/\s+/g, ' ').trim();
    const scoreTd = tds[scorencIdx];
    const totalTimeTd = tds[scorettIdx];
    const problemTds = tds.slice(scorettIdx + 1).filter((td) => $(td).hasClass('score_cell'));

    const score: srk.RankScore = {
      value: parseInt($(scoreTd).text().trim(), 10),
      time: [parseInt($(totalTimeTd).text().trim(), 10), 'min'],
    };

    const statuses: srk.RankProblemStatus[] = [];
    for (const problemTd of problemTds) {
      const problemTdScore = $(problemTd).find('div')[0];
      if (!problemTdScore) {
        statuses.push({ result: null });
        continue;
      }
      const $div = $(problemTdScore);
      const result = $div.hasClass('score_incorrect')
        ? 'RJ'
        : $div.hasClass('score_pending')
          ? '?'
          : $div.hasClass('score_first')
            ? 'FB'
            : 'AC';
      const rawHtml = $div.html() ?? '';
      const timePart = rawHtml.split('<span')[0].trim();
      const timeUsed =
        result === 'RJ' || result === '?' || !timePart || timePart === '--'
          ? null
          : parseInt(timePart, 10);
      const triesMatch = $div.find('span').text().trim().match(/(\d+)\s*tries?/);
      const tries = triesMatch ? parseInt(triesMatch[1], 10) : undefined;

      statuses.push({
        result,
        time: timeUsed !== null && !Number.isNaN(timeUsed) ? [timeUsed, 'min'] : undefined,
        tries,
      } as srk.RankProblemStatus);
    }

    rows.push({
      user: userParser
        ? userParser(userId, name, organization, [], undefined, undefined)
        : {
            id: userId,
            name,
            organization,
            official: true,
          },
      score,
      statuses,
    });
  }

  const generator = new UniversalSrkGenerator();

  generator.init({
    contest: {
      title: {
        'zh-CN': contestTitle,
        fallback: contestTitle,
      },
      startAt: '2000-01-01T00:00:00+08:00',
      duration: [5, 'h'],
      frozenDuration: [1, 'h'],
    },
    problems: problemBgColors.map((problemBg, index) => ({
      alias: numberToAlphabet(index),
      style: problemBg
        ? {
            backgroundColor: problemBg,
          }
        : undefined,
    })),
    contributors: ['algoUX (https://algoux.org)'],
    useICPCPreset: true,
    icpcPresetOptions: {
      mainRankSeriesRule: {
        count: {
          value: [0, 0, 0],
        },
      },
      sorterTimePrecision: 'min',
    },
    remarks: {
      'zh-CN':
        '这个榜单缺失奖牌数据，如果您有该比赛的原始榜单或获奖名单，欢迎联系我们补充数据。',
      fallback:
        'This ranklist lacks medal data. If you have the original ranklist or the list of winners, please contact us to supplement the data.',
    },
  });

  generator.setRows(rows);

  generator.build({
    calculateFB: true,
    disableFBIfConflict: true,
  });

  return generator.getSrk();
}
