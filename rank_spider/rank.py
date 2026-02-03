import json
import time

from typing import Any, Dict, List, Tuple


# Solution Result 题目结果
SR_FirstBlood = 'FB'
SR_Accepted = 'AC'
SR_Rejected = 'RJ'
SR_WrongAnswer = 'WA'
SR_PresentationError = 'PE'
SR_TimeLimitExceeded = 'TLE'
SR_MemoryLimitExceeded = 'MLE'
SR_OutputLimitExceeded = 'OLE'
SR_RuntimeError = 'RTE'
SR_CompilationError = 'CE'
SR_UnknownError = 'UKE'
SR_Frozen = '?'

# 颜色格式简写，也支持 HEX 格式：#FFFFFF、RGB 格式：rgb(255, 255, 255)、RGBA 格式：rgba(255, 255, 255, 0.75)
Style_Gold = 'gold'
Style_Silver = 'silver'
Style_Bronze = 'bronze'
Style_Red = 'red'
Style_Orange = 'orange'
Style_Yellow = 'yellow'
Style_Green = 'green'
Style_Blue = 'blue'
Style_Purple = 'purple'
Style_Pink = 'pink'


class Contest:
    def __init__(self, title: str, start_at: int, duration: float, frozen_duration: float = 0, link: str = None, banner: str = None) -> None:
        '''
            title: 标题
            start_at: 开始时间，秒级时间戳
            duration: 持续时长，单位/小时
            frozen_duration: 封榜时长，单位/小时【可选】
            link: 比赛的外链地址【可选】
            banner: 比赛的头部大横幅【可选】
        '''
        self.contest = {
            'title': {'zh-CN': title, 'en': '', 'fallback': ''},
            'startAt': time.strftime('%Y-%m-%dT%H:%M:%S+08:00', time.localtime(start_at)),
            'duration': [duration, "h"],
            'frozenDuration': [frozen_duration, "h"]
        }
        if link is not None:
            self.contest['link'] = link  
        if banner is not None:
            self.contest['banner'] = banner  
class Problem:
    def __init__(self, alias: str, statistics: Tuple[int, int] = None, style: Tuple[str, str] = None, **kwargs) -> None:
        '''
            alias: 题号
            statistics: 题目统计数据 (通过提交数, 总提交数)【可选】
            style: 题目展示颜色 (背景色, 字体色)【可选】
            kwargs: 可选参数，当前支持 title 题目标题，link 题目外链
        '''
        self.problem = {'alias': alias}
        if statistics is not None:
            self.problem['statistics'] = {
                'accepted': statistics[0],
                'submitted': statistics[1],
            }
        if style is not None:
            self.problem['style'] = {
                'backgroundColor': style[0],
                'textColor': style[1],
            }
        if kwargs.get('title') is not None:
            self.problem['title'] = kwargs.get('title')
        if kwargs.get('link') is not None:
            self.problem['link'] = kwargs.get('link')


class Series:
    def __init__(self, title: str, segments: List[Tuple[str, int, str]] = None) -> None:
        '''
            title: 排行榜名称
            segment: 奖项，三元组数组[(奖牌名称, 数量, 颜色)]【可选】
        '''
        self.series = {'title': title}
        if segments is not None:
            sgs = []
            for segment in segments:
                sgs.append({
                    'title': segment[0], # Gold Medalist, Silver Medalist, Bronze Medalist
                    'count': segment[1],
                    'style': segment[2], # gold, silver, bronze
                })
            self.series['segments'] = sgs


class Marker:
    def __init__(self, id: str, label: str, style: str) -> None:
        self.marker = {
            'id': id,
            'label': label,
            'style': style,
        }


class User:
    def __init__(self, name: str, id: str = None, organization: str = None, members: List[str] = None, official: bool = None, marker: Marker = None, location: str = None, avatar: str = None, photo: str = None) -> None:
        '''
            name: 用户名或队伍名
            id: 队伍 ID【可选】
            organization: 学校或组织或机构【可选】
            member: 队员名【可选】
            official: 是否是正式比赛队伍【可选】
            marker: 特殊队伍标记【可选】
            location: 选手位置（座位号）
            avatar: 选手的小头像 avatar（一般就是对应学校的校徽图片）
            photo: 选手的照片（一般点击选手单元格后弹窗展示）
        '''
        self.user = {'name': name}
        if id is not None:
            self.user['id'] = id
        if organization is not None:
            self.user['organization'] = organization
        if members is not None:
            team = []
            for m in members:
                team.append({'name': m})
            self.user['teamMembers'] = team
        if official is not None:
            self.user['official'] = official
        if marker is not None:
            self.user['marker'] = marker.marker['id']
        if location is not None:
            self.user['location'] = location
        if avatar is not None:
            self.user['avatar'] = avatar
        if photo is not None:
            self.user['photo'] = photo
