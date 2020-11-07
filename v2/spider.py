# 将数据格式化并存储在 SQLite 中，防止爬虫突然中断导致数据丢失
# 和前端交互则是在 config.yml 中配置最后生成的 json 文件的存储位置以及名称

import yaml
import json
import time
import shutil
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

    spider = Spider(headers, config['spider']['contest_id'])
    calculation = Calculation(config['information_path'], config['contest']['problems'])
    scroll = Scroll(config['contest']['problems'], config['scroll_path'])
    ranking = Ranking(config['contest'], config['ranking_path'])

    while True:
        submit_id = get_submit_id()
        submissions, resp_time = spider.crawl(submit_id, config['spider']['limit'])
        if submissions is None:
            print('未爬取到数据，请检查是否出错')
            time.sleep(5)
            continue

        infos, scroll_submissions, submit_id = calculation.calculation(submissions, config['contest']['start_at'])
        set_submit_id(submit_id)
        update_time = int(time.mktime(time.strptime(resp_time, '%a, %d %b %Y %H:%M:%S %Z'))) + 8 * 60 * 60
        scroll.scroll(scroll_submissions, update_time)
        ranking.ranking(infos, update_time)

        start_time = int(time.mktime(time.strptime(config['contest']['start_at'].split('+')[0], "%Y-%m-%dT%H:%M:%S")))
        if start_time + config['contest']['duration'] * 60 * 60 < update_time:
            print("比赛已结束，感谢使用")
            return

        print(time.strftime('%Y-%m-%d %H:%M', time.localtime()), '爬取成功')
        time.sleep(config['spider']['duration'])


def get_config():
    """读取 config.yml 文件"""
    with open('config.yml', 'r', encoding='utf-8') as file:
        config = file.read()

    return yaml.Loader(config).get_data()


def get_submit_id():
    """获取 submit_id，以 submit_id 作为起始点开始爬取提交记录"""
    try:
        with open('runtime', 'r', encoding='utf-8') as file:
            submit_id = file.read()
    except Exception as e:
        print("发生错误，将 submit_id 更新为初始值", e)
        submit_id = '1'

    return submit_id


def set_submit_id(submit_id):
    """会变更 runtime.json 文件中的 submit_id"""
    with open('runtime', 'w', encoding='utf-8') as file:
        file.write(submit_id)


