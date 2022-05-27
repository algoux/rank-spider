import math
import yaml
import json
import time
import shutil
import sqlite3
import requests


time_format = '%Y-%m-%dT%H:%M:%S.%fZ'
utc_8 = 8 * 60 * 60

status = {
    1: 'AC',
    2: 'TLE',
    3: 'MLE',
    4: 'WA',
    5: 'RTE',
    6: 'OLE',
    7: 'CE',
    8: 'PE',
    9: 'SE',
}


headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/67.0.3396.99 Safari/537.36',
    'Accept': 'application/json;charset=UTF-8',
    'Referer': 'https://acm.sdut.edu.cn',
}


def main():
    config = get_config()
    if config['cookie'] != '':
        headers['cookie'] = config['cookie']

    spider = Spider(headers=headers, contest_id=config['contest_id'], limit=config['limit'])
    contest_config = spider.get_contest_config()
    
    db = Database(config.setdefault('database', 'sdutoj.db'))
    calculation = Calculation(contest_config, db)

    solution_id = config['submit_id']
    while True:
        solutions, t = spider.get_solution(solution_id=solution_id)
        scroll_data, sid = calculation.scroll(solutions)
        if sid is not None:
            solution_id = sid
        elif solution_id != config['submit_id'] and contest_config['end_at'] > t:
            print('数据拉取失败，10 秒后拉取。。。')
            time.sleep(10)
            continue

        dump_info(config['scroll_path'], scroll_data)
        rank_data = calculation.ranking(t)
        dump_info(config['ranking_path'], rank_data)
        if contest_config['end_at'] < t:
            print("比赛已结束，感谢使用")
            break

        format_time = time.strftime('%Y-%m-%d %H:%M', time.localtime())
        print(f'{format_time} 成功爬取 {len(solutions)} solution_id={solution_id}')
        time.sleep(config['duration'])



def get_config():
    """读取 config.yaml 文件"""
    with open('config.yaml', 'r', encoding='utf-8') as file:
        config = file.read()

    return yaml.Loader(config).get_data()


def dump_info(path, data):
    with open('temp.json', 'w', encoding='utf-8') as file:
        json.dump(data, file, ensure_ascii=False)

    # 此处直接复制文件，而不是写入文件，是为了避免写入文件时读取内容，导致读取的数据混乱
    # 采取复制的方式速度快，可避免写入时读取数据混乱的问题
    shutil.copy('temp.json', path)


class Spider:
    def __init__(self, headers: dict, contest_id: int, limit: int) -> None:
        self.headers = headers
        self.base_url = 'https://acm.sdut.edu.cn/onlinejudge3/api/'
        self.contest_id = contest_id
        self.limit = limit
    
    def get_contest_config(self) -> dict:
        json = {"competitionId": self.contest_id}
        # 获取比赛信息
        d = self._post(path='getCompetitionDetail', json=json)
        contest_config = {
            "title": d['title'],
            "start_at": int(time.mktime(time.strptime(d['startAt'], time_format))) + utc_8,
            "end_at": int(time.mktime(time.strptime(d['endAt'], time_format))) + utc_8
        }

        # 获取封榜时间
        d = self._post(path='getCompetitionSettings', json=json)
        # 距离比赛结束还剩多少时间进行封榜
        contest_config['frozen'] = d['frozenLength']

        # 获取题目配置
        d = self._post(path='getCompetitionProblemConfig', json=json)
        problems = []
        for i, pro in enumerate(d['rows']):
            problems.append([pro['problemId'], chr(ord('A')+i), '', pro['balloonColor']])
        contest_config['problems'] = problems

        return contest_config
    
    def _post(self, path: str, json: dict) -> dict:
        url = self.base_url + path

        try:
            result = requests.post(url=url, json=json, headers=self.headers, timeout=5)
        except Exception as e:
            print(f'请求 {url} 发生错误，获取失败：', e)
            return
        
        if result.status_code != 200:
            print(f'请求 {url} 被拒绝，状态码：', result.status_code)
            return
        
        return result.json()['data']
    
    def get_solution(self, solution_id: int):
        json = {
            "competitionId": self.contest_id,
            "gt": solution_id,
            "order": [["solutionId", "ASC"]],
            "limit": self.limit
        }
        d = self._post(path='getSolutionList', json=json)
        if d == None or len(d['rows']) == 0:
            return [], 0
        
        results = []
        for row in d['rows']:
            res = {
                'user_id':     row['user']['userId'],
                'problem_id':  row['problem']['problemId'],
                'solution_id': row['solutionId'],
                'status':      row['result'],
                'created_at':  int(time.mktime(time.strptime(row['createdAt'], time_format))) + utc_8,
            }
            results.append(res)

        return results, int(time.time())


