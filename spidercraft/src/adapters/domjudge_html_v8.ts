import path from 'path';
import type * as srk from '@algoux/standard-ranklist';
import cheerio from 'cheerio';
import { numberToAlphabet } from '@algoux/standard-ranklist-utils';
import { UniversalSrkGenerator } from '../generators/universal';

export interface DomjudgeHtmlV8Asset {
  kind: 'contest-banner' | 'team-photo';
  source: string;
  suggestedFilename: string;
  htmlPath?: string;
  userId?: string;
}

export interface DomjudgeHtmlV8UserContext {
  id: string;
  name: string;
  organization: string;
  categories: string[];
  description?: string;
  location?: string;
  photoUrl?: string;
}

export interface DomjudgeHtmlV8RunOptions {
  htmlPath?: string;
  modifyUser?: (
    user: srk.User,
    context: DomjudgeHtmlV8UserContext,
  ) => srk.User | void | Promise<srk.User | void>;
  assetHandler?: (asset: DomjudgeHtmlV8Asset) => string | undefined | Promise<string | undefined>;
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

function getModalField(
  $: cheerio.Root,
  $modal: cheerio.Cheerio,
  fieldNames: string | string[],
): string | undefined {
  const names = Array.isArray(fieldNames) ? fieldNames : [fieldNames];
  const row = $modal
    .find('.modal-body table tr')
    .filter((_, tr) => names.includes(normalizeText($(tr).find('th').first().text())))
    .first();
  if (row.length === 0) return undefined;
  return normalizeText(row.find('td').first().text());
}

function getModalCategories($: cheerio.Root, $modal: cheerio.Cheerio): string[] {
  const row = $modal
    .find('.modal-body table tr')
    .filter((_, tr) => {
      const name = normalizeText($(tr).find('th').first().text());
      return name === 'Category' || name === 'Categories';
    })
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

function getTeamPhotoUrl($: cheerio.Root, $modal: cheerio.Cheerio): string | undefined {
  const $knownPhoto = $modal.find('img.teampicture, img#teampicture').first();
  if ($knownPhoto.length > 0) {
    return $knownPhoto.attr('src');
  }
  return $modal
    .find('img')
    .filter((_, img) => {
      const alt = normalizeText($(img).attr('alt')).toLowerCase();
      const title = normalizeText($(img).attr('title')).toLowerCase();
      return alt.startsWith('picture of team') || title.startsWith('picture of team');
    })
    .first()
    .attr('src');
}

function buildSeries(rows: srk.RanklistRow[], medalCounts: number[], sawAnyMedalClass: boolean) {
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

  return series;
}

export async function run(html: string, options: DomjudgeHtmlV8RunOptions = {}) {
  const $ = cheerio.load(html);
  const contestTitle =
    normalizeText($('.card-header span').first().text()) ||
    normalizeText($('title').first().text()).replace(/\s*-\s*DOMjudge\s*$/i, '') ||
    'DOMjudge Contest';

  const $scoreboard = $('table.scoreboard').has('tr[id^="team:"]').first();
  if ($scoreboard.length === 0) {
    throw new Error('Cannot find DOMjudge v8 scoreboard table');
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

  const problemHeaders = $scoreboard.find('thead tr.scoreheader th[title^="problem"]').toArray();
  const problems: srk.Problem[] = problemHeaders.map((th, index) => {
    const $th = $(th);
    const $badge = $th.find('.problem-badge').first();
    const alias = normalizeText($badge.text()) || numberToAlphabet(index);
    const badgeStyle = $badge.attr('style');
    const backgroundColor =
      cssValue(badgeStyle, 'background-color') ?? cssValue(badgeStyle, 'background');
    const textColor = cssValue($badge.find('span').first().attr('style'), 'color');
    const style: srk.Style = {};
    if (backgroundColor) style.backgroundColor = backgroundColor;
    if (textColor) style.textColor = textColor;
    const title = normalizeText($th.attr('title')).replace(/^problem\s+/i, '');

    return {
      alias,
      title: title || undefined,
      style: Object.keys(style).length > 0 ? style : undefined,
    };
  });

  const rows: srk.RanklistRow[] = [];
  const usedMarkerIds = new Set<string>();
  const medalCounts = [0, 0, 0];
  let sawAnyMedalClass = false;

  const tableRows = $scoreboard.find('tbody > tr[id^="team:"]').toArray();
  for (const tr of tableRows) {
    const $tr = $(tr);
    const userId = ($tr.attr('id') ?? '').replace(/^team:/, '');
    if (!userId) continue;

    const rankClass = $tr.find('td.scorepl').first().attr('class') ?? '';
    if (rankClass.includes('gold-medal')) {
      sawAnyMedalClass = true;
      medalCounts[0]++;
    } else if (rankClass.includes('silver-medal')) {
      sawAnyMedalClass = true;
      medalCounts[1]++;
    } else if (rankClass.includes('bronze-medal')) {
      sawAnyMedalClass = true;
      medalCounts[2]++;
    }

    const $modal = getTeamModal($, userId);
    const rowName =
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

    const organization = normalizeText($tr.find('td.scoretn .univ').first().text());
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
    const photoUrl = getTeamPhotoUrl($, $modal);
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
    for (let index = 0; index < problems.length; index++) {
      const problemCell = problemCells[index];
      statuses.push(problemCell ? parseProblemStatus($, problemCell) : { result: null });
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

  const generator = new UniversalSrkGenerator();
  generator.init({
    contest,
    problems,
    contributors: ['algoUX (https://algoux.org)'],
    series: buildSeries(rows, medalCounts, sawAnyMedalClass),
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
