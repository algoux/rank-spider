import json
import requests
import rank3
import re
import os
from copy import deepcopy
from typing import Any, Dict, List, Optional, Union
import image_downloader


# contest_name: url
contest_url = {}
# url: {contest_name: name, status: v}
unkown_contest = {}
# Old XCPCIO online boards can collapse many accepted runs to the same earliest time.
MAX_SAME_TIME_ONLINE_FIRST_BLOODS = 10


def _result(
    ok: bool,
    output_path: Optional[str] = None,
    contest_name: Optional[str] = None,
    contest_url_value: Optional[str] = None,
    unknown_statuses: Optional[Dict[str, Any]] = None,
    warnings: Optional[List[str]] = None,
    error: Optional[str] = None,
) -> Dict[str, Any]:
    return {
        "ok": ok,
        "output_path": output_path,
        "contest_name": contest_name,
        "contest_url": contest_url_value,
        "unknown_statuses": unknown_statuses or {},
        "warnings": warnings or [],
        "error": error,
    }


def _resolve_output_path(output_path: str, cwd: Optional[str] = None) -> str:
    if not output_path or not output_path.strip():
        raise ValueError("output_path must not be empty")

    base_dir = os.path.abspath(cwd or os.getcwd())
    resolved = os.path.abspath(os.path.join(base_dir, output_path))
    common_path = os.path.commonpath([base_dir, resolved])
    if common_path != base_dir:
        raise ValueError(
            f"output_path must be inside current working directory: {base_dir}"
        )
    if os.path.basename(resolved) == "":
        raise ValueError("output_path must include a file name")
    return resolved


def _format_unknown_statuses(url: Optional[str]) -> Dict[str, Any]:
    if not url:
        return {}
    item = unkown_contest.get(url)
    if not item:
        return {}
    return {
        "name": item.get("name"),
        "status": sorted(item.get("status", set())),
        "count": item.get("count", 0),
    }


def _asset_alias(output_path: str) -> str:
    filename = os.path.basename(output_path)
    if filename.endswith(".srk.json"):
        return filename[: -len(".srk.json")]
    return os.path.splitext(filename)[0]


def _prepare_image_asset(
    image_data: Any,
    contest_id: str,
    filename_stem: str,
    warnings: List[str],
    warning_label: str,
    download_assets: bool = True,
    default_ext: str = "png",
) -> Optional[str]:
    if image_data is None:
        return None

    if download_assets:
        image_path, ok = image_downloader.download_asset(
            image_data,
            contest_id,
            filename_stem,
            default_ext=default_ext,
        )
        if not ok:
            if image_path is None:
                warnings.append(f"{warning_label} 图片素材处理失败")
            else:
                warnings.append(f"{warning_label} 图片素材下载失败，已回退到远程 URL")
        return image_path

    image_path = image_downloader.get_srk_image_without_download(image_data)
    if image_path is None and image_downloader.parse_base64_image(image_data):
        warnings.append(
            f"{warning_label} 是 base64 图片，已跳过；启用资源下载后可写入 assets/"
        )
    return image_path


def _template_image_for_team(template: Any, team_id: Any) -> Optional[Any]:
    if not template:
        return None
    team_id_str = str(team_id)
    if isinstance(template, str):
        return template.replace("${team_id}", team_id_str)
    if isinstance(template, dict):
        image = deepcopy(template)
        if isinstance(image.get("url"), str):
            image["url"] = image["url"].replace("${team_id}", team_id_str)
        return image
    return None


def _team_items(teams: Any):
    if isinstance(teams, dict):
        return teams.items()
    if isinstance(teams, list):
        return [
            (team.get("id", str(i)) if isinstance(team, dict) else str(i), team)
            for i, team in enumerate(teams)
        ]
    return []


def _prepare_assets(
    path: str,
    config: Dict,
    teams: Any,
    contest_id: str,
    download_assets: bool,
    warnings: List[str],
) -> None:
    banner = config.get("banner")
    if banner is not None:
        banner_image = _prepare_image_asset(
            banner,
            contest_id,
            "banner",
            warnings,
            f"{path} banner",
            download_assets,
            "png",
        )
        if banner_image:
            config["_srk_banner"] = banner_image
            banner_link = image_downloader.image_link(banner)
            if banner_link:
                config["_srk_banner_link"] = banner_link

    team_photo_template = None
    if isinstance(config.get("options"), dict):
        team_photo_template = config["options"].get("team_photo_url_template")

    for team_key, team in _team_items(teams):
        if not isinstance(team, dict):
            continue

        team_id = team.get("team_id") or team.get("id") or team_key
        filename_id = image_downloader.safe_filename_component(team_id, "team")

        avatar_source = team.get("avatar") or team.get("badge")
        if avatar_source is not None:
            avatar = _prepare_image_asset(
                avatar_source,
                contest_id,
                f"team-{filename_id}-avatar",
                warnings,
                f"{path} team {team_id} avatar",
                download_assets,
                "png",
            )
            if avatar:
                team["avatar"] = avatar

        photo_source = team.get("photo")
        if photo_source is None and not team.get("missing_photo", False):
            photo_source = _template_image_for_team(team_photo_template, team_id)
        if photo_source is not None:
            photo = _prepare_image_asset(
                photo_source,
                contest_id,
                f"team-{filename_id}-photo",
                warnings,
                f"{path} team {team_id} photo",
                download_assets,
                "jpg",
            )
            if photo:
                team["photo"] = photo


