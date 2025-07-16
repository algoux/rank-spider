""""
数据库
team 表结构：
id:           string 队伍 Id
title:        string 队伍名
organization: string 组织名（一般是学校名）
coach:        string 教练姓名
members:      string 队员名（"|" 分割多个队员的姓名）
official:     bool   是否是正式队（正式队 1，友情队 0）
marker:       string 特殊标记队伍（如：女队）

submit 表结构：
id:      string 提交记录 Id
team_id: string 队伍 Id
problem: string 题目
result:  string 结果
time_at: int    相对时间，本次提交距离比赛开始的时间，单位：秒
"""

import sqlite3
import yaml
import csv


team_sql = '''CREATE TABLE IF NOT EXISTS team (
id           VARCHAR(255) not null unique,
title        VARCHAR(255) not null,
organization VARCHAR(255) not null,
coach        VARCHAR(255) not null,
members      VARCHAR(255) not null,
official     INTEGER,
marker       VARCHAR(255));
'''

submit_sql = '''CREATE TABLE IF NOT EXISTS submit (
id      VARCHAR(255) not null unique,
team_id VARCHAR(255) not null,
problem VARCHAR(255) not null,
result  VARCHAR(255) not null,
time_at INTEGER);
'''


def main():
    config = get_config()
    db_name = config.setdefault('database', 'ccpc.db')
    connect = sqlite3.connect(db_name)

    # 创建队伍表
    create_table(connect, team_sql)
    # 创建提交记录表
    create_table(connect, submit_sql)

    # 队伍信息 csv 中的格式必须为：
    # Id, 队伍名, 组织（学校）, 教练, 队员1, 队员2, 队员3, 是否是正式队, 特殊类型
    info_path = config.setdefault('team_info', 'team_info.csv')
    infos = team_info(info_path)

    # 导入数据
    insert(connect, infos)
    connect.close()


def get_config():
    """读取 config.yml 文件"""
    with open('config.yml', 'r', encoding='utf-8') as file:
        config = file.read()

    return yaml.Loader(config).get_data()


def team_info(path: str):
    """
    :param path:
    :return:
    """
    infos = []
    with open(path, 'r', encoding='utf-8') as file:
        rows = csv.reader(file)
        next(rows)
        for row in rows:
            info = row[:4]
            members = '|'.join(row[4:7])
            info.append(members)

            # 判断是否是正式队
            if row[7] == '正式队伍':
                info.append(1)
            else:
                info.append(0)

            # 判断是否是女队
            if row[8] == '女队':
                info.append('female')
            else:
                info.append('')

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
    sql = 'REPLACE INTO team VALUES (?, ?, ?, ?, ?, ?, ?)'
    cursor.executemany(sql, params)
    connection.commit()
    cursor.close()


if __name__ == '__main__':
    main()
