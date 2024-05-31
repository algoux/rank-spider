import re
import json
import requests
import rank

from typing import Any, Dict, List, Tuple
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from bs4 import BeautifulSoup


class CCPCOJ:
    '''当页面很复杂，而且自己不想去排查页面的各种异步请求时，可通过 selenium 将整个页面加载之后获取网页的 html 代码进行解析'''
    def __init__(self) -> None:
        option = Options()
        option.add_argument('--headless')
        option.add_argument("--disable-blink-features=AutomationControlled")
        self.driver = webdriver.Chrome('/etc/chromedriver', options=option)

    def __del__(self) -> None:
        self.driver.close()

    def spider(self, url: str) -> str:
        self.driver.get(url=url)
        self.driver.maximize_window()
        self.driver.implicitly_wait(10)
        
        return self.driver.page_source


def get_page(url: str) -> str:
    try:
        result = requests.get(url=url, timeout=5)
    except Exception as e:
        print('请求 URL 发生错误', e)
        return

    if result.status_code != 200:
        print("请求被拒绝，状态码：", result.status_code)
        return

    result.encoding = 'utf-8'
    return result.text


class Parse:
    def __init__(self, text) -> None:
        soup = BeautifulSoup(text, 'lxml')
        self.table = soup.find('table', id='rank')

    def contest(self) -> rank.Contest:
        return rank.Contest('2019年中国大学生程序设计竞赛 哈尔滨站-东北林业大学', 1573952400, 5, 1)

    def problems(self) -> List[rank.Problem]:
        return [rank.Problem('A'), rank.Problem('B'), rank.Problem('C'), rank.Problem('D'), rank.Problem('E'), 
            rank.Problem('F'), rank.Problem('G'), rank.Problem('H'), rank.Problem('I'), rank.Problem('J'), 
            rank.Problem('K'), rank.Problem('L')]

    def series(self) -> List[rank.Series]:
        self.gold = 13
        self.silver = 36
        self.bronze = 69
        return [rank.Series('#', [('一等奖', self.gold, rank.Style_Gold), ('二等奖', self.silver, rank.Style_Silver), ('三等奖', self.bronze, rank.Style_Bronze)]), rank.Series('S#')]

    def rows(self) -> List[rank.Row]:
        rows = []

        tbody = self.table.find('tbody')
        for i, tr in enumerate(tbody.find_all('tr')):
            tds = tr.find_all('td')

            official = True
            if tds[0].string == '*':
                official = False
            user = rank.User(name=tds[3].string, organization=tds[4].string, official=official)

            rk = rank.Order()
            if tds[0].string == 'Winner':
                rk = rank.Order(1, 0)
            elif tds[0].string != '*':
                index = int(tds[0].string)
                if index <= self.gold:
                    rk = rank.Order(index, 0)
                elif index <= self.silver:
                    rk = rank.Order(index, 1)
                elif index <= self.bronze:
                    rk = rank.Order(index, 2)
                else:
                    rk = rank.Order(index)

            srk = rank.Order()
            if tds[1].string is not None and tds[0].string != '*':
                srk = rank.Order(int(tds[1].string))
            orders = [rk, srk]

            h, m, s = tds[6].string.split(':')
            time_s = int(h)*60*60 + int(m)*60 + int(s)
            score = (int(tds[5].string), time_s)

            status = []
            for i in range(0, 12):
                ps = tds[i+7].string
                # print(f'ps={ps}')
                if ps is None:
                    status.append(rank.Status())
                    continue
                
                tries_s = re.compile(r'-[0-9]+').findall(ps)
                # print(f'tries_s={tries_s}')
                tries = 1
                if len(tries_s) > 0:
                    tries = -1 * int(tries_s[0]) + 1
                
                tm_s = re.compile(r'[0-9]+:[0-9]+:[0-9]+').findall(ps)
                # print(f'tm_s={tm_s}')
                if len(tm_s) > 0:
                    h, m, s = tm_s[0].split(':')
                    tm = int(h)*60*60 + int(m)*60 + int(s)
                    status.append(rank.Status(rank.SR_Accepted, tm, tries))
                    continue
                status.append(rank.Status(rank.SR_Rejected, 0, tries))
                
            rows.append(rank.Row(orders, user, score, status))
        
        return rows


def main():
    # page = Scoreboard().spider('http://acm.sdut.edu.cn/acmss/ccpc/2019/beijing/index.html')
    page = get_page('http://acm.sdut.edu.cn/acmss/ccpc/2019/beijing/index.html')
    # page = get_page('http://acm.sdut.edu.cn/acmss/ccpc/2019/haerbin/index.htm')
    parse = Parse(page)
    contest = parse.contest()
    problems = parse.problems()
    series = parse.series()
    rows = parse.rows()
    r = rank.Rank(contest, problems, series, rows)
    with open('ccpc2019beijing.srk.json', 'w', encoding='utf-8') as file:
        json.dump(r.result(), file, ensure_ascii=False)
    print(r.to_str(False))


if __name__ == '__main__':
    main()