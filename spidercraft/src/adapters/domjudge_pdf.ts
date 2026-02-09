import path from 'path';
import fs from 'fs-extra';
import _ from 'lodash';
import { PDFDocument, rgb } from 'pdf-lib';
import type * as srk from '@algoux/standard-ranklist';
import { UniversalSrkGenerator } from '../generators/universal';

/** 题目数量 */
let PROB_NUM = 0;

/** 临时调试：要调试的 pageIndex，设为 undefined 则不生成 debug.pdf */
let debugPage: number | undefined = 0;
/** 临时调试：要调试的 fill 下标列表，仅当 debugPage 有值时生效 */
let debugFills: number[] = [
  // 对于如 icpc2019invitational-xi_an 的 DOMjudge（有徽标，无关注按钮）
  // // P0F0（表头下方）
  // /** 徽标 */ 660, /** TEAM */ 644, /** SCORE */ 659, /** 题目列 */ 658, 657, 656, 655, 654, 653, 652, 651, 650, 649, 648, 647, 646,
  // // P0F1 (Row#0 下方)
  // /** TEAM */ 645, /** 题目列 */ 643, 642, 641, 640, 639, 638, 637, 636, 635, 634, 633, 632, 631,
  // // P0F2 (Row#1 下方)
  // /** TEAM */ 630, /** 题目列 */ 629, 628, 627, 626, 625, 624, 623, 622, 621, 620, 619, 618, 617,
  // // P0F46 (Row#45 下方，最后一行，yGroupedFills 中 y 最大的一项）
  // /** TEAM */ 14, /** 题目列 */ 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
  // // P1F0（表头下方）
  // /** 徽标+TEAM */ 715, /** SCORE */ 714, /** 题目列 */ 713, 712, 711, 710, 709, 708, 707, 706, 705, 704, 703, 702, 701,
  // // P1F1（表头下方）
  // /** TEAM */ 699, /** 题目列 */ 697, 695, 693, 691, 689, 687, 685, 683, 681, 679, 677, 675, 673,
  // // P1F2（Row#0 下方）
  // /** TEAM */ 700, /** 题目列 */ 698, 696, 694, 692, 690, 688, 686, 684, 682, 680, 678, 676, 674,
  // // P1F3（Row#1 下方）
  // /** TEAM */ 672, /** 题目列 */ 671, 670, 669, 668, 667, 666, 665, 664, 663, 662, 661, 660, 659,
  // // P7F0（表头下方）
  // /** 徽标+TEAM */ 382, /** SCORE */ 381, /** 题目列 */ 380, 379, 378, 377, 376, 375, 374, 373, 372, 371, 370, 369, 368,
  // // P7F1（表头下方）
  // /** TEAM */ 366, /** 题目列 */ 364, 362, 360, 358, 356, 354, 352, 350, 348, 346, 344, 342, 340,
  // // P7F2（Row#0 下方）
  // /** TEAM */ 367, /** 题目列 */ 365, 363, 361, 359, 357, 355, 353, 351, 349, 347, 345, 343, 341,
  // // P7F3（Row#1 下方）
  // /** TEAM */ 339, /** 题目列 */ 338, 337, 336, 335, 334, 333, 332, 331, 330, 329, 328, 327, 326,
  // // P7F23（Row#21 下方）
  // /** TEAM */ 59, /** 题目列 */ 58, 57, 56, 55, 54, 53, 52, 51, 50, 49, 48, 47, 46,
  // // P7F24（Row#22 下方，最后一行，同时是 SUMMARY 组合尾部块的上方，yGroupedFills 中 y 最大的一项）
  // /** RANK+徽标+TEAM */ 29, /** TEAM */ 45, /** 题目列 */ 44, 43, 42, 41, 40, 39, 38, 37, 36, 35, 34, 33, 32,

  // 对于如 icpc2019nanjing 的 DOMjudge（无徽标，但有关注按钮）
  // // P0F0（表头下方）
  // /** TEAM 全 */ 430, /** TEAM 不包括关注 */ 414, /** SCORE */ 429, /** 题目列 */ 428, 427, 426, 425, 424, 423, 422, 421, 420, 419, 418,
  // // P0F1（Row#0 下方）
  // /** TEAM 不包括关注 */ 415, /** 题目列 */ 412, 411, 410, 409, 408, 407, 406, 405, 404, 403, 402,
  // // P1F0（表头下方）
  // /** TEAM 全 */ 569, /** SCORE */ 568, /** 题目列 */ 567, 566, 565, 564, 563, 562, 561, 560, 559, 558, 557,
  // // P1F1（表头下方）
  // /** TEAM 不包括关注 */ 553, /** 题目列 */ 550, 548, 546, 544, 542, 540, 538, 536, 534, 532, 530,
  // // P1F2（Row#0 下方）
  // /** TEAM 不包括关注 */ 554, /** 题目列 */ 551, 549, 547, 545, 543, 541, 539, 537, 535, 533, 531,
  // // P10F24（Row#1 下方，最后一行，同时是 SUMMARY 组合尾部块的上方，yGroupedFills 中 y 最大的一项）
  // /** RANK+TEAM 全 */ 27, /** TEAM 不包括关注 */ 41, /** 题目列 */ 40, 39, 38, 37, 36, 35, 34, 33, 32, 31, 30,
];

