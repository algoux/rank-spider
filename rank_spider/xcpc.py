import json
import requests
import rank3
import re
import os
from typing import Dict, List, Union


# contest_name: url
contest_url = {}
# url: {contest_name: name, status: v}
unkown_contest = {}

def set_contest_url(path: str, config):
    url = f'https://board.xcpcio.com{path}'
    contest_url[config['contest_name']] = url
    print(f'name: {config["contest_name"]}, url: {url}')



def get(url: str):
    try:
        result = requests.get(url=url, timeout=180)
    except Exception as e:
        print('请求 URL 发生错误', e)
        return

    if result.status_code != 200:
        print("请求被拒绝，状态码：", result.status_code)
        return

    result.encoding = 'utf-8'
    return result.json()
    

sr_results = {
    'ACCEPTED': rank3.SR_Accepted,
    'WRONG_ANSWER': rank3.SR_WrongAnswer,
    'RUNTIME_ERROR': rank3.SR_RuntimeError,
    'TIME_LIMIT_EXCEEDED': rank3.SR_TimeLimitExceeded,
    'COMPILATION_ERROR': rank3.SR_CompilationError,
    'MEMORY_LIMIT_EXCEEDED': rank3.SR_MemoryLimitExceeded,
    'OUTPUT_LIMIT_EXCEEDED': rank3.SR_OutputLimitExceeded,
    'PRESENTATION_ERROR': rank3.SR_PresentationError,
    'NO_OUTPUT': rank3.SR_NoOutput,
    'CORRECT': rank3.SR_Accepted,
    'INCORRECT': rank3.SR_Rejected,
    'PENDING': rank3.SR_Frozen,
    'FROZEN': rank3.SR_Frozen,
}


srkDefaultBallonColors = [
  'rgba(189, 14, 14, 0.7)',
  'rgba(149, 31, 217, 0.7)',
  'rgba(16, 32, 96, 0.7)',
  'rgba(38, 185, 60, 0.7)',
  'rgba(239, 217, 9, 0.7)',
  'rgba(243, 88, 20, 0.7)',
  'rgba(12, 76, 138, 0.7)',
  'rgba(156, 155, 155, 0.7)',
  'rgba(4, 154, 115, 0.7)',
  'rgba(159, 19, 236, 0.7)',
  'rgba(42, 197, 202, 0.7)',
  'rgba(142, 56, 54, 0.7)',
  'rgba(144, 238, 144, 0.7)',
]

