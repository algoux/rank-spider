""""
数据库
team 表结构：
id:           int    队伍 Id
title:        string 队伍名
organization: string 组织名（一般是学校名）
slogan:       string 口号
official:     bool   是否是正式队（ 1 正式队， 0 友情队）
marker:       string 特殊标记队伍（如：专业组，非专业组）

submit 表结构：
id:         int    提交记录 Id
team_id:    int    队伍 Id
problem_id: int    题目 Id
result:     string 结果
time_at:    int    相对时间，本次提交距离比赛开始的时间，单位：秒
"""

from cmath import inf
from distutils.log import info
import sqlite3
import yaml
import requests


team_sql = '''CREATE TABLE IF NOT EXISTS team (
id           INTEGER not null unique,
title        VARCHAR(255) not null,
organization VARCHAR(255) not null,
slogan       VARCHAR(255) not null,
official     INTEGER,
marker       VARCHAR(255));
'''

submit_sql = '''CREATE TABLE IF NOT EXISTS submit (
id         INTEGER not null unique,
team_id    INTEGER not null,
problem_id INTEGER not null,
result     VARCHAR(255) not null,
time_at    INTEGER);
'''


def main():
    config = get_config()
    db_name = config.setdefault('database', 'sdutoj.db')
    connect = sqlite3.connect(db_name)

    # 创建队伍表
    create_table(connect, team_sql)
    # 创建提交记录表
    create_table(connect, submit_sql)

    infos = team_info(config['contest_id'])

    # 导入数据
    insert(connect, infos)
    connect.close()
    print(f'成功导入 {len(infos)} 支队伍数据，队伍具体信息如下：')
    print(infos)


def get_config():
    """读取 config.yaml 文件"""
    with open('config.yaml', 'r', encoding='utf-8') as file:
        config = file.read()

    return yaml.Loader(config).get_data()


def team_info(contest_id: int) -> list:
    """
    :param path:
    :return:
    """
    url = 'https://acm.sdut.edu.cn/onlinejudge3/api/getPublicCompetitionParticipants'
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/67.0.3396.99 Safari/537.36',
        'Accept': 'application/json;charset=UTF-8',
        'Referer': 'https://acm.sdut.edu.cn',
    }
    json = {"competitionId": contest_id}

    try:
        result = requests.post(url=url, json=json, headers=headers, timeout=5)
    except Exception as e:
        print('请求 URL 发生错误', e)
        return

    if result.status_code != 200:
        print("请求被拒绝，状态码：", result.status_code)
        return

    rows = result.json()['data']['rows']
    print(f'共有 {len(rows)} 支队伍参加比赛')
    infos = []
    for row in rows:
        title = row['info'].setdefault('nickname', '未知')
        organization = row['info'].setdefault('subname', '')
        slogan = row['info'].setdefault('slogan', '')
        info = [row['userId'], title, organization, slogan]

        # 研究生队伍为打星队伍
        official = True
        if row['info']['group'] == 'postgraduate':
            official = False
        info.append(official)

        # 比赛人员分为专业组和非专业组分别比拼
        marker = 'pro'
        if row['info']['group'] == 'nonpro':
            marker = 'nopro'
        info.append(marker)

        infos.append(info)

    return infos


def create_table(connection: sqlite3.Connection, sql: str):
    """
    创建数据库
    :param connection:
    :param sql:
    :return:
    """
    cursor = connection.cursor()
    cursor.execute(sql)
    connection.commit()
    cursor.close()


def insert(connection: sqlite3.Connection, params):
    print(params)
    cursor = connection.cursor()
    sql = 'REPLACE INTO team VALUES (?, ?, ?, ?, ?, ?)'
    cursor.executemany(sql, params)
    connection.commit()
    cursor.close()



if __name__ == '__main__':
    main()
