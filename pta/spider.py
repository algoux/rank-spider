import yaml
import json
import time
import shutil
import sqlite3
import requests

status = {
    'ACCEPTED': 'AC',
    'COMPILE_ERROR': 'CE',
    'FLOAT_POINT_EXCEPTION': 'RTE',
    'INTERNAL_ERROR': 'UKE',
    'MEMORY_LIMIT_EXCEEDED': 'MLE',
    'MULTIPLE_ERROR': 'WA',
    'NON_ZERO_EXIT_CODE': 'RTE',
    'NO_ANSWER': 'WA',
    'OUTPUT_LIMIT_EXCEEDED': 'OLE',
    'PARTIAL_ACCEPTED': 'WA',
    'PRESENTATION_ERROR': 'PE',
    'RUNTIME_ERROR': 'RTE',
    'SAMPLE_ERROR': 'WA',
    'SEGMENTATION_FAULT': 'RTE',
    'TIME_LIMIT_EXCEEDED': 'TLE',
    'WRONG_ANSWER': 'WA',
}


def main():
    config = get_config()

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/67.0.3396.99 Safari/537.36',
        'Cookie': config['spider']['cookie'],
        'Accept': 'application/json;charset=UTF-8',
    }

    spider = Spider(headers, config['spider']['contest_id'], config['spider']['limit'])
    db = Database(config['database'])
    calculation = Calculation(config['contest'], db)

    submit_id = config['spider']['submit_id']
    while True:
        submissions, timestamp = spider.crawl(submit_id)
        scroll_data, sid = calculation.scroll(submissions)
        if sid is not None:
            submit_id = sid

        dump_info(config['scroll_path'], scroll_data)
        rank_data = calculation.ranking(timestamp)
        dump_info(config['ranking_path'], rank_data)
        if calculation.start_timestamp + config['contest']['duration'] * 60 * 60 < timestamp:
            print("比赛已结束，感谢使用")
            break

        format_time = time.strftime('%Y-%m-%d %H:%M', time.localtime())
        print('{} 成功爬取 {} 条记录，submit_id={}'.format(format_time, len(submissions), submit_id))
        time.sleep(config['spider']['duration'])


def get_config():
    """读取 config.yml 文件"""
    with open('config.yml', 'r', encoding='utf-8') as file:
        config = file.read()

    return yaml.Loader(config).get_data()


def dump_info(path, data):
    with open('temp.json', 'w', encoding='utf-8') as file:
        json.dump(data, file, ensure_ascii=False)

    shutil.copy('temp.json', path)


class Spider:
    """定义爬虫类，为了简单把每一个模块封装成一个类，都放在该文件中"""
    def __init__(self, headers: dict, contest_id: str, limit: int):
        self.headers = headers
        self.url = 'https://pintia.cn/api/problem-sets/{cid}/submissions'.format(cid=contest_id)
        self.params = {
            'show_all': True,
            'filter': '{}',
            'limit': limit,
            'after': '1',
        }

    def crawl(self, submit_id: str):
        """
        :param submit_id:
        :return:
        """
        self.params['after'] = submit_id
        try:
            result = requests.get(url=self.url, params=self.params, headers=self.headers, timeout=5)
        except Exception as e:
            print('请求 URL 发生错误', e)
            return

        if result.status_code != 200:
            print("请求被拒绝，状态码：", result.status_code)
            return

        # 返回时间序的提交记录列表，列表有序且序号越大距离当前时间越来越远
        submissions = result.json()['submissions']
        # 逆序，按照提交顺序进行返回
        submissions.reverse()
        timestamp = int(time.mktime(time.strptime(result.headers['Date'], '%a, %d %b %Y %H:%M:%S %Z'))) + 8 * 60 * 60

        return submissions, timestamp


class Database:
    def __init__(self, db_name):
        self.connect = sqlite3.connect(db_name)

    def __del__(self):
        self.connect.close()

    def insert(self, table, params):
        sql = 'REPLACE INTO {} VALUES (?, ?, ?, ?, ?)'.format(table)
        cursor = self.connect.cursor()
        cursor.executemany(sql, params)
        self.connect.commit()
        cursor.close()

    def select_all(self, table):
        cursor = self.connect.cursor()
        sql = 'SELECT * FROM {}'.format(table)
        rows = cursor.execute(sql)
        self.connect.commit()

        records = []
        for row in rows:
            records.append(row)

        cursor.close()

        return records

    def select(self, table, **kwargs):
        cursor = self.connect.cursor()
        terms = ''
        for k, v in kwargs.items():
            if terms != '':
                terms += ' and '
            terms += '{}="{}"'.format(k, v)
        sql = 'SELECT * FROM {} WHERE {}'.format(table, terms)
        try:
            rows = cursor.execute(sql)
        except Exception as e:
            print('数据库查询出错：', e)
            rows = []

        self.connect.commit()

        records = []
        for row in rows:
            records.append(row)

        cursor.close()

        return records

    def execute(self, sql):
        cursor = self.connect.cursor()
        rows = cursor.execute(sql)
        self.connect.commit()
        cursor.close()
        return rows


