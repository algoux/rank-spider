import json
import requests
import rank

from typing import Dict, List


def get(url: str):
    try:
        result = requests.get(url=url, timeout=5)
    except Exception as e:
        print('请求 URL 发生错误', e)
        return

    if result.status_code != 200:
        print("请求被拒绝，状态码：", result.status_code)
        return

    result.encoding = 'utf-8'
    return result.json()
    

class Parse:
    def __init__(self, config: Dict, teams: Dict, runs: Dict) -> None:
        self.config = config
        self.teams = teams
        self.runs = runs

        self.statistics = [[0, 0] for i in self.config['problem_id']]
        self.statuses = {}
        self.__calculate()

    def contest(self) -> rank.Contest:
        start_time = self.config.get('start_time')
        end_time = self.config.get('end_time')
        frozen_time = self.config.get('frozen_time', 0)

        # 兼容毫秒级或秒级时间戳
        if start_time is not None and start_time > 946684800000:
            start_time = start_time // 1000
        if end_time is not None and end_time > 946684800000:
            end_time = end_time // 1000

        duration = (end_time - start_time) / 3600

        # 处理 frozen_time：同 xcpc.py 的策略
        frozen_hours = 0
        try:
            if frozen_time is None:
                frozen_hours = 0
            elif isinstance(frozen_time, (int, float)) and frozen_time > 946684800000:
                frozen_ts = int(frozen_time) // 1000
                frozen_hours = (end_time - frozen_ts) / 3600
            elif isinstance(frozen_time, (int, float)) and frozen_time > 1000:
                frozen_hours = float(frozen_time) / 1000.0 / 3600.0
            else:
                if isinstance(frozen_time, (int, float)) and frozen_time > 3600:
                    frozen_hours = float(frozen_time) / 3600.0
                else:
                    frozen_hours = float(frozen_time)
        except Exception:
            frozen_hours = 0

        return rank.Contest(self.config['contest_name'], start_time, duration, frozen_hours)

    def problems(self) -> List[rank.Problem]:
        problems = []
        for i, v in enumerate(self.config['problem_id']):
            style = None
            if self.config.get('balloon_color') is not None:
                color = self.config['balloon_color'][i]
                style = (color['background_color'], color['color'])
            problems.append(rank.Problem(v, self.statistics[i], style))
        return problems

    def series(self) -> List[rank.Series]:
        self.gold, self.silver, self.bronze = 0, 0, 0
        if self.config.get('medal') is not None and self.config['medal'].get('official') is not None:
            self.gold = self.config['medal']['official']['gold']
            self.silver = self.config['medal']['official']['silver']
            self.bronze = self.config['medal']['official']['bronze']
        return [rank.Series('#', [('金奖', self.gold, rank.Style_Gold), ('银奖', self.silver, rank.Style_Silver), ('铜奖', self.bronze, rank.Style_Bronze)]), rank.Series('R#'), rank.Series('S#')]

    def markers(self) -> List[rank.Marker]:
        return [rank.Marker('female', '女队', 'pink')]

    def rows(self) -> List[rank.Row]:
        data = []
        for k, v in self.teams.items():
            official = v.setdefault('official', 0) == 1
            marker = None
            if v.get('girl') == 1:
                marker = rank.Marker('female', '女队', 'pink')
            user = rank.User(v['name'], k, v['organization'], v.setdefault('members', None), official, marker)
            cnt, ctm = 0, 0
            statuses = self.statuses.setdefault(str(k), [])
            for v in statuses:
                if v.result in [rank.SR_Accepted, rank.SR_FirstBlood]:
                    cnt += 1
                    ctm += v.duration
            score = [cnt, ctm]
            data.append({'user': user, 'score': score, 'status': statuses})
        data.sort(key=lambda x: (x['score'][0], -x['score'][1]), reverse=True)

        rows = []
        school = set()
        ofr, r, sr = 1, 1, 1
        ofr_i, r_i, sr_i = (0, 1000, 0), (0, 1000, 0), (0, 1000, 0)
        for d in data:
            order, o_order, s_order = rank.Order(), rank.Order(), rank.Order()
            # 计算总排名是否有并列情况
            if d['score'][0] != r_i[1] or d['score'][1] != r_i[2]:
                r_i = (r, d['score'][0], d['score'][1])
            order = rank.Order(r_i[0])
            r += 1

            if d['user'].user['official']:
                # 计算正式队伍是否有并列情况
                if d['score'][0] != ofr_i[1] or d['score'][1] != ofr_i[2]:
                    ofr_i = (ofr, d['score'][0], d['score'][1])
                if ofr_i[0] <= self.gold:
                    o_order = rank.Order(ofr_i[0], 0)
                elif ofr_i[0] <= self.gold + self.silver:
                    o_order = rank.Order(ofr_i[0], 1)
                elif ofr_i[0] <= self.gold + self.silver + self.bronze:
                    o_order = rank.Order(ofr_i[0], 2)
                else:
                    o_order = rank.Order(ofr_i[0])
                ofr += 1

                if d['user'].user['organization'] not in school:
                    # 计算学校是否有并列情况
                    if d['score'][0] != sr_i[1] or d['score'][1] != sr_i[2]:
                        sr_i = (sr, d['score'][0], d['score'][1])
                    s_order = rank.Order(sr_i[0])
                    sr += 1
                    school.add(d['user'].user['organization'])
            row = rank.Row([o_order, order, s_order], d['user'], d['score'], d['status'])
            rows.append(row)
        return rows

    def __calculate(self) -> None:
        frist_blood = [0 for i in self.config['problem_id']]
        for v in self.runs:
            if self.statuses.get(str(v['team_id'])) is None:
                self.statuses[str(v['team_id'])] = [rank.Status() for i in self.config['problem_id']]
            status = self.statuses[str(v['team_id'])][v['problem_id']]
            if status.result == rank.SR_Accepted:
                continue
            
            # 默认提交状态为：incorrect
            result = rank.SR_Rejected
            if v['status'] == 'correct':
                if frist_blood[v['problem_id']] == 0 or frist_blood[v['problem_id']] == v['timestamp']:
                    result = rank.SR_FirstBlood
                    frist_blood[v['problem_id']] = v['timestamp']
                else:
                    result = rank.SR_Accepted

            status.result = result
            status.duration = 20 * 60 * status.tries + v['timestamp']
            status.tries += 1
            if status.solutions is None:
                status.solutions = []
            status.solutions.append({
                'result': result,
                'time': [v['timestamp'], 's'],
            })
            self.statuses[str(v['team_id'])][v['problem_id']] = status

            if result == rank.SR_Accepted:
                self.statistics[v['problem_id']][0] += 1
            self.statistics[v['problem_id']][1] += 1