let toDebugFillIndices: number[] = [];

// DESIGN：列范围分割算法
// 表格结构：
// 1. 表头：RANK、TEAM、SCORE、若干题目列（A,B,C...，数量为 PROB_NUM）
// 2. 若干的表格行
// 确定的几个可保证的设定：
// 1. 每一页表格的列宽和列分隔位置一致，所以只需要看第一页的表头
// 2. 每一页都有表头
// 3. 题目列宽度一定全部一致
//
// 列范围侦测算法（以下全部基于 yGroupedFills 计算，用于确定每一列的左右位置范围，即每一列的 x0, x1）：
// 1. 根据 Page 0 中 minY 找到一组 fills，这是表头下方的一条黑色分隔线：P0F0
// 2. 固定 RANK 列的 x0 为 0，其 x1 为 P0F0[0] 的 x；
// 3. 对于 TEAM 列，x0 为 P0F0[0] 的 x，x1 为 P0F0[1] 的 x+w；
// 4. 对于 SCORE 列，x0 为 P0F0[2] 的 x，x1 为 P0F0[2] 的 x+w；
// 5. 后面还有 PROB_NUM 个元素列，每一项都可以由 P0F0[2+i] 的 x 和 x+w 确定其 x0, x1；
// 以上即列所在范围的确定方法，需要存储这个数据结构，记录每一列的 [x0, x1] 表示它们的实际范围。
//
// 行范围（表格 body）：基于 yGroupedFills 的 key（y 值）作为行分隔线位置。
// - Page 0：sorted y 依次为 表头下、Row#0 下、Row#1 下、…、最后一行下；行 i 的 y0=keys[i], y1=keys[i+1]。
// - Page 1-n：yGroupedFills 多一档 F1（表头下多一条），去掉 keys[1] 后与 page0 逻辑一致。

/** 列范围 [x0, x1]（form 坐标） */
export interface ColumnRange {
  colIndex: number;
  name?: string;
  x0: number;
  x1: number;
}

/** 行范围 [y0, y1]（form 坐标） */
export interface RowRange {
  rowIndex: number;
  y0: number;
  y1: number;
}

/** pdf2json 单条 Fill 结构 */
export type Fill = { x: number; y: number; w: number; h: number; clr?: number; oc?: string };

/** pdf2json 解析后的单页结构（我们关心的字段） */
export interface Pdf2JsonPage {
  Width?: number;
  Height?: number;
  HLines?: Array<{
    x: number;
    y: number;
    w: number;
    l: number;
    clr?: number;
    oc?: string;
    dsh?: number;
  }>;
  VLines?: Array<{
    x: number;
    y: number;
    w: number;
    l: number;
    clr?: number;
    oc?: string;
    dsh?: number;
  }>;
  Fills?: Fill[];
  Texts?: Array<{
    x: number;
    y: number;
    w?: number;
    clr?: number;
    oc?: string;
    A?: string;
    R?: Array<{ T: string; S?: number; TS?: number[]; RA?: number }>;
  }>;
  Fields?: Array<any>;
  Boxsets?: Array<any>;
  [key: string]: unknown;
}

