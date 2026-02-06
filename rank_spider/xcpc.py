import json
import requests
import rank3
import re
import os
from typing import Dict, List, Union
import image_downloader


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


srkDefaultBallonColors = [
  'rgba(189, 14, 14, 0.7)',
  'rgba(149, 31, 217, 0.7)',
  'rgba(16, 32, 96, 0.7)',
  'rgba(38, 185, 60, 0.7)',
  'rgba(239, 217, 9, 0.7)',
  'rgba(243, 88, 20, 0.7)',
  'rgba(12, 76, 138, 0.7)',
  'rgba(156, 155, 155, 0.7)',
  'rgba(4, 154, 115, 0.7)',
  'rgba(159, 19, 236, 0.7)',
  'rgba(42, 197, 202, 0.7)',
  'rgba(142, 56, 54, 0.7)',
  'rgba(144, 238, 144, 0.7)',
]

class Parse:
    time_unit = 'ms'
    def __init__(self, config: Dict, teams: Dict, runs: Dict) -> None:
        self.config = config
        self.teams = teams
        self.runs = runs
        
        # 兼容不同的配置格式：优先使用 problem_id 数组，否则从 problems 对象数组提取
        if 'problem_id' in config:
            self.problem_id_list = config['problem_id']
        elif 'problems' in config and isinstance(config['problems'], list):
            # 从 problems 数组提取 id 或 label 作为 problem_id
            self.problem_id_list = []
            for prob in config['problems']:
                if isinstance(prob, dict):
                    # 优先使用 label，其次使用 id
                    if 'label' in prob:
                        self.problem_id_list.append(prob['label'])
                    elif 'id' in prob:
                        self.problem_id_list.append(prob['id'])
            if not self.problem_id_list:
                raise ValueError("config 中的 problems 数组为空或格式不正确")
        else:
            raise KeyError("config 中既没有 problem_id 数组也没有 problems 数组")
        
        self.num_problems = len(self.problem_id_list)
        
        # 建立 problem_id 映射：支持数字和字符串两种格式的 problem_id
        # 用于将 runs 中的 problem_id (可能是数字) 映射到索引
        self.problem_id_map = {}
        if 'problems' in config and isinstance(config['problems'], list):
            for idx, prob in enumerate(config['problems']):
                if isinstance(prob, dict) and 'id' in prob:
                    # 映射字符串形式的 id
                    self.problem_id_map[prob['id']] = idx
                    # 如果 id 是数字字符串，也映射数字形式
                    try:
                        num_id = int(prob['id'])
                        self.problem_id_map[num_id] = idx
                    except (ValueError, TypeError):
                        pass
        
        # 如果没有 problems 数组，使用默认的索引映射
        if not self.problem_id_map:
            for idx, pid in enumerate(self.problem_id_list):
                self.problem_id_map[pid] = idx
                self.problem_id_map[idx] = idx
        
        self.group = config.get('group', {})
        self.statistics = [[0, 0] for i in self.problem_id_list]
        self.statuses = {}
        self.__calculate()

    def contest(self) -> rank3.Contest:
        # 处理时间戳：如果是毫秒级时间戳，转换为秒级
        start_time = self.config['start_time']
        end_time = self.config['end_time']
        frozen_time = self.config.get('frozen_time', 0)
        link = self.config.get('link', None)
        banner = self.config.get('banner', None)

        # 检查是否为毫秒级时间戳（大于某个阈值，比如2000年的时间戳*1000）
        if start_time > 946684800000:  # 2000-01-01 00:00:00 的毫秒时间戳
            start_time = start_time // 1000
        if end_time > 946684800000:
            end_time = end_time // 1000

        # 兼容 frozen_time 的多种含义：
        # 1) 如果 frozen_time 看起来像一个毫秒级的时间戳（> 2000 年），则视为封榜开始时间戳，计算封榜时长 = end_time - frozen_timestamp
        # 2) 否则，如果 frozen_time 看起来像毫秒级的时长（>1000），则视为毫秒时长，转换为小时
        # 3) 否则，尝试按秒或小时直接使用
        frozen_hours = 0
        try:
            if frozen_time is None:
                frozen_hours = 0
            elif isinstance(frozen_time, (int, float)) and frozen_time > 946684800000:
                # 毫秒级时间戳
                frozen_ts = int(frozen_time) // 1000
                frozen_hours = (end_time - frozen_ts) / 3600
            elif isinstance(frozen_time, (int, float)) and frozen_time > 1000:
                # 很可能是毫秒级的时长（例如 3600000 表示 1 小时）
                frozen_hours = float(frozen_time) / 1000.0 / 3600.0
            else:
                # 可能已经是秒或小时数，优先当成秒处理再转小时，否则直接当小时
                if isinstance(frozen_time, (int, float)) and frozen_time > 3600:
                    # 当作秒
                    frozen_hours = float(frozen_time) / 3600.0
                else:
                    frozen_hours = float(frozen_time)
        except Exception:
            frozen_hours = 0

        duration = (end_time - start_time) / 3600
        
        # 处理 banner：转换为 {image, link} 格式
        processed_banner = None
        if banner is not None and isinstance(banner, dict):
            original_link = banner.get('url') 
            if original_link:
                processed_banner = {
                    'image': original_link,
                    'link': original_link
                }
        
        return rank3.Contest(self.config['contest_name'], start_time, duration, frozen_hours, link, processed_banner)

    def problems(self) -> List[rank3.Problem]:
        problems = []
        f = 1
        for i, v in enumerate(self.problem_id_list):
            style = None
            if self.config.get('balloon_color') is not None:
                color = self.config['balloon_color'][i]
                style = (color['background_color'], color['color'])
                if(i <= 12 and color['background_color'] != srkDefaultBallonColors[i]):
                    f = 0
                    break

        for i, v in enumerate(self.problem_id_list):
            style = None
            if self.config.get('balloon_color') is not None:
                color = self.config['balloon_color'][i]
                style = (color['background_color'], color['color'])
            if f == 1:
                style = None
            problems.append(rank3.Problem(v, self.statistics[i], style))
        return problems

    def series(self, markers) -> Dict[str, Union[List[rank3.Series], bool]]:
        self.gold, self.silver, self.bronze = 0, 0, 0
        ccpcFlag = False
        toRemarks = True
        if type(self.config.get('medal')) is dict and self.config['medal'].get('official') is not None:
            self.gold = self.config['medal']['official']['gold']
            self.silver = self.config['medal']['official']['silver']
            self.bronze = self.config['medal']['official']['bronze']
            toRemarks = False
        elif type(self.config.get('medal')) is str:
            if self.config.get('medal') == 'CCPC' or self.config.get('medal') == 'ccpc':
                self.gold = 0.1
                self.silver = 0.2
                self.bronze = 0.3
                ccpcFlag = True
                toRemarks = False
        elif type(self.config.get('medal')) is dict and self.config['medal'].get('all') is not None:
            self.gold = self.config['medal']['all']['gold']
            self.silver = self.config['medal']['all']['silver']
            self.bronze = self.config['medal']['all']['bronze']
            toRemarks = False
        else:
            self.gold = 0
            self.silver = 0
            self.bronze = 0

        all_rank = rank3.Series(title='R#', rule={"preset": "Normal"})


 
        if ccpcFlag is False:
            icpc_rule = {
                "preset": "ICPC",
                "options": {
                    "count": {"value": [self.gold, self.silver, self.bronze]}
                }
            }
        else:
            icpc_rule = {
                "preset": "ICPC",
                "options": {
                    "ratio": {"value": [self.gold, self.silver, self.bronze], "denominator": "scored"}
                }
            }
        
        anotherSeries = []
        if len(markers) > 0:
            if type(self.config.get('medal')) is dict and self.config['medal'].get('official') is None:
                for key,value in self.config['medal'].items():
                    if type(value) is dict and value.get('gold') is not None and value.get('silver') is not None and value.get('bronze') is not None:
                        title = None
                        for marker in markers:
                            if marker.marker['id'] == key:
                                title = marker.marker['label'] + '#'
                                break
                        if title is None:
                            continue
                        rule = {
                            "preset": "ICPC",
                            "options": {
                                "count": {"value": [value['gold'], value['silver'], value['bronze']]},
                                "filter": {"byMarker": key}
                            }
                        }
                        anotherSeries.append(rank3.Series(title=title, segments=[('金奖', rank3.Style_Gold), ('银奖', rank3.Style_Silver), ('铜奖', rank3.Style_Bronze)], rule=rule))
                    else:
                        continue

        offical_rank = rank3.Series(title='#', segments=[('金奖', rank3.Style_Gold), ('银奖', rank3.Style_Silver), ('铜奖', rank3.Style_Bronze)], rule=icpc_rule)
        school_rank = rank3.Series(title='S#', rule={"preset": "UniqByUserField", "options": {"field": "organization", "includeOfficialOnly": True}})
        result = [offical_rank]
        if len(anotherSeries) > 0:
            result += anotherSeries
        result.append(all_rank)
        result.append(school_rank)
        return {
            "rows": result,
            "remarks": toRemarks
        }

    def markers(self) -> List[rank3.Marker]:
        all_markers = []
        colors = [ 'blue', 'green', 'yellow', 'orange', 'red', 'purple']
        index = 0
        femalePattern = r'女队'
        starPattern = r'打星'
        for key, value in self.group.items():
            if key == 'unofficial':
                continue
            if key == 'official':
                continue
            if re.search(starPattern, value):
                continue
            is_female = re.search(femalePattern, value) or (isinstance(key, str) and 'female' in key)
            style = 'pink' if is_female else colors[index % len(colors)]
            marker = rank3.Marker(key, value, style)
            all_markers.append(marker)
            if not is_female:
                index += 1
        # 拆分女队相关和普通 marker
        female_markers = [m for m in all_markers if ('female' in str(m.marker['id']).lower() or re.search(femalePattern, str(m.marker['label'])))]
        normal_markers = [m for m in all_markers if m not in female_markers]
        return normal_markers + female_markers

    def rows(self, markers) -> List[rank3.Row]:
        data = []
        
        # 处理 teams 数据格式兼容性：支持字典和列表两种格式
        if isinstance(self.teams, dict):
            # 旧格式：字典 {"J12": {"team_id": "J12", "name": "Echo", ...}, ...}
            teams_items = self.teams.items()
        elif isinstance(self.teams, list):
            # 新格式：列表 [{"id": "team001", "name": {...}, ...}, ...]
            teams_items = [(team.get('id', str(i)), team) for i, team in enumerate(self.teams)]
        else:
            raise TypeError(f"Unsupported teams data type: {type(self.teams)}")
            
        for k, v in teams_items:
            u_markers = []

            # 判断是否有教练
            coach = None
            if v.get('coach', None) is not None:
                coach = v.get('coach')
            # 判断是否为正式队伍的逻辑
            original_official = v.get('official', 0) == 1
            group = v.get('group', [])
            group_unofficial = 'unofficial' in group

            explicit_official = v.get('official', False)
            explicit_unofficial = v.get('unofficial', group_unofficial)

            official = original_official  or explicit_official or not explicit_unofficial

            # group字段内的marker，只添加 markers 里存在的 id
            for t in group:
                if t is not None and t != 'official' and t != 'unofficial' and t != 'girl':
                    for m in markers:
                        if m.marker['id'] == t and m not in u_markers:
                            u_markers.append(m)
            # 检查group外层对象属性是否与markers重合
            for m in markers:
                if m.marker['id'] in v and m not in u_markers:
                    u_markers.append(m)

            # 判断是否为女队的逻辑（只要 markers 里有女队相关 marker 且 user 是女队且未加过就加）
            original_girl = v.get('girl') == 1
            group_girl = 'girl' in group
            is_girl_team = original_girl or group_girl
            # 女队相关 marker: id 含 female/girl 或 label 含“女队”
            female_markers = [m for m in markers if ('female' in str(m.marker['id']).lower() or 'girl' in str(m.marker['id']).lower() or '女队' in str(m.marker['label']))]
            # 检查当前 user 是否已加过女队相关 marker
            has_any_female_marker = any(m in u_markers for m in female_markers)
            if is_girl_team and not has_any_female_marker:
                for m in female_markers:
                    if m not in u_markers:
                        u_markers.append(m)

            # 处理队伍名称：兼容新旧格式
            team_name = v.get('name', '')
            if isinstance(team_name, dict):
                if 'texts' in team_name:
                    # 新格式：多语言名称
                    fallback_lang = team_name.get('fallback_lang', 'zh-CN')
                    texts = team_name.get('texts', {})
                    # 优先使用 fallback_lang 指定的语言，否则使用 zh-CN，最后使用第一个可用的语言
                    if fallback_lang in texts:
                        team_name = texts[fallback_lang]
                    elif 'zh-CN' in texts:
                        team_name = texts['zh-CN']
                    elif texts:
                        team_name = list(texts.values())[0]
                    else:
                        team_name = ''
                else:
                    # 如果是字典但没有 texts 字段，转换为字符串
                    team_name = str(team_name)

            members = None
            if v.get('members', None) is not None:
                processed_members = []
                for member in v['members']:
                    if member is not None and str(member).lower() != 'null':
                        # 处理成员名称：兼容新旧格式
                        if isinstance(member, dict) and 'name' in member:
                            # 先提取 name 字段
                            member_name_obj = member['name']
                            if isinstance(member_name_obj, dict) and 'texts' in member_name_obj:
                                # 新格式：多语言成员名称
                                fallback_lang = member_name_obj.get('fallback_lang', 'zh-CN')
                                texts = member_name_obj.get('texts', {})
                                if fallback_lang in texts:
                                    member_name = texts[fallback_lang]
                                elif 'zh-CN' in texts:
                                    member_name = texts['zh-CN']
                                elif texts:
                                    member_name = list(texts.values())[0]
                                else:
                                    member_name = str(member_name_obj)
                            else:
                                # name 字段直接是字符串
                                member_name = str(member_name_obj)
                        else:
                            # 旧格式：直接是字符串
                            member_name = str(member)
                        processed_members.append(member_name)
                members = processed_members
            if coach is not None and type(members) is list:
                members.append(f"{coach} (教练)")
            
            user = rank3.User(team_name, k, v.get('organization', None), members, official, u_markers, v.get('location', None), v.get('avatar', None), v.get('photo', None))
            
            # 处理队伍照片：根据 missing_photo 字段生成 x_photo 信息
            x_photo = None
            missing_photo = v.get('missing_photo', False)
            if not missing_photo:  # 如果没有 missing_photo 字段或者为 False，说明有照片
                # 从 config 中获取照片URL模板来确定文件扩展名
                team_photo_template = self.config.get('options', {}).get('team_photo_url_template', {})
                if team_photo_template and 'url' in team_photo_template:
                    # 从模板URL中提取文件扩展名，如果没有则默认为 .jpg
                    template_url = team_photo_template['url']
                    if '.' in template_url:
                        # 提取最后一个点后面的内容作为扩展名
                        extension = '.' + template_url.split('.')[-1]
                    else:
                        extension = '.jpg'
                    x_photo = f"{k}{extension}"
                else:
                    # 如果没有模板，默认使用 .jpg
                    x_photo = f"{k}.jpg"

            # 把 x_photo 放入 user.user 中（rows[].user.x_photo）而非 row 层级
            if x_photo is not None:
                user.user['x_photo'] = x_photo
                    
            cnt, ctms = 0, 0
            last_solved_time = 0  # 最后一次通过题目的时间（秒级时间戳）
            statuses = self.statuses.get(str(k), [])

            use_accumulate_in_seconds = self.options()

            for v in statuses:
                v.duration //= 1000  # 转换为秒
                if v.result in [rank3.SR_Accepted, rank3.SR_FirstBlood]:
                    cnt += 1
                    if use_accumulate_in_seconds:
                        ctms += v.duration
                    else:
                        ctms += v.duration // 60 * 60
                    
                    # 更新最后一次通过题目的时间
                    # v.duration 已经转换为秒，包含了罚时+通过时间
                    # 原始罚时公式（毫秒）：duration = 20*60*1000*tries + timestamp
                    # 转换为秒后：duration = 20*60*tries + timestamp_in_seconds
                    # 所以实际通过时间戳（秒） = duration - 20*60*tries
                    actual_solve_time = v.duration - (20 * 60 * v.tries)
                    if actual_solve_time > last_solved_time:
                        last_solved_time = actual_solve_time
            
            score = [cnt, ctms//60*60 if use_accumulate_in_seconds else ctms]
            data.append({
                'user': user, 
                'score': score, 
                'status': statuses,
                'last_solved_time': last_solved_time,
                'team_name': team_name  # 用于字典序排序
            })
        
        # 优化排序逻辑：解题数(降序), 罚时(升序), 最后通过时间(升序), 队伍名称(升序)
        data.sort(key=lambda x: (
            -x['score'][0],  # 解题数，降序（数量越多越好）
            x['score'][1],   # 罚时，升序（时间越少越好）
            x['last_solved_time'] // 60,  # 最后通过时间（分钟），升序（时间越早越好）
            x['team_name']   # 队伍名称，升序（字典序）
        ))

        rows = []
        for d in data:
            row = rank3.Row(d['user'], d['score'], d['status'], self.num_problems)
            # x_photo 已直接放入 user 字段（user.user['x_photo']），无需在 row 层级重复设置
            rows.append(row)
        return rows
    
    # 判断是否使用 accumulate_in_seconds 计算 penalty
    # 如果使用 accumulate_in_seconds 则返回 True，否则返回 False
    def options(self) -> bool:
        use_accumulate_in_seconds = (
                isinstance(self.config.get('options'), dict) and
                self.config['options'].get('calculation_of_penalty') == 'accumulate_in_seconds_and_finally_to_the_minute'
            )
        return use_accumulate_in_seconds
    
    def __calculate(self) -> None:

        first_blood = [0 for i in self.problem_id_list]

        for v in self.runs:
            # 将 runs 中的 problem_id 映射到索引
            raw_problem_id = v['problem_id']
            problem_idx = self.problem_id_map.get(raw_problem_id)
            
            # 如果映射失败，跳过此记录
            if problem_idx is None:
                url = contest_url.get(self.config.get("contest_name"))
                unkown = unkown_contest.setdefault(url,
                                                   {'name': self.config.get("contest_name"), 'status': set(), 'count': 0})
                unkown['status'].add(f"unknown_problem_id:{raw_problem_id}")
                unkown['count'] += 1
                continue

            if self.statuses.get(str(v['team_id'])) is None:
                self.statuses[str(v['team_id'])] = [rank3.Status() for i in self.problem_id_list]
            status = self.statuses[str(v['team_id'])][problem_idx]

            result = sr_results.get(v['status'].upper())
            if result is None:
                url = contest_url.get(self.config["contest_name"])
                unkown = unkown_contest.setdefault(url,
                                                   {'name': self.config["contest_name"], 'status': set(), 'count': 0})
                unkown['status'].add(v["status"])
                unkown['count'] += 1
                continue

            if status.result in [rank3.SR_Accepted, rank3.SR_FirstBlood]:
                continue


            tt = v['timestamp'] * 1000 if Parse.time_unit == 's' else v['timestamp']
            if result == rank3.SR_Accepted:
                if first_blood[problem_idx] == 0 or first_blood[problem_idx] == tt:
                    result = rank3.SR_FirstBlood
                    first_blood[problem_idx] = tt
            
            status.result = result

            if status.solutions is None:
                status.solutions = []
            status.solutions.append({
                'result': result,
                'time': [v['timestamp'], Parse.time_unit],
            })

            if result not in [rank3.SR_FirstBlood, rank3.SR_Accepted, rank3.SR_Rejected, rank3.SR_Frozen]:
                status.result = rank3.SR_Rejected

            if result in [rank3.SR_FirstBlood, rank3.SR_Accepted] :
                status.duration = 20 * 60 * 1000 * status.tries + tt


            if result not in [rank3.SR_CompilationError, rank3.SR_PresentationError, rank3.SR_UnknownError]:
                status.tries += 1

            self.statuses[str(v['team_id'])][problem_idx] = status

            if result == rank3.SR_Accepted or result == rank3.SR_FirstBlood :
                self.statistics[problem_idx][0] += 1
            self.statistics[problem_idx][1] += 1



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
        
    # icpc.pop('2018world-finals')
    # icpc.pop('2019world-finals')
    # icpc.pop('2020world-finals')
    # icpc.pop('2020world-finals-Invitational')
    # icpc.pop('48thworld-finals')
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

    if config is None:
        print(f"{path} 获取 config.json 失败")
        return
    if teams is None:
        print(f"{path} 获取 team.json 失败")
        return
    if runs is None:
        print(f"{path} 获取 run.json 失败")
        return

    # 下载 banner 图片
    banner = config.get('banner', None)
    if banner is not None:
        # 从 name 中提取比赛 ID，例如 'ccpc/ccpc7thfinal.srk.json' -> 'ccpc7thfinal'
        contest_id = name.split('/')[-1].replace('.srk.json', '')
        image_downloader.download_banner(banner, contest_id)

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
    marker = parse.markers()
    series = parse.series(marker)
    rows = parse.rows(marker)
    options = parse.options()
    r = rank3.Rank(contest, 
                   problems, 
                   series['rows'], 
                   rows, 
                   marker, 
                   contributors=['XCPCIO (https://xcpcio.com)', 'algoUX (https://algoux.org)'], 
                   penaltyTimeCalculation = 's' if options else 'min',
                   isRemarks = series['remarks'],
                   )
    os.makedirs(os.path.dirname(name), exist_ok=True)
    with open(name, 'w', encoding='utf-8') as file:
        json.dump(r.result(), file, ensure_ascii=False)

def once():
    call_rank('/icpc/48th/nanjing', 'temp/nanjing.srk.json')


if __name__ == '__main__':
    main()
    # once()