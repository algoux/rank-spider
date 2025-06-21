import * as srk from '@algoux/standard-ranklist';
import cheerio from 'cheerio';
import { numberToAlphabet } from '@algoux/standard-ranklist-utils';
import { UniversalSrkGenerator } from '../generators/universal';

export async function run(html: string) {
  const $ = cheerio.load(html);
  const contestTitle = $('.card-header>span').eq(0).text().trim();
  const problemHeaders = Array.from($('table>thead>tr.scoreheader>th[title~=problem] .circle'));
  const problemBgColors = problemHeaders.map((ph) =>
    $(ph)
      .attr('style')!
      .match(/background:\s*([^;]+)/)![1]
      .toString(),
  );
  const problenNum = problemBgColors.length;
  const trs = $('table>tbody>tr');
  const bdTrs = Array.from(trs).splice(0, trs.length - 6);
  const rows: srk.RanklistRow[] = [];
  for (const tr of bdTrs) {
    const userId = $(tr)
      .attr('id')!
      .trim()
      .replace(/^team:/, '');
    const tds = Array.from($(tr).find('td'));
    const [rankTd, _, nameTd, scoreTd, totalTimeTd, ...problemTds] = tds;
    const name = $(nameTd).attr('title')!.trim();
    const organization = $(nameTd).find('.univ').text().trim();
    const score: srk.RankScore = {
      value: parseInt($(scoreTd).text().trim()),
      time: [parseInt($(totalTimeTd).text().trim()), 'min'],
    };
    const statuses = [];
    for (const problemTd of problemTds) {
      const problemTdScore = $(problemTd).find('div')[0];
      if (!problemTdScore) {
        statuses.push({
          result: null,
        });
        continue;
      }
      const result = $(problemTdScore).hasClass('score_incorrect')
        ? 'RJ'
        : $(problemTdScore).hasClass('score_first')
        ? 'FB'
        : 'AC';
      let timeUsed = result === 'RJ' ? null : $(problemTdScore).html()!.split('<span')[0].trim();
      let tries = $(problemTdScore).find('span').text().trim().split(' tr')[0];
      statuses.push({
        result,
        time: timeUsed !== null ? [parseInt(timeUsed), 'min'] : undefined,
        tries: parseInt(tries),
      } as srk.RankProblemStatus);
    }
    rows.push({
      user: {
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
      startAt: '2000-01-01T00:00:00Z',
      duration: [5, 'h'],
      frozenDuration: [1, 'h'],
    },
    problems: problemBgColors.map((problemBg, index) => ({
      alias: numberToAlphabet(index),
      style: {
        backgroundColor: problemBg,
      },
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
  });

  generator.setRows(rows);

  generator.build({
    calculateFB: false,
  });

  return generator.getSrk();
}