/** pdf2json 解析结果根结构 */
export interface Pdf2JsonRoot {
  Meta?: Record<string, unknown>;
  Pages?: Pdf2JsonPage[];
  [key: string]: unknown;
}

export interface DomjudgePdfOptions {
  /** 题目数量（由命令行 -p n 传入，必填） */
  probNum: number;
  /** 是否输出调试信息到 debug 目录 */
  debug?: boolean;
  /** 调试输出目录，默认当前工作区的 debug */
  debugDir?: string;
}

/** Fill 加上在原始 Fills 中的下标 */
export type FillWithIndex = Fill & { index: number };

const pageYGroupedFills: Record<number, FillWithIndex[]>[] = [];

/**
 * 从 fills 中筛出存在 oc 的项，按 y 升序、同 y 内按 x 升序排序，再按 y 分组为 Record<y, FillWithIndex[]>；
 * 每项带 index 指向其在原始 fills 中的下标。不修改原 Fills 数组。
 */
function computeYGroupedFills(fills: Fill[]): Record<number, FillWithIndex[]> {
  const withOcAndIndex = fills
    .map((f, i) => ({ f, i }))
    .filter(
      (item): item is { f: Fill & { oc: string }; i: number } =>
        'oc' in item.f && item.f.oc != null && (item.f.oc === '#000000' || item.f.oc === '#000'),
    );
  const sorted = [...withOcAndIndex].sort(
    (a, b) => (a.f.y ?? 0) - (b.f.y ?? 0) || (a.f.x ?? 0) - (b.f.x ?? 0),
  );
  const out: Record<number, FillWithIndex[]> = {};
  for (const { f, i } of sorted) {
    const y = f.y ?? 0;
    if (!(y in out)) out[y] = [];
    out[y].push({ ...f, index: i });
  }
  Object.keys(out).forEach((y) => {
    if (out[y as unknown as number].length < 1 + PROB_NUM) {
      delete out[y as unknown as number];
    }
  });
  return out;
}

const COL_NAMES = [
  'RANK',
  'TEAM',
  'SCORE',
  ...Array.from({ length: PROB_NUM }, (_, i) => String.fromCharCode(65 + i)),
];

/**
 * 根据 Page 0 的 minY 行（P0F0）计算列范围与分隔线 x 坐标。
 */
function computeColumnRanges(
  page0YGroupedFills: Record<number, FillWithIndex[]>,
  page0MinY: number,
): { columnRanges: ColumnRange[]; separatorX: number[] } {
  const p0f0 = page0YGroupedFills[page0MinY];
  if (!p0f0 || p0f0.length < 3 + PROB_NUM) {
    return { columnRanges: [], separatorX: [] };
  }
  const columnRanges: ColumnRange[] = [];
  const separatorX: number[] = [0];
  columnRanges.push({ colIndex: 0, name: 'RANK', x0: 0, x1: p0f0[0].x });
  separatorX.push(p0f0[0].x);
  columnRanges.push({
    colIndex: 1,
    name: 'TEAM',
    x0: p0f0[0].x,
    x1: p0f0[1].x + p0f0[1].w,
  });
  separatorX.push(p0f0[1].x + p0f0[1].w);
  columnRanges.push({
    colIndex: 2,
    name: 'SCORE',
    x0: p0f0[2].x,
    x1: p0f0[2].x + p0f0[2].w,
  });
  separatorX.push(p0f0[2].x + p0f0[2].w);
  for (let i = 0; i < PROB_NUM; i++) {
    const f = p0f0[3 + i];
    columnRanges.push({
      colIndex: 3 + i,
      name: COL_NAMES[3 + i],
      x0: f.x,
      x1: f.x + f.w,
    });
    separatorX.push(f.x + f.w);
  }
  return { columnRanges, separatorX };
}

/**
 * 根据该页 yGroupedFills 计算行范围；page 1-n 会去掉多出的 F1（keys[1]）以与 page0 一致。
 */