def set_contest_url(path: str, config):
    url = f"https://board.xcpcio.com{path}"
    contest_url[config["contest_name"]] = url
    print(f"name: {config['contest_name']}, url: {url}")


def get(url: str):
    try:
        result = requests.get(url=url, timeout=180)
    except Exception as e:
        print("请求 URL 发生错误", e)
        return

    if result.status_code != 200:
        print("请求被拒绝，状态码：", result.status_code)
        return

    result.encoding = "utf-8"
    return result.json()


sr_results = {
    "ACCEPTED": rank3.SR_Accepted,
    "WRONG_ANSWER": rank3.SR_WrongAnswer,
    "RUNTIME_ERROR": rank3.SR_RuntimeError,
    "TIME_LIMIT_EXCEEDED": rank3.SR_TimeLimitExceeded,
    "COMPILATION_ERROR": rank3.SR_CompilationError,
    "MEMORY_LIMIT_EXCEEDED": rank3.SR_MemoryLimitExceeded,
    "OUTPUT_LIMIT_EXCEEDED": rank3.SR_OutputLimitExceeded,
    "PRESENTATION_ERROR": rank3.SR_PresentationError,
    "NO_OUTPUT": rank3.SR_NoOutput,
    "CORRECT": rank3.SR_Accepted,
    "INCORRECT": rank3.SR_Rejected,
    "PENDING": rank3.SR_Frozen,
    "FROZEN": rank3.SR_Frozen,
}


srkDefaultBallonColorPalettes = [
    [
        "rgba(189, 14, 14, 0.7)",
        "rgba(149, 31, 217, 0.7)",
        "rgba(16, 32, 96, 0.7)",
        "rgba(38, 185, 60, 0.7)",
        "rgba(239, 217, 9, 0.7)",
        "rgba(243, 88, 20, 0.7)",
        "rgba(12, 76, 138, 0.7)",
        "rgba(156, 155, 155, 0.7)",
        "rgba(4, 154, 115, 0.7)",
        "rgba(159, 19, 236, 0.7)",
        "rgba(42, 197, 202, 0.7)",
        "rgba(142, 56, 54, 0.7)",
        "rgba(144, 238, 144, 0.7)",
    ],
    [
        "rgba(189, 14, 14, 0.7)",
        "rgba(255, 144, 228, 0.7)",
        "rgba(255, 255, 255, 0.7)",
        "rgba(38, 185, 60, 0.7)",
        "rgba(239, 217, 9, 0.7)",
        "rgba(243, 88, 20, 0.7)",
        "rgba(12, 76, 138, 0.7)",
        "rgba(156, 155, 155, 0.7)",
        "rgba(4, 154, 115, 0.7)",
        "rgba(159, 19, 236, 0.7)",
        "rgba(42, 197, 202, 0.7)",
        "rgba(142, 56, 54, 0.7)",
        "rgba(0, 0, 0, 0.7)",
    ],
    [
        "rgba(189, 14, 14, 0.7)",
        "#951FD9",
        "rgba(255, 255, 255, 0.7)",
        "rgba(38, 185, 60, 0.7)",
        "rgba(239, 217, 9, 0.7)",
        "rgba(243, 88, 20, 0.7)",
        "rgba(12, 76, 138, 0.7)",
        "rgba(156, 155, 155, 0.7)",
        "rgba(4, 154, 115, 0.7)",
        "rgba(159, 19, 236, 0.7)",
        "rgba(42, 197, 202, 0.7)",
        "rgba(142, 56, 54, 0.7)",
        "rgba(0, 0, 0, 0.7)",
    ],
    [
        "#dc2626",
        "#f59e0b",
        "#fde047",
        "#22c55e",
        "#5eead4",
        "#3b82f6",
        "#a855f7",
        "#f472b6",
        "#ffffff",
        "#edc5f2",
        "#95f4b8",
        "#f2e7b1",
    ],
    [
        "#ff3b30",
        "#ee7528",
        "#fde047",
        "#00aa00",
        "#5eead4",
        "#1b75dc",
        "#a855f7",
        "#f472b6",
        "#A52A2A",
        "#000080",
        "#000000",
        "#ffffff",
        "#f5b7b7",
    ],
    [
        "#ff3b30",
        "#ee7528",
        "#fde047",
        "#00aa00",
        "#5eead4",
        "#1b75dc",
        "#a855f7",
        "#f472b6",
        "#A52A2A",
        "#000080",
        "#000000",
        "#737373",
    ],
]


def _normalize_contest_timestamp_seconds(value: Any) -> float:
    timestamp = float(value)
    if timestamp > 946684800000:
        return timestamp // 1000
    return timestamp


