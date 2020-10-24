import yaml
import json
import time
import requests


def main():
    config = get_config()
    set_id = config['problem_set_id']

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/67.0.3396.99 Safari/537.36',
        'cookie': config['cookie'],
        'Accept': 'application/json;charset=UTF-8',
    }

    # 获取用户相关其他数据
    infos = get_infos()

    # 爬取排行榜信息
    while True:
        info_list, label_list, now = crawl_rankings(set_id, headers, config['limit'], infos)
        if len(info_list) == 0:
            print('spider failed')
            time.sleep(5)
            continue

        data = {
            'contest': {
                'title': config['title'],
                'startAt': config['start_at'],
                'duration': [config['time_duration'], 'h'],
            },
            '_now': now,
            'series': [
                {
                    'title': '排名',
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
                {'title': '总排名'},
                {'title': '学校排名'},
            ],
            'markers': [{'id': 'female', 'label': '女队', 'style': 'pink'}],
            'type': 'general',
            'version': '0.2.1',
        }
        problems = []
        for label in label_list:
            problem = {'alias': label}
            problems.append(problem)
        data['problems'] = problems

        rows, medals = format_data(info_list, label_list)
        data['rows'] = rows
        for i, series in enumerate(data['series'][0]['segments']):
            series['count'] = medals[i]

        with open(config['path_file'], 'w', encoding='utf-8') as file:
            json.dump(data, file, ensure_ascii=False)

        print(time.strftime('%Y-%m-%d %H:%M', time.localtime()), 'success')
        time.sleep(60)


def get_config():
    """读取 config.yml 文件"""
    with open('config.yml', 'r', encoding='utf-8') as file:
        config = file.read()

    return yaml.Loader(config).get_data()


def get_infos():
    """读取 CCPC2020.json 文件"""
    with open('CCPC2020.json', 'r', encoding='utf-8') as file:
        return json.load(file)


def crawl_rankings(set_id, headers, limit, infos):
    """爬取排行榜数据"""
    root_url = 'https://pintia.cn/api/problem-sets/{id}/rankings?'.format(id=set_id)

    info_list, labels_list = [], []
    page = 0
    while True:
        url = root_url + 'page={}&limit={}'.format(page, limit)

        try:
            result = requests.get(url, headers=headers, timeout=5)
        except Exception as e:
            print(e)
            return info_list, []

        if result.status_code != 200:
            return info_list, []

        t = time.mktime(time.strptime(result.headers['Date'], "%a, %d %b %Y %H:%M:%S %Z"))
        now_time = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.localtime(t))

        rankings = result.json()
        # 获取题目标签信息
        if page == 0:
            labels_list = rankings['commonRankings']['labels']

        info_list.extend(rankings['commonRankings']['commonRankings'])

        page += 1
        if page * limit >= rankings['total']:
            break

    return format_info(info_list, infos), labels_list, now_time


def format_info(rankings, infos):
    """格式化数据，将补充数据合并"""
    ranking_list = []
    organization, official = 1, 1
    organization_set = set()
    for ranking in rankings:
        if not ranking['user'].get('studentUser'):
            continue

        team_id = ranking['user']['studentUser']['studentNumber']
        info = infos[team_id]
        data = {
            'id': team_id,
            'rank': ranking['rank'],
            'name': info['name'],
            'organization': info['organization'],
            'teamMembers': info['teamMembers'],
            'official': info['official'],
            'marker': info['marker'],
            'solveTime': ranking['solvingTime'],
        }

        problems = {}
        accept = 0
        for k, v in ranking['problemScores'].items():
            problems[k] = {
                'count': v['validSubmitCount'],
                'time': v['acceptTime'],
                'accept': False,
            }
            if v['score'] != 0:
                problems[k]['accept'] = True
                accept += 1

        data['problems'] = problems
        data['solveTotal'] = accept

        if info['official']:
            data['officialRank'] = official
            official += 1
            if info['organization'] not in organization_set:
                organization_set.add(info['organization'])
                data['organizationRank'] = organization
                organization += 1

        ranking_list.append(data)

    return ranking_list


def format_data(data_list, label_list):
    """遵从 srk 格式保存数据"""
    rows = []
    for info in data_list:
        row = {
            'user': {
                'id': info['id'],
                'name': info['name'],
                'organization': info['organization'],
                'teamMembers': info['teamMembers'],
                'official': info['official'],
            },
            'ranks': [
                {'rank': info['rank'], 'segmentIndex': None},
                {'rank': None, 'segmentIndex': None},
            ]
        }
        if info.get('organizationRank'):
            row['ranks'][-1]['rank'] = info['organizationRank']
        if info['marker']:
            row['user']['marker'] = 'female'
        official_rank = {'rank': None, 'segmentIndex': None}
        if info.get('officialRank'):
            official_rank['rank'] = info['officialRank']
            official_rank['segmentIndex'] = None
        row['ranks'].insert(0, official_rank)

        # 默认单位分钟
        statuses = []
        for label in label_list:
            status = {'result': None, 'time': [0, 's'], 'tries': 0}
            if info['problems'].get(label) and info['problems'][label]['count'] > 0:
                status['result'] = 'RJ'
                if info['problems'][label]['accept']:
                    status['result'] = 'AC'
                status['time'] = [info['problems'][label]['time'], 'min']
                status['tries'] = info['problems'][label]['count']
            statuses.append(status)
        row['score'] = {
            'value': info['solveTotal'],
            'time': [info['solveTime'], 'min'],
        }
        row['statuses'] = statuses
        rows.append(row)

    medals = calculation_medals(rows)
    return rows, medals


def calculation_medals(rows):
    """计算奖牌的数量"""
    official_list = []
    for i, row in enumerate(rows):
        if row['user']['official'] and row['score']['value'] > 0:
            official = {
                'rows_index': i,
                'score': row['score'],
            }
            official_list.append(official)

    def index(official_list, index):
        while True:
            last_score = official_list[index-1]['score']
            score = official_list[index]['score']
            if last_score['value'] != score['value'] or last_score['time'][0] != score['time'][0]:
                break
            index += 1

        return index

    # 金银铜奖数量
    if len(official_list) >= 240:
        gold_index = index(official_list, 24)
        silver_index = index(official_list, 48+gold_index)
        bronze_index = index(official_list, 72+silver_index)
        medals = [gold_index, silver_index-gold_index, bronze_index-silver_index]
    else:
        official_len = len(official_list)
        gold_index = index(official_list, int(official_len*0.1))
        silver_index = index(official_list, int(official_len*0.2+gold_index))
        bronze_index = index(official_list, int(official_len*0.3+silver_index))
        medals = [gold_index, silver_index-gold_index, bronze_index-silver_index]

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