function computeRowRangesForPage(
  yGroupedFills: Record<number, FillWithIndex[]>,
  pageIndex: number,
): { rowRanges: RowRange[]; separatorY: number[] } {
  let keys = Object.keys(yGroupedFills)
    .map(Number)
    .sort((a, b) => a - b);
  if (pageIndex >= 1 && keys.length > 1) {
    keys = [keys[0], ...keys.slice(2)];
  }
  const rowRanges: RowRange[] = [];
  for (let i = 0; i < keys.length - 1; i++) {
    rowRanges.push({ rowIndex: i, y0: keys[i], y1: keys[i + 1] });
  }
  return { rowRanges, separatorY: keys };
}

type Pdf2JsonText = Pdf2JsonPage['Texts'] extends (infer T)[] | undefined ? T : never;

function getTextContent(text: Pdf2JsonText): string {
  const runs = text?.R ?? [];
  const raw = runs.map((r) => r?.T ?? '').join('');
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    return raw;
  }
}

/** 单元格内一条文本（用于 debug 与解析） */
export interface CellText {
  raw: string;
  x: number;
  y: number;
}

/** 逻辑行（所有页按行顺序拼接后的单行）及其单元格文本 */
export interface LogicalRowWithCells {
  globalRowIndex: number;
  pageIndex: number;
  pageRowIndex: number;
  cells: CellText[][]; // cells[colIndex] = 该列内文本列表，已按从上到下、从左到右排序
}

/**
 * 将每页的 Text 元素按所属单元格分组；逻辑行 = 各页行顺序拼接。
 */
function assignTextsToCells(
  pages: Pdf2JsonPage[],
  gridPages: Array<{ pageIndex: number; rowRanges: RowRange[]; separatorY: number[] }>,
  columnRanges: ColumnRange[],
): {
  logicalRowsWithCells: LogicalRowWithCells[];
  cellsDebug: {
    rows: Array<{
      globalRowIndex: number;
      pageIndex: number;
      pageRowIndex: number;
      cells: Array<{ colIndex: number; colName?: string; texts: CellText[] }>;
    }>;
  };
} {
  const logicalRows: Array<{ pageIndex: number; pageRowIndex: number; y0: number; y1: number }> =
    [];
  for (let p = 0; p < gridPages.length; p++) {
    const gp = gridPages[p];
    for (const row of gp.rowRanges) {
      logicalRows.push({
        pageIndex: p,
        pageRowIndex: row.rowIndex,
        y0: row.y0,
        y1: row.y1,
      });
    }
  }

  const cells: CellText[][][] = logicalRows.map(() => columnRanges.map(() => []));

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    const texts = page.Texts ?? [];
    const gp = gridPages[pageIndex];
    if (!gp) continue;
    const rowRanges = gp.rowRanges;

    for (const t of texts) {
      const x = t.x ?? 0;
      const y = t.y ?? 0;
      // 行归属：effectiveY = Text.y + 字号/16（TS[1]），满足 row.y0 <= effectiveY <= row.y1 即属该行
      const fontSize = (t.R?.[0]?.TS?.[1] as number | undefined) ?? 0;
      const effectiveY = y + fontSize / 16;

      let rowIdx = -1;
      for (let i = 0; i < rowRanges.length; i++) {
        const row = rowRanges[i];
        if (effectiveY >= row.y0 && effectiveY <= row.y1) {
          rowIdx = i;
          break;
        }
      }
      if (rowIdx < 0) continue;

      // 列判断：从后向前遍历列，第一个满足 Text.x >= col.x0 的列即归属
      let colIdx = -1;
      for (let c = columnRanges.length - 1; c >= 0; c--) {
        if (x >= columnRanges[c].x0) {
          colIdx = c;
          break;
        }
      }
      if (colIdx < 0) continue;
      const raw = getTextContent(t);
      // 题目列内：题目标号+空格的 text（如 "A ", "B "）不纳入任何单元格，直接跳过；用 raw 测试，正则 [A-Z] 以兼容 PROB_NUM>13
      const isProblemCol = colIdx >= 3 && colIdx < 3 + PROB_NUM;
      if (isProblemCol && /^[A-Z] $/.test(raw)) continue;
      const globalRowIdx = logicalRows.findIndex(
        (lr) => lr.pageIndex === pageIndex && lr.pageRowIndex === rowIdx,
      );
      if (globalRowIdx < 0) continue;
      cells[globalRowIdx][colIdx].push({ raw, x, y });
    }
  }

  const SCORE_COL_INDEX = 2;
  for (let r = 0; r < cells.length; r++) {
    for (let c = 0; c < cells[r].length; c++) {
      if (c === SCORE_COL_INDEX) {
        cells[r][c].sort((a, b) => a.x - b.x);
      } else {
        // TEAM 及题目列：二级排序，优先 y 递增，再 x 递增
        cells[r][c].sort((a, b) => a.y - b.y || a.x - b.x);
      }
    }
  }

  const logicalRowsWithCells: LogicalRowWithCells[] = logicalRows.map((lr, globalRowIndex) => ({
    globalRowIndex,
    pageIndex: lr.pageIndex,
    pageRowIndex: lr.pageRowIndex,
    cells: cells[globalRowIndex],
  }));

  const cellsDebug = {
    rows: logicalRowsWithCells.map((row) => ({
      globalRowIndex: row.globalRowIndex,
      pageIndex: row.pageIndex,
      pageRowIndex: row.pageRowIndex,
      cells: row.cells.map((texts, colIndex) => ({
        colIndex,
        colName: columnRanges[colIndex]?.name,
        texts,
      })),
    })),
  };

  return { logicalRowsWithCells, cellsDebug };
}