def _infer_run_time_unit(config: Dict, runs: List[Dict]) -> str:
    first_timestamp = float(runs[0].get("timestamp", 0))
    if first_timestamp / 1000 < 1:
        return "s"

    try:
        start_time = _normalize_contest_timestamp_seconds(config.get("start_time"))
        end_time = _normalize_contest_timestamp_seconds(config.get("end_time"))
        contest_duration_seconds = end_time - start_time
    except (TypeError, ValueError):
        return "ms"

    if contest_duration_seconds <= 0:
        return "ms"

    max_timestamp = max(float(run.get("timestamp", 0)) for run in runs)
    tolerance_seconds = max(300, contest_duration_seconds * 0.01)
    if max_timestamp <= contest_duration_seconds + tolerance_seconds:
        return "s"
    return "ms"


def _is_online_contest(path: str, config: Dict) -> bool:
    parts = [
        path,
        config.get("contest_name"),
        config.get("name"),
        config.get("title"),
        config.get("board_name"),
    ]
    text = " ".join(
        " ".join(str(v) for v in value.values())
        if isinstance(value, dict)
        else str(value or "")
        for value in parts
    )
    return re.search(r"网络|online|preliminary", text, re.IGNORECASE) is not None


def _time_to_milliseconds(time_value: Any) -> float:
    if not isinstance(time_value, list) or len(time_value) < 2:
        return float("nan")
    try:
        value = float(time_value[0])
    except (TypeError, ValueError):
        return float("nan")
    unit = time_value[1]
    if unit == "ms":
        return value
    if unit == "s":
        return value * 1000
    if unit == "min":
        return value * 60 * 1000
    if unit == "h":
        return value * 60 * 60 * 1000
    if unit == "d":
        return value * 24 * 60 * 60 * 1000
    return value


def _set_accepted_solution_result(status: Dict, result: str) -> None:
    solutions = status.get("solutions")
    if not isinstance(solutions, list):
        return
    for solution in reversed(solutions):
        if solution.get("result") in [rank3.SR_Accepted, rank3.SR_FirstBlood]:
            solution["result"] = result
            return


def _normalize_online_first_blood(rank_object: Dict) -> None:
    best_by_problem: Dict[int, Dict[str, Any]] = {}

    for row in rank_object.get("rows", []):
        statuses = row.get("statuses", row.get("status", []))
        if not isinstance(statuses, list):
            continue
        for problem_index, status in enumerate(statuses):
            if not isinstance(status, dict):
                continue

            if status.get("result") == rank3.SR_FirstBlood:
                status["result"] = rank3.SR_Accepted
            solutions = status.get("solutions")
            if isinstance(solutions, list):
                for solution in solutions:
                    if solution.get("result") == rank3.SR_FirstBlood:
                        solution["result"] = rank3.SR_Accepted

            if status.get("result") != rank3.SR_Accepted:
                continue
            time = _time_to_milliseconds(status.get("time"))
            if time != time:
                continue

            best = best_by_problem.get(problem_index)
            if best is None or time < best["time"]:
                best_by_problem[problem_index] = {
                    "time": time,
                    "candidates": [status],
                }
            elif time == best["time"]:
                best["candidates"].append(status)

    for best in best_by_problem.values():
        candidates = best["candidates"]
        if len(candidates) > MAX_SAME_TIME_ONLINE_FIRST_BLOODS:
            candidates = candidates[:1]
        for status in candidates:
            status["result"] = rank3.SR_FirstBlood
            _set_accepted_solution_result(status, rank3.SR_FirstBlood)