class Order:
    def __init__(self, order: int = None, segment_index: int = None) -> None:
        '''
            order: 排行榜的排名顺序【可选】
            segment_index: 获得奖项的序号【可选】
        '''
        self.order = {
            'rank': None
        }
        if order is not None:
            self.order['rank'] = order
        if segment_index is not None:
            self.order['segmentIndex'] = segment_index


class Status:
    def __init__(self, result: str = None, duration: int = 0, tries: int = 0, solutions:  List[Tuple[str, int]] = None) -> None:
        '''
            result: 题目最终结果
            duration: 解题总耗时，单位秒
            solutions: 每次提交的具体结果 (提交结果, 耗时/单位秒)
        '''
        self.result = result
        self.duration = duration
        self.tries = tries
        self.solutions = None
        if solutions is not None:
            self.solutions = []
            for solution in solutions:
                self.solutions.append({
                    'result': solution[0],
                    'time': [solution[1], 's'],
                })


class Row:
    def __init__(self, ranks: List[Order], user: User, score: Tuple[int, int], statuses: List[Status]) -> None:
        '''
            ranks: 与 Series 对应，Series 有几项 ranks 数组元素就有多少
            user: 用户信息
            score: 解题总数和总用时，单位秒 (解题数, 总用时)
            statuses: 和 Problem 对应，比赛有多少道题目 statuses 数组元素有多少
        '''
        self.ranks = []
        for r in ranks:
            self.ranks.append(r.order)

        self.user = user.user
        self.score = {'value': score[0], 'time': [score[1], 's']}
        self.statuses = []
        for s in statuses:
            status = {
                'result': s.result,
                'time': [s.duration, 's'],
                'tries': s.tries,
            }
            if s.solutions is not None:
                status['solutions'] = s.solutions
            self.statuses.append(status)


class Rank:
    def __init__(self, contest: Contest, problems: List[Problem], series: List[Series], rows: List[Row], markers: List[Marker] = None, contributors: List[str] = None) -> None:
        '''
            contest: 比赛基础信息
            problems: 题目列表
            series: 排名
            rows: 做题记录
            markers: 特殊队伍标记
        '''
        self.contest = contest.contest

        self.problems = []
        for p in problems:
            self.problems.append(p.problem)
        
        self.series = []
        for s in series:
            self.series.append(s.series)
        
        self.rows = rows

        self.markers = None
        if markers is not None:
            self.markers = []
            for m in markers:
                self.markers.append(m.marker)
        self.contributors = contributors
        
        self.__check()
    
    def __check(self):
        '''
            TODO: 参数校验
        '''
        pass

    def __transform_rows(self) -> List[Any]:
        rows = []
        for r in self.rows:      
            rows.append({
                'ranks': r.ranks,
                'user': r.user,
                'score': r.score,
                'statuses': r.statuses,
            })
        
        return rows

    def result(self) -> Dict[str, Any]:
        rank = {
            'type': 'general',
            'version': '0.2.3',
            'contest': self.contest,
            'problems': self.problems,
            'series': self.series,
            'rows': self.__transform_rows(),
            'sorter': {'algorithm': 'ICPC', 'config': {'penalty': [20, 'min']}}
        }
        if self.markers is not None:
            rank['markers'] = self.markers
        if self.contributors is not None:
            rank['contributors'] = self.contributors
        
        return rank
    
    def to_str(self, ensure_ascii=True) -> str:
        return json.dumps(self.result(), ensure_ascii=ensure_ascii)


def main():
    contest = Contest('contest 2022', 1666511976, 5, 1)
    problems = [Problem('A', (5, 20)), Problem('B', (1, 10))]
    series = [Series('rank', [('金奖', 1, Style_Gold)])]
    rows = [Row([Order(1, 1)], User('一队'), (1, 1000), [Status(SR_FirstBlood, 10, 1), Status(SR_FirstBlood, 10, 1)]), Row([Order(2, 2)], User('二队'), (1, 1200), [Status(SR_Accepted, 100, 3), Status(SR_FirstBlood, 10, 1)])]
    rank = Rank(contest, problems, series, rows)
    print(rank.to_str())


if __name__ == '__main__':
    main()