/**
 * 将单元格内 CellText[] 按 y 分组，每组内按 x 升序用 raw 拼接成一段字符串。
 * 返回 string[]，每个元素表示单元格内一行文字（同一 y 组拼接结果）。
 */
function cellTextsToConcatenatedLines(texts: CellText[]): string[] {
  if (texts.length === 0) return [];
  const yVals = [...new Set(texts.map((a) => a.y))].sort((a, b) => a - b);
  return yVals.map((yVal) =>
    texts
      .filter((a) => a.y === yVal)
      .sort((a, b) => a.x - b.x)
      .map((a) => a.raw)
      .join(''),
  );
}

/** 匹配 "N try" 或 "N tries"，返回 N */
function matchTries(s: string): number | null {
  const m = s.trim().match(/^(\d+)\s*(?:try|tries)$/i);
  return m ? parseInt(m[1], 10) : null;
}

function parseProblemCell(texts: CellText[]): srk.RankProblemStatus | null {
  if (texts.length === 0) return { result: null } as srk.RankProblemStatus;
  const lines = cellTextsToConcatenatedLines(texts); // 至多两项：[0]=上一行拼接，[1]=下一行拼接
  if (lines.length === 0) return { result: null } as srk.RankProblemStatus;

  if (lines.length === 1) {
    const tries = matchTries(lines[0]);
    if (tries != null) return { result: 'RJ', tries } as srk.RankProblemStatus;
    return { result: null } as srk.RankProblemStatus;
  }

  if (lines.length === 2) {
    const timeNum = parseInt(lines[0].trim(), 10);
    const tries = matchTries(lines[1]);
    if (!Number.isNaN(timeNum) && tries != null)
      return { result: 'AC', time: [timeNum, 'min'], tries } as srk.RankProblemStatus;
  }
  return { result: null } as srk.RankProblemStatus;
}

function parseRowToSrkRow(
  cells: CellText[][],
  _columnRanges: ColumnRange[],
  globalRowIndex?: number,
): srk.RanklistRow {
  const col = (idx: number) => cells[idx] ?? [];
  const firstRaw = (idx: number) => (col(idx).length > 0 ? col(idx)[0].raw.trim() : '');

  const rankRaw = firstRaw(0);
  const userId = /^\d+$/.test(rankRaw)
    ? rankRaw
    : globalRowIndex != null
    ? String(globalRowIndex)
    : '0';

  // TEAM 列：复用 y 分组拼接，[0]=name（小 y），[1]=organization（大 y）
  const teamLines = cellTextsToConcatenatedLines(col(1));
  let name = '';
  let organization = '';
  if (teamLines.length === 1) {
    name = teamLines[0] ?? '';
  } else if (teamLines.length >= 2) {
    name = teamLines[teamLines.length - 2] ?? '';
    organization = teamLines[teamLines.length - 1] ?? '';
  }

  const scoreTexts = col(2);
  // SCORE 列：内部已按 x 升序，[0]=左=score.value，[1]=右=score.time。
  let scoreValue = 0;
  let scoreTime = 0;
  if (scoreTexts.length >= 1) scoreValue = parseInt(scoreTexts[0].raw.trim(), 10) || 0;
  if (scoreTexts.length >= 2) scoreTime = parseInt(scoreTexts[1].raw.trim(), 10) || 0;
  const score: srk.RankScore = { value: scoreValue, time: [scoreTime, 'min'] };

  // 题目列：传入 CellText[]，parseProblemCell 内部用 cellTextsToConcatenatedLines 转成 string[] 再解析
  const statuses: srk.RankProblemStatus[] = [];
  for (let i = 0; i < PROB_NUM; i++) {
    const st = parseProblemCell(col(3 + i));
    statuses.push(st ?? ({ result: null } as srk.RankProblemStatus));
  }

  return {
    user: {
      id: name,
      name,
      organization,
      official: true,
    },
    score,
    statuses,
  };
}