def main():
    url = get('https://board.xcpcio.com/data/index/contest_list.json')
    icpc = {}
    for k, v in url['icpc'].items():
        for vk, vv in v.items():
            if 'board_link' in vv:
                icpc[k+vk] = vv['board_link']

    ccpc = {}
    for k, v in url['ccpc'].items():
        for vk, vv in v.items():
            if 'board_link' in vv:
                ccpc[k+vv] = vv['board_link']
    province = {}
    for k, v in url['provincial-contest'].items():
        for vk, vv in v.items():
            if 'board_link' in vv:
                province[k+vk] = vv['board_link']
        
    icpc.pop('2018world-finals')
    icpc.pop('2019world-finals')
    icpc.pop('2020world-finals')
    icpc.pop('2020world-finals-Invitational')
    for k, v in icpc.items():
        print(v)
        config = get(f'https://board.xcpcio.com/data{v}/config.json')
        teams = get(f'https://board.xcpcio.com/data{v}/team.json')
        runs = get(f'https://board.xcpcio.com/data{v}/run.json')
        runs.sort(key=lambda x: x['timestamp'])
        parse = Parse(config, teams, runs)
        contest = parse.contest()
        problems = parse.problems()
        series = parse.series()
        marker = parse.markers()
        rows = parse.rows()
        r = rank.Rank(contest, problems, series, rows, marker, contributors=['XCPCIO (https://xcpcio.com/)', 'algoUX (https://algoux.org)'])
        with open(f'icpc/icpc{k}.srk.json', 'w', encoding='utf-8') as file:
            json.dump(r.result(), file, ensure_ascii=False)
    for k, v in ccpc.items():
        print(v)
        config = get(f'https://board.xcpcio.com/data{v}/config.json')
        teams = get(f'https://board.xcpcio.com/data{v}/team.json')
        runs = get(f'https://board.xcpcio.com/data{v}/run.json')
        runs.sort(key=lambda x: x['timestamp'])
        parse = Parse(config, teams, runs)
        contest = parse.contest()
        problems = parse.problems()
        series = parse.series()
        marker = parse.markers()
        rows = parse.rows()
        r = rank.Rank(contest, problems, series, rows, marker, contributors=['XCPCIO (https://xcpcio.com/)', 'algoUX (https://algoux.org)'])
        with open(f'ccpc/ccpc{k}.srk.json', 'w', encoding='utf-8') as file:
            json.dump(r.result(), file, ensure_ascii=False)
    for k, v in province.items():
        print(v)
        config = get(f'https://board.xcpcio.com/data{v}/config.json')
        teams = get(f'https://board.xcpcio.com/data{v}/team.json')
        runs = get(f'https://board.xcpcio.com/data{v}/run.json')
        runs.sort(key=lambda x: x['timestamp'])
        parse = Parse(config, teams, runs)
        contest = parse.contest()
        problems = parse.problems()
        series = parse.series()
        marker = parse.markers()
        rows = parse.rows()
        r = rank.Rank(contest, problems, series, rows, marker, contributors=['XCPCIO (https://xcpcio.com/)', 'algoUX (https://algoux.org)'])
        with open(f'province/ccpc{k}.srk.json', 'w', encoding='utf-8') as file:
            json.dump(r.result(), file, ensure_ascii=False)


if __name__ == '__main__':
    main()