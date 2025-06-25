import XLSX from 'xlsx';
import type * as srk from '@algoux/standard-ranklist';
import { UniversalSrkGenerator } from '../generators/universal';
import { numberToAlphabet } from '@algoux/standard-ranklist-utils';

export function ptaExcelToSrk(excelPath: string): { title: string; body: string[][] } {
  const workbook = XLSX.readFile(excelPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  // 读取第一行第一列的文本内容
  const firstCell = sheet['A1'];
  const firstCellText = firstCell.v as string;
  const title = firstCellText
    .trim()
    .replace(/^成绩明细 -/, '')
    .replace(/- 全体考生$/, '')
    .trim();

  const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 2 });

  // 过滤掉空行，并将所有数据转换为字符串
  const body: string[][] = jsonData
    .filter(
      (row: any) =>
        row && row.length > 0 && row.some((cell: any) => cell !== null && cell !== undefined),
    )
    .map((row: any) =>
      row.map((cell: any) => (cell === null || cell === undefined ? '' : String(cell))),
    );

  return {
    title,
    body,
  };
}

export async function run(
  filePath: string,
  userParser?: (idCol: string, nameCol: string) => srk.User,
) {
  const { title, body } = ptaExcelToSrk(filePath);
  const problemNum = body[0].length - 5;
  const problems: srk.Problem[] = [];
  for (let i = 0; i < problemNum; i++) {
    problems.push({
      alias: numberToAlphabet(i),
    });
  }

  const generator = new UniversalSrkGenerator();
  generator.init({
    contest: {
      title: {
        'zh-CN': title,
        fallback: title,
      },
      startAt: '2000-01-01T00:00:00+08:00',
      duration: [300, 'min'],
      frozenDuration: [60, 'min'],
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
    markers: [],
    remarks: {
      'zh-CN': '这个榜单缺失奖牌数据，如果您有该比赛的原始榜单或获奖名单，欢迎联系我们补充数据。',
      fallback:
        'This ranklist lacks medal data. If you have the original ranklist or the list of winners, please contact us to supplement the data.',
    },
  });

  const rows: srk.RanklistRow[] = [];
  for (const row of body) {
    const [_, id, name, score, time, ...problemCols] = row;
    const idCol = id.trim();
    if (rows.find((row) => row.user.id === idCol)) {
      continue;
    }
    if (_.trim() === '缺考') {
      continue;
    }
    const nameCol = name.trim();
    const user: srk.User = userParser?.(idCol, nameCol) || {
      id: idCol,
      name: nameCol,
      organization: '',
      official: true,
    };
    const statuses: srk.RankProblemStatus[] = [];
    for (let i = 0; i < problemCols.length; i++) {
      const problemCol = problemCols[i].trim();
      if (problemCol === '-') {
        statuses.push({ result: null });
        continue;
      }
      let [triesMarkPart, timePart] = problemCol.split('\n');
      triesMarkPart = triesMarkPart.trim();
      if (!timePart) {
        statuses.push({ result: 'RJ', tries: -1 * parseInt(triesMarkPart) }); // '-1' 等
        continue;
      }
      timePart = timePart.trim();
      const tries = parseInt(triesMarkPart.replace(/^\+/, '') || '0') + 1; // '+', '+1' 等
      const time = parseInt(timePart);
      statuses.push({ result: 'AC', tries, time: [time, 'min'] });
    }
    rows.push({
      user,
      score: { value: parseInt(score), time: [parseInt(time), 'min'] },
      statuses,
    });
  }
  generator.setRows(rows);
  generator.build({
    calculateFB: false,
  });
  const srkObject = generator.getSrk();
  return srkObject;
}