function buildSrkFromRows(rows: srk.RanklistRow[]) {
  const generator = new UniversalSrkGenerator();
  generator.init({
    contest: {
      title: { 'zh-CN': 'DomJudge PDF Parsed', fallback: 'DomJudge PDF Parsed' },
      startAt: '2000-01-01T00:00:00+08:00',
      duration: [5, 'h'],
      frozenDuration: [1, 'h'],
    },
    problems: Array.from({ length: PROB_NUM }, (_, i) => ({
      alias: String.fromCharCode(65 + i),
    })),
    contributors: ['algoUX (https://algoux.org)'],
    useICPCPreset: true,
    icpcPresetOptions: {
      mainRankSeriesRule: { count: { value: [0, 0, 0] } },
      sorterTimePrecision: 'min',
      sorterRankingTimePrecision: 'min',
    },
    remarks: {
      'zh-CN': '这个榜单缺失奖牌数据，如果您有该比赛的原始榜单或获奖名单，欢迎联系我们补充数据。',
      fallback:
        'This ranklist lacks medal data. If you have the original ranklist or the list of winners, please contact us to supplement the data.',
    },
  });
  generator.setRows(rows);
  generator.build({ calculateFB: true, disableFBIfConflict: true });
  return generator.getSrk();
}

/**
 * 使用 pdf2json 解析 PDF，得到包含每页尺寸与所有元素（Texts、Fills、HLines、VLines 等）的 JSON。
 * 若 options.debug 为 true，将该 JSON 写入 options.debugDir。
 */
export async function parsePdfWithPdf2Json(pdfPath: string): Promise<Pdf2JsonRoot> {
  const { default: PDFParser } = await import('pdf2json');

  return new Promise((resolve, reject) => {
    const parser = new PDFParser();
    parser.on('pdfParser_dataError', (errData: unknown) => {
      const err =
        errData && typeof errData === 'object' && 'parserError' in errData
          ? (errData as { parserError?: unknown }).parserError
          : errData;
      reject(err ?? new Error('pdf2json parse error'));
    });
    parser.on('pdfParser_dataReady', (pdfData: unknown) => {
      resolve(pdfData as Pdf2JsonRoot);
    });
    parser.loadPDF(pdfPath, 0);
  });
}