class Calculation:
    def __init__(self, contest: dict, db: Database):
        # 比赛相关数据
        self.title = contest['title']
        timestamp = int(time.mktime(time.strptime(contest['start_at'].split('+')[0], "%Y-%m-%dT%H:%M:%S")))
        self.start_timestamp = timestamp
        self.frozen_timestamp = int(time.mktime(time.strptime(contest['frozen_at'].split('+')[0], "%Y-%m-%dT%H:%M:%S")))
        self.duration = contest['duration']
        self.problems = contest['problems']
        self.problem_dict = {}
        for problem in contest['problems']:
            self.problem_dict[problem[0]] = problem[1]

        self.db = db

        # 获取所有用户
        self.user = {}
        rows = db.select_all('team')
        for row in rows:
            self.user[row[0]] = {
                'id': row[0],
                'name': row[1],
                'organization': row[2],
                'coach': row[3],
                'members': row[4],
                'official': False,
                'marker': row[6],
                'accept': {},  # key: 题目 value: AC 时间的相对比赛开始经过的时间 单位：秒
            }

            if row[5] == 1:
                self.user[row[0]]['official'] = True

        # 记录一血
        self.first_blood = {}  # key: problem value: team_id
        # 用户每道题目提交次数
        self.problem_status = {}  # key: 用户 Id value: key: 题目 value: set(每次提交的 id)
        rows = db.select_all('submit')
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
            submit_id = submit['id']
            team_id = submit['user']['studentUser']['studentNumber']
            problem = self.problem_dict[submit['problemSetProblem']['label']]
            result = status.setdefault(submit['status'], 'unknow')
            # 不明提交，中断后续数据的获取
            if result == 'unknow':
                print('出现不明提交结果：{} submit_id={} team_id={} problem_label={}'.format(submit['status'], submit_id, team_id, submit['problemSetProblem']['label']))
                # 将本次的不明提交记录到下次提交内，如果不减一，本次不明提交会被忽略
                submit_id = str(int(submit_id)-1)
                break

            t = int(time.mktime(time.strptime(submit['submitAt'], "%Y-%m-%dT%H:%M:%SZ"))) + 8*60*60
            duration = t - self.start_timestamp

            if t > self.frozen_timestamp and result not in ['CE', 'UKE']:
                result = '?'

            record = [submit_id, team_id, problem, result, duration]
            records.append(record)

            if result in ['CE', 'UKE']:
                continue

            row = {
                'problem': {'alias': problem},
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

            if not self.user[team_id]['accept'].get(problem):
                t = self.problem_status.setdefault(team_id, {})
                s = t.setdefault(problem, set())
                s.add(submit_id)
                t[problem] = s
                self.problem_status[team_id] = t

                if result == 'AC':
                    self.user[team_id]['accept'][problem] = duration
                    row['score']['value'] += 1
                    if not self.first_blood.get(problem) and self.user[team_id]['official']:
                        self.first_blood[problem] = team_id
                        row['result'] = 'FB'

            if time.time() - duration < 5*60:
                rows.append(row)

        # 将数据更新到数据库，无则添加，有则更新
        self.db.insert('submit', records)
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
                # 时间计算，因为 PTA 榜单是分钟级别的准确度，所以此处进行秒数的向下取整
                t = v - (v % 60)
                total_time += t
                total_time += 20 * 60 * (len(self.problem_status[team_id][k]) - 1)

            info = [team_id, len(info['accept']), total_time]
            infos.append(info)
        infos.sort(key=lambda x: (x[1], -x[2]), reverse=True)

        rows = []
        school = set()
        rank = school_rank = official_rank = 1
        # 计算并列排行使用
        index = (0, 1000, 0)  # 元组：排名，AC 题目数，做题总时间
        school_index = (0, 1000, 0)  # 元组：排名，AC 题目数，做题总时间
        official_index = (0, 1000, 0)  # 元组：排名, AC 题目数，做题总时间
        for info in infos:
            user = self.user[info[0]]
            team_members = [{'name': '{}(教练)'.format(user['coach'])}]
            for member in user['members'].split('|'):
                team_members.append({'name': member})

            row = {
                'user': {
                    'id': user['id'],
                    'name': user['name'],
                    'organization': user['organization'],
                    'teamMembers': team_members,
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
                row['ranks'][1]['rank'] = index[0]
            else:
                row['ranks'][1]['rank'] = rank
                index = (rank, info[1], info[2])
            rank += 1

            if user['official']:
                # 计算正式队伍是否有并列情况
                if info[1] == official_index[1] and info[2] == official_index[2]:
                    row['ranks'][0]['rank'] = official_index[0]
                else:
                    row['ranks'][0]['rank'] = official_rank
                    official_index = (official_rank, info[1], info[2])
                official_rank += 1

                if user['organization'] not in school:
                    # 计算学校是否有并列情况
                    if info[1] == school_index[1] and info[2] == school_index[2]:
                        row['ranks'][2]['rank'] = school_index[0]
                    else:
                        row['ranks'][2]['rank'] = school_rank
                        school_index = (school_rank, info[1], info[2])
                    school_rank += 1
                    school.add(user['organization'])

            if user['marker'] != '':
                row['user']['marker'] = user['marker']

            statuses = []
            for i, problem in enumerate(self.problems):
                stat = {"result": None, "time": [0, "s"], "tries": 0}
                problem_time = 0
                if not self.problem_status.get(user['id']):
                    self.problem_status[user['id']] = {}
                problem_tries = self.problem_status[user['id']].setdefault(problem[1], set())
                if len(problem_tries) > 0:
                    stat['result'] = 'RJ'

                if user['accept'].get(problem[1]):
                    problem_time = user['accept'][problem[1]]
                    stat['result'] = 'AC'
                    if self.first_blood[problem[1]] == user['id']:
                        stat['result'] = 'FB'
                stat['time'][0] = problem_time
                stat['tries'] = len(problem_tries)

                solutions, is_frozen = self.solutions(user['id'], problem[1], problem_tries)
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

    def solutions(self, team_id: str, problem: str, problem_tries: set):
        solutions = []
        is_frozen = False
        rows = self.db.select('submit', team_id=team_id, problem=problem)
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

    def ranking(self, timestamp: int):
        now_time = time.strftime('%Y-%m-%dT%H:%M:%S+08:00', time.localtime(timestamp))
        data = {
            'contest': {
                'title': self.title,
                'startAt': time.strftime('%Y-%m-%dT%H:%M:%S+08:00', time.localtime(self.start_timestamp)),
                'duration': [self.duration, 'h'],
                'frozenDuration': [self.duration*60*60 - (self.frozen_timestamp - self.start_timestamp),  's']
            },
            'series': [
                {
                    'title': '#',
                    'segments': [
                        {
                            'title': 'Gold Medalist',
                            'count': 0,
                            'style': 'gold',
                        },
                        {
                            'title': 'Silver Medalist',
                            'count': 0,
                            'style': 'silver',
                        },
                        {
                            'title': 'Bronze Medalist',
                            'count': 0,
                            'style': 'bronze',
                        }
                    ]
                },
                {'title': 'R#'},
                {'title': 'S#'},
            ],
            'markers': [{'id': 'female', 'label': '女队', 'style': 'pink'}],
            'type': 'general',
            'version': '0.2.1',
        }
        if self.start_timestamp + 8*60*60 > timestamp:
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
                if user['accept'].get(problem[1]):
                    ac_total += 1
                s = self.problem_status.setdefault(team_id, {})
                total += len(s.setdefault(problem[1], set()))
            p['statistics'] = {
                'accepted': ac_total,
                'submitted': total,
            }

            problems.append(p)
        data['problems'] = problems

        rows = self.calculation()
        data['rows'] = rows

        medals = self.medals(rows)
        for i, series in enumerate(data['series'][0]['segments']):
            series['count'] = medals[i]

        return data

    def medals(self, rows):
        """计算奖牌的数量"""
        official_list = []
        for i, row in enumerate(rows):
            if row['user']['official'] and row['score']['value'] > 0:
                official = {
                    'rows_index': i,
                    'score': row['score'],
                }
                official_list.append(official)
        if len(official_list) <= 10:
            return [0, 0, 0]

        def index(official_list, index):
            while True:
                last_score = official_list[index - 1]['score']
                score = official_list[index]['score']
                if last_score['value'] != score['value'] or last_score['time'][0] != score['time'][0]:
                    break
                index += 1

            return index

        # 金银铜奖数量
        if len(official_list) >= 240:
            gold_index = index(official_list, 24)
            silver_index = index(official_list, 48 + 24)
            bronze_index = index(official_list, 72 + 48 + 24)
            medals = [gold_index, silver_index - gold_index, bronze_index - silver_index]
        else:
            official_len = len(official_list)
            gold_index = index(official_list, int(official_len * 0.1))
            silver_index = index(official_list, int(official_len * 0.3))
            bronze_index = index(official_list, int(official_len * 0.6))
            medals = [gold_index, silver_index - gold_index, bronze_index - silver_index]

        for i, official in enumerate(official_list):
            if i < gold_index:
                rows[official['rows_index']]['ranks'][0]['segmentIndex'] = 0
            elif i < silver_index:
                rows[official['rows_index']]['ranks'][0]['segmentIndex'] = 1
            elif i < bronze_index:
                rows[official['rows_index']]['ranks'][0]['segmentIndex'] = 2

        return medals


if __name__ == '__main__':
    main()