class Parse:
    time_unit = "ms"

    def __init__(
        self, config: Dict, teams: Dict, runs: Dict, org: List[Dict] = None
    ) -> None:
        self.config = config
        self.teams = teams
        self.runs = runs
        self.org = org

        # 建立 organization_id → org_name 的映射，用于快速查询
        self.org_map = {}
        if org is not None and isinstance(org, list):
            for org_item in org:
                if org_item.get("id") is not None:
                    org_id = org_item["id"]
                    # 提取 org 的 name 字段（可能是字符串或多语言对象）
                    org_name_obj = org_item.get("name", {})
                    org_name = self._extract_org_name(org_name_obj)
                    if org_name:
                        self.org_map[org_id] = org_name
                        self.org_map[str(org_id)] = org_name

        # 兼容不同的配置格式：优先使用 problem_id 数组，否则从 problems 对象数组提取
        if "problem_id" in config:
            self.problem_id_list = config["problem_id"]
        elif "problems" in config and isinstance(config["problems"], list):
            # 从 problems 数组提取 id 或 label 作为 problem_id
            self.problem_id_list = []
            for prob in config["problems"]:
                if isinstance(prob, dict):
                    # 优先使用 label，其次使用 id
                    if "label" in prob:
                        self.problem_id_list.append(prob["label"])
                    elif "id" in prob:
                        self.problem_id_list.append(prob["id"])
            if not self.problem_id_list:
                raise ValueError("config 中的 problems 数组为空或格式不正确")
        else:
            raise KeyError("config 中既没有 problem_id 数组也没有 problems 数组")

        self.num_problems = len(self.problem_id_list)

        # 建立 problem_id 映射：支持数字和字符串两种格式的 problem_id
        # 用于将 runs 中的 problem_id (可能是数字) 映射到索引
        self.problem_id_map = {}
        if "problems" in config and isinstance(config["problems"], list):
            for idx, prob in enumerate(config["problems"]):
                if isinstance(prob, dict) and "id" in prob:
                    # 映射字符串形式的 id
                    self.problem_id_map[prob["id"]] = idx
                    # 如果 id 是数字字符串，也映射数字形式
                    try:
                        num_id = int(prob["id"])
                        self.problem_id_map[num_id] = idx
                    except (ValueError, TypeError):
                        pass

        # 如果没有 problems 数组，使用默认的索引映射
        if not self.problem_id_map:
            for idx, pid in enumerate(self.problem_id_list):
                self.problem_id_map[pid] = idx
                self.problem_id_map[idx] = idx

        self.group = config.get("group", {})
        self.statistics = [[0, 0] for i in self.problem_id_list]
        self.statuses = {}
        self.org = org
        self.__calculate()

    def _team_items(self):
        if isinstance(self.teams, dict):
            return self.teams.items()
        if isinstance(self.teams, list):
            return [(team.get("id", str(i)), team) for i, team in enumerate(self.teams)]
        raise TypeError(f"Unsupported teams data type: {type(self.teams)}")

    def _team_group_ids(self, team: Dict) -> List:
        group = team.get("group", [])
        if group is None:
            group = []
        if not isinstance(group, list):
            group = [group]
        else:
            group = list(group)

        team_markers = team.get("markers", [])
        if team_markers is None:
            team_markers = []
        if not isinstance(team_markers, list):
            team_markers = [team_markers]

        if "official" in team:
            if self._is_true_flag(team.get("official")) and "official" not in group:
                group.append("official")
            elif (
                self._is_false_flag(team.get("official")) and "unofficial" not in group
            ):
                group.append("unofficial")

        return group + [marker for marker in team_markers if marker not in group]

    def _is_true_flag(self, value) -> bool:
        if isinstance(value, str):
            return value.strip().lower() in ["1", "true", "yes"]
        return value is True or value == 1

    def _is_false_flag(self, value) -> bool:
        if isinstance(value, str):
            return value.strip().lower() in ["0", "false", "no"]
        return value is False or value == 0

    def _star_group_ids(self) -> set:
        starPattern = r"打星"
        star_group_ids = {"unofficial"}
        for key, value in self.group.items():
            if re.search(starPattern, str(value)):
                star_group_ids.add(key)
        return star_group_ids

    def _is_star_team(self, team: Dict, group: Optional[List] = None) -> bool:
        if team.get("unofficial", False):
            return True
        group = self._team_group_ids(team) if group is None else group
        star_group_ids = self._star_group_ids()
        return any(group_id in star_group_ids for group_id in group)

    def _official_team_id_set(self) -> set:
        return {
            team_id
            for team_id, team in self._team_items()
            if not self._is_star_team(team)
        }

    def _group_team_id_set(self, group_id: str) -> set:
        return {
            team_id
            for team_id, team in self._team_items()
            if group_id in self._team_group_ids(team)
        }

    def _is_official_group_label(self, value) -> bool:
        label = str(value).strip().lower()
        return label in ["正式", "正式队", "正式队伍", "默认队伍组", "official"]

    def _official_group_candidates(self) -> List[str]:
        if "official" in self.group:
            return ["official"]
        return [
            key
            for key, value in self.group.items()
            if self._is_official_group_label(value)
        ]

    def _special_official_group_ids(self) -> set:
        official_team_ids = self._official_team_id_set()
        return {
            group_id
            for group_id in self._official_group_candidates()
            if self._group_team_id_set(group_id) == official_team_ids
        }

    def _has_special_official_group(self) -> bool:
        return len(self._special_official_group_ids()) > 0

    def _extract_localized_name(self, value) -> str:
        if value is None:
            return ""
        if isinstance(value, str):
            return value
        if isinstance(value, dict):
            # 常见格式：{"name": {...}}，递归提取实际姓名对象
            if "name" in value:
                return self._extract_localized_name(value.get("name"))
            if "texts" in value:
                fallback_lang = value.get("fallback_lang", "zh-CN")
                texts = value.get("texts", {})
                if isinstance(texts, dict):
                    if "zh-CN" in texts:
                        return texts["zh-CN"]
                    if fallback_lang in texts:
                        return texts[fallback_lang]
                    if texts:
                        return next(iter(texts.values()))
                return ""
            if "fallback" in value:
                return value.get("fallback", "")
        return str(value)

    def _extract_org_name(self, value) -> str:
        """提取组织/学校名称，处理多语言和不同格式"""
        if value is None:
            return ""
        if isinstance(value, str):
            return value
        if isinstance(value, dict):
            if "name" in value:
                return self._extract_org_name(value.get("name"))
            # 处理多语言格式
            if "texts" in value:
                fallback_lang = value.get("fallback_lang", "zh-CN")
                texts = value.get("texts", {})
                if isinstance(texts, dict):
                    if "zh-CN" in texts:
                        return texts["zh-CN"]
                    if fallback_lang in texts:
                        return texts[fallback_lang]
                    if texts:
                        return next(iter(texts.values()))
                return ""
            # 处理简单格式
            if "fallback" in value:
                return value.get("fallback", "")
            # 如果是其他格式，尝试转换为字符串
            if value:
                return str(value)
        return ""

    def _resolve_team_organization(self, team: Dict) -> Optional[str]:
        org_name = None
        organization_id = team.get("organization_id")
        if organization_id is not None and self.org_map:
            org_name = self.org_map.get(organization_id) or self.org_map.get(
                str(organization_id)
            )
        if not org_name:
            org_name = self._extract_org_name(team.get("organization"))
        return org_name or None

    def _normalize_color(self, value) -> str:
        return re.sub(r"\s+", "", str(value or "").strip().lower())

    def _uses_default_balloon_colors(self) -> bool:
        balloon_colors = self.config.get("balloon_color")
        if not isinstance(balloon_colors, list):
            return False

        required_count = min(self.num_problems, 13)
        if len(balloon_colors) < required_count:
            return False

        actual_colors = [
            self._normalize_color((balloon_colors[i] or {}).get("background_color"))
            for i in range(required_count)
        ]

        for palette in srkDefaultBallonColorPalettes:
            if len(palette) < required_count:
                continue
            expected_colors = [
                self._normalize_color(color) for color in palette[:required_count]
            ]
            if actual_colors == expected_colors:
                return True
        return False

    def contest(self) -> rank3.Contest:
        # 处理时间戳：如果是毫秒级时间戳，转换为秒级
        start_time = self.config["start_time"]
        end_time = self.config["end_time"]
        frozen_time = self.config.get("frozen_time", 0)
        link = self.config.get("link", None)
        banner = self.config.get("_srk_banner", self.config.get("banner", None))
        banner_link = self.config.get("_srk_banner_link")

        start_time = _normalize_contest_timestamp_seconds(start_time)
        end_time = _normalize_contest_timestamp_seconds(end_time)

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

        # 处理 banner：转换为 standard-ranklist 的 Image 或 ImageWithLink 格式
        processed_banner = None
        if banner is not None:
            if isinstance(banner, str):
                processed_banner = (
                    {"image": banner, "link": banner_link} if banner_link else banner
                )
            elif isinstance(banner, dict):
                original_link = image_downloader.get_srk_image_without_download(banner)
                banner_link = banner_link or image_downloader.image_link(banner)
                if original_link:
                    processed_banner = (
                        {"image": original_link, "link": banner_link}
                        if banner_link
                        else original_link
                    )

        return rank3.Contest(
            self.config["contest_name"],
            start_time,
            duration,
            frozen_hours,
            link,
            processed_banner,
        )

    def problems(self) -> List[rank3.Problem]:
        problems = []
        uses_default_balloon_colors = self._uses_default_balloon_colors()

        for i, v in enumerate(self.problem_id_list):
            style = None
            if self.config.get("balloon_color") is not None:
                color = self.config["balloon_color"][i]
                style = (color["background_color"],)
            if uses_default_balloon_colors:
                style = None
            problems.append(rank3.Problem(v, self.statistics[i], style))
        return problems

    def series(self, markers) -> Dict[str, Union[List[rank3.Series], bool]]:
        self.gold, self.silver, self.bronze = 0, 0, 0
        ccpcFlag = False
        toRemarks = True
        medal_config = self.config.get("medal")
        special_official_group_ids = self._special_official_group_ids()
        official_medal_keys = ["official"] + [
            group_id
            for group_id in special_official_group_ids
            if group_id != "official"
        ]
        official_medal_key = next(
            (
                key
                for key in official_medal_keys
                if type(medal_config) is dict and medal_config.get(key) is not None
            ),
            None,
        )
        if (
            official_medal_key is not None
            and type(medal_config) is dict
            and medal_config.get(official_medal_key) is not None
        ):
            self.gold = medal_config[official_medal_key]["gold"]
            self.silver = medal_config[official_medal_key]["silver"]
            self.bronze = medal_config[official_medal_key]["bronze"]
            toRemarks = False
        elif type(medal_config) is str:
            if medal_config == "CCPC" or medal_config == "ccpc":
                self.gold = 0.1
                self.silver = 0.2
                self.bronze = 0.3
                ccpcFlag = True
                toRemarks = False
        elif type(medal_config) is dict and medal_config.get("all") is not None:
            self.gold = medal_config["all"]["gold"]
            self.silver = medal_config["all"]["silver"]
            self.bronze = medal_config["all"]["bronze"]
            toRemarks = False
        else:
            self.gold = 0
            self.silver = 0
            self.bronze = 0

        all_rank = rank3.Series(title="R#", rule={"preset": "Normal"})

        if ccpcFlag is False:
            icpc_rule = {
                "preset": "ICPC",
                "options": {"count": {"value": [self.gold, self.silver, self.bronze]}},
            }
        else:
            icpc_rule = {
                "preset": "ICPC",
                "options": {
                    "ratio": {
                        "value": [self.gold, self.silver, self.bronze],
                        "denominator": "scored",
                    }
                },
            }

        anotherSeries = []
        if len(markers) > 0 and type(medal_config) is dict:
            for key, value in medal_config.items():
                if key == "all" or key in special_official_group_ids:
                    continue
                if (
                    type(value) is dict
                    and value.get("gold") is not None
                    and value.get("silver") is not None
                    and value.get("bronze") is not None
                ):
                    title = None
                    for marker in markers:
                        if marker.marker["id"] == key:
                            title = marker.marker["label"] + "#"
                            break
                    if title is None:
                        continue
                    rule = {
                        "preset": "ICPC",
                        "options": {
                            "count": {
                                "value": [
                                    value["gold"],
                                    value["silver"],
                                    value["bronze"],
                                ]
                            },
                            "filter": {"byMarker": key},
                        },
                    }
                    anotherSeries.append(
                        rank3.Series(
                            title=title,
                            segments=[
                                ("金奖", rank3.Style_Gold),
                                ("银奖", rank3.Style_Silver),
                                ("铜奖", rank3.Style_Bronze),
                            ],
                            rule=rule,
                        )
                    )
                    toRemarks = False
                else:
                    continue

        offical_rank = rank3.Series(
            title="#",
            segments=[
                ("金奖", rank3.Style_Gold),
                ("银奖", rank3.Style_Silver),
                ("铜奖", rank3.Style_Bronze),
            ],
            rule=icpc_rule,
        )
        school_rank = rank3.Series(
            title="S#",
            rule={
                "preset": "UniqByUserField",
                "options": {"field": "organization", "includeOfficialOnly": True},
            },
        )
        result = [offical_rank]
        if len(anotherSeries) > 0:
            result += anotherSeries
        result.append(all_rank)
        result.append(school_rank)
        return {"rows": result, "remarks": toRemarks}

    def markers(self) -> List[rank3.Marker]:
        all_markers = []
        colors = ["blue", "green", "yellow", "orange", "red", "purple"]
        index = 0
        femalePattern = r"女队|女生|女子"
        starPattern = r"打星"
        special_official_group_ids = self._special_official_group_ids()
        for key, value in self.group.items():
            if key == "unofficial":
                continue
            if key in special_official_group_ids:
                continue
            if re.search(starPattern, str(value)):
                continue
            key_lower = str(key).lower()
            is_female = (
                re.search(femalePattern, str(value))
                or key_lower in ["female", "girl"]
                or "female" in key_lower
                or "girl" in key_lower
            )
            style = "pink" if is_female else colors[index % len(colors)]
            marker = rank3.Marker(key, value, style)
            all_markers.append(marker)
            if not is_female:
                index += 1
        # 拆分女队相关和普通 marker
        female_markers = [
            m
            for m in all_markers
            if (
                "female" in str(m.marker["id"]).lower()
                or "girl" in str(m.marker["id"]).lower()
                or re.search(femalePattern, str(m.marker["label"]))
            )
        ]
        normal_markers = [m for m in all_markers if m not in female_markers]
        return normal_markers + female_markers

    def rows(self, markers) -> List[rank3.Row]:
        data = []
        teams_items = self._team_items()
        special_official_group_ids = self._special_official_group_ids()

        for k, v in teams_items:
            u_markers = []

            # 判断是否有教练
            coaches = []
            if v.get("coach", None) is not None:
                coach_name = self._extract_localized_name(v.get("coach"))
                if coach_name:
                    coaches.append(coach_name)
            if v.get("coaches", None) is not None:
                for coach_item in v["coaches"]:
                    if coach_item is not None and str(coach_item).lower() != "null":
                        coach_name = self._extract_localized_name(coach_item)
                        if coach_name:
                            coaches.append(coach_name)
            # official=true 表示全体队伍排除打星队伍，不再由 official 分组直接决定。
            group = self._team_group_ids(v)
            official = not self._is_star_team(v, group)

            # group字段内的marker，只添加 markers 里存在的 id
            for t in group:
                if (
                    t is not None
                    and t not in special_official_group_ids
                    and t != "unofficial"
                    and t != "girl"
                ):
                    for m in markers:
                        if m.marker["id"] == t and m not in u_markers:
                            u_markers.append(m)
            # 检查group外层对象属性是否与markers重合
            for m in markers:
                if (
                    m.marker["id"] in v
                    and self._is_true_flag(v.get(m.marker["id"]))
                    and m not in u_markers
                ):
                    u_markers.append(m)

            # 判断是否为女队的逻辑（只要 markers 里有女队相关 marker 且 user 是女队且未加过就加）
            original_girl = self._is_true_flag(v.get("girl"))
            group_girl = "girl" in group
            is_girl_team = original_girl or group_girl
            # 女队相关 marker: id 含 female/girl 或 label 含“女队”
            female_markers = [
                m
                for m in markers
                if (
                    "female" in str(m.marker["id"]).lower()
                    or "girl" in str(m.marker["id"]).lower()
                    or "女队" in str(m.marker["label"])
                )
            ]
            # 检查当前 user 是否已加过女队相关 marker
            has_any_female_marker = any(m in u_markers for m in female_markers)
            if is_girl_team and not has_any_female_marker:
                for m in female_markers:
                    if m not in u_markers:
                        u_markers.append(m)

            # 处理队伍名称：兼容新旧格式
            team_name = v.get("name", "")
            if isinstance(team_name, dict):
                if "texts" in team_name:
                    fallback_lang = team_name.get("fallback_lang", "zh-CN")
                    texts = team_name.get("texts", {})
                    if "zh-CN" in texts:
                        team_name = texts["zh-CN"]
                    elif fallback_lang in texts:
                        team_name = texts[fallback_lang]
                    elif texts:
                        team_name = list(texts.values())[0]
                    else:
                        team_name = ""
                elif "fallback" in team_name:
                    # 只有 fallback 字段的旧格式
                    team_name = team_name["fallback"]
                else:
                    # 其他格式，转换为字符串
                    team_name = str(team_name)

            members = None
            if v.get("members", None) is not None:
                processed_members = []
                for member in v["members"]:
                    if member is not None and str(member).lower() != "null":
                        member_name = self._extract_localized_name(member)
                        if member_name:
                            processed_member = {"name": member_name}
                            if (
                                isinstance(member, dict)
                                and member.get("role") is not None
                            ):
                                processed_member["role"] = member.get("role")
                            processed_members.append(processed_member)
                members = processed_members
            if len(coaches) > 0:
                if not isinstance(members, list):
                    members = []
                for coach in coaches:
                    members.append({"name": coach, "role": "coach"})

            orgName = self._resolve_team_organization(v)

            user = rank3.User(
                team_name,
                k,
                orgName,
                members,
                official,
                u_markers,
                v.get("location", None),
                v.get("avatar", None),
                v.get("photo", None),
            )

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
                    # duration 中只累计 AC 前的错误罚时，tries 包含 AC 那次。
                    actual_solve_time = v.duration - (
                        20 * 60 * max(v.tries - 1, 0)
                    )
                    if actual_solve_time > last_solved_time:
                        last_solved_time = actual_solve_time

            score = [cnt, ctms // 60 * 60 if use_accumulate_in_seconds else ctms]
            data.append(
                {
                    "user": user,
                    "score": score,
                    "status": statuses,
                    "last_solved_time": last_solved_time,
                    "team_name": team_name,  # 用于字典序排序
                }
            )

        # 优化排序逻辑：解题数(降序), 罚时(升序), 最后通过时间(升序), 队伍名称(升序)
        data.sort(
            key=lambda x: (
                -x["score"][0],  # 解题数，降序（数量越多越好）
                x["score"][1],  # 罚时，升序（时间越少越好）
                x["last_solved_time"]
                // 60,  # 最后通过时间（分钟），升序（时间越早越好）
                x["team_name"],  # 队伍名称，升序（字典序）
            )
        )

        rows = []
        for d in data:
            row = rank3.Row(d["user"], d["score"], d["status"], self.num_problems)
            rows.append(row)
        return rows

    # 判断是否使用 accumulate_in_seconds 计算 penalty
    # 如果使用 accumulate_in_seconds 则返回 True，否则返回 False
    def options(self) -> bool:
        use_accumulate_in_seconds = (
            isinstance(self.config.get("options"), dict)
            and self.config["options"].get("calculation_of_penalty")
            == "accumulate_in_seconds_and_finally_to_the_minute"
        )
        return use_accumulate_in_seconds

    def __calculate(self) -> None:

        first_blood = [None for i in self.problem_id_list]

        for v in self.runs:
            # 将 runs 中的 problem_id 映射到索引
            raw_problem_id = v["problem_id"]
            problem_idx = self.problem_id_map.get(raw_problem_id)

            # 如果映射失败，跳过此记录
            if problem_idx is None:
                url = contest_url.get(self.config.get("contest_name"))
                unkown = unkown_contest.setdefault(
                    url,
                    {
                        "name": self.config.get("contest_name"),
                        "status": set(),
                        "count": 0,
                    },
                )
                unkown["status"].add(f"unknown_problem_id:{raw_problem_id}")
                unkown["count"] += 1
                continue

            if self.statuses.get(str(v["team_id"])) is None:
                self.statuses[str(v["team_id"])] = [
                    rank3.Status() for i in self.problem_id_list
                ]
            status = self.statuses[str(v["team_id"])][problem_idx]

            result = sr_results.get(v["status"].upper())
            if result is None:
                url = contest_url.get(self.config["contest_name"])
                unkown = unkown_contest.setdefault(
                    url,
                    {"name": self.config["contest_name"], "status": set(), "count": 0},
                )
                unkown["status"].add(v["status"])
                unkown["count"] += 1
                continue

            if status.result in [rank3.SR_Accepted, rank3.SR_FirstBlood]:
                continue

            tt = v["timestamp"] * 1000 if Parse.time_unit == "s" else v["timestamp"]
            if result == rank3.SR_Accepted:
                if first_blood[problem_idx] is None or first_blood[problem_idx] == tt:
                    result = rank3.SR_FirstBlood
                    first_blood[problem_idx] = tt

            status.result = result

            if status.solutions is None:
                status.solutions = []
            status.solutions.append(
                {
                    "result": result,
                    "time": [v["timestamp"], Parse.time_unit],
                }
            )

            if result not in [
                rank3.SR_FirstBlood,
                rank3.SR_Accepted,
                rank3.SR_Rejected,
                rank3.SR_Frozen,
            ]:
                status.result = rank3.SR_Rejected

            if result in [rank3.SR_FirstBlood, rank3.SR_Accepted]:
                status.duration = 20 * 60 * 1000 * status.tries + tt

            if result not in [
                rank3.SR_CompilationError,
                rank3.SR_PresentationError,
                rank3.SR_UnknownError,
            ]:
                status.tries += 1

            self.statuses[str(v["team_id"])][problem_idx] = status

            if result == rank3.SR_Accepted or result == rank3.SR_FirstBlood:
                self.statistics[problem_idx][0] += 1
            self.statistics[problem_idx][1] += 1


def main():
    url = get("https://board.xcpcio.com/data/index/contest_list.json")
    icpc = {}
    for k, v in url["icpc"].items():
        for vk, vv in v.items():
            if vv.get("board_link"):
                icpc[k + vk] = vv["board_link"]

    ccpc = {}
    for k, v in url["ccpc"].items():
        for vk, vv in v.items():
            if vv.get("board_link"):
                ccpc[k + vk] = vv["board_link"]
    province = {}
    for k, v in url["provincial-contest"].items():
        for vk, vv in v.items():
            if vv.get("board_link"):
                province[k + vk] = vv["board_link"]

    # icpc.pop('2018world-finals')
    # icpc.pop('2019world-finals')
    # icpc.pop('2020world-finals')
    # icpc.pop('2020world-finals-Invitational')
    # icpc.pop('48thworld-finals')
    for k, v in icpc.items():
        call_rank(path=v, name=f"icpc/icpc{k}.srk.json")
    for k, v in ccpc.items():
        call_rank(path=v, name=f"ccpc/ccpc{k}.srk.json")
    for k, v in province.items():
        call_rank(path=v, name=f"province/ccpc{k}.srk.json")
    print(unkown_contest)


def generate_rank(
    path: str, output_path: str, download_banner: bool = True
) -> Dict[str, Any]:
    warnings = []
    contest_url_value = f"https://board.xcpcio.com{path}"
    resolved_output_path = None
    contest_name = None

    try:
        resolved_output_path = _resolve_output_path(output_path)
        print(path, resolved_output_path)

        config = get(f"https://board.xcpcio.com/data{path}/config.json")
        teams = get(f"https://board.xcpcio.com/data{path}/team.json")
        runs = get(f"https://board.xcpcio.com/data{path}/run.json")
        org = get(f"https://board.xcpcio.com/data{path}/organizations.json")

        if config is None:
            return _result(
                False,
                resolved_output_path,
                None,
                contest_url_value,
                error=f"{path} 获取 config.json 失败",
            )
        contest_name = config.get("contest_name")
        if teams is None:
            return _result(
                False,
                resolved_output_path,
                contest_name,
                contest_url_value,
                error=f"{path} 获取 team.json 失败",
            )
        if runs is None:
            return _result(
                False,
                resolved_output_path,
                contest_name,
                contest_url_value,
                error=f"{path} 获取 run.json 失败",
            )
        if org is None:
            warnings.append(
                f"{path} 获取 organizations.json 失败，将不写入 organization_id 映射"
            )

        contest_id = _asset_alias(resolved_output_path)
        _prepare_assets(path, config, teams, contest_id, download_banner, warnings)

        set_contest_url(path, config)
        runs.sort(key=lambda x: x["timestamp"])
        if len(runs) == 0:
            return _result(
                False,
                resolved_output_path,
                contest_name,
                contest_url_value,
                warnings=warnings,
                error=f"{path} 获取提交记录为空",
            )
        Parse.time_unit = _infer_run_time_unit(config, runs)
        if Parse.time_unit == "s":
            warnings.append("检测到 run.timestamp 为秒级时间戳，按秒级处理")
        parse = Parse(config, teams, runs, org)
        contest = parse.contest()
        problems = parse.problems()
        marker = parse.markers()
        series = parse.series(marker)
        rows = parse.rows(marker)
        options = parse.options()
        r = rank3.Rank(
            contest,
            problems,
            series["rows"],
            rows,
            marker,
            contributors=["XCPCIO (https://xcpcio.com)", "algoUX (https://algoux.org)"],
            penaltyTimeCalculation="s" if options else "min",
            isRemarks=series["remarks"] and not _is_online_contest(path, config),
        )
        output_dir = os.path.dirname(resolved_output_path)
        if output_dir:
            os.makedirs(output_dir, exist_ok=True)
        rank_object = r.result()
        if _is_online_contest(path, config):
            _normalize_online_first_blood(rank_object)
        with open(resolved_output_path, "w", encoding="utf-8") as file:
            json.dump(rank_object, file, ensure_ascii=False)

        return _result(
            True,
            resolved_output_path,
            contest_name,
            contest_url_value,
            _format_unknown_statuses(contest_url_value),
            warnings,
        )
    except Exception as e:
        return _result(
            False,
            resolved_output_path,
            contest_name,
            contest_url_value,
            _format_unknown_statuses(contest_url_value),
            warnings,
            str(e),
        )


def call_rank(path: str, name: str):
    result = generate_rank(path, name)
    if not result["ok"]:
        print(result["error"])
    return result


def once():
    call_rank("/provincial-contest/2025/liaoning/", "temp/ln.srk.json")


if __name__ == "__main__":
    main()
    # once()