export async function run(pdfPath: string, options: DomjudgePdfOptions) {
  const { debug = false, debugDir = path.join(process.cwd(), 'debug'), probNum } = options;
  if (probNum == null || !Number.isInteger(probNum) || probNum < 1) {
    throw new Error('请通过 -p n 指定题目数量（正整数），例如 -p 13。');
  }
  PROB_NUM = probNum;

  const resolvedPdf = path.resolve(pdfPath);

  if (debug) {
    await fs.ensureDir(debugDir);
  }

  const pdfData = await parsePdfWithPdf2Json(resolvedPdf);
  const pages = pdfData.Pages ?? [];

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    const fills = page.Fills ?? [];
    const yGroupedFills = computeYGroupedFills(fills);
    pageYGroupedFills.push(yGroupedFills);
    // 对最后一页，额外去掉底部 SUMMARY 组合尾部块
    if (pageIndex === pages.length - 1) {
      const maxY = Math.max(...Object.keys(yGroupedFills).map(Number));
      delete yGroupedFills[maxY];
    }
    if (debug) {
      const yKeys = Object.keys(yGroupedFills).map(Number);
      const minY = yKeys.length > 0 ? Math.min(...yKeys) : undefined;
      const pagePayload = {
        pageIndex,
        Width: page.Width ?? 0,
        Height: page.Height ?? 0,
        Fills: fills,
        yGroupedFills,
        minY,
        Texts: page.Texts ?? [],
        ..._.omit(page, ['Width', 'Height', 'Fills', 'Texts']),
      };
      const outPath = path.join(debugDir, `page-${pageIndex}.json`);
      await fs.writeJson(outPath, pagePayload, { spaces: 2 });
      console.log('[domjudge_pdf] 已写入分页 pdf2json 解析数据:', outPath);
    }
  }

  if (debug) {
    const fullPath = path.join(debugDir, 'pdf2json-full.json');
    await fs.writeJson(fullPath, pdfData, { spaces: 2 });
    console.log('[domjudge_pdf] 已写入 pdf2json 全量解析数据:', fullPath);
  }

  const page0YGroupedFills = pageYGroupedFills[0];
  const page0YKeys = Object.keys(page0YGroupedFills).map(Number);
  const page0MinY = page0YKeys.length > 0 ? Math.min(...page0YKeys) : undefined;

  let columnRanges: ColumnRange[] = [];
  let separatorX: number[] = [];
  if (page0MinY !== undefined) {
    const colResult = computeColumnRanges(page0YGroupedFills, page0MinY);
    columnRanges = colResult.columnRanges;
    separatorX = colResult.separatorX;
  }

  const gridPages: Array<{ pageIndex: number; rowRanges: RowRange[]; separatorY: number[] }> = [];
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const yGroupedFills = pageYGroupedFills[pageIndex];
    const rowResult = computeRowRangesForPage(yGroupedFills, pageIndex);
    gridPages.push({ pageIndex, rowRanges: rowResult.rowRanges, separatorY: rowResult.separatorY });
  }

  if (debug) {
    const gridDebugPath = path.join(debugDir, 'grid-debug.json');
    await fs.writeJson(
      gridDebugPath,
      {
        columnRanges,
        separatorX,
        pages: gridPages,
      },
      { spaces: 2 },
    );
    console.log('[domjudge_pdf] 已写入行列检测调试数据:', gridDebugPath);
  }

  const { logicalRowsWithCells, cellsDebug } = assignTextsToCells(pages, gridPages, columnRanges);
  if (debug) {
    const cellsDebugPath = path.join(debugDir, 'cells-debug.json');
    await fs.writeJson(cellsDebugPath, cellsDebug, { spaces: 2 });
    console.log('[domjudge_pdf] 已写入单元格检测调试数据:', cellsDebugPath);

    const cellsConcatenated = {
      rows: logicalRowsWithCells.map((row) => ({
        globalRowIndex: row.globalRowIndex,
        pageIndex: row.pageIndex,
        pageRowIndex: row.pageRowIndex,
        cells: row.cells.map((texts, colIndex) => ({
          colIndex,
          colName: columnRanges[colIndex]?.name,
          texts: cellTextsToConcatenatedLines(texts),
        })),
      })),
    };
    const cellsConcatenatedPath = path.join(debugDir, 'cells-concatenated.json');
    await fs.writeJson(cellsConcatenatedPath, cellsConcatenated, { spaces: 2 });
    console.log('[domjudge_pdf] 已写入单元格拼接结果:', cellsConcatenatedPath);
  }

  if (debug && debugPage !== undefined && pages[debugPage]) {
    const page = pages[debugPage];
    const fills = page.Fills ?? [];
    toDebugFillIndices = debugFills.filter((i) => i >= 0 && i < fills.length);
    // const bfFills = fills.map((f, i) => f.oc === '#bfbfbf' ? i : -1).filter((i) => i >= 0);
    // const whiteFills = fills.map((f, i) => f.clr === 1 ? i : -1).filter((i) => i > 0);
    // const curPageYFills = pageYGroupedFills[debugPage];
    // const curPageYKeys = Object.keys(curPageYFills).map(Number);
    // const selectedYFillIndices = curPageYFills[curPageYKeys[0]].map((f) => f.index);
    // toDebugFillIndices = _.uniq([...toDebugFillIndices, ...selectedYFillIndices]);

    for (const i of toDebugFillIndices) {
      const f = fills[i];
      delete f.clr;
      (f as Record<string, unknown>).oc = DEBUG_FILL_OC;
    }
    const debugFillsModifiedPath = path.join(debugDir, 'debug-fills-modified.json');
    await fs.writeJson(
      debugFillsModifiedPath,
      { pageIndex: debugPage, Fills: fills },
      { spaces: 2 },
    );
    console.log('[domjudge_pdf] 已写入修改后 fills:', debugFillsModifiedPath);
  }

  if (debug) {
    await writeDebugPdfWithGrid(
      resolvedPdf,
      debugDir,
      pdfData,
      { columnRanges, separatorX, pages: gridPages },
      debugPage,
      debugFills,
    );
  }

  const srkRows = logicalRowsWithCells.map((row) =>
    parseRowToSrkRow(row.cells, columnRanges, row.globalRowIndex),
  );
  return buildSrkFromRows(srkRows);
}

