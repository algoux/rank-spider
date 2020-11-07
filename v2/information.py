"""
id:           string 队伍 Id
name:         string 队伍名
organization: string 组织名（一般是学校名）
coach:        string 教练姓名
member:       ["队员1", "队员二", "队员三"] 队员名（"|" 分割多个队员的姓名）
official:     bool    是否是正式队（正式队 1，友情队 0）
marker:       string 特殊标记队伍（如：女队）
problems:     string 队伍提交的题目信息，是个 json 数据

problems 中的数据
{
    "ac_total": int （通过的题目数）
    "time":     int （总用时，单位秒）
    "label": {
        "label_id": {
            "first_blood": bool （是否是一血）
            "submissions": [ （有序提交记录）
                {
                    "result": string （提交的结果）
                    "time_duration": int (相对时间，单位秒）
                }
            ]
            "accept_at": int (AC 时间，相对时间，单位秒)
        }
    }
}

json 数据样例
{
    id: {
        name: string,
        organization: string,
        coach: string,
        member: ["队员名"],
        official: bool,
        marker: string,
        problems: {
            "ac_total": int,
            "time":     int,
            "label": {
                "first_blood": bool,
                "submissions": [
                    {
                        "result": string,
                        "time_duration": int,
                    }
                ],
                "accept_at": int (AC 时间，相对时间，单位秒)
            }
        }
    }
}
"""

import json
import csv


def main():
    infos = get_info('CCPC2020.csv')
    with open('CCPC2020.json', 'w', encoding='utf-8') as file:
        json.dump(infos, file, ensure_ascii=False)


def get_info(filename: str):
    """
    :param filename: str
    :return: information: dict{}

    从 csv 文件中获取数据，文件以逗号分割，并且数据格式必须为：
    team_id,学校,队名,教练,队员一,队员二,队员三,是否女队，参数类型
    """
    infos = {}
    with open(filename, 'r', encoding='utf-8') as file:
        rows = csv.reader(file)
        next(rows)
        for row in rows:
            info = {
                'id': row[0],
                'organization': row[1],
                'name': row[2],
                'coach': row[3],
                'members': [row[4], row[5], row[6]],
                'official': False,
                'problems': {
                    'ac_total': 0,
                    'time': 0,  # 单位秒
                    'label': {},
                }
            }

            # 特殊队伍判断
            if row[-2] == '女队':
                info['marker'] = 'female'
            if row[-1] != '打星参赛':
                info['official'] = True

            infos[row[0]] = info

    print(infos)
    return infos


if __name__ == '__main__':
    main()
