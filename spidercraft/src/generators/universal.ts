import type * as srk from '@algoux/standard-ranklist';
import {
  CalculatedSolutionTetrad,
  formatTimeDuration,
  getSortedCalculatedRawSolutions,
  regenerateRanklistBySolutions,
} from '@algoux/standard-ranklist-utils';

const SRK_VERSION = '0.3.9';

export interface SrkGeneratorInitOptions {
  contest: srk.Contest;

  problems: srk.Problem[];

  /**
   * 排名系列配置。
   *
   * 当存在这个配置时，优先级比其他预设值高。
   *
   * @defaultValue 含一列名称为 `R#` 的全排名系列。
   */
  series?: srk.RankSeries[];

  /**
   * 排名系列配置。
   *
   * 当存在这个配置时，优先级比其他预设值高。
   */
  markers?: srk.Marker[];

  /**
   * 排名系列排序配置。
   *
   * 当存在这个配置时，优先级比其他预设值高。
   */
  sorter?: srk.Sorter;

  contributors?: srk.Contributor[];

  remarks?: srk.Text;

  /**
   * 是否启用 ICPC 生成预设。
   *
   * 当启用时，通常可以省略 `series`、`markers`、`sorter`、`contributors` 和 `remarks` 配置。
   *
   * 预设行为：
   * - `series`：使用 ICPC 通用预设的排名系列（包含 `#`、`R#`、`S#`）。
   * - `markers`：含粉色预设的 female 女队标记。
   * - `sorter`：使用 ICPC 通用预设的排序配置。
   */
  useICPCPreset?: boolean;

  /** ICPC 生成预设配置。 */
  icpcPresetOptions?: {
    /**
     * 指定金银铜主排名的计算规则。
     *
     * @defaultValue 按照 0.1、0.2、0.3 的比例向上取整计算，包含未产生提交的全部选手。
     */
    mainRankSeriesRule?: srk.RankSeriesRulePresetICPC['options'];

    /**
     * 指定不计算罚时的结果。
     *
     * @defaultValue Based on srk spec
     * @reference srk.SorterICPC['config']['noPenaltyResults']
     */
    sorterNoPenaltyResults?: srk.SorterICPC['config']['noPenaltyResults'];

    /**
     * 分数的总时间部分在累加计算时采用的时间精度。
     *
     * @defaultValue 不进行转换，而是取决于 rows 中提供的原始数据
     * @reference srk.SorterICPC['config']['timePrecision']
     *
     */
    sorterTimePrecision?: srk.SorterICPC['config']['timePrecision'];

    /**
     * 分数的总时间部分在累加计算时，时间精度转换的取整方式。
     *
     * @defaultValue Based on srk spec
     * @reference srk.SorterICPC['config']['timeRounding']
     */
    sorterTimeRounding?: srk.SorterICPC['config']['timeRounding'];

    /**
     * 排名计算时采用的时间精度。
     *
     * @defaultValue Based on srk spec
     * @reference srk.SorterICPC['config']['rankingTimePrecision']
     */
    sorterRankingTimePrecision?: srk.SorterICPC['config']['rankingTimePrecision'];

    /**
     * 排名计算时，时间精度转换的取整方式。
     *
     * @defaultValue Based on srk spec
     * @reference srk.SorterICPC['config']['rankingTimeRounding']
     */
    sorterRankingTimeRounding?: srk.SorterICPC['config']['rankingTimeRounding'];
  };
}

export interface SrkGeneratorBuildOptions {
  /**
   * 是否计算题目的 FB。
   *
   * 当提供的 solutions 中包含 FB 的提交时，不会触发计算。
   *
   * @defaultValue false
   */
  calculateFB?: boolean;

  /**
   * 是否仅将正式参赛用户纳入 FB 计算。
   *
   * @defaultValue false
   */
  onlyIncludeOfficialForFB?: boolean;

  /**
   * 当存在由于时间精度所限导致的一道题目有多个相同提交时间的潜在 FB 的情况时，禁用 FB 计算。
   *
   * @defaultValue false
   */
  disableFBIfConflict?: boolean;

  /**
   * 信任 solutions 的顺序作为绝对先后顺序。
   *
   * 即使有多个相同提交时间的潜在 FB，也仅把按顺序第一个出现的提交视作 FB。
   *
   * 若开启此选项，`disableFBIfConflict` 将不会生效。
   *
   * @defaultValue false
   */
  useSolutionAbsoluteOrderForFB?: boolean;
}