const DEBUG_FILL_OC = '#ffa500'; // 橙色
const LINE_THICKNESS = 0.8;

type GridDebugData = {
  columnRanges: ColumnRange[];
  separatorX: number[];
  pages: Array<{ pageIndex: number; rowRanges: RowRange[]; separatorY: number[] }>;
};

/**
 * 生成 debug.pdf：每页绘制红色列分隔线、蓝色行分隔线；若设置了 debugPage/debugFills 则在该页再绘制橙色 fill。
 */
async function writeDebugPdfWithGrid(
  pdfPath: string,
  debugDir: string,
  pdfData: Pdf2JsonRoot,
  gridData: GridDebugData,
  debugPage?: number,
  debugFills?: number[],
): Promise<void> {
  const pdfBytes = await fs.readFile(pdfPath);
  const doc = await PDFDocument.load(pdfBytes);
  const pdfPages = doc.getPages();
  const pages = pdfData.Pages ?? [];
  const red = rgb(1, 0, 0);
  const blue = rgb(0, 0, 1);

  for (let pageIndex = 0; pageIndex < pdfPages.length; pageIndex++) {
    const pdfPage = pdfPages[pageIndex];
    const page = pages[pageIndex];
    const pdfW = pdfPage.getWidth();
    const pdfH = pdfPage.getHeight();
    const jsonW = (page?.Width ?? pdfW) as number;
    const jsonH = (page?.Height ?? pdfH) as number;
    const scaleX = pdfW / jsonW;
    const scaleY = pdfH / jsonH;

    for (const xForm of gridData.separatorX) {
      const xPdf = xForm * scaleX;
      pdfPage.drawLine({
        start: { x: xPdf, y: 0 },
        end: { x: xPdf, y: pdfH },
        thickness: LINE_THICKNESS,
        color: red,
      });
    }

    const pageGrid = gridData.pages.find((p) => p.pageIndex === pageIndex);
    if (pageGrid) {
      for (const yForm of pageGrid.separatorY) {
        const yPdf = pdfH - yForm * scaleY;
        pdfPage.drawLine({
          start: { x: 0, y: yPdf },
          end: { x: pdfW, y: yPdf },
          thickness: LINE_THICKNESS,
          color: blue,
        });
      }
    }

    if (debugPage === pageIndex && page) {
      const fills = page.Fills ?? [];
      const orange = rgb(1, 165 / 255, 0);
      for (const i of toDebugFillIndices) {
        const f = fills[i];
        const x = (f.x ?? 0) * scaleX;
        const w = (f.w ?? 0) * scaleX;
        const h = (f.h ?? 0) * scaleY;
        const yForm = (f.y ?? 0) + (f.h ?? 0);
        const yPdf = pdfH - yForm * scaleY;
        pdfPage.drawRectangle({
          x,
          y: yPdf,
          width: w,
          height: h,
          color: orange,
          opacity: 0.95,
        });
      }
    }
  }

  const outPdfPath = path.join(debugDir, 'debug.pdf');
  const outBytes = await doc.save();
  await fs.writeFile(outPdfPath, outBytes);
  console.log('[domjudge_pdf] 已写入调试 PDF:', outPdfPath);
}