class Database:
    def __init__(self, db_name: str):
        self.connect = sqlite3.connect(db_name)

    def __del__(self):
        self.connect.close()

    def insert_solution(self, params: list):
        sql = 'REPLACE INTO submit VALUES (?, ?, ?, ?, ?)'
        cursor = self.connect.cursor()
        cursor.executemany(sql, params)
        self.connect.commit()
        cursor.close()

    def select(self, table: str, **kwargs):
        cursor = self.connect.cursor()
        sql = f'SELECT * FROM {table}'
        if len(kwargs.items()) > 0:
            terms = ''
            for k, v in kwargs.items():
                if terms != '':
                    terms += ' and '
                terms += f'{k}="{v}"'
            sql += f' WHERE {terms}'

        try:
            rows = cursor.execute(sql)
        except Exception as e:
            print('数据库查询出错：', e)
            return []

        self.connect.commit()
        records = rows.fetchall()
        cursor.close()
        return records


class Calculation:
    def __init__(self, contest: dict, db: Database):
        # 比赛相关数据
        self.title = contest['title']
        self.start_at = contest['start_at']
        self.frozen = contest['frozen']
        self.end_at = contest['end_at']
        self.problems = contest['problems']
        self.problem_dict = {}
        for problem in contest['problems']:
            self.problem_dict[problem[0]] = problem[1]
        self.db = db

        # 获取所有用户
        self.user = {}
        rows = db.select('team')
        for row in rows:
            self.user[row[0]] = {
                'id': row[0],
                'name': row[1],
                'organization': row[2],
                'slogan': row[3],
                'official': row[4] == 1, # 1 是正式队伍 0 是打星队伍
                'marker': row[5],
                'accept': {},  # key: 题目 value: AC 时间 单位：秒
            }

        # 记录一血
        self.first_blood = {}  # key: problem value: team_id
        # 用户每道题目提交次数
        self.problem_status = {}  # key: 用户 Id value: key: 题目 value: set(每次提交的 id)
        rows = db.select('submit')
        for row in rows:
            if not self.problem_status.get(row[1]):
                self.problem_status[row[1]] = {}
            s = self.problem_status[row[1]].setdefault(row[2], set())

            # 如果题目已经 AC 后续的提交记录，不进入计算。CE、UKE、unknow 不计入罚时
            if not self.user[row[1]]['accept'].get(row[2]) and row[3] not in ['CE', 'UKE', 'unknow']:
                s.add(row[0])
                if row[3] == 'AC':
                    self.user[row[1]]['accept'][row[2]] = row[4]
                    if not self.first_blood.get(row[2]) and self.user[row[1]]['official']:
                        self.first_blood[row[2]] = row[1]
            self.problem_status[row[1]][row[2]] = s

    def scroll(self, submissions: list):
        records, rows = [], []
        submit_id = None  # 初始化 submit_id 值无用
        for submit in submissions:
            submit_id = submit['solution_id']
            team_id = submit['user_id']
            problem_alias = self.problem_dict.get(submit['problem_id'])
            if problem_alias is None:
                print(f'获取到未知题目的提交，请检查是否更换了题目，未知提交记录: {submit}')
                continue

            result = status.setdefault(submit['status'], 'unknow')
            # 不明提交，中断后续数据的获取
            if result == 'unknow':
                print(f"出现不明提交结果： solution_id={submit_id} user_id={team_id} problem_id={submit['problem_id']} result={submit['status']}")
                # 将本次的不明提交记录到下次提交内，如果不减一，本次不明提交会被忽略
                submit_id -= 1
                break

            duration = self.end_at - submit['created_at']
            if duration <= self.frozen and result not in ['CE', 'UKE']:
                result = '?'

            record = [submit_id, team_id, submit['problem_id'], result, duration]
            records.append(record)

            if result in ['CE', 'UKE']:
                continue

            row = {
                'problem': {'alias': problem_alias},
                'score': {
                    'value': len(self.user[team_id]['accept'])
                },
                'result': result,  # 榜单展示具体出错状态，改为变量 result
                'user': {
                    'id': team_id,
                    'name': self.user[team_id]['name'],
                    'organization': self.user[team_id]['organization'],
                },
            }

            if not self.user[team_id]['accept'].get(submit['problem_id']):
                pid = submit['problem_id']
                t = self.problem_status.setdefault(team_id, {})
                s = t.setdefault(pid, set())
                s.add(submit_id)
                t[pid] = s
                self.problem_status[team_id] = t

                if result == 'AC':
                    self.user[team_id]['accept'][pid] = duration
                    row['score']['value'] += 1
                    if not self.first_blood.get(pid) and self.user[team_id]['official']:
                        self.first_blood[pid] = team_id
                        row['result'] = 'FB'

            # 如果提交是五分钟前的提交，则不进行滚动展示
            if time.time() - submit['created_at'] < 5*60:
                rows.append(row)

        # 将数据更新到数据库，无则添加，有则更新
        self.db.insert_solution(records)
        # 返回滚动的信息流，和当前提交 Id
        data = {
            'updatedAt': int(time.time()),
            'rows': rows,
        }
        return data, submit_id

    def calculation(self):
        infos = []
        for team_id, info in self.user.items():
            total_time = 0
            for k, v in info['accept'].items():
                total_time += v + 20 * 60 * (len(self.problem_status[team_id][k]) - 1)

            info = [team_id, len(info['accept']), total_time]
            infos.append(info)
        infos.sort(key=lambda x: (x[1], -x[2]), reverse=True)

        rows = []
        rank = pro_rank = nopro_rank = 1
        # 计算并列排行使用
        index = (0, 1000, 0)  # 元组：排名，AC 题目数，做题总时间
        pro_index = (0, 1000, 0)  # 元组：排名，AC 题目数，做题总时间
        nopro_index = (0, 1000, 0)  # 元组：排名, AC 题目数，做题总时间
        for info in infos:
            user = self.user[info[0]]

            row = {
                'user': {
                    'id': user['id'],
                    'name': user['name'],
                    'organization': user['organization'],
                    'teamMembers': [{'name': user['slogan']}],
                    'official': user['official'],
                },
                'ranks': [
                    {'rank': None, 'segmentIndex': None},
                    {'rank': None, 'segmentIndex': None},
                    {'rank': None, 'segmentIndex': None},
                ]
            }

            # 计算总排名是否有并列情况
            if info[1] == index[1] and info[2] == index[2]:
                row['ranks'][0]['rank'] = index[0]
            else:
                row['ranks'][0]['rank'] = rank
                index = (rank, info[1], info[2])
            rank += 1

            # 计算正式队伍排名
            if user['official']:
                # 专业组排名
                if user['marker'] == 'pro':
                    if info[1] == pro_index[1] and info[2] == pro_index[2]:
                        row['ranks'][1]['rank'] = pro_index[0]
                    else:
                        row['ranks'][1]['rank'] = pro_rank
                        pro_index = (pro_rank, info[1], info[2])
                    pro_rank += 1
                # 非专业组
                elif user['marker'] == 'nopro':
                    if info[1] == nopro_index[1] and info[2] == nopro_index[2]:
                        row['ranks'][2]['rank'] = nopro_index[0]
                    else:
                        row['ranks'][2]['rank'] = nopro_rank
                        nopro_index = (nopro_rank, info[1], info[2])
                    nopro_rank += 1

            if user['marker'] != '':
                row['user']['marker'] = user['marker']

            statuses = []
            for i, problem in enumerate(self.problems):
                stat = {"result": None, "time": [0, "s"], "tries": 0}
                problem_time = 0
                if not self.problem_status.get(user['id']):
                    self.problem_status[user['id']] = {}
                problem_tries = self.problem_status[user['id']].setdefault(problem[0], set())
                if len(problem_tries) > 0:
                    stat['result'] = 'RJ'

                if user['accept'].get(problem[0]):
                    problem_time = user['accept'][problem[0]]
                    stat['result'] = 'AC'
                    if self.first_blood[problem[0]] == user['id']:
                        stat['result'] = 'FB'
                stat['time'][0] = problem_time
                stat['tries'] = len(problem_tries)

                solutions, is_frozen = self.solutions(user['id'], problem[0], problem_tries)
                stat['solutions'] = solutions
                if is_frozen:
                    stat['result'] = '?'
                statuses.append(stat)

            row['statuses'] = statuses
            row['score'] = {
                'value': info[1],
                'time': [info[2], 's'],
            }
            rows.append(row)

        return rows

    def solutions(self, team_id: str, problem: int, problem_tries: set):
        solutions = []
        is_frozen = False
        rows = self.db.select('submit', team_id=team_id, problem_id=problem)
        for row in rows:
            if row[0] not in problem_tries:
                continue
            solution = {
                'result': row[3],
                'time': [row[4], 's'],
            }
            if row[3] == "AC" and self.first_blood[problem] == team_id:
                solution['result'] = 'FB'
            solutions.append(solution)
            if row[3] == '?':
                is_frozen = True
        solutions.sort(key=lambda x: x['time'][0])

        return solutions, is_frozen

    def ranking(self, now: int):
        now_time = time.strftime('%Y-%m-%dT%H:%M:%S+08:00', time.localtime(now))
        data = {
            'contest': {
                'title': self.title,
                'startAt': time.strftime('%Y-%m-%dT%H:%M:%S+08:00', time.localtime(self.start_at)),
                'duration': [self.end_at - self.start_at, 's'],
                'frozenDuration': [self.frozen,  's']
            },
            'series': [
                {'title': '总榜'},
                {
                    'title': '专业',
                    'segments': [
                        {'title': 'Gold Medalist', 'count': 0, 'style': 'gold'},
                        {'title': 'Silver Medalist', 'count': 0, 'style': 'silver'},
                        {'title': 'Bronze Medalist', 'count': 0, 'style': 'bronze'}
                    ]
                },
                {
                    'title': '非专业',
                    'segments': [
                        {'title': 'Gold Medalist', 'count': 0, 'style': 'gold'},
                        {'title': 'Silver Medalist', 'count': 0, 'style': 'silver'},
                        {'title': 'Bronze Medalist', 'count': 0, 'style': 'bronze'}
                    ]
                },
            ],
            'markers': [
                {'id': 'pro', 'label': '专业', 'style': {'backgroundColor': 'rgba(0, 0, 0, 0)'}}, 
                {'id': 'nopro', 'label': '非专业', 'style': {'backgroundColor': 'rgba(0, 0, 0, 0)'}}
            ],
            'type': 'general',
            'version': '0.2.1',
        }
        if self.start_at > now:
            data['_now'] = now_time

        problems = []
        for problem in self.problems:
            p = {
                'alias': problem[1],
                "style": {
                    'textColor': problem[-2],
                    'backgroundColor': problem[-1],
                }
            }

            # 查询提交数和 AC 数
            total = 0
            ac_total = 0
            for team_id, user in self.user.items():
                if user['accept'].get(problem[0]):
                    ac_total += 1
                s = self.problem_status.setdefault(team_id, {})
                total += len(s.setdefault(problem[0], set()))
            p['statistics'] = {
                'accepted': ac_total,
                'submitted': total,
            }

            problems.append(p)
        data['problems'] = problems

        rows = self.calculation()
        data['rows'] = rows

        medals = self.medals(rows)
        pro_medal = medals[0]
        for i, series in enumerate(data['series'][1]['segments']):
            series['count'] = pro_medal[i]
        nopro_medal = medals[1]
        for i, series in enumerate(data['series'][2]['segments']):
            series['count'] = nopro_medal[i]

        return data

    def medals(self, rows):
        """计算奖牌的数量"""
        pro_list = []
        nopro_list = []
        for i, row in enumerate(rows):
            if row['user']['official'] and row['score']['value'] > 0:
                info = {
                    'rows_index': i,
                    'score': row['score']
                }
                if row['user']['marker'] == 'pro':
                    pro_list.append(info)
                else:
                    nopro_list.append(info)
              
        # 对奖牌显示进行限制，如果专业组和非专业组都不满足有 10 人 AC 一题，则不显示奖牌数量
        # if len(pro_list) <= 10 and len(nopro_list) <= 10:
        #     return [[0, 0, 0], [0, 0, 0]]

        medals = []
        # 专业组金银铜奖数量
        pro_len = len(pro_list)
        gold_i = self._get_index(pro_list, math.ceil(pro_len * 0.1))
        silver_i = self._get_index(pro_list, math.ceil(pro_len * 0.3))
        bronze_i = self._get_index(pro_list, math.ceil(pro_len * 0.6))
        medals.append([gold_i, silver_i - gold_i, bronze_i - silver_i])

        for i, pro in enumerate(pro_list):
            if i < gold_i:
                rows[pro['rows_index']]['ranks'][1]['segmentIndex'] = 0
            elif i < silver_i:
                rows[pro['rows_index']]['ranks'][1]['segmentIndex'] = 1
            elif i < bronze_i:
                rows[pro['rows_index']]['ranks'][1]['segmentIndex'] = 2

        # 非专业组
        nopro_len = len(nopro_list)
        gold_i = self._get_index(nopro_list, math.ceil(nopro_len * 0.1))
        silver_i = self._get_index(nopro_list, math.ceil(nopro_len * 0.3))
        bronze_i = self._get_index(nopro_list, math.ceil(nopro_len * 0.6))
        # 非专业组有额外限制
        gold_i = self._nopro_medals(nopro_list, gold_i, pro_list[medals[0][0]]['score']['value'])
        silver_i = self._nopro_medals(nopro_list, silver_i, pro_list[medals[0][1]]['score']['value'])
        bronze_i = self._nopro_medals(nopro_list, bronze_i, pro_list[medals[0][2]]['score']['value'])
        medals.append([gold_i, silver_i - gold_i, bronze_i - silver_i])

        for i, nopro in enumerate(nopro_list):
            if i < gold_i:
                rows[nopro['rows_index']]['ranks'][2]['segmentIndex'] = 0
            elif i < silver_i:
                rows[nopro['rows_index']]['ranks'][2]['segmentIndex'] = 1
            elif i < bronze_i:
                rows[nopro['rows_index']]['ranks'][2]['segmentIndex'] = 2

        return medals

    def _get_index(self, infos: list, index: int) -> int:
        while index > 0:
            last_score = infos[index - 1]['score']
            score = infos[index]['score']
            if last_score['value'] != score['value'] or last_score['time'][0] != score['time'][0]:
                break
            index += 1
        return index

    def _nopro_medals(self, nopro_list: list, index: int, pro_solve_num: int) -> int:
        """
        Param: nopro_list 非专业数组
        Param: index 非专业获奖最后一人的下标
        Param: pro_solve_num 专业获奖解出的题目数
        Return: 校正后后的非专业组获奖下标
        Description: 非专业组的同类奖项需要满足在 10 20 30 的范围且同类型奖项解出题目数最多只能比专业组少一题
        """
        while index > 0:
            if nopro_list[index-1]['score']['value'] >= pro_solve_num:
                break
            index -= 1
        return index


if __name__ == '__main__':
    main()
