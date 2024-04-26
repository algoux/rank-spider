import json
import requests
import rank3

from typing import Dict, List


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


class Parse:
    time_unit = 'ms'
    def __init__(self, config: Dict, teams: Dict, runs: Dict) -> None:
        self.config = config
        self.teams = teams
        self.runs = runs

        self.statistics = [[0, 0] for i in self.config['problem_id']]
        self.statuses = {}
        self.__calculate()

    def contest(self) -> rank3.Contest:
        duration = (self.config['end_time'] - self.config['start_time']) / 3600
        return rank3.Contest(self.config['contest_name'], self.config['start_time'], duration, self.config['frozen_time'] / 3600)

    def problems(self) -> List[rank3.Problem]:
        problems = []
        for i, v in enumerate(self.config['problem_id']):
            style = None
            if self.config.get('balloon_color') is not None:
                color = self.config['balloon_color'][i]
                style = (color['background_color'], color['color'])
            problems.append(rank3.Problem(v, self.statistics[i], style))
        return problems

    def series(self) -> List[rank3.Series]:
        self.gold, self.silver, self.bronze = 0, 0, 0
        if type(self.config.get('medal')) is dict and self.config['medal'].get('official') is not None:
            self.gold = self.config['medal']['official']['gold']
            self.silver = self.config['medal']['official']['silver']
            self.bronze = self.config['medal']['official']['bronze']

        all_rank = rank3.Series(title='R#', rule={"preset": "Normal"})
        icpc_rule = {
            "preset": "ICPC",
            "options": {
                "count": {"value": [self.gold, self.silver, self.bronze]}
            }
        }
        offical_rank = rank3.Series(title='#', segments=[('金奖', rank3.Style_Gold), ('银奖', rank3.Style_Silver), ('铜奖', rank3.Style_Bronze)], rule=icpc_rule)
        school_rank = rank3.Series(title='S#', rule={"preset": "UniqByUserField", "options": {"field": "organization", "includeOfficialOnly": True}})
        return [offical_rank, all_rank, school_rank]

    def markers(self) -> List[rank3.Marker]:
        return [rank3.Marker('female', '女队', 'pink')]

    def rows(self) -> List[rank3.Row]:
        data = []
        for k, v in self.teams.items():
            official = v.get('official', 0) == 1
            marker = None
            if v.get('girl') == 1:
                marker = rank3.Marker('female', '女队', 'pink')
            user = rank3.User(v['name'], k, v.get('organization', None), v.get('members', None), official, marker)
            cnt, ctms = 0, 0
            statuses = self.statuses.get(str(k), [])
            for v in statuses:
                v.duration //= 1000
                if v.result in [rank3.SR_Accepted, rank3.SR_FirstBlood]:
                    cnt += 1
                    ctms += v.duration//60*60
            score = [cnt, ctms]
            data.append({'user': user, 'score': score, 'status': statuses})
        data.sort(key=lambda x: (x['score'][0], -x['score'][1]), reverse=True)

        rows = []
        for d in data:
            row = rank3.Row(d['user'], d['score'], d['status'])
            rows.append(row)
        return rows

    def __calculate(self) -> None:
        frist_blood = [0 for i in self.config['problem_id']]
        for v in self.runs:
            if self.statuses.get(str(v['team_id'])) is None:
                self.statuses[str(v['team_id'])] = [rank3.Status() for i in self.config['problem_id']]
            status = self.statuses[str(v['team_id'])][v['problem_id']]
            if status.result == rank3.SR_Accepted:
                continue
            
            result = sr_results.get(v['status'].upper())
            if result is None:
                url = contest_url.get(self.config["contest_name"])
                unkown = unkown_contest.setdefault(url, {'name': self.config["contest_name"], 'status': set(), 'count': 0})
                unkown['status'].add(v["status"])
                unkown['count'] += 1
                continue

            tt = v['timestamp'] * 1000 if Parse.time_unit == 's' else v['timestamp']
            if result == rank3.SR_Accepted:
                if frist_blood[v['problem_id']] == 0 or frist_blood[v['problem_id']] == tt:
                    result = rank3.SR_FirstBlood
                    frist_blood[v['problem_id']] = tt
            
            status.result = result
            if result not in [rank3.SR_FirstBlood, rank3.SR_Accepted, rank3.SR_Rejected, rank3.SR_Frozen]:
                status.result = rank3.SR_Rejected
            
            if result in [rank3.SR_FirstBlood, rank3.SR_Accepted]:
                status.duration = 20 * 60 * 1000 * status.tries + tt
                # print(f'duration={status.duration}, tries={status.tries}, timestamp={v["timestamp"]}, unit={Parse.time_unit}')
            
            if result not in [rank3.SR_CompilationError, rank3.SR_PresentationError, rank3.SR_UnknownError, rank3.SR_NoOutput, rank3.SR_RuntimeError]:
                status.tries += 1

            if status.solutions is None:
                status.solutions = []
            status.solutions.append({
                'result': result,
                'time': [v['timestamp'], Parse.time_unit],
            })
            self.statuses[str(v['team_id'])][v['problem_id']] = status

            if result == rank3.SR_Accepted:
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
    series = parse.series()
    marker = parse.markers()
    rows = parse.rows()
    r = rank3.Rank(contest, problems, series, rows, marker, contributors=['XCPCIO (https://xcpcio.com/)', 'algoUX (https://algoux.org)'])
    with open(name, 'w', encoding='utf-8') as file:
        json.dump(r.result(), file, ensure_ascii=False)

def once():
    call_rank('/icpc/48th/nanjing', 'temp/nanjing.srk.json')


if __name__ == '__main__':
    main()
    # once()