export interface SrkGeneratorSolution extends srk.Solution {
  userId: srk.User['id'];
  problemIndexOrAlias: number | string;
}

export class UniversalSrkGenerator {
  private srkObject: srk.Ranklist;
  private members: srk.User[];
  private solutions: SrkGeneratorSolution[];

  constructor() {
    // @ts-ignore
    this.srkObject = {
      type: 'general',
      version: SRK_VERSION,
    };
  }

  /**
   * 初始化 srk 对象。
   * @param options 初始化选项
   */
  public init(options: SrkGeneratorInitOptions) {
    this.srkObject.contest = options.contest;

    if (options.contributors) {
      this.srkObject.contributors = options.contributors;
    }

    if (options.remarks) {
      this.srkObject.remarks = options.remarks;
    }

    if (options.series) {
      this.srkObject.series = options.series;
    } else if (options.useICPCPreset) {
      this.srkObject.series = [
        {
          title: '#',
          segments: [
            {
              style: 'gold',
              title: 'Gold Award',
            },
            {
              style: 'silver',
              title: 'Silver Award',
            },
            {
              style: 'bronze',
              title: 'Bronze Award',
            },
          ],
          rule: {
            preset: 'ICPC',
            options: options.icpcPresetOptions?.mainRankSeriesRule ?? {
              ratio: {
                value: [0.1, 0.2, 0.3],
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
        {
          title: 'S#',
          rule: {
            preset: 'UniqByUserField',
            options: {
              field: 'organization',
              includeOfficialOnly: true,
            },
          },
        },
      ];
    } else {
      this.srkObject.series = [
        {
          title: 'R#',
          rule: {
            preset: 'Normal',
          },
        },
      ];
    }

    if (options.sorter) {
      this.srkObject.sorter = options.sorter;
    } else if (options.useICPCPreset) {
      this.srkObject.sorter = {
        algorithm: 'ICPC',
        config: {
          noPenaltyResults: options.icpcPresetOptions?.sorterNoPenaltyResults ?? [
            'FB',
            'AC',
            '?',
            'CE',
            'UKE',
            null,
          ],
          penalty: [20, 'min'],
          timePrecision: options.icpcPresetOptions?.sorterTimePrecision,
          timeRounding: options.icpcPresetOptions?.sorterTimeRounding,
          rankingTimePrecision: options.icpcPresetOptions?.sorterRankingTimePrecision,
          rankingTimeRounding: options.icpcPresetOptions?.sorterRankingTimeRounding,
        },
      };
    }

    if (options.markers) {
      this.srkObject.markers = options.markers;
    } else if (options.useICPCPreset) {
      this.srkObject.markers = [
        {
          id: 'female',
          label: '女队',
          style: 'pink',
        },
      ];
    }

    this.srkObject.problems = options.problems;
  }

  /**
   * 设置 srk 已计算的排名列表。
   *
   * @param rows 排名列表
   */
  public setRows(rows: srk.RanklistRow[]) {
    this.srkObject.rows = rows;
  }

  /**
   * 设置参赛用户列表。
   *
   * @param members 比赛参赛用户列表
   */
  public setMembers(members: srk.User[]) {
    this.members = members;
  }

  /**
   * 设置全量 solutions。
   *
   * @param solutions 按照时间顺序递增的 solutions 列表
   */
  public setSolutions(solutions: SrkGeneratorSolution[]) {
    this.solutions = solutions;
  }

  /**
   * 构建 srk 对象。
   *
   * 这将会计算最终的 srk（如有提供 `solutions`，将计算排名并排序），并对 srk 中的计算属性进行下列完整性补充：
   * - `problems` 中的 statistics 数据
   * - 题目的 FB
   * @param options 构建选项
   */
  public build(options: SrkGeneratorBuildOptions = {}): void {
    if (!this.srkObject.contest || !this.srkObject.problems) {
      throw new Error(
        'Invalid srk: contest and problems must be initialized before building srk object',
      );
    }
    let solutions: CalculatedSolutionTetrad[];
    if (this.solutions && this.members) {
      // 如果提供了 solutions 和 members，则使用它们来计算生成 rows
      // 预检查 solutions 合法性
      let lastSolutionTime = -1;
      this.solutions.forEach((solution) => {
        const time = formatTimeDuration(solution.time);
        if (typeof time !== 'number' || time < 0 || time < lastSolutionTime) {
          throw new Error(
            `Invalid solution: solution ${JSON.stringify(solution)} has invalid time`,
          );
        }
        lastSolutionTime = time;
      });
      // 生成空 rows
      const problemAliasToIndexMap = new Map<string, number>();
      this.srkObject.problems.forEach((problem, index) => {
        if (problem.alias) {
          problemAliasToIndexMap.set(problem.alias, index);
        }
      });
      solutions = this.solutions.map((solution) => [
        solution.userId,
        typeof solution.problemIndexOrAlias === 'string'
          ? problemAliasToIndexMap.get(solution.problemIndexOrAlias) ?? -1
          : solution.problemIndexOrAlias,
        solution.result,
        solution.time,
      ]);
      this.srkObject.rows = this.members.map((member) => ({
        user: member,
        score: {
          value: 0,
          time: [0, 'ms'],
        },
        statuses: this.srkObject.problems.map(() => ({
          result: null,
        })),
      }));
    } else if (this.srkObject.rows) {
      // 从 rows 中提取 solutions
      solutions = getSortedCalculatedRawSolutions(this.srkObject.rows);
    } else {
      throw new Error(
        'Invalid srk: rows or (solutions and members) must be set before building srk object',
      );
    }

    if (options.calculateFB) {
      let disableFBCalc = false;
      const problemFBSolutionIndexMap = new Map<number, number>();
      solutions.forEach((solution, index) => {
        const [_, problemIndex, result] = solution;
        if (result === 'FB') {
          if (problemIndex < 0) {
            throw new Error(`Invalid FB solution: solution [${solution}] is invalid`);
          }
          if (!problemFBSolutionIndexMap.has(problemIndex)) {
            problemFBSolutionIndexMap.set(problemIndex, index);
          } else if (options.disableFBIfConflict) {
            disableFBCalc = true;
          }
        }
      });
      const fbSolutionIndexes: number[] = [];
      if (problemFBSolutionIndexMap.size === 0) {
        // 尝试计算 FB
        const userIdMap = new Map<string, srk.User>();
        this.srkObject.rows.forEach((row) => {
          userIdMap.set(row.user.id, row.user);
        });
        solutions.forEach((solution, index) => {
          const [userId, problemIndex, result, time] = solution;
          const user = userIdMap.get(userId);
          if (!user) {
            console.warn(`User ID ${userId} not found in members, skipping solution: ${solution}`);
            return;
          }
          if (options.onlyIncludeOfficialForFB && !user.official) {
            return;
          }

          if (result === 'AC') {
            if (problemIndex < 0) {
              throw new Error(`Invalid AC solution: solution [${solution}] is invalid`);
            }
            if (!problemFBSolutionIndexMap.has(problemIndex)) {
              problemFBSolutionIndexMap.set(problemIndex, index);
              fbSolutionIndexes.push(index);
            } else if (
              formatTimeDuration(time) ===
              formatTimeDuration(solutions[problemFBSolutionIndexMap.get(problemIndex)!][3])
            ) {
              if (!options.useSolutionAbsoluteOrderForFB) {
                fbSolutionIndexes.push(index);
                if (options.disableFBIfConflict) {
                  disableFBCalc = true;
                }
              }
              console.log(`Possible another same-time FB found: ${solution}`);
            }
          }
        });
      }
      if (!disableFBCalc) {
        fbSolutionIndexes.forEach((fbSolutionIndex) => {
          solutions[fbSolutionIndex][2] = 'FB';
        });
      } else {
        console.warn('FB calculation is disabled due to conflict: multiple solutions are FB');
      }
    }

    this.srkObject = regenerateRanklistBySolutions(this.srkObject, solutions);
  }

  public getSrk(): srk.Ranklist {
    if (
      !this.srkObject.contest ||
      !this.srkObject.problems ||
      !this.srkObject.series ||
      !this.srkObject.rows
    ) {
      throw new Error(
        'Invalid srk: related properties must be initialized before getting srk object',
      );
    }
    return this.srkObject;
  }
}