class Parse:
    time_unit = 'ms'
    def __init__(self, config: Dict, teams: Dict, runs: Dict) -> None:
        self.config = config
        self.teams = teams
        self.runs = runs
        self.num_problems = len(config['problem_id'])
        self.group = config.get('group', {})

        self.statistics = [[0, 0] for i in self.config['problem_id']]
        self.statuses = {}
        self.__calculate()

    def contest(self) -> rank3.Contest:
        duration = (self.config['end_time'] - self.config['start_time']) / 3600
        return rank3.Contest(self.config['contest_name'], self.config['start_time'], duration, self.config['frozen_time'] / 3600)

    def problems(self) -> List[rank3.Problem]:
        problems = []
        f = 1
        for i, v in enumerate(self.config['problem_id']):
            style = None
            if self.config.get('balloon_color') is not None:
                color = self.config['balloon_color'][i]
                style = (color['background_color'], color['color'])
                if(i <= 12 and color['background_color'] != srkDefaultBallonColors[i]):
                    f = 0
                    break

        for i, v in enumerate(self.config['problem_id']):
            style = None
            if self.config.get('balloon_color') is not None:
                color = self.config['balloon_color'][i]
                style = (color['background_color'], color['color'])
            if f == 1:
                style = None
            problems.append(rank3.Problem(v, self.statistics[i], style))
        return problems

    def series(self, markers) -> Dict[str, Union[List[rank3.Series], bool]]:
        self.gold, self.silver, self.bronze = 0, 0, 0
        ccpcFlag = False
        toRemarks = True
        if type(self.config.get('medal')) is dict and self.config['medal'].get('official') is not None:
            self.gold = self.config['medal']['official']['gold']
            self.silver = self.config['medal']['official']['silver']
            self.bronze = self.config['medal']['official']['bronze']
            toRemarks = False
        elif type(self.config.get('medal')) is str:
            if self.config.get('medal') == 'CCPC' or self.config.get('medal') == 'ccpc':
                self.gold = 0.1
                self.silver = 0.2
                self.bronze = 0.3
                ccpcFlag = True
                toRemarks = False
        else:
            self.gold = 0
            self.silver = 0
            self.bronze = 0

        all_rank = rank3.Series(title='R#', rule={"preset": "Normal"})


 
        if ccpcFlag is False:
            icpc_rule = {
                "preset": "ICPC",
                "options": {
                    "count": {"value": [self.gold, self.silver, self.bronze]}
                }
            }
        else:
            icpc_rule = {
                "preset": "ICPC",
                "options": {
                    "ratio": {"value": [self.gold, self.silver, self.bronze]}
                }
            }
        
        anotherSeries = []
        if len(markers) > 0:
            if type(self.config.get('medal')) is dict and self.config['medal'].get('official') is None:
                for key,value in self.config['medal'].items():
                    if type(value) is dict and value.get('gold') is not None and value.get('silver') is not None and value.get('bronze') is not None:
                        title = None
                        for marker in markers:
                            if marker.marker['id'] == key:
                                title = marker.marker['label'] + '#'
                                break
                        if title is None:
                            continue
                        rule = {
                            "preset": "ICPC",
                            "options": {
                                "count": {"value": [value['gold'], value['silver'], value['bronze']]},
                                "filter": {"byMarker": key}
                            }
                        }
                        anotherSeries.append(rank3.Series(title=title, segments=[('金奖', rank3.Style_Gold), ('银奖', rank3.Style_Silver), ('铜奖', rank3.Style_Bronze)], rule=rule))
                    else:
                        continue

        offical_rank = rank3.Series(title='#', segments=[('金奖', rank3.Style_Gold), ('银奖', rank3.Style_Silver), ('铜奖', rank3.Style_Bronze)], rule=icpc_rule)
        school_rank = rank3.Series(title='S#', rule={"preset": "UniqByUserField", "options": {"field": "organization", "includeOfficialOnly": True}})
        result = [offical_rank]
        if len(anotherSeries) > 0:
            result += anotherSeries
        result.append(all_rank)
        result.append(school_rank)
        return {
            "rows": result,
            "remarks": toRemarks
        }

    def markers(self) -> List[rank3.Marker]:
        all_markers = []
        colors = [ 'blue', 'green', 'yellow', 'orange', 'red', 'purple']
        index = 0
        femalePattern = r'女队'
        starPattern = r'打星'
        for key, value in self.group.items():
            if key == 'unofficial':
                continue
            if key == 'official':
                continue
            if re.search(starPattern, value):
                continue
            is_female = re.search(femalePattern, value) or (isinstance(key, str) and 'female' in key)
            style = 'pink' if is_female else colors[index % len(colors)]
            marker = rank3.Marker(key, value, style)
            all_markers.append(marker)
            if not is_female:
                index += 1
        # 拆分女队相关和普通 marker
        female_markers = [m for m in all_markers if ('female' in str(m.marker['id']).lower() or re.search(femalePattern, str(m.marker['label'])))]
        normal_markers = [m for m in all_markers if m not in female_markers]
        return normal_markers + female_markers

    def rows(self, markers) -> List[rank3.Row]:
        data = []
        for k, v in self.teams.items():
            u_markers = []

            # 判断是否有教练
            coach = None
            if v.get('coach', None) is not None:
                coach = v.get('coach')
            # 判断是否为正式队伍的逻辑
            original_official = v.get('official', 0) == 1
            group = v.get('group', [])
            group_unofficial = 'unofficial' in group

            explicit_official = v.get('official', False)
            explicit_unofficial = v.get('unofficial', group_unofficial)

            official = original_official  or explicit_official or not explicit_unofficial

            # group字段内的marker，只添加 markers 里存在的 id
            for t in group:
                if t is not None and t != 'official' and t != 'unofficial' and t != 'girl':
                    for m in markers:
                        if m.marker['id'] == t and m not in u_markers:
                            u_markers.append(m)
            # 检查group外层对象属性是否与markers重合
            for m in markers:
                if m.marker['id'] in v and m not in u_markers:
                    u_markers.append(m)

            # 判断是否为女队的逻辑（只要 markers 里有女队相关 marker 且 user 是女队且未加过就加）
            original_girl = v.get('girl') == 1
            group_girl = 'girl' in group
            is_girl_team = original_girl or group_girl
            # 女队相关 marker: id 含 female/girl 或 label 含“女队”
            female_markers = [m for m in markers if ('female' in str(m.marker['id']).lower() or 'girl' in str(m.marker['id']).lower() or '女队' in str(m.marker['label']))]
            # 检查当前 user 是否已加过女队相关 marker
            has_any_female_marker = any(m in u_markers for m in female_markers)
            if is_girl_team and not has_any_female_marker:
                for m in female_markers:
                    if m not in u_markers:
                        u_markers.append(m)

            members = None
            if v.get('members', None) is not None:
                members =  [x for x in v['members'] if x is not None and str(x).lower() != 'null']
            if coach is not None and type(members) is list:
                members.append(f"{coach} (教练)")
            user = rank3.User(v['name'], k, v.get('organization', None), members, official, u_markers)
            cnt, ctms = 0, 0
            statuses = self.statuses.get(str(k), [])

            use_accumulate_in_seconds = self.options()

            for v in statuses:

                v.duration //= 1000
                if v.result in [rank3.SR_Accepted, rank3.SR_FirstBlood]:
                    cnt += 1
                    if use_accumulate_in_seconds:
                        ctms += v.duration
                    else:
                        ctms += v.duration // 60 * 60
            score = [cnt, ctms//60*60 if use_accumulate_in_seconds else ctms]
            data.append({'user': user, 'score': score, 'status': statuses})
        data.sort(key=lambda x: (x['score'][0], -x['score'][1]), reverse=True)

        rows = []
        for d in data:
            row = rank3.Row(d['user'], d['score'], d['status'],self.num_problems)
            rows.append(row)
        return rows
    
    # 判断是否使用 accumulate_in_seconds 计算 penalty
    # 如果使用 accumulate_in_seconds 则返回 True，否则返回 False
    def options(self) -> bool:
        use_accumulate_in_seconds = (
                isinstance(self.config.get('options'), dict) and
                self.config['options'].get('calculation_of_penalty') == 'accumulate_in_seconds_and_finally_to_the_minute'
            )
        return use_accumulate_in_seconds
    
    def __calculate(self) -> None:

        first_blood = [0 for i in self.config['problem_id']]

        for v in self.runs:

            if self.statuses.get(str(v['team_id'])) is None:
                self.statuses[str(v['team_id'])] = [rank3.Status() for i in self.config['problem_id']]
            status = self.statuses[str(v['team_id'])][v['problem_id']]

            result = sr_results.get(v['status'].upper())
            if result is None:
                url = contest_url.get(self.config["contest_name"])
                unkown = unkown_contest.setdefault(url,
                                                   {'name': self.config["contest_name"], 'status': set(), 'count': 0})
                unkown['status'].add(v["status"])
                unkown['count'] += 1
                continue

            if status.result in [rank3.SR_Accepted, rank3.SR_FirstBlood]:
                continue


            tt = v['timestamp'] * 1000 if Parse.time_unit == 's' else v['timestamp']
            if result == rank3.SR_Accepted:
                if first_blood[v['problem_id']] == 0 or first_blood[v['problem_id']] == tt:
                    result = rank3.SR_FirstBlood
                    first_blood[v['problem_id']] = tt
            
            status.result = result

            if status.solutions is None:
                status.solutions = []
            status.solutions.append({
                'result': result,
                'time': [v['timestamp'], Parse.time_unit],
            })

            if result not in [rank3.SR_FirstBlood, rank3.SR_Accepted, rank3.SR_Rejected, rank3.SR_Frozen]:
                status.result = rank3.SR_Rejected

            if result in [rank3.SR_FirstBlood, rank3.SR_Accepted] :
                status.duration = 20 * 60 * 1000 * status.tries + tt


            if result not in [rank3.SR_CompilationError, rank3.SR_PresentationError, rank3.SR_UnknownError]:
                status.tries += 1

            self.statuses[str(v['team_id'])][v['problem_id']] = status

            if result == rank3.SR_Accepted or result == rank3.SR_FirstBlood :
                self.statistics[v['problem_id']][0] += 1
            self.statistics[v['problem_id']][1] += 1


def main():
    url = get('https://board.xcpcio.com/data/index/contest_list.json')
    icpc = {}
    for k, v in url['icpc'].items():
        for vk, vv in v.items():
            if vv.get('board_link'):
                icpc[k+vk] = vv['board_link']

    ccpc = {}
    for k, v in url['ccpc'].items():
        for vk, vv in v.items():
            if vv.get('board_link'):
                ccpc[k+vk] = vv['board_link']
    province = {}
    for k, v in url['provincial-contest'].items():
        for vk, vv in v.items():
            if vv.get('board_link'):
                province[k+vk] = vv['board_link']
        
    icpc.pop('2018world-finals')
    icpc.pop('2019world-finals')
    icpc.pop('2020world-finals')
    icpc.pop('2020world-finals-Invitational')
    icpc.pop('48thworld-finals')
    for k, v in icpc.items():
        call_rank(path=v, name=f'icpc/icpc{k}.srk.json')
    for k, v in ccpc.items():
        call_rank(path=v, name=f'ccpc/ccpc{k}.srk.json')
    for k, v in province.items():
        call_rank(path=v, name=f'province/ccpc{k}.srk.json')
    print(unkown_contest)


def call_rank(path: str, name: str):
    print(path, name)
    config = get(f'https://board.xcpcio.com/data{path}/config.json')
    teams = get(f'https://board.xcpcio.com/data{path}/team.json')
    runs = get(f'https://board.xcpcio.com/data{path}/run.json')

    if config is None:
        print(f"{path} 获取 config.json 失败")
        return
    if teams is None:
        print(f"{path} 获取 team.json 失败")
        return
    if runs is None:
        print(f"{path} 获取 run.json 失败")
        return

    set_contest_url(path, config)
    runs.sort(key=lambda x: x['timestamp'])
    if len(runs) == 0:
        print(path, name, "获取提交记录为空")
        return
    Parse.time_unit = 'ms'

    # for 

    if runs[0]['timestamp']/1000 < 1:
        print(f"获取 runs 失败, {runs[0]['timestamp']}")
        Parse.time_unit = 's'
    parse = Parse(config, teams, runs)
    contest = parse.contest()
    problems = parse.problems()
    marker = parse.markers()
    series = parse.series(marker)
    rows = parse.rows(marker)
    options = parse.options()
    r = rank3.Rank(contest, 
                   problems, 
                   series['rows'], 
                   rows, 
                   marker, 
                   contributors=['XCPCIO (https://xcpcio.com)', 'algoUX (https://algoux.org)'], 
                   penaltyTimeCalculation = 's' if options else 'min',
                   isRemarks = series['remarks'],
                   )
    os.makedirs(os.path.dirname(name), exist_ok=True)
    with open(name, 'w', encoding='utf-8') as file:
        json.dump(r.result(), file, ensure_ascii=False)

def once():
    call_rank('/icpc/48th/nanjing', 'temp/nanjing.srk.json')


if __name__ == '__main__':
    main()
    # once()