class Ranking:
    def __init__(self, contest: dict, path: str):
        self.contest = contest
        self.path = path

    def ranking(self, infos, update_time):
        now_time = time.strftime('%Y-%m-%dT%H:%M:%S+08:00', time.localtime(update_time))
        data = {
            '_now': now_time,
            'contest': {
                'title': self.contest['title'],
                'startAt': self.contest['start_at'],
                'duration': [self.contest['duration'], 'h'],
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

        problems = []
        for problem in self.contest['problems']:
            p = {
                'alias': problem[0],
                "style": {
                    'textColor': problem[-2],
                    'backgroundColor': problem[-1],
                }
            }
            if problem[1] != '':
                p['alias'] = problem[1]
            problems.append(p)
        data['problems'] = problems

        info_list = []
        for team_id, info in infos.items():
            i = [info['problems']['ac_total'], info['problems']['time'], team_id]
            info_list.append(i)
        info_list.sort(key=lambda x: (x[0], -x[1]), reverse=True)

        rank = school_rank = official_rank = 1
        school = set()
        rows = []
        for i in info_list:
            info = infos[i[-1]]
            team_members = [{'name': '{}(教练)'.format(info['coach'])}]
            for member in info['members']:
                team_members.append({'name': member})

            row = {
                'user': {
                    'id': i[-1],
                    'name': info['name'],
                    'organization': info['organization'],
                    'teamMembers': team_members,
                    'official': info['official'],
                },
                'ranks': [
                    {'rank': None, 'segmentIndex': None},
                    {'rank': rank, 'segmentIndex': None},
                    {'rank': None, 'segmentIndex': None},
                ]
            }
            rank += 1
            if info['official']:
                row['ranks'][0]['rank'] = official_rank
                official_rank += 1
            if info['organization'] not in school:
                row['ranks'][-1]['rank'] = school_rank
                school_rank += 1
                school.add(info['organization'])

            if info.get('marker'):
                row['user']['marker'] = info['marker']

            statuses = [{"result": None, "time": [0, "s"], "tries": 0}] * len(self.contest['problems'])
            p = {}
            for i, problem in enumerate(self.contest['problems']):
                p[problem[0]] = i

            if info['problems'].get('label'):
                for label, value in info['problems']['label'].items():
                    solutions = []
                    total_time = 0
                    for submit in value['submissions']:
                        s = {
                            'result': status[submit['result']],
                            'time': [submit['time_duration'], 's']
                        }
                        solutions.append(s)
                        total_time += submit['time_duration']

                    if len(solutions) > 0:
                        statuses[p[label]]['result'] = 'RJ'
                        if value.get('accept_at'):
                            statuses[p[label]]['result'] = 'AC'
                        if value.get('first_blood'):
                            statuses[p[label]]['result'] = 'FB'

                        statuses[p[label]]['time'] = [total_time, 's']
                        statuses[p[label]]['tries'] = len(solutions)
                        statuses[p[label]]['solutions'] = solutions

            row['statuses'] = statuses
            row['score'] = {
                'value': info['problems']['ac_total'],
                'time': [info['problems']['time'], 's'],
            }
            rows.append(row)

        data['rows'] = rows
        medals = self.medals(rows)
        for i, series in enumerate(data['series'][0]['segments']):
            series['count'] = medals[i]

        self.dump_ranking(data)

    def dump_ranking(self, data):
        with open('rank.json', 'w', encoding='utf-8') as file:
            json.dump(data, file, ensure_ascii=False)
        shutil.copy('rank.json', self.path)

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
        if len(official_list) <= 0:
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


class Scroll:
    def __init__(self, problems: dict, path: str):
        self.problems = problems
        self.path = path

    def scroll(self, submissions, update_time: int):
        scroll_submissions = {
            'updatedAt': update_time,
            'rows': [],
        }

        name = {}
        for problem in self.problems:
            name[problem[0]] = problem[1]

        for submit in submissions:
            row = {
                'problem': {'alias': submit['problem']},
                'score': {
                    'value': submit['total']
                },
                'result': 'RJ',
                'user': submit['user'],
            }
            if name[submit['problem']] != '':
                row['problem']['alias'] = name[submit['problem']]
            if submit['result'] == 'AC':
                row['result'] = 'AC'

            scroll_submissions['rows'].append(row)

        self.dump_scroll(scroll_submissions)

    def dump_scroll(self, scroll_submissions):
        with open('scroll.json', 'w', encoding='utf-8') as file:
            json.dump(scroll_submissions, file, ensure_ascii=False)

        shutil.copy('scroll.json', self.path)


class Calculation:
    def __init__(self, info_path: str, problems: list):
        self.info_path = info_path
        self.problems = problems

    def calculation(self, submissions, start_at: str):
        infos = self.load_info()

        # 因时间是一个字符串，将其转化为时间戳，时区为东八区
        start_time = int(time.mktime(time.strptime(start_at.split('+')[0], "%Y-%m-%dT%H:%M:%S")))

        scroll_submissions = []
        for submission in submissions:
            team_id = submission['user']['studentUser']['studentNumber']
            if not infos.get(team_id):
                continue

            info = infos[team_id]
            label = submission['problemSetProblem']['label']
            # 如果该题目已经 AC，后续的提交不记录到总次数中
            if info['problems']['label'].get(label) and info['problems']['label'][label].get('accept_at'):
                continue

            # 编译错误、系统错误不记录罚时
            if submission['status'] in ['COMPILE_ERROR', 'INTERNAL_ERROR', 'JUDGING', 'REJUDGING', 'SKIPPED']:
                continue

            # 如果正在判断，则返回下次从此处继续爬取数据
            if submission['status'] in ['WAITING']:
                return scroll_submissions, str(int(submission['id'])-1)

            # 时间转换，将其转换成时间戳，加 8 小时是因为时间为零时区，中国为东八区
            status_time = int(time.mktime(time.strptime(submission['submitAt'], "%Y-%m-%dT%H:%M:%SZ"))) + 8 * 60 * 60

            # 数据格式化
            problems = info.setdefault('problems', {'ac_total': 0, 'time': 0, 'label': {}})
            problem = problems['label'].setdefault(label, {'submissions': []})
            time_duration = status_time - start_time
            if submission['status'] == 'ACCEPTED':
                problems['ac_total'] += 1
                problems['time'] = problems['time'] + len(problem['submissions']) * 20*60 + time_duration
                problem['accept_at'] = status_time - start_time

            problem['submissions'].append({'result': submission['status'], 'time_duration': time_duration})
            problems['label'][label] = problem
            info['problems'] = problems

            infos[team_id] = info
            scroll_submit = {
                'problem': label,
                'total': len(problem['submissions']),
                'result': submission['status'],
                'user': {
                    'id': info['id'],
                    'name': info['name'],
                    'organization': info['organization'],
                }
            }
            if info.get('marker'):
                scroll_submit['user']['marker'] = info['marker']
            scroll_submissions.append(scroll_submit)
        self.dump_info(infos)

        submit_id = submissions[-1]['id']
        return infos, scroll_submissions, submit_id

    def load_info(self):
        with open(self.info_path, 'r', encoding='utf-8') as file:
            infos = json.load(file)
        return infos

    def dump_info(self, infos: dict):
        # 保存之前先遍历一遍数据，将一血计算出来
        fb = {}
        for i, problem in enumerate(self.problems):
            fb[problem[0]] = {'team_id': '', 'time': 999999, 'index': i}

        for info in infos.values():
            if not info['problems'].get('label'):
                continue
            for k, v in info['problems']['label'].items():
                if v.get('accept_at') and v['accept_at'] < fb[k]['time']:
                    fb[k]['team_id'] = info['id']
                    fb[k]['time'] = v['accept_at']

        for k, v in fb.items():
            if v['team_id'] == '':
                continue
            infos[v['team_id']]['problems']['label'][k]['first_blood'] = True

        with open(self.info_path, 'w', encoding='utf-8') as file:
            json.dump(infos, file, ensure_ascii=False)


class Spider:
    """定义爬虫类，为了简单把每一个模块封装成一个类，都放在该文件中"""
    def __init__(self, headers: dict, contest_id: str):
        self.headers = headers
        self.url = 'https://pintia.cn/api/problem-sets/{cid}/submissions'.format(cid=contest_id)
        self.params = {
            'show_all': True,
            'filter': '{}',
            'limit': 50,
            'after': '1',
        }

    def crawl(self, submit_id: str, limit: int):
        """
        :param submit_id:
        :param limit:
        :return: list[dict{}]
        """
        self.params['limit'] = limit
        self.params['after'] = submit_id
        try:
            result = requests.get(url=self.url, params=self.params, headers=self.headers, timeout=5)
        except Exception as e:
            print('请求 URL 发生错误', e)
            return None

        if result.status_code != 200:
            print("请求被拒绝，状态码：", result.status_code)
            return None

        # 返回时间序的提交记录列表，列表有序且序号越大距离当前时间越来越远
        submissions = result.json()['submissions']
        submissions.reverse()
        # 由于需要计算一血等相关信息，所以逆序，按照提交顺序进行计算
        return submissions, result.headers['Date']


if __name__ == '__main__':
    main()
