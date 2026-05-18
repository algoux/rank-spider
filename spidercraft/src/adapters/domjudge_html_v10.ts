import path from 'path';
import fs from 'fs-extra';
import type * as srk from '@algoux/standard-ranklist';
import cheerio from 'cheerio';
import { numberToAlphabet } from '@algoux/standard-ranklist-utils';
import { UniversalSrkGenerator } from '../generators/universal';

export interface DomjudgeHtmlV10Asset {
  kind: 'contest-banner' | 'team-photo';
  source: string;
  suggestedFilename: string;
  htmlPath?: string;
  userId?: string;
}

export interface DomjudgeHtmlV10UserContext {
  id: string;
  name: string;
  organization: string;
  categories: string[];
  description?: string;
  location?: string;
  photoUrl?: string;
}

export interface DomjudgeHtmlV10RunOptions {
  htmlPath?: string;
  modifyUser?: (
    user: srk.User,
    context: DomjudgeHtmlV10UserContext,
  ) => srk.User | void | Promise<srk.User | void>;
  assetHandler?: (asset: DomjudgeHtmlV10Asset) => string | undefined | Promise<string | undefined>;
}

interface DomjudgeSubmissionRecord {
  time?: string;
  language?: string;
  verdict?: string;
  score?: number | null;
}

const MEDAL_MISSING_REMARKS: srk.Text = {
  'zh-CN':
    '这个榜单缺失奖牌数据，如果您有该比赛的原始榜单或获奖名单，欢迎联系我们补充数据。',
  fallback:
    'This ranklist lacks medal data. If you have the original ranklist or the list of winners, please contact us to supplement the data.',
};

function normalizeText(text: string | undefined | null): string {
  return (text ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function hasTextValue(text: srk.Text | undefined): boolean {
  if (!text) return false;
  if (typeof text === 'string') {
    return normalizeText(text).length > 0;
  }
  return normalizeText(text.fallback).length > 0;
}

function stripQueryAndHash(source: string): string {
  return source.split(/[?#]/)[0];
}

function isHttpUrl(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

function filenameFromSource(source: string, fallback: string): string {
  try {
    if (isHttpUrl(source)) {
      return path.basename(new URL(source).pathname) || fallback;
    }
  } catch {
    // Fall through to path parsing below.
  }
  return path.basename(stripQueryAndHash(source)) || fallback;
}

function cssValue(style: string | undefined, property: string): string | undefined {
  if (!style) return undefined;
  const escaped = property.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const match = style.match(new RegExp(`(?:^|;)\\s*${escaped}\\s*:\\s*([^;]+)`, 'i'));
  return match ? match[1].trim() : undefined;
}

function parseElapsedToMinutes(text: string | undefined | null): number | undefined {
  const cleaned = normalizeText(text);
  if (!cleaned || cleaned === '--') return undefined;
  if (cleaned.includes(':')) {
    const parts = cleaned.split(':').map((part) => parseInt(part, 10));
    if (parts.some((part) => Number.isNaN(part))) return undefined;
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    if (parts.length === 3) {
      return parts[0] * 60 + parts[1] + Math.floor(parts[2] / 60);
    }
    return undefined;
  }
  const value = parseInt(cleaned, 10);
  return Number.isNaN(value) ? undefined : value;
}

function parseTries(text: string): number | undefined {
  const match = normalizeText(text).match(/(\d+)\s*tr(?:y|ies)/i);
  if (!match) return undefined;
  const tries = parseInt(match[1], 10);
  return Number.isNaN(tries) ? undefined : tries;
}

function mapSubmissionVerdict(verdictHtml: string | undefined): Exclude<srk.SolutionResultFull, null> {
  const $verdict = cheerio.load(verdictHtml ?? '');
  const classes = $verdict('[class]')
    .map((_, el) => $verdict(el).attr('class') ?? '')
    .get()
    .join(' ')
    .toLowerCase();
  const verdictText = normalizeText($verdict.root().text()).toLowerCase();

  if (classes.includes('sol_correct') || /^(correct|accepted|ac)$/.test(verdictText)) {
    return 'AC';
  }
  if (classes.includes('sol_pending') || verdictText.includes('pending')) {
    return '?';
  }
  if (verdictText.includes('compile')) {
    return 'CE';
  }
  if (verdictText.includes('time limit')) {
    return 'TLE';
  }
  if (verdictText.includes('memory limit')) {
    return 'MLE';
  }
  if (verdictText.includes('run') && verdictText.includes('error')) {
    return 'RTE';
  }
  return 'RJ';
}

function parseProblemStatus($: cheerio.Root, td: cheerio.Element): srk.RankProblemStatus {
  const $div = $(td).find('div').first();
  if ($div.length === 0) {
    return { result: null };
  }

  const result: srk.SolutionResultLite = $div.hasClass('score_incorrect')
    ? 'RJ'
    : $div.hasClass('score_pending')
      ? '?'
      : $div.hasClass('score_first')
        ? 'FB'
        : 'AC';

  const $timeOnly = $div.clone();
  $timeOnly.find('span').remove();
  const time = parseElapsedToMinutes($timeOnly.text());
  const tries = parseTries($div.find('span').text());

  const status: srk.RankProblemStatus = { result };
  if (time !== undefined && result !== 'RJ' && result !== '?') {
    status.time = [time, 'min'];
  }
  if (tries !== undefined) {
    status.tries = tries;
  }
  return status;
}

function resolveSubmissionsSource(source: string, htmlPath?: string): string {
  if (isHttpUrl(source)) return source;
  const cleaned = stripQueryAndHash(source);
  if (htmlPath) {
    return path.resolve(path.dirname(htmlPath), cleaned);
  }
  return path.resolve(cleaned);
}

async function loadSubmissionsData(
  source: string,
  htmlPath: string | undefined,
  cache: Map<string, Promise<any>>,
): Promise<any> {
  const resolved = resolveSubmissionsSource(source, htmlPath);
  if (!cache.has(resolved)) {
    const promise = isHttpUrl(resolved)
      ? fetch(resolved, {
          headers: {
            accept: 'application/json, text/plain, */*',
            'user-agent':
              'Mozilla/5.0 (compatible; rank-spider DOMjudge HTML v10 adapter)',
          },
        }).then(async (res) => {
          if (!res.ok) {
            throw new Error(`HTTP ${res.status} while fetching submissions: ${resolved}`);
          }
          return res.json();
        })
      : fs.readFile(resolved, 'utf-8').then((text) => JSON.parse(text));
    cache.set(resolved, promise);
  }
  return cache.get(resolved)!;
}

async function parseSolutionsForCell(
  $: cheerio.Root,
  td: cheerio.Element,
  teamId: string,
  problemId: string,
  status: srk.RankProblemStatus,
  htmlPath: string | undefined,
  submissionsCache: Map<string, Promise<any>>,
): Promise<srk.Solution[] | undefined> {
  const $link = $(td).find('[data-submissions-url]').first();
  const submissionsUrl = $link.attr('data-submissions-url');
  if (!submissionsUrl) return undefined;

  const data = await loadSubmissionsData(submissionsUrl, htmlPath, submissionsCache);
  const teamKey = `team-${teamId}`;
  const problemKey = `problem-${problemId}`;
  const records = data?.submissions?.[teamKey]?.[problemKey];
  if (!Array.isArray(records)) return undefined;

  const solutions = (records as DomjudgeSubmissionRecord[])
    .map((record) => {
      const time = parseElapsedToMinutes(record.time);
      if (time === undefined) return undefined;
      const solution: srk.Solution = {
        result: mapSubmissionVerdict(record.verdict),
        time: [time, 'min'],
      };
      if (typeof record.score === 'number') {
        solution.score = record.score;
      }
      return solution;
    })
    .filter((solution): solution is srk.Solution => !!solution)
    .sort((a, b) => a.time[0] - b.time[0]);

  if (status.result === 'FB') {
    const firstAccepted = solutions.find((solution) => solution.result === 'AC');
    if (firstAccepted) {
      firstAccepted.result = 'FB';
    }
  }

  return solutions;
}

function getModalField(
  $: cheerio.Root,
  $modal: cheerio.Cheerio,
  fieldName: string,
): string | undefined {
  const row = $modal
    .find('.modal-body table tr')
    .filter((_, tr) => normalizeText($(tr).find('th').first().text()) === fieldName)
    .first();
  if (row.length === 0) return undefined;
  return normalizeText(row.find('td').first().text());
}

function getModalCategories($: cheerio.Root, $modal: cheerio.Cheerio): string[] {
  const row = $modal
    .find('.modal-body table tr')
    .filter((_, tr) => normalizeText($(tr).find('th').first().text()) === 'Categories')
    .first();
  if (row.length === 0) return [];
  const categories = row
    .find('td li')
    .map((_, li) => normalizeText($(li).text()))
    .get()
    .filter(Boolean);
  if (categories.length > 0) return categories;
  const directText = normalizeText(row.find('td').first().text());
  return directText ? [directText] : [];
}

function categoryToMarker(category: string): string | undefined {
  const normalized = normalizeText(category).toLowerCase();
  if (normalized === 'girls' || normalized === 'female') {
    return 'female';
  }
  return undefined;
}

function categoryMarksUnofficial(category: string): boolean {
  const normalized = normalizeText(category).toLowerCase();
  return (
    normalized === 'star' ||
    normalized === 'unofficial' ||
    normalized === 'observers' ||
    normalized === 'observer' ||
    normalized === 'out of competition'
  );
}

function getTeamModal($: cheerio.Root, userId: string): cheerio.Cheerio {
  return $('[id]')
    .filter((_, el) => $(el).attr('id') === `team-modal-${userId}`)
    .first();
}

export async function run(html: string, options: DomjudgeHtmlV10RunOptions = {}) {
  const $ = cheerio.load(html);
  const contestTitle =
    normalizeText($('.card-header span').first().text()) ||
    normalizeText($('title').first().text()).replace(/\s*-\s*DOMjudge\s*$/i, '') ||
    'DOMjudge Contest';

  const $scoreboard = $('table.desktop-scoreboard').first().length
    ? $('table.desktop-scoreboard').first()
    : $('table.scoreboard').has('tr[data-team-id]').first();
  if ($scoreboard.length === 0) {
    throw new Error('Cannot find DOMjudge v10 scoreboard table');
  }

  const bannerUrl = $('img.banner').first().attr('src');
  let banner: string | undefined;
  if (bannerUrl && options.assetHandler) {
    banner = await options.assetHandler({
      kind: 'contest-banner',
      source: bannerUrl,
      htmlPath: options.htmlPath,
      suggestedFilename: filenameFromSource(bannerUrl, 'banner'),
    });
  }

  const problemHeaders = $scoreboard.find('thead tr.scoreheader th[data-problem-id]').toArray();
  const problemIds: string[] = [];
  const problems: srk.Problem[] = problemHeaders.map((th, index) => {
    const $th = $(th);
    const problemId = $th.attr('data-problem-id') ?? numberToAlphabet(index).toLowerCase();
    problemIds.push(problemId);
    const $badge = $th.find('.problem-badge').first();
    const alias = normalizeText($badge.text()) || numberToAlphabet(index);
    const badgeStyle = $badge.attr('style');
    const backgroundColor = cssValue(badgeStyle, 'background-color') ?? cssValue(badgeStyle, 'background');
    const textColor = cssValue($badge.find('span').first().attr('style'), 'color');
    const style: srk.Style = {};
    if (backgroundColor) style.backgroundColor = backgroundColor;
    if (textColor) style.textColor = textColor;

    return {
      alias,
      title: $th.attr('data-problem-name') || undefined,
      style: Object.keys(style).length > 0 ? style : undefined,
    };
  });

  const rows: srk.RanklistRow[] = [];
  const usedMarkerIds = new Set<string>();
  const medalCounts = [0, 0, 0];
  let sawAnyMedalClass = false;
  const submissionsCache = new Map<string, Promise<any>>();

  const tableRows = $scoreboard.find('tbody > tr[data-team-id]').toArray();
  for (const tr of tableRows) {
    const $tr = $(tr);
    const userId = $tr.attr('data-team-id');
    if (!userId) continue;

    const medalClass = $tr.find('td.no-border i.fa-medal').first().attr('class') ?? '';
    if (medalClass) {
      sawAnyMedalClass = true;
      if (medalClass.includes('gold-medal')) medalCounts[0]++;
      if (medalClass.includes('silver-medal')) medalCounts[1]++;
      if (medalClass.includes('bronze-medal')) medalCounts[2]++;
    }

    const $modal = getTeamModal($, userId);
    const rowName =
      normalizeText($tr.attr('data-team-name')) ||
      normalizeText($tr.find('td.scoretn').attr('title')) ||
      normalizeText($tr.find('td.scoretn .forceWidth').first().text()) ||
      getModalField($, $modal, 'Name') ||
      userId;
    let name = rowName;
    let official = true;
    if (/^[*★☆]\s*/.test(name)) {
      official = false;
      name = name.replace(/^[*★☆]\s*/, '').trim();
    }

    const organization =
      normalizeText($tr.find('td.scoretn .univ').first().text()) ||
      normalizeText(
        $tr
          .find('td.scoreaf')
          .filter((_, td) => !$(td).hasClass('heart'))
          .first()
          .text(),
      );
    const categories = getModalCategories($, $modal);
    for (const category of categories) {
      if (categoryMarksUnofficial(category)) official = false;
    }

    const markers = categories
      .map(categoryToMarker)
      .filter((marker): marker is string => !!marker);
    markers.forEach((marker) => usedMarkerIds.add(marker));

    const location = getModalField($, $modal, 'Location');
    const description = getModalField($, $modal, 'Description');
    const photoUrl = $modal.find('img.teampicture').first().attr('src');
    let photo: string | undefined;
    if (photoUrl && options.assetHandler) {
      photo = await options.assetHandler({
        kind: 'team-photo',
        source: photoUrl,
        htmlPath: options.htmlPath,
        userId,
        suggestedFilename: filenameFromSource(photoUrl, `${userId}-photo`),
      });
    }

    let user: srk.User = {
      id: userId,
      name,
      official,
      organization: organization || undefined,
      location: location || undefined,
      markers: markers.length > 0 ? markers : undefined,
      photo,
    };

    if (options.modifyUser) {
      const modifiedUser = await options.modifyUser(user, {
        id: userId,
        name,
        organization,
        categories,
        description,
        location,
        photoUrl,
      });
      if (modifiedUser) {
        user = modifiedUser;
      }
    }

    const scoreValue = parseInt(normalizeText($tr.find('td.scorenc').first().text()), 10);
    const scoreTime = parseInt(normalizeText($tr.find('td.scorett').first().text()), 10);
    const problemCells = $tr.find('td.score_cell').toArray();
    const statuses: srk.RankProblemStatus[] = [];
    for (let index = 0; index < problemIds.length; index++) {
      const problemCell = problemCells[index];
      const status = problemCell ? parseProblemStatus($, problemCell) : { result: null };
      if (problemCell) {
        const solutions = await parseSolutionsForCell(
          $,
          problemCell,
          userId,
          problemIds[index],
          status,
          options.htmlPath,
          submissionsCache,
        );
        if (solutions) {
          status.solutions = solutions;
        }
      }
      statuses.push(status);
    }

    rows.push({
      user,
      score: {
        value: Number.isNaN(scoreValue) ? 0 : scoreValue,
        time: [Number.isNaN(scoreTime) ? 0 : scoreTime, 'min'],
      },
      statuses,
    });
  }

  const markers: srk.Marker[] = [];
  if (usedMarkerIds.has('female')) {
    markers.push({
      id: 'female',
      label: '女队',
      style: 'pink',
    });
  }

  const contest: srk.Contest = {
    title: {
      fallback: contestTitle,
    },
    startAt: '2000-01-01T00:00:00+08:00',
    duration: [5, 'h'],
    frozenDuration: [1, 'h'],
  };
  if (banner) {
    contest.banner = banner;
  }

  const series: srk.RankSeries[] = [
    {
      title: '#',
      segments: [
        { style: 'gold', title: 'Gold Award' },
        { style: 'silver', title: 'Silver Award' },
        { style: 'bronze', title: 'Bronze Award' },
      ],
      rule: {
        preset: 'ICPC',
        options: {
          count: {
            value: sawAnyMedalClass ? medalCounts : [0, 0, 0],
          },
        },
      },
    },
    {
      title: 'R#',
      rule: {
        preset: 'Normal',
      },
    },
  ];

  if (rows.every((row) => hasTextValue(row.user.organization))) {
    series.push({
      title: 'S#',
      rule: {
        preset: 'UniqByUserField',
        options: {
          field: 'organization',
          includeOfficialOnly: true,
        },
      },
    });
  }

  const generator = new UniversalSrkGenerator();
  generator.init({
    contest,
    problems,
    contributors: ['algoUX (https://algoux.org)'],
    series,
    markers,
    sorter: {
      algorithm: 'ICPC',
      config: {
        noPenaltyResults: ['FB', 'AC', '?', 'NOUT', 'CE', 'UKE', null],
        penalty: [20, 'min'],
        timePrecision: 'min',
      },
    },
    remarks: sawAnyMedalClass ? undefined : MEDAL_MISSING_REMARKS,
  });

  generator.setRows(rows);
  generator.build({
    calculateFB: false,
  });

  return generator.getSrk();
}
