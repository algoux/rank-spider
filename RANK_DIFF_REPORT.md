# 榜单差异报告（rank_spider 新爬 vs srk-collection 老存档）

生成时间：2026-06-24（按赛季年份切分 pre-2025）

## 摘要

- A 仓库（rank_spider）总文件数：**438**
  - ccpc: 103; icpc: 220; province: 115
- B 仓库（srk-collection）总文件数：**353**
  - ccpc: 76; icpc: 166; provincial: 111
- 配对成功数：**262**
- A 仅有的：**176**；B 仅有的：**91**
- pre-2025（赛季 < 2025）配对中 B 缺字段（建议覆盖）：**70**
- 解析失败：A 0；B 0

### 赛季年份判定规则（决定 pre-2025）

对每个 contest 按以下优先级推断「赛季年份」：
1. **标题或文件名出现的 4 位年份**（2009 - 2030 之间），取最小值。例如 `ccpc2024final.srk.json`、`第 47 届国际大学生程序设计竞赛亚洲区域赛沈阳站` 中的 `2022` → 赛季 2022。
2. **届数 → 赛季年份**：
   - CCPC：第 N 届 = `2014 + N`（第 9 届 = 2023 赛季，第 10 届 = 2024，第 11 届 = 2025，第 12 届 = 2026）；从标题中文 `第 X 届` 或文件名 `ccpc10th` / `ccpc11st` 提取。
   - ICPC（区域赛 / World Finals）：第 N 届 = `1975 + N`（第 45 届 = 2020 赛季，第 49 届 = 2024）；从 `第 X 届`、文件名 `icpc49thecfinal` 等提取。
3. **回退到 startAt 年份**。若标题是"总决赛/ec-final" 且 startAt 月份 ≤ 7，把赛季减 1（如 `ccpc2024final` startAt = 2025-05-11 → 赛季仍为 2024）。
4. **pre-2025 = 赛季年份 < 2025**。也即 2024 赛季及以前全部归入 pre-2025；2024 赛季的总决赛即使在 2025 年举行，也算 pre-2025。

### 配对方法

1. 第 1 轮：同一 `startAt` 日期 + 完全相同 `contest.title`（空白/大小写规范化后），直接配对；
2. 第 2 轮：同一日期 + warmup 标识一致 + 标题关键词集合存在非空交集（赛区/角色），按交集大小取最佳；
3. 第 3 轮：占位日期下 (双方均无可提取关键词且唯一候选) 配对。

### 字段差异判定规则

- **缺 user.location**：A 任一 `rows[].user` 有 `location`，B 完全没有；
- **缺 markers / markers id 不一致**：典型如 `female` vs `girl`；
- **缺 user.avatar / contest.banner**：assets 资源字段缺失；
- **series 段中英不一致**：A 段是中文 `金奖`，B 是英文 `Gold Medalist` / `Gold Award`。

---

## 一、需要用新榜单替换/补全 srk-collection 的（按赛事类别分组）

> 仅列赛季 < 2025 的配对，且 B 至少缺一项字段。建议用 A 仓库对应文件覆盖 B 仓库同一比赛的文件（注意目标路径文件名可能不同）。

### CCPC（23 项）

| # | 赛季 | A 仓库路径 | B 仓库路径 | 比赛标题 | startAt | 缺失/差异 |
|---|---|---|---|---|---|---|
| 1 | 2020 | `rank_spider/ccpc/ccpc2020weihai.srk.json` | `official/ccpc/ccpc2020/ccpc2020weihai.srk.json` | CCPC2020-第六届中国大学生程序设计竞赛（威海） 正式赛 | 2020-10-25 | markers id 不一致 (A=['girl'], B=['female']); series 段标题语言不一致 (A=中文 ['金奖', '银奖', '铜奖'], B=英文 ['Gold Medalist', 'Silver Medalist', 'Bronze Medalist']) |
| 2 | 2020 | `rank_spider/ccpc/ccpc2020mianyang.srk.json` | `official/ccpc/ccpc2020/ccpc2020mianyang.srk.json` | CCPC2020-第六届中国大学生程序设计竞赛（绵阳） 正式赛 | 2020-11-01 | markers id 不一致 (A=['girl'], B=['female']); series 段标题语言不一致 (A=中文 ['金奖', '银奖', '铜奖'], B=英文 ['Gold Medalist', 'Silver Medalist', 'Bronze Medalist']) |
| 3 | 2020 | `rank_spider/ccpc/ccpc2020changchun.srk.json` | `official/ccpc/ccpc2020/ccpc2020changchun.srk.json` | CCPC2020-第六届中国大学生程序设计竞赛（长春） 正式赛 | 2020-11-08 | markers id 不一致 (A=['girl'], B=['female']); series 段标题语言不一致 (A=中文 ['金奖', '银奖', '铜奖'], B=英文 ['Gold Medalist', 'Silver Medalist', 'Bronze Medalist']) |
| 4 | 2020 | `rank_spider/ccpc/ccpc2020final.srk.json` | `official/ccpc/ccpc2020/ccpc2020final.srk.json` | 第六届中国大学生程序设计竞赛总决赛（正式赛） | 2021-05-30 | series 段标题语言不一致 (A=中文 ['金奖', '银奖', '铜奖'], B=英文 ['Gold Medalist', 'Silver Medalist', 'Bronze Medalist']) |
| 5 | 2021 | `rank_spider/ccpc/ccpc7thgirl.srk.json` | `official/ccpc/ccpc2021/ccpc2021ladies.srk.json` | 2021 年中国大学生程序设计竞赛女生专场 正式赛 | 2021-10-31 | series 段标题语言不一致 (A=中文 ['金奖', '银奖', '铜奖'], B=英文 ['Gold Medalist', 'Silver Medalist', 'Bronze Medalist']) |
| 6 | 2021 | `rank_spider/ccpc/ccpc7thfinal.srk.json` | `official/ccpc/ccpc2021/ccpc2021final.srk.json` | 第七届中国大学生程序设计竞赛总决赛 | 2022-07-27 | markers id 不一致 (A=['girl'], B=['female']) |
| 7 | 2022 | `rank_spider/ccpc/ccpc8thgaozhi.srk.json` | `official/ccpc/ccpc2022/ccpc2022hv.srk.json` | 2022 年中国大学生程序设计竞赛 (CCPC) 高职专场 | 2022-10-23 | markers id 不一致 (A=['girl'], B=['female']) |
| 8 | 2022 | `rank_spider/ccpc/ccpc8thguilin.srk.json` | `official/ccpc/ccpc2022/ccpc2022guilin.srk.json` | 2022 年中国大学生程序设计竞赛 (CCPC) 桂林 | 2022-10-30 | markers id 不一致 (A=['girl'], B=['female']) |
| 9 | 2022 | `rank_spider/ccpc/ccpc8thweihai.srk.json` | `official/ccpc/ccpc2022/ccpc2022weihai.srk.json` | 2022 中国大学生程序设计竞赛（威海） - 正式赛 | 2022-11-06 | markers id 不一致 (A=['girl'], B=['female']) |
| 10 | 2022 | `rank_spider/ccpc/ccpc8thguangzhou.srk.json` | `official/ccpc/ccpc2022/ccpc2022guangzhou.srk.json` | 2022 中国大学生程序设计竞赛（广州） - 正式赛 | 2022-11-13 | markers id 不一致 (A=['girl'], B=['female']) |
| 11 | 2022 | `rank_spider/ccpc/ccpc8thmianyang.srk.json` | `official/ccpc/ccpc2022/ccpc2022mianyang.srk.json` | 2022 中国大学生程序设计竞赛（绵阳） - 正式赛 | 2022-11-20 | markers id 不一致 (A=['girl'], B=['female']) |
| 12 | 2022 | `rank_spider/ccpc/ccpc8thgirls.srk.json` | `official/ccpc/ccpc2022/ccpc2022ladies.srk.json` | 2022 中国大学生程序设计竞赛（女生专场） - 正式赛 | 2022-11-27 | markers id 不一致 (A=['girl'], B=['female']) |
| 13 | 2022 | `rank_spider/ccpc/ccpc8thfinal.srk.json` | `official/ccpc/ccpc2022/ccpc2022final.srk.json` | 第八届中国大学生程序设计竞赛总决赛（正式赛） | 2023-05-14 | markers id 不一致 (A=['girl'], B=['female']) |
| 14 | 2023 | `rank_spider/ccpc/ccpc9thjiangsu-and-xiangtan.srk.json` | `official/ccpc/ccpc2023/ccpc2023invitational-xiangtan.srk.json` | 2023 年 CCPC 江苏省赛 & 全国邀请赛（湖南）- 正式赛 | 2023-05-28 | markers id 不一致 (A=['girl', 'jiangsu', 'xiangtan'], B=['female']) |
| 15 | 2023 | `rank_spider/ccpc/ccpc9thqinhuangdao.srk.json` | `official/ccpc/ccpc2023/ccpc2023qinhuangdao.srk.json` | 第 9 届 CCPC 中国大学生程序设计竞赛秦皇岛站 - 正式赛 | 2023-10-15 | 缺 user.location; markers id 不一致 (A=['girl'], B=['female']); series 段标题语言不一致 (A=中文 ['金奖', '银奖', '铜奖'], B=英文 ['Gold Award', 'Silver Award', 'Bronze Award']) |
| 16 | 2023 | `rank_spider/ccpc/ccpc9thvocational.srk.json` | `official/ccpc/ccpc2023/ccpc2023hv.srk.json` | 第 9 届 CCPC 中国大学生程序设计竞赛高职专场 - 正式赛 | 2023-10-21 | markers id 不一致 (A=['girl'], B=['female']) |
| 17 | 2023 | `rank_spider/ccpc/ccpc9thharbin.srk.json` | `official/ccpc/ccpc2023/ccpc2023harbin.srk.json` | 第 9 届 CCPC 中国大学生程序设计竞赛哈尔滨站 - 正式赛 | 2023-11-05 | 缺 user.location; series 段标题语言不一致 (A=中文 ['金奖', '银奖', '铜奖'], B=英文 ['Gold Award', 'Silver Award', 'Bronze Award']) |
| 18 | 2023 | `rank_spider/ccpc/ccpc9thshenzhen.srk.json` | `official/ccpc/ccpc2023/ccpc2023shenzhen.srk.json` | 第 9 届 CCPC 中国大学生程序设计竞赛深圳站 - 正式赛 | 2023-11-12 | 缺 user.location; series 段标题语言不一致 (A=中文 ['金奖', '银奖', '铜奖'], B=英文 ['Gold Award', 'Silver Award', 'Bronze Award']) |
| 19 | 2023 | `rank_spider/ccpc/ccpc9thfinal.srk.json` | `official/ccpc/ccpc2023/ccpc2023final.srk.json` | 第 9 届 CCPC 中国大学生程序设计竞赛总决赛 | 2024-03-31 | markers id 不一致 (A=['girl'], B=['female']) |
| 20 | 2024 | `rank_spider/ccpc/ccpc10thharbin.srk.json` | `official/ccpc/ccpc2024/ccpc2024harbin.srk.json` | 第 10 届 CCPC 中国大学生程序设计竞赛哈尔滨站 - 正式赛 | 2024-10-20 | 缺 user.location; 缺 markers; series 段标题语言不一致 (A=中文 ['金奖', '银奖', '铜奖'], B=英文 ['Gold Award', 'Silver Award', 'Bronze Award']) |
| 21 | 2024 | `rank_spider/ccpc/ccpc10thjinan.srk.json` | `official/ccpc/ccpc2024/ccpc2024jinan.srk.json` | 第 10 届 CCPC 中国大学生程序设计竞赛济南站 - 正式赛 | 2024-10-27 | 缺 user.location; 缺 markers; series 段标题语言不一致 (A=中文 ['金奖', '银奖', '铜奖'], B=英文 ['Gold Award', 'Silver Award', 'Bronze Award']) |
| 22 | 2024 | `rank_spider/ccpc/ccpc10thchongqing.srk.json` | `official/ccpc/ccpc2024/ccpc2024chongqing.srk.json` | 第 10 届 CCPC 中国大学生程序设计竞赛重庆站 - 正式赛 | 2024-11-10 | 缺 user.location; markers id 不一致 (A=['girl'], B=['female']); series 段标题语言不一致 (A=中文 ['金奖', '银奖', '铜奖'], B=英文 ['Gold Award', 'Silver Award', 'Bronze Award']) |
| 23 | 2024 | `rank_spider/ccpc/ccpc10thzhengzhou.srk.json` | `official/ccpc/ccpc2024/ccpc2024zhengzhou.srk.json` | 第 10 届 CCPC 中国大学生程序设计竞赛郑州站 - 正式赛 | 2024-11-17 | 缺 user.location; 缺 markers; series 段标题语言不一致 (A=中文 ['金奖', '银奖', '铜奖'], B=英文 ['Gold Award', 'Silver Award', 'Bronze Award']) |

### ICPC（14 项）

| # | 赛季 | A 仓库路径 | B 仓库路径 | 比赛标题 | startAt | 缺失/差异 |
|---|---|---|---|---|---|---|
| 1 | 2018 | `rank_spider/icpc/icpc2018world-finals.srk.json` | `official/icpc/icpc2017/icpc42ndworldfinals.srk.json` | The 42nd ICPC World Finals | 2018-04-19 | 缺 user.avatar; 缺 contest.banner; series 段标题语言不一致 (A=中文 ['金奖', '银奖', '铜奖'], B=英文 ['Gold Medalist', 'Silver Medalist', 'Bronze Medalist']) |
| 2 | 2019 | `rank_spider/icpc/icpc2019nanchang.srk.json` | `official/icpc/icpc2019/icpc2019nanchang.srk.json` | The 44th ICPC International Collegiate Programming Cont… | 2019-11-11 | markers id 不一致 (A=['girl'], B=['female']); 缺 user.avatar |
| 3 | 2021 | `rank_spider/icpc/icpc46thmacau-warmup.srk.json` | `official/icpc/icpc2021/icpc2021macau.srk.json` | 第 46 屆 ICPC 東亞洲區域賽（澳門）熱身賽 | 2022-04-03 | markers id 不一致 (A=['girl'], B=['female']) |
| 4 | 2021 | `rank_spider/icpc/icpc46thkunming.srk.json` | `official/icpc/icpc2021/icpc2021kunming.srk.json` | 第 46 届 ICPC 亚洲区域赛（昆明）正式赛 | 2022-04-17 | markers id 不一致 (A=['girl'], B=['female']) |
| 5 | 2022 | `rank_spider/icpc/icpc47thshenyang.srk.json` | `official/icpc/icpc2022/icpc2022shenyang.srk.json` | 第 47 届国际大学生程序设计竞赛亚洲区域赛沈阳站（正式赛） | 2022-11-06 | markers id 不一致 (A=['girl'], B=['female']) |
| 6 | 2022 | `rank_spider/icpc/icpc47thxian.srk.json` | `official/icpc/icpc2022/icpc2022xi_an.srk.json` | 第 47 届国际大学生程序设计竞赛亚洲区域赛西安站（正式赛） | 2022-11-13 | markers id 不一致 (A=['girl'], B=['female']) |
| 7 | 2022 | `rank_spider/icpc/icpc47thhefei.srk.json` | `official/icpc/icpc2022/icpc2022hefei.srk.json` | 第 47 届国际大学生程序设计竞赛亚洲区域赛合肥站（正式赛） | 2022-11-20 | markers id 不一致 (A=['girl'], B=['female']) |
| 8 | 2022 | `rank_spider/icpc/icpc47thjinan.srk.json` | `official/icpc/icpc2022/icpc2022jinan.srk.json` | 第 47 届国际大学生程序设计竞赛亚洲区域赛济南站（正式赛） | 2022-11-27 | markers id 不一致 (A=['girl'], B=['female']) |
| 9 | 2022 | `rank_spider/icpc/icpc47thhangzhou.srk.json` | `official/icpc/icpc2022/icpc2022hangzhou.srk.json` | 第 47 届国际大学生程序设计竞赛亚洲区域赛杭州站（正式赛） | 2022-12-04 | markers id 不一致 (A=['girl'], B=['female']) |
| 10 | 2022 | `rank_spider/icpc/icpc47thnanjing.srk.json` | `official/icpc/icpc2022/icpc2022nanjing.srk.json` | 第 47 届国际大学生程序设计竞赛亚洲区域赛南京站（正式赛） | 2022-12-18 | markers id 不一致 (A=['girl'], B=['female']) |
| 11 | 2023 | `rank_spider/icpc/icpc48thxian-invitational.srk.json` | `official/icpc/icpc2023/icpc2023invitational-xi_an.srk.json` | 第 48 届 ICPC 国际大学生程序设计竞赛西安邀请赛（正式赛） | 2023-05-14 | markers id 不一致 (A=['girl'], B=['female']) |
| 12 | 2024 | `rank_spider/icpc/icpc49thxian-invitational.srk.json` | `official/icpc/icpc2024/icpc2024invitational-xi_an.srk.json` | 第 49 届 ICPC 国际大学生程序设计竞赛邀请赛西安站 - 正式赛 | 2024-05-19 | markers id 不一致 (A=['girl'], B=['female']) |
| 13 | 2024 | `rank_spider/icpc/icpc49thkunming-invitational.srk.json` | `official/icpc/icpc2024/icpc2024invitational-kunming.srk.json` | 第 49 届 ICPC 国际大学生程序设计竞赛邀请赛昆明站 - 正式赛 | 2024-05-26 | 缺 markers |
| 14 | 2024 | `rank_spider/icpc/icpc49thecfinal.srk.json` | `official/icpc/icpc2024/icpc2024ecfinal.srk.json` | The 49th ICPC Asia East Continent Final Contest | 2024-12-28 | markers id 不一致 (A=['girl'], B=['female']) |

### 省赛 (provincial)（33 项）

| # | 赛季 | A 仓库路径 | B 仓库路径 | 比赛标题 | startAt | 缺失/差异 |
|---|---|---|---|---|---|---|
| 1 | 2019 | `rank_spider/province/ccpc2019jscpc.srk.json` | `official/provincial/js/jscpc4th.srk.json` | “SHEIN杯”2019年江苏省大学生程序设计大赛 | 2019-05-14 | 缺 user.avatar |
| 2 | 2019 | `rank_spider/province/ccpc2019sxcpc.srk.json` | `official/provincial/sn/sncpc7th.srk.json` | The 2019 ICPC China Shaanxi Provincial Programming Cont… | 2019-06-02 | 缺 user.avatar |
| 3 | 2020 | `rank_spider/province/ccpc2020zjcpc.srk.json` | `official/provincial/zj/zjcpc17th.srk.json` | The 17th Zhejiang Provincial Collegiate Programming Con… | 2020-10-17 | markers id 不一致 (A=['girl', 'highschool', 'junior', 'undergraduate'], B=['female']) |
| 4 | 2020 | `rank_spider/province/ccpc2020henancpc.srk.json` | `official/provincial/ha/haccpc2nd.srk.json` | “卓见杯”2020年河南省CCPC大学生程序设计竞赛 | 2020-11-21 | series 段标题语言不一致 (A=中文 ['金奖', '银奖', '铜奖'], B=英文 ['Gold Medalist', 'Silver Medalist', 'Bronze Medalist']) |
| 5 | 2021 | `rank_spider/province/ccpc2021zjcpc.srk.json` | `official/provincial/zj/zjcpc18th.srk.json` | The 18th Zhejiang Provincial Collegiate Programming Con… | 2021-04-17 | markers id 不一致 (A=['girl', 'highschool', 'junior', 'undergraduate'], B=['female']) |
| 6 | 2021 | `rank_spider/province/ccpc2021henan.srk.json` | `official/provincial/ha/haccpc3rd.srk.json` | 2021 年河南省第三届 CCPC 大学生程序设计竞赛正式赛 | 2021-10-30 | markers id 不一致 (A=['girl'], B=['female']) |
| 7 | 2021 | `rank_spider/province/ccpc2021jilin.srk.json` | `official/provincial/jl/jlcpc15th.srk.json` | 第十五届吉林省大学生程序设计竞赛 - 正式赛 | 2021-11-30 | markers id 不一致 (A=['group_a', 'group_b'], B=['female']) |
| 8 | 2021 | `rank_spider/province/ccpc2021jiangsu.srk.json` | `official/provincial/js/jscpc6th.srk.json` | 2021 年江苏省大学生程序设计大赛 - 正式赛 | 2021-12-25 | markers id 不一致 (A=['girl'], B=['female']) |
| 9 | 2022 | `rank_spider/province/ccpc2022zjcpc.srk.json` | `official/provincial/zj/zjcpc19th.srk.json` | The 19th Zhejiang Provincial Collegiate Programming Con… | 2022-04-16 | markers id 不一致 (A=['girl', 'highschool', 'junior', 'official', 'undergraduate'], B=['female']) |
| 10 | 2022 | `rank_spider/province/ccpc2022jiangsu.srk.json` | `official/provincial/js/jscpc7th.srk.json` | 2022 年江苏省大学生程序设计大赛 - 正式赛 | 2022-05-28 | markers id 不一致 (A=['girl'], B=['female']) |
| 11 | 2022 | `rank_spider/province/ccpc2022guangdong.srk.json` | `official/provincial/gd/gdcpc19th.srk.json` | 2022 年「小马智行杯」广东省大学生程序设计大赛 - 正式赛 | 2022-06-05 | markers id 不一致 (A=['girl'], B=['female']) |
| 12 | 2022 | `rank_spider/province/ccpc2022guangxi.srk.json` | `official/provincial/gx/gxcpc5th.srk.json` | 第五届广西大学生程序设计大赛 | 2022-06-26 | markers id 不一致 (A=['girl'], B=['female']) |
| 13 | 2023 | `rank_spider/province/ccpc2023zhejiang.srk.json` | `official/provincial/zj/zjcpc20th.srk.json` | The 20th Zhejiang Provincial Collegiate Programming Con… | 2023-04-15 | markers id 不一致 (A=['girl', 'undergraduate', 'vocational'], B=['female']) |
| 14 | 2023 | `rank_spider/province/ccpc2023henan.srk.json` | `official/provincial/ha/haccpc5th.srk.json` | 第五届 CCPC 河南省大学生程序设计竞赛（正式赛） | 2023-05-07 | markers id 不一致 (A=['girl'], B=['female']) |
| 15 | 2023 | `rank_spider/province/ccpc2023guangdong.srk.json` | `official/provincial/gd/gdcpc20th.srk.json` | 第二十届 CCPC 广东省大学生程序设计竞赛（正式赛） | 2023-05-14 | markers id 不一致 (A=['girl'], B=['female']); series 段标题语言不一致 (A=中文 ['金奖', '银奖', '铜奖'], B=英文 ['Gold Award', 'Silver Award', 'Bronze Award']) |
| 16 | 2023 | `rank_spider/province/ccpc2023hebei.srk.json` | `official/provincial/he/hecpc7th.srk.json` | 2023 年 CCPC 河北省大学生程序设计竞赛（正式赛） | 2023-05-21 | markers id 不一致 (A=['girl', 'undergraduate', 'vocational'], B=['female']) |
| 17 | 2023 | `rank_spider/province/ccpc2023jiangxi.srk.json` | `official/provincial/jx/jxcpc2023.srk.json` | 2023 年 ICPC 江西省大学生程序设计竞赛（正式赛） | 2023-05-21 | markers id 不一致 (A=['girl'], B=['female']) |
| 18 | 2023 | `rank_spider/province/ccpc2023jiangsu.srk.json` | `official/provincial/js/jscpc8th.srk.json` | 2023 年江苏省大学生程序设计竞赛（正式赛） | 2023-05-28 | markers id 不一致 (A=['girl'], B=['female']) |
| 19 | 2023 | `rank_spider/province/ccpc2023shandong.srk.json` | `official/provincial/sd/sdcpc13th.srk.json` | 第十三届山东省 ICPC 大学生程序设计竞赛（正式赛） | 2023-06-04 | markers id 不一致 (A=['girl'], B=['female']) |
| 20 | 2023 | `rank_spider/province/ccpc2023hunan.srk.json` | `official/provincial/hn/hncpc19th.srk.json` | 湖南省第十九届大学生计算机程序设计竞赛 | 2023-09-17 | 缺 user.location; markers id 不一致 (A=['girl'], B=['female']); series 段标题语言不一致 (A=中文 ['金奖', '银奖', '铜奖'], B=英文 ['Gold Award', 'Silver Award', 'Bronze Award']) |
| 21 | 2024 | `rank_spider/province/ccpc2024zhejiang.srk.json` | `official/provincial/zj/zjcpc21st.srk.json` | 「睿琪杯」浙江省第 21 届大学生程序设计竞赛 | 2024-04-13 | markers id 不一致 (A=['girl', 'undergraduate', 'vocational'], B=['female']); 缺 contest.banner |
| 22 | 2024 | `rank_spider/province/ccpc2024jiangsu.srk.json` | `official/provincial/js/jscpc9th.srk.json` | 「华为杯」2024 江苏省大学生程序设计竞赛 - 正式赛 | 2024-05-12 | markers id 不一致 (A=['girl'], B=['female']) |
| 23 | 2024 | `rank_spider/province/ccpc2024henan.srk.json` | `official/provincial/ha/haccpc6th.srk.json` | 第 6 届 CCPC 河南省大学生程序设计竞赛 - 正式赛 | 2024-05-12 | 缺 user.location; series 段标题语言不一致 (A=中文 ['金奖', '银奖', '铜奖'], B=英文 ['Gold Award', 'Silver Award', 'Bronze Award']) |
| 24 | 2024 | `rank_spider/province/ccpc2024guangxi.srk.json` | `official/provincial/gx/gxcpc7th.srk.json` | 第七届广西大学生程序设计大赛 | 2024-05-19 | markers id 不一致 (A=['girl', 'undergraduate', 'vocational'], B=['female']) |
| 25 | 2024 | `rank_spider/province/ccpc2024shandong.srk.json` | `official/provincial/sd/sdcpc14th.srk.json` | 2024 CCPC 全国邀请赛（山东）暨山东省大学生程序设计竞赛 - 正式赛 | 2024-05-26 | markers id 不一致 (A=['girl', 'out_of_province', 'within_the_province'], B=['female', 'type1', 'type2']); series 段标题语言不一致 (A=中文 ['金奖', '银奖', '铜奖'], B=英文 ['Gold Medalist', 'Silver Medalist', 'Bronze Medalist']) |
| 26 | 2024 | `rank_spider/province/ccpc2024hebei.srk.json` | `official/provincial/he/hecpc8th.srk.json` | 2024 CCPC 河北省大学生程序设计竞赛 - 正式赛 | 2024-05-26 | markers id 不一致 (A=['girl'], B=['female']) |
| 27 | 2024 | `rank_spider/province/ccpc2024guangdong.srk.json` | `official/provincial/gd/gdcpc21st.srk.json` | 第二十一届广东省大学生程序设计竞赛 - 正式赛 | 2024-05-26 | series 段标题语言不一致 (A=中文 ['金奖', '银奖', '铜奖'], B=英文 ['Gold Award', 'Silver Award', 'Bronze Award']) |
| 28 | 2024 | `rank_spider/province/ccpc2024fujian.srk.json` | `official/provincial/fj/fjcpc11th.srk.json` | 第十一届福建省大学生程序设计竞赛暨 CCPC 全国邀请赛（福州） | 2024-05-26 | markers id 不一致 (A=['girl'], B=['female']) |
| 29 | 2024 | `rank_spider/province/ccpc2024jiangxi.srk.json` | `official/provincial/jx/jxcpc2024.srk.json` | 2024 江西省大学生程序设计竞赛 - 正式赛 | 2024-06-02 | markers id 不一致 (A=['girl'], B=['female']) |
| 30 | 2024 | `rank_spider/province/ccpc2024shaanxi.srk.json` | `official/provincial/sn/sncpc12th.srk.json` | 第 12 届陕西省大学生程序设计竞赛 - 正式赛 | 2024-06-02 | markers id 不一致 (A=['girl'], B=['female']) |
| 31 | 2024 | `rank_spider/province/ccpc2024sichuan.srk.json` | `official/provincial/sc/sccpc16th.srk.json` | 第十六届四川省大学生程序设计竞赛 - 正式赛 | 2024-06-16 | markers id 不一致 (A=['girl'], B=['female']) |
| 32 | 2024 | `rank_spider/province/ccpc2024hunan.srk.json` | `official/provincial/hn/hncpc20th.srk.json` | 湖南省第二十届大学生计算机程序设计竞赛 | 2024-10-13 | 缺 user.location; series 段标题语言不一致 (A=中文 ['金奖', '银奖', '铜奖'], B=英文 ['Gold Award', 'Silver Award', 'Bronze Award']) |
| 33 | 2024 | `rank_spider/province/ccpc2024liaoning.srk.json` | `official/provincial/ln/lncpc5th.srk.json` | 第五届辽宁省大学生程序设计竞赛 | 2024-11-03 | 缺 user.location; markers id 不一致 (A=['girl'], B=['female']); series 段标题语言不一致 (A=中文 ['金奖', '银奖', '铜奖'], B=英文 ['Gold Award', 'Silver Award', 'Bronze Award']) |

---

## 二、仅 rank_spider 有的（srk-collection 尚未收录）

> 按赛季 < 2025 / ≥ 2025 分组。

### CCPC

<details><summary><b>pre-2025（33 个）</b></summary>

- [赛季 2016] `rank_spider/ccpc/ccpc2016cuhk_online.srk.json` — CCPC cuhk online (2016-09-01)
- [赛季 2017] `rank_spider/ccpc/ccpc2017final_onsite.srk.json` — CCPC final onsite (2017-09-01)
- [赛季 2017] `rank_spider/ccpc/ccpc2017hdu_onsite.srk.json` — CCPC hdu onsite (2017-09-01)
- [赛季 2017] `rank_spider/ccpc/ccpc2017zstu_onsite.srk.json` — CCPC zstu onsite (2017-09-01)
- [赛季 2020] `rank_spider/ccpc/ccpc2020wfinal.srk.json` — CCPC2020-第六届中国大学生程序设计竞赛（女生专场） 正式赛 (2020-10-18)
- [赛季 2020] `rank_spider/ccpc/ccpc2020weihai-warmup.srk.json` — CCPC2020-第六届中国大学生程序设计竞赛（威海） 热身赛 (2020-10-24)
- [赛季 2020] `rank_spider/ccpc/ccpc2020mianyang-warmup.srk.json` — CCPC2020-第六届中国大学生程序设计竞赛（绵阳） 热身赛 (2020-10-31)
- [赛季 2020] `rank_spider/ccpc/ccpc2020changchun-warmup.srk.json` — CCPC2020-第六届中国大学生程序设计竞赛（长春） 热身赛 (2020-11-07)
- [赛季 2020] `rank_spider/ccpc/ccpc2020final-warmup.srk.json` — 第六届中国大学生程序设计竞赛总决赛（热身赛） (2021-05-29)
- [赛季 2021] `rank_spider/ccpc/ccpc7thgirl-warmup.srk.json` — 2021 年中国大学生程序设计竞赛女生专场 热身赛 (2021-10-30)
- [赛季 2021] `rank_spider/ccpc/ccpc7thguilin-warmup.srk.json` — 2021 年中国大学生程序设计竞赛桂林站 热身赛 (2021-11-06)
- [赛季 2021] `rank_spider/ccpc/ccpc7thguangzhou-warmup.srk.json` — 第 7 届中国大学生程序设计竞赛（CCPC）广州站 - 热身赛 (2021-11-13)
- [赛季 2021] `rank_spider/ccpc/ccpc7thweihai-warmup.srk.json` — 第 7 届中国大学生程序设计竞赛（CCPC）威海站 - 热身赛 (2021-11-20)
- [赛季 2021] `rank_spider/ccpc/ccpc7thharbin-warmup.srk.json` — 第 7 届中国大学生程序设计竞赛（CCPC）哈尔滨站 - 热身赛 (2021-11-27)
- [赛季 2022] `rank_spider/ccpc/ccpc8thweihai-warmup.srk.json` — 2022 中国大学生程序设计竞赛（威海） - 热身赛 (2022-11-05)
- [赛季 2022] `rank_spider/ccpc/ccpc8thguangzhou-warmup.srk.json` — 2022 中国大学生程序设计竞赛（广州） - 热身赛 (2022-11-12)
- [赛季 2022] `rank_spider/ccpc/ccpc8thmianyang-warmup.srk.json` — 2022 中国大学生程序设计竞赛（绵阳） - 热身赛 (2022-11-19)
- [赛季 2022] `rank_spider/ccpc/ccpc8thgirls-warmup.srk.json` — 2022 中国大学生程序设计竞赛（女生专场） - 热身赛 (2022-11-26)
- [赛季 2022] `rank_spider/ccpc/ccpc8thfinal-warmup.srk.json` — 第八届中国大学生程序设计竞赛总决赛（热身赛） (2023-05-13)
- [赛季 2023] `rank_spider/ccpc/ccpc9thjiangsu-and-xiangtan-warmup.srk.json` — 2023 年 CCPC 江苏省赛 & 全国邀请赛（湖南）- 热身赛 (2023-05-27)
- [赛季 2023] `rank_spider/ccpc/ccpc9thxiangtan-invitational-warmup.srk.json` — 2023 年中国大学生程序设计竞赛全国邀请赛（湖南）- 热身赛 (2023-05-27)
- [赛季 2023] `rank_spider/ccpc/ccpc9thxiangtan-invitational.srk.json` — 2023 年中国大学生程序设计竞赛全国邀请赛（湖南）- 正式赛 (2023-05-28)
- [赛季 2023] `rank_spider/ccpc/ccpc9thqinhuangdao-warmup.srk.json` — 第 9 届 CCPC 中国大学生程序设计竞赛秦皇岛站 - 热身赛 (2023-10-14)
- [赛季 2023] `rank_spider/ccpc/ccpc9thgirl-warmup.srk.json` — 第 9 届 CCPC 中国大学生程序设计竞赛女生专场 - 热身赛 (2023-10-20)
- [赛季 2023] `rank_spider/ccpc/ccpc9thvocational-warmup.srk.json` — 第 9 届 CCPC 中国大学生程序设计竞赛高职专场 - 热身赛 (2023-10-20)
- [赛季 2023] `rank_spider/ccpc/ccpc9thguilin-warmup.srk.json` — 第 9 届 CCPC 中国大学生程序设计竞赛桂林站 - 热身赛 (2023-10-28)
- [赛季 2023] `rank_spider/ccpc/ccpc9thharbin-warmup.srk.json` — 第 9 届 CCPC 中国大学生程序设计竞赛哈尔滨站 - 热身赛 (2023-11-04)
- [赛季 2023] `rank_spider/ccpc/ccpc9thshenzhen-warmup.srk.json` — 第 9 届 CCPC 中国大学生程序设计竞赛深圳站 - 热身赛 (2023-11-11)
- [赛季 2023] `rank_spider/ccpc/ccpc9thfinal-warmup.srk.json` — 第 9 届 CCPC 中国大学生程序设计竞赛总决赛 - 热身赛 (2024-03-30)
- [赛季 2024] `rank_spider/ccpc/ccpc10thharbin-warmup.srk.json` — 第 10 届 CCPC 中国大学生程序设计竞赛哈尔滨站 - 热身赛 (2024-10-19)
- [赛季 2024] `rank_spider/ccpc/ccpc10thjinan-warmup.srk.json` — 第 10 届 CCPC 中国大学生程序设计竞赛济南站 - 热身赛 (2024-10-26)
- [赛季 2024] `rank_spider/ccpc/ccpc10thchongqing-warmup.srk.json` — 第 10 届 CCPC 中国大学生程序设计竞赛重庆站 - 热身赛 (2024-11-09)
- [赛季 2024] `rank_spider/ccpc/ccpc10thzhengzhou-warmup.srk.json` — 第 10 届 CCPC 中国大学生程序设计竞赛郑州站 - 热身赛 (2024-11-16)

</details>

<details><summary><b>2025+（18 个）</b></summary>

- [赛季 2025] `rank_spider/ccpc/ccpc11stnortheastern-warmup.srk.json` — 2025 年 CCPC 全国邀请赛（东北）暨第十九届 CCPC 东北地区大学生程序设计竞赛 - 热身赛 (2025-05-24)
- [赛季 2025] `rank_spider/ccpc/ccpc11thnortheastern-warmup.srk.json` — 2025 年 CCPC 全国邀请赛（东北）暨第十九届 CCPC 东北地区大学生程序设计竞赛 - 热身赛 (2025-05-24)
- [赛季 2025] `rank_spider/ccpc/ccpc11stnortheastern.srk.json` — 2025 年 CCPC 全国邀请赛（东北）暨第十九届 CCPC 东北地区大学生程序设计竞赛 - 正式赛 (2025-05-25)
- [赛季 2025] `rank_spider/ccpc/ccpc11stzhengzhou-invitational-warmup.srk.json` — 2025 CCPC 全国邀请赛（郑州）暨第七届 CCPC 河南省赛 - 热身赛 (2025-06-01)
- [赛季 2025] `rank_spider/ccpc/ccpc11thzhengzhou-invitational-warmup.srk.json` — 2025 CCPC 全国邀请赛（郑州）暨第七届 CCPC 河南省赛 - 热身赛 (2025-06-01)
- [赛季 2025] `rank_spider/ccpc/ccpc11thnanchang-invitational-warmup.srk.json` — 2025 CCPC 全国邀请赛（南昌）暨第二届江西省赛 - 热身赛 (2025-09-12)
- [赛季 2025] `rank_spider/ccpc/ccpc11stnanchang-invitational-warmup.srk.json` — 2025 CCPC 全国邀请赛（南昌）暨第二届江西省赛 - 热身赛 (2025-09-12)
- [赛季 2025] `rank_spider/ccpc/ccpc11stnanchang-invitational.srk.json` — 2025 CCPC 全国邀请赛（南昌）暨第二届江西省赛 - 正式赛 (2025-09-13)
- [赛季 2025] `rank_spider/ccpc/ccpc11thharbin-warmup.srk.json` — 第 11 届 CCPC 中国大学生程序设计竞赛哈尔滨站 - 热身赛 (2025-11-08)
- [赛季 2025] `rank_spider/ccpc/ccpc11stharbin-warmup.srk.json` — 第 11 届 CCPC 中国大学生程序设计竞赛哈尔滨站 - 热身赛 (2025-11-08)
- [赛季 2025] `rank_spider/ccpc/ccpc11stharbin.srk.json` — 第 11 届 CCPC 中国大学生程序设计竞赛哈尔滨站 - 正式赛 (2025-11-09)
- [赛季 2025] `rank_spider/ccpc/ccpc11stjinan-warmup.srk.json` — 第 11 届 CCPC 中国大学生程序设计竞赛济南站 - 热身赛 (2025-11-15)
- [赛季 2025] `rank_spider/ccpc/ccpc11thjinan-warmup.srk.json` — 第 11 届 CCPC 中国大学生程序设计竞赛济南站 - 热身赛 (2025-11-15)
- [赛季 2025] `rank_spider/ccpc/ccpc11thjinan.srk.json` — 第 11 届 CCPC 中国大学生程序设计竞赛济南站 - 正式赛 (2025-11-16)
- [赛季 2025] `rank_spider/ccpc/ccpc11thzhengzhou-warmup.srk.json` — 第 11 届 CCPC 中国大学生程序设计竞赛郑州站 - 热身赛 (2025-11-22)
- [赛季 2025] `rank_spider/ccpc/ccpc11thchongqing-warmup.srk.json` — 第 11 届 CCPC 中国大学生程序设计竞赛重庆站 - 热身赛 (2025-11-29)
- [赛季 2026] `rank_spider/ccpc/ccpc12thnanchang-invitational-warmup.srk.json` — 2026 CCPC 中国大学生程序设计竞赛全国邀请赛（南昌） - 热身赛 (2026-05-23)
- [赛季 2026] `rank_spider/ccpc/ccpc12thguizhou-invitational-warmup.srk.json` — 2026 CCPC 中国大学生程序设计竞赛全国邀请赛（贵州）暨贵州省赛 - 热身赛 (2026-06-07)

</details>

### ICPC

<details><summary><b>pre-2025（66 个）</b></summary>

- [赛季 2011] `rank_spider/icpc/icpc2011ccniit_onsite000.srk.json` — ICPC ccniit onsite000 (2011-09-01)
- [赛季 2011] `rank_spider/icpc/icpc2011dlut_onsite2.srk.json` — ICPC dlut onsite2 (2011-09-01)
- [赛季 2011] `rank_spider/icpc/icpc2011fdu_onsite0.srk.json` — ICPC fdu onsite0 (2011-09-01)
- [赛季 2012] `rank_spider/icpc/icpc2012ccniit_online.srk.json` — ICPC ccniit online (2012-09-01)
- [赛季 2014] `rank_spider/icpc/icpc2014wpu_onsite.srk.json` — ICPC wpu onsite (2014-09-01)
- [赛季 2015] `rank_spider/icpc/icpc2015ecfinal.srk.json` — The 40th ICPC Asia East Continent Final Contest (2015-12-13)
- [赛季 2016] `rank_spider/icpc/icpc2016cuhk_online.srk.json` — ICPC cuhk online (2016-09-01)
- [赛季 2016] `rank_spider/icpc/icpc2016pku_onsite.srk.json` — ICPC pku onsite (2016-09-01)
- [赛季 2017] `rank_spider/icpc/icpc2017gxu_onsite.srk.json` — ICPC gxu onsite (2017-09-01)
- [赛季 2017] `rank_spider/icpc/icpc2017hrbust_onsite.srk.json` — ICPC hrbust onsite (2017-09-01)
- [赛季 2017] `rank_spider/icpc/icpc2017nwpu_onsite.srk.json` — ICPC nwpu onsite (2017-09-01)
- [赛季 2017] `rank_spider/icpc/icpc2017pku_onsite.srk.json` — ICPC pku onsite (2017-09-01)
- [赛季 2017] `rank_spider/icpc/icpc2017xju_onsite.srk.json` — ICPC xju onsite (2017-09-01)
- [赛季 2017] `rank_spider/icpc/icpc2017qingdao.srk.json` — 第 42 届 ICPC 国际大学生程序设计竞赛区域赛青岛站 - 正式赛 (2017-09-01)
- [赛季 2018] `rank_spider/icpc/icpc2018qingdao.srk.json` — 第 43 届 ICPC 国际大学生程序设计竞赛区域赛青岛站 - 正式赛 (2018-10-21)
- [赛季 2019] `rank_spider/icpc/icpc2019world-finals.srk.json` — The 43rd ICPC World Finals (2019-04-04)
- [赛季 2020] `rank_spider/icpc/icpc2020practice-contest.srk.json` — ICPC2020-第 45 届国际大学生程序设计竞赛亚洲网上区域赛模拟赛 (2020-10-31)
- [赛季 2020] `rank_spider/icpc/icpc2020xiaomi-warmup.srk.json` — 2020 ICPC·小米邀请赛 决赛热身赛 (2020-11-21)
- [赛季 2020] `rank_spider/icpc/icpc2020shanghai-warmup.srk.json` — 第 45 届国际大学生程序设计竞赛（ICPC）亚洲区域赛（上海）热身赛 (2020-12-12)
- [赛季 2020] `rank_spider/icpc/icpc2020nanjing-warmup.srk.json` — 第 45 届国际大学生程序设计竞赛（ICPC）亚洲区域赛（南京）热身赛 (2020-12-19)
- [赛季 2020] `rank_spider/icpc/icpc2020jinan-warmup.srk.json` — 第 45 届国际大学生程序设计竞赛（ICPC）亚洲区域赛（济南）热身赛 (2020-12-26)
- [赛季 2020] `rank_spider/icpc/icpc2020kunming-warmup.srk.json` — 第 45 届国际大学生程序设计竞赛（ICPC）亚洲区域赛（昆明）热身赛 (2021-04-02)
- [赛季 2020] `rank_spider/icpc/icpc2020world-finals-Invitational.srk.json` — The 44th ICPC World Finals Moscow Invitational Contest (2021-09-30)
- [赛季 2020] `rank_spider/icpc/icpc2020world-finals.srk.json` — The 44th ICPC World Finals (2021-10-05)
- [赛季 2021] `rank_spider/icpc/icpc46thjinan-warmup.srk.json` — The 46th ICPC Asia Jinan Regional Contest - Practice Session (2021-11-13)
- [赛季 2021] `rank_spider/icpc/icpc46thshenyang-warmup.srk.json` — 第 46 届 ICPC 国际大学生程序设计竞赛亚洲区域赛（沈阳）热身赛 (2021-11-20)
- [赛季 2021] `rank_spider/icpc/icpc46thshanghai-warmup.srk.json` — 第 46 届 ICPC 国际大学生程序设计竞赛亚洲区域赛（上海）热身赛 (2021-11-27)
- [赛季 2021] `rank_spider/icpc/icpc46thnanjing-warmup.srk.json` — 第 46 届 ICPC 国际大学生程序设计竞赛亚洲区域赛（南京）热身赛 (2021-12-03)
- [赛季 2021] `rank_spider/icpc/icpc46thmacau.srk.json` — 第 46 屆 ICPC 東亞洲區域賽（澳門）正式賽 (2022-04-03)
- [赛季 2021] `rank_spider/icpc/icpc46thkunming-warmup.srk.json` — 第 46 届 ICPC 亚洲区域赛（昆明）热身赛 (2022-04-16)
- [赛季 2021] `rank_spider/icpc/icpc46thec-final-warmup.srk.json` — The 46th ICPC Asia East Continent Final Contest Warmup (2022-07-19)
- [赛季 2022] `rank_spider/icpc/icpc47thonline-qualification-1.srk.json` — The 2022 ICPC Asia Regionals Online Contest (I) (2022-09-17)
- [赛季 2022] `rank_spider/icpc/icpc47thonline-qualification-2.srk.json` — The 2022 ICPC Asia Regionals Online Contest (II) (2022-09-25)
- [赛季 2022] `rank_spider/icpc/icpc47thshenyang-warmup.srk.json` — 第 47 届国际大学生程序设计竞赛亚洲区域赛沈阳站（热身赛） (2022-11-05)
- [赛季 2022] `rank_spider/icpc/icpc47thxian-warmup.srk.json` — 第 47 届国际大学生程序设计竞赛亚洲区域赛西安站（热身赛） (2022-11-12)
- [赛季 2022] `rank_spider/icpc/icpc47thhefei-warmup.srk.json` — 第 47 届国际大学生程序设计竞赛亚洲区域赛合肥站（热身赛） (2022-11-19)
- [赛季 2022] `rank_spider/icpc/icpc47thjinan-warmup.srk.json` — 第 47 届国际大学生程序设计竞赛亚洲区域赛济南站（热身赛） (2022-11-26)
- [赛季 2022] `rank_spider/icpc/icpc47thhangzhou-warmup.srk.json` — 第 47 届国际大学生程序设计竞赛亚洲区域赛杭州站（热身赛） (2022-12-03)
- [赛季 2022] `rank_spider/icpc/icpc47thnanjing-warmup.srk.json` — 第 47 届国际大学生程序设计竞赛亚洲区域赛南京站（热身赛） (2022-12-17)
- [赛季 2022] `rank_spider/icpc/icpc47thhongkong.srk.json` — The 47th ICPC Asia Hong Kong Regional Contest (2023-01-14)
- [赛季 2022] `rank_spider/icpc/icpc47thhongkong-warmup.srk.json` — The 47th ICPC Asia Hong Kong Regional Contest Warmup (2023-01-14)
- [赛季 2022] `rank_spider/icpc/icpc47thec-final.srk.json` — The 47th ICPC Asia East Continent Final Contest (2023-03-25)
- [赛季 2023] `rank_spider/icpc/icpc48thxian-invitational-warmup.srk.json` — 第 48 届 ICPC 国际大学生程序设计竞赛西安邀请赛（热身赛） (2023-05-14)
- [赛季 2023] `rank_spider/icpc/icpc48thonline-qualification-1.srk.json` — The 2023 ICPC Asia Regionals Online Contest (I) (2023-09-17)
- [赛季 2023] `rank_spider/icpc/icpc48thonline-qualification-2.srk.json` — The 2023 ICPC Asia Regionals Online Contest (II) (2023-09-23)
- [赛季 2023] `rank_spider/icpc/icpc48thnanjing-warmup.srk.json` — 第 48 届 ICPC 国际大学生程序设计竞赛区域赛南京站 - 热身赛 (2023-11-04)
- [赛季 2023] `rank_spider/icpc/icpc48thshenyang-warmup.srk.json` — 第 48 届 ICPC 国际大学生程序设计竞赛区域赛沈阳站 - 热身赛 (2023-11-11)
- [赛季 2023] `rank_spider/icpc/icpc48thmacau.srk.json` — 2023 - 2024 International Collegiate Programming Contest, Macau Site (2023-11-19)
- [赛季 2023] `rank_spider/icpc/icpc48thhefei-warmup.srk.json` — 第 48 届 ICPC 国际大学生程序设计竞赛区域赛合肥站 - 热身赛 (2023-11-25)
- [赛季 2023] `rank_spider/icpc/icpc48thjinan-warmup.srk.json` — 第 48 届 ICPC 国际大学生程序设计竞赛区域赛济南站 - 热身赛 (2023-12-02)
- [赛季 2023] `rank_spider/icpc/icpc48thhangzhou-warmup.srk.json` — 第 48 届 ICPC 国际大学生程序设计竞赛区域赛杭州站 - 热身赛 (2023-12-09)
- [赛季 2023] `rank_spider/icpc/icpc48thecfinal-warmup.srk.json` — The 48th ICPC Asia East Continent Final Contest Warmup (2024-01-12)
- [赛季 2024] `rank_spider/icpc/icpc49thwuhan-invitational-warmup.srk.json` — 第 49 届 ICPC 国际大学生程序设计竞赛邀请赛武汉站 - 热身赛 (2024-05-01)
- [赛季 2024] `rank_spider/icpc/icpc49thkunming-invitational-warmup.srk.json` — 第 49 届 ICPC 国际大学生程序设计竞赛邀请赛昆明站 - 热身赛 (2024-05-25)
- [赛季 2024] `rank_spider/icpc/icpc49thonline-qualification-1.srk.json` — The 49th ICPC Asia Regionals Online Contest (I) (2024-09-15)
- [赛季 2024] `rank_spider/icpc/icpc49thonline-qualification-2.srk.json` — The 49th ICPC Asia Regionals Online Contest (II) (2024-09-21)
- [赛季 2024] `rank_spider/icpc/icpc49thchengdu-warmup.srk.json` — 第 49 届 ICPC 国际大学生程序设计竞赛区域赛成都站 - 热身赛 (2024-10-26)
- [赛季 2024] `rank_spider/icpc/icpc49thnanjing-warmup.srk.json` — 第 49 届 ICPC 国际大学生程序设计竞赛区域赛南京站 - 热身赛 (2024-11-02)
- [赛季 2024] `rank_spider/icpc/icpc49thhangzhou-warmup.srk.json` — 第 49 届 ICPC 国际大学生程序设计竞赛区域赛杭州站 - 热身赛 (2024-11-09)
- [赛季 2024] `rank_spider/icpc/icpc49thshanghai-warmup.srk.json` — 第 49 届 ICPC 国际大学生程序设计竞赛区域赛上海站 - 热身赛 (2024-11-16)
- [赛季 2024] `rank_spider/icpc/icpc49thshenyang-warmup.srk.json` — 第 49 届 ICPC 国际大学生程序设计竞赛区域赛沈阳站 - 热身赛 (2024-11-23)
- [赛季 2024] `rank_spider/icpc/icpc49thkunming-warmup.srk.json` — 第 49 届 ICPC 国际大学生程序设计竞赛区域赛昆明站 - 热身赛 (2024-11-30)
- [赛季 2024] `rank_spider/icpc/icpc49thhongkong-warmup.srk.json` — The 49th ICPC Asia Hong Kong Regional Contest Warmup (2024-12-21)
- [赛季 2024] `rank_spider/icpc/icpc49thhongkong.srk.json` — The 49th ICPC Asia Hong Kong Regional Contest (2024-12-22)
- [赛季 2024] `rank_spider/icpc/icpc49thecfinal-warmup.srk.json` — The 49th ICPC Asia East Continent Final Contest Warmup (2024-12-27)
- [赛季 2024] `rank_spider/icpc/icpc49thworld-finals-dress-rehearsal.srk.json` — The 49th ICPC World Finals - Dress Rehearsal (2025-09-02)

</details>

<details><summary><b>2025+（13 个）</b></summary>

- [赛季 2025] `rank_spider/icpc/icpc50thwuhan-invitational-warmup.srk.json` — 第 50 届 ICPC 国际大学生程序设计竞赛邀请赛武汉站 - 热身赛 (2025-04-26)
- [赛季 2025] `rank_spider/icpc/icpc50thnanchang-invitational-warmup.srk.json` — 2025年icpc全国邀请赛（南昌）暨2025年（icpc）江西省大学生程序设计竞赛 - 热身赛 (2025-05-18)
- [赛季 2025] `rank_spider/icpc/icpc50thchengdu-warmup.srk.json` — 「华为杯」第 50 届 ICPC 国际大学生程序设计竞赛区域赛成都站 - 热身赛 (2025-10-25)
- [赛季 2025] `rank_spider/icpc/icpc50thwuhan-warmup.srk.json` — 「华为杯」第 50 届 ICPC 国际大学生程序设计竞赛区域赛武汉站 - 热身赛 (2025-11-01)
- [赛季 2025] `rank_spider/icpc/icpc50thnanjing-warmup.srk.json` — 「华为杯」第 50 届 ICPC 国际大学生程序设计竞赛区域赛南京站 - 热身赛 (2025-11-08)
- [赛季 2025] `rank_spider/icpc/icpc50thshenyang-warmup.srk.json` — 「华为杯」第 50 届 ICPC 国际大学生程序设计竞赛区域赛沈阳站 - 热身赛 (2025-11-15)
- [赛季 2025] `rank_spider/icpc/icpc50thshanghai-warmup.srk.json` — 「华为杯」第 50 届 ICPC 国际大学生程序设计竞赛区域赛上海站 - 热身赛 (2025-11-22)
- [赛季 2025] `rank_spider/icpc/icpc50thhongkong-warmup.srk.json` — The 50th ICPC Asia Hong Kong Regional Contest Warmup (2025-11-29)
- [赛季 2025] `rank_spider/icpc/icpc50thecfinal-warmup.srk.json` — The "Huawei Cup" 50th ICPC Asia East Continent Final Contest Warmup (2026-02-01)
- [赛季 2026] `rank_spider/icpc/icpc51stshenzhen-invitational-warmup.srk.json` — 2026 年 ICPC 国际大学生程序设计竞赛全国邀请赛（深圳）- 热身赛 (2026-04-11)
- [赛季 2026] `rank_spider/icpc/icpc51stxian-invitational-warmup.srk.json` — 第 51 届 ICPC 国际大学生程序设计竞赛邀请赛西安站 - 热身赛 (2026-05-02)
- [赛季 2026] `rank_spider/icpc/icpc51stjiangxi-invitational-warmup.srk.json` — 2026 年 ICPC 国际大学生程序设计竞赛全国邀请赛（南昌）暨江西省赛 - 热身赛 (2026-05-16)
- [赛季 2026] `rank_spider/icpc/icpc51stwuhan-invitational-warmup.srk.json` — 2026 年 ICPC 国际大学生程序设计竞赛全国邀请赛（武汉）暨湖北省赛 - 热身赛 (2026-05-16)

</details>

### 省赛 (provincial)

<details><summary><b>pre-2025（28 个）</b></summary>

- [赛季 2019] `rank_spider/province/ccpc2019sdcpc.srk.json` — The 10th Shandong Provincial Collegiate Programming Contest (2019-05-02)
- [赛季 2020] `rank_spider/province/ccpc2020jscpc-warmup.srk.json` — 2020ICPC 江西省大学生程序设计竞赛热身赛 (2020-11-14)
- [赛季 2021] `rank_spider/province/ccpc2021necpc-warmup.srk.json` — “红旗杯”第十五届东北地区大学生程序设计竞赛（热身赛） (2021-06-12)
- [赛季 2021] `rank_spider/province/ccpc2021shanghai-warmup.srk.json` — 2021“科大讯飞杯”上海市大学生程序设计竞赛——暨 CCPC 2021 上海市赛热身赛 (2021-07-11)
- [赛季 2021] `rank_spider/province/ccpc2021henan-warmup.srk.json` — 2021 年河南省第三届 CCPC 大学生程序设计竞赛热身赛 (2021-10-30)
- [赛季 2021] `rank_spider/province/ccpc2021jiangsu-warmup.srk.json` — 2021 年江苏省大学生程序设计大赛 - 热身赛 (2021-12-24)
- [赛季 2022] `rank_spider/province/ccpc2022jiangsu-warmup.srk.json` — 2022 年江苏省大学生程序设计大赛 - 热身赛 (2022-05-27)
- [赛季 2022] `rank_spider/province/ccpc2022guangdong-warmup.srk.json` — 2022 年「小马智行杯」广东省大学生程序设计大赛 - 热身赛 (2022-06-05)
- [赛季 2022] `rank_spider/province/ccpc2022shanxi-warmup.srk.json` — 2022 年国际大学生程序设计竞赛第 10 届陕西省程序设计竞赛（热身赛） (2022-10-22)
- [赛季 2022] `rank_spider/province/ccpc2022liaoning-warmup.srk.json` — 2022 年第三届辽宁省大学生程序设计竞赛（热身赛） (2022-10-22)
- [赛季 2022] `rank_spider/province/ccpc2022jiangxi-warmup.srk.json` — 2022 年江西省大学生程序设计竞赛 (热身赛) (2022-10-23)
- [赛季 2023] `rank_spider/province/ccpc2023zhejiang-warmup.srk.json` — The 20th Zhejiang Provincial Collegiate Programming Contest Sponsored by TuSimpl (2023-04-15)
- [赛季 2023] `rank_spider/province/ccpc2023hubei-warmup.srk.json` — 第五届 CCPC 湖北省大学生程序设计竞赛（热身赛） (2023-04-29)
- [赛季 2023] `rank_spider/province/ccpc2023henan-warmup.srk.json` — 第五届 CCPC 河南省大学生程序设计竞赛（热身赛） (2023-05-05)
- [赛季 2023] `rank_spider/province/ccpc2023guangdong-warmup.srk.json` — 第二十届 CCPC 广东省大学生程序设计竞赛（热身赛） (2023-05-13)
- [赛季 2023] `rank_spider/province/ccpc2023jiangsu-warmup.srk.json` — 2023 年江苏省大学生程序设计竞赛（热身赛） (2023-05-27)
- [赛季 2023] `rank_spider/province/ccpc2023guangxi-warmup.srk.json` — 2023 年第六届广西大学生程序设计竞赛（热身赛） (2023-06-03)
- [赛季 2023] `rank_spider/province/ccpc2023shandong-warmup.srk.json` — 第十三届山东省 ICPC 大学生程序设计竞赛（热身赛） (2023-06-03)
- [赛季 2024] `rank_spider/province/ccpc2024zhejiang-warmup.srk.json` — 「睿琪杯」浙江省第 21 届大学生程序设计竞赛 - 热身赛 (2024-04-13)
- [赛季 2024] `rank_spider/province/ccpc2024hubei-warmup.srk.json` — The 2024 ICPC in Hubei Province, China - Warming Up (2024-04-26)
- [赛季 2024] `rank_spider/province/ccpc2024henan-warmup.srk.json` — 第 6 届 CCPC 河南省大学生程序设计竞赛 - 热身赛 (2024-05-11)
- [赛季 2024] `rank_spider/province/ccpc2024hebei-warmup.srk.json` — 2024 CCPC 河北省大学生程序设计竞赛 - 热身赛 (2024-05-25)
- [赛季 2024] `rank_spider/province/ccpc2024guangdong-warmup.srk.json` — 第二十一届广东省大学生程序设计竞赛 - 热身赛 (2024-05-25)
- [赛季 2024] `rank_spider/province/ccpc2024henan-icpc-warmup.srk.json` — 2024 ICPC 河南省大学生程序设计竞赛 - 热身赛 (2024-06-02)
- [赛季 2024] `rank_spider/province/ccpc2024jiangxi-warmup.srk.json` — 2024 江西省大学生程序设计竞赛 - 热身赛 (2024-06-02)
- [赛季 2024] `rank_spider/province/ccpc2024shaanxi-warmup.srk.json` — 第 12 届陕西省大学生程序设计竞赛 - 热身赛 (2024-06-02)
- [赛季 2024] `rank_spider/province/ccpc2024sichuan-warmup.srk.json` — 第十六届四川省大学生程序设计竞赛 - 热身赛 (2024-06-15)
- [赛季 2024] `rank_spider/province/ccpc2024hunan-warmup.srk.json` — 湖南省第二十届大学生计算机程序设计竞赛 - 热身赛 (2024-10-12)

</details>

<details><summary><b>2025+（18 个）</b></summary>

- [赛季 2025] `rank_spider/province/ccpc2025zhejiang-warmup.srk.json` — 「睿琪杯」浙江省第 22 届大学生程序设计竞赛 - 热身赛 (2025-04-26)
- [赛季 2025] `rank_spider/province/ccpc2025henan-warmup.srk.json` — 2025 ICPC 河南省大学生程序设计竞赛 - 热身赛 (2025-05-10)
- [赛季 2025] `rank_spider/province/ccpc2025shaanxi-warmup.srk.json` — 第十三届陕西省国际大学生程序设计竞赛 - 热身赛 (2025-05-10)
- [赛季 2025] `rank_spider/province/ccpc2025hebei-warmup.srk.json` — 第九届河北省大学生程序设计竞赛 - 热身赛 (2025-05-17)
- [赛季 2025] `rank_spider/province/ccpc2025jilin-warmup.srk.json` — 第 18 届吉林省大学生程序设计竞赛 - 热身赛 (2025-05-23)
- [赛季 2025] `rank_spider/province/ccpc2025guangxi-warm.srk.json` — 第八届广西大学生程序设计大赛暨2025邀请赛（热身赛） (2025-05-24)
- [赛季 2025] `rank_spider/province/ccpc2025jiangsu-warmup.srk.json` — 「华为杯」2025 年江苏省大学生程序设计竞赛 - 热身赛 (2025-06-01)
- [赛季 2025] `rank_spider/province/ccpc2025sichuan-warmup.srk.json` — 2025 四川省大学生程序设计竞赛 - 热身赛 (2025-06-07)
- [赛季 2025] `rank_spider/province/ccpc2025shanghai-warmup.srk.json` — 「华为智联杯」无线程序设计竞赛暨 2025 年上海市大学生程序设计竞赛 - 热身赛 (2025-07-05)
- [赛季 2025] `rank_spider/province/ccpc2025liaoning-warmup.srk.json` — 第六届辽宁省大学生程序设计竞赛 - 热身赛 (2025-11-14)
- [赛季 2026] `rank_spider/province/ccpc2026gba.srk.json` — 2026 GBA International Programming Contest (2026-04-12)
- [赛季 2026] `rank_spider/province/ccpc2026zhejiang-warmup.srk.json` — 「睿琪杯」浙江省第 23 届大学生程序设计竞赛 - 热身赛 (2026-04-25)
- [赛季 2026] `rank_spider/province/ccpc2026jiangsu-warmup.srk.json` — 2026 年江苏省大学生程序设计竞赛 热身赛 (2026-05-16)
- [赛季 2026] `rank_spider/province/ccpc2026jilin-warmup.srk.json` — 第 19 届吉林省大学生程序设计竞赛 - 热身赛 (2026-05-22)
- [赛季 2026] `rank_spider/province/ccpc2026shandong-warmup.srk.json` — 2026 年山东省大学生程序设计竞赛 - 热身赛 (2026-05-23)
- [赛季 2026] `rank_spider/province/ccpc2026henan-icpc-warmup.srk.json` — 第 17 届 ICPC 河南省大学生程序设计竞赛 - 热身赛 (2026-05-23)
- [赛季 2026] `rank_spider/province/ccpc2026northeastern-warmup.srk.json` — 第二十届东北地区大学生程序设计竞赛 - 热身赛 (2026-05-23)
- [赛季 2026] `rank_spider/province/ccpc2026sichuan-warmup.srk.json` — 第十八届四川省大学生程序设计竞赛 - 热身赛 (2026-05-30)

</details>

---

## 三、仅 srk-collection 有的（rank_spider 尚未爬取）

### CCPC

<details><summary><b>pre-2025（19 个）</b></summary>

- [赛季 2017] `official/ccpc/ccpc2017/ccpc2017qingdao.srk.json` — CCPC upc onsite (2017-09-01)
- [赛季 2017] `official/ccpc/ccpc2017/ccpc2017hangzhou.srk.json` — CCPC 2017 杭州赛区现场赛 (2017-11-05)
- [赛季 2017] `official/ccpc/ccpc2017/ccpc2017final.srk.json` — 2017年中国大学生程序设计竞赛 总决赛 (2017-12-03)
- [赛季 2018] `official/ccpc/ccpc2018/ccpc2018invitational-xiangtan.srk.json` — 2018年“三盟科技杯”中国大学生程序设计竞赛全国邀请赛（湖南）暨第十届湘潭市大学生计算机程序设计大赛 (2018-05-13)
- [赛季 2018] `official/ccpc/ccpc2018/ccpc2018jilin.srk.json` — 2018年中国大学生程序设计竞赛 吉林站-北华大学 (2018-09-22)
- [赛季 2018] `official/ccpc/ccpc2018/ccpc2018qinhuangdao.srk.json` — 2018年中国大学生程序设计竞赛 秦皇岛站-东北大学秦皇岛分校 (2018-09-28)
- [赛季 2018] `official/ccpc/ccpc2018/ccpc2018guilin.srk.json` — 2018年中国大学生程序设计竞赛 桂林站-桂林电子科技大学 (2018-10-28)
- [赛季 2018] `official/ccpc/ccpc2018/ccpc2018final.srk.json` — 2018年中国大学生程序设计竞赛 总决赛-哈尔滨工业大学（深圳） (2018-11-25)
- [赛季 2019] `official/ccpc/ccpc2019/ccpc2019qinhuangdao.srk.json` — 2019年中国大学生程序设计竞赛 秦皇岛站-东北大学秦皇岛分校 (2019-09-22)
- [赛季 2019] `official/ccpc/ccpc2019/ccpc2019harbin.srk.json` — 2019年中国大学生程序设计竞赛 哈尔滨站-东北林业大学 (2019-10-13)
- [赛季 2019] `official/ccpc/ccpc2019/ccpc2019xiamen.srk.json` — 2019年中国大学生程序设计竞赛 厦门站-厦门理工学院 (2019-10-20)
- [赛季 2019] `official/ccpc/ccpc2019/ccpc2019final.srk.json` — 2019年中国大学生程序设计竞赛 总决赛-中国传媒大学 (2019-11-17)
- [赛季 2024] `official/ccpc/ccpc2024/ccpc2024invitational-changchun.srk.json` — 2024年中国大学生程序设计竞赛全国邀请赛（长春）暨第十七届CCPC吉林省大学生程序设计竞赛 (2024-05-18)
- [赛季 2024] `official/ccpc/ccpc2024/ccpc2024invitational-northeast.srk.json` — 2024年中国大学生程序设计竞赛全国邀请赛（东北）暨第十八届CCPC东北地区大学生程序设计竞赛 (2024-05-19)
- [赛季 2024] `official/ccpc/ccpc2024/ccpc2024invitational-jinan.srk.json` — “齐鲁软件园杯”2024年中国大学生程序设计竞赛全国邀请赛（山东）暨CCPC山东省大学生程序设计竞赛 (2024-05-26)
- [赛季 2024] `official/ccpc/ccpc2024/ccpc2024invitational-fuzhou.srk.json` — 第十一届福建省大学生程序设计竞赛暨 CCPC 全国邀请赛（福州） (2024-05-26)
- [赛季 2024] `official/ccpc/ccpc2024/ccpc2024ladies.srk.json` — 第十届中国大学生程序设计竞赛（女生专场） (2024-11-03)
- [赛季 2024] `official/ccpc/ccpc2024/ccpc2024hv.srk.json` — 第十届中国大学生程序设计竞赛（高职专场） (2024-11-03)
- [赛季 2024] `official/ccpc/ccpc2024/ccpc2024final.srk.json` — 第十届中国大学生程序设计竞赛总决赛 (2025-05-11)

</details>

<details><summary><b>2025+（5 个）</b></summary>

- [赛季 2025] `official/ccpc/ccpc2025/ccpc2025invitational-fujian.srk.json` — 第十二届福建省大学生程序设计竞赛暨2025年CCPC福建邀请赛 (2025-06-21)
- [赛季 2025] `official/ccpc/ccpc2025/ccpc2025ladies.srk.json` — 第十一届中国大学生程序设计竞赛（女生专场） (2025-10-26)
- [赛季 2025] `official/ccpc/ccpc2025/ccpc2025final.srk.json` — 第十一届中国大学生程序设计竞赛总决赛 (2026-04-26)
- [赛季 2026] `official/ccpc/ccpc2026/ccpc2026invitational-qinhuangdao.srk.json` — 2026年中国大学生程序设计竞赛全国邀请赛（秦皇岛）暨第十届河北省大学生程序设计竞赛-正式赛 (2026-05-24)
- [赛季 2026] `official/ccpc/ccpc2026/ccpc2026invitational-fuzhou.srk.json` — 第十三届福建省大学生程序设计竞赛 暨2026年CCPC全国邀请赛（福州） (2026-05-30)

</details>

### ICPC

<details><summary><b>pre-2025（23 个）</b></summary>

- [赛季 2016] `official/icpc/icpc2016/icpc2016beijing.srk.json` — The 2016 ACM-ICPC Asia Beijing Regional Contest (2016-11-13)
- [赛季 2017] `official/icpc/icpc2017/icpc2017xi_an.srk.json` — ICPC nwpu onsite (2017-10-29)
- [赛季 2017] `official/icpc/icpc2017/icpc2017beijing.srk.json` — The 2017 ACM-ICPC Asia Beijing Regional Contest (2017-11-19)
- [赛季 2017] `official/icpc/icpc2017/icpc2017nanning.srk.json` — ICPC gxu onsite (2017-11-26)
- [赛季 2017] `official/icpc/icpc2017/icpc2017urumchi.srk.json` — ICPC xju onsite (2017-12-03)
- [赛季 2018] `official/icpc/icpc2018/icpc2018nanjing.srk.json` — 第43届ACM-ICPC国际大学生程序设计竞赛亚洲区域赛（南京）-南京航空航天大学 (2018-10-14)
- [赛季 2018] `official/icpc/icpc2018/icpc2018shenyang.srk.json` — 第43届ACM国际大学生程序设计竞赛亚洲区域赛（沈阳站） (2018-10-21)
- [赛季 2018] `official/icpc/icpc2018/icpc2018xuzhou.srk.json` — 第43届ACM-ICPC国际大学生程序设计竞赛亚洲区域赛（徐州站） (2018-10-28)
- [赛季 2018] `official/icpc/icpc2018/icpc2018jiaozuo.srk.json` — 第43届ACM-ICPC国际大学生程序设计竞赛亚洲区域赛（焦作站） (2018-11-25)
- [赛季 2018] `official/icpc/icpc2018/icpc2018ecfinal.srk.json` — 2018-2019 ACM-ICPC, Asia East Continent Finals (2018-12-16)
- [赛季 2019] `official/icpc/icpc2019/icpc2019invitational-xi_an.srk.json` — 2019年ACM国际大学生程序设计竞赛全国邀请赛（陕西） (2019-05-19)
- [赛季 2019] `official/icpc/icpc2019/icpc2019nanjing.srk.json` — 第44届ICPC国际大学生程序设计竞赛亚洲区域赛（南京） (2019-10-27)
- [赛季 2019] `official/icpc/icpc2019/icpc2019xuzhou.srk.json` — 第44届ICPC国际大学生程序设计竞赛亚洲区域赛（徐州站） (2019-11-03)
- [赛季 2019] `official/icpc/icpc2019/icpc2019shenyang.srk.json` — 2019 ICPC Asia Shenyang Regional Contest (2019-11-17)
- [赛季 2019] `official/icpc/icpc2019/icpc2019shanghai.srk.json` — 第44届ICPC国际大学生程序设计竞赛亚洲区域赛（上海） (2019-11-24)
- [赛季 2019] `official/icpc/icpc2019/icpc2019ecfinal.srk.json` — 2019 ICPC Asia-East Continent Final (2019-12-15)
- [赛季 2021] `official/icpc/icpc2021/icpc2021invitational-xi_an.srk.json` — 2021年国际大学生程序设计竞赛全国邀请赛（陕西）（西北工业大学） (2021-06-06)
- [赛季 2022] `official/icpc/icpc2022/icpc2022ecfinal.srk.json` — The 2022 ICPC Asia East Continent Final Contest (2022-03-25)
- [赛季 2022] `official/icpc/icpc2022/icpc2022hongkong.srk.json` — 第 47 届国际大学生程序设计竞赛亚洲区域赛香港站 (2023-01-14)
- [赛季 2023] `official/icpc/icpc2023/icpc2023srni.srk.json` — The 2023 ICPC China Silk Road National Invitational Programming Contest (Ningxia (2023-06-04)
- [赛季 2023] `official/icpc/icpc2023/icpc2023macau.srk.json` — 第 48 屆 ICPC 東亞洲區域賽（澳門） (2023-11-19)
- [赛季 2024] `official/icpc/icpc2024/icpc2024srni.srk.json` — The 2024 ICPC China Silk Road National Invitational Programming Contest (Ningxia (2024-06-09)
- [赛季 2024] `official/icpc/icpc2024/icpc2024hongkong.srk.json` — 第 49 届 ICPC 国际大学生程序设计竞赛区域赛香港站 (2024-12-22)

</details>

<details><summary><b>2025+（2 个）</b></summary>

- [赛季 2025] `official/icpc/icpc2025/icpc2025invitational-xi_an.srk.json` — 2025 年 ICPC 国际大学生程序设计竞赛 全国邀请赛（陕西）（西北工业大学） (2025-05-04)
- [赛季 2025] `official/icpc/icpc2025/icpc2025srni.srk.json` — The 2025 ICPC China Silk Road National Invitational Programming Contest (Ningxia (2025-06-08)

</details>

### 省赛 (provincial)

<details><summary><b>pre-2025（18 个）</b></summary>

- [赛季 2012] `official/provincial/sd/sdcpc3rd.srk.json` — 2012年"浪潮杯"山东省第三届ACM大学生程序设计竞赛（山东理工大学） (2012-05-13)
- [赛季 2013] `official/provincial/sd/sdcpc4th.srk.json` — 2013年"浪潮杯"山东省第四届ACM大学生程序设计竞赛（中国石油大学(华东)） (2013-06-09)
- [赛季 2014] `official/provincial/sd/sdcpc5th.srk.json` — 2014年山东省第5届ACM大学生程序设计竞赛（哈尔滨工业大学(威海)） (2014-05-11)
- [赛季 2015] `official/provincial/sd/sdcpc6th.srk.json` — “浪潮杯”山东省第六届ACM大学生程序设计竞赛（山东科技大学） (2015-05-10)
- [赛季 2016] `official/provincial/sd/sdcpc7th.srk.json` — “浪潮杯”山东省第七届ACM大学生程序设计竞赛（山东师范大学） (2016-06-05)
- [赛季 2017] `official/provincial/sd/sdcpc8th.srk.json` — “浪潮杯”山东省第八届ACM大学生程序设计竞赛（青岛科技大学） (2017-05-07)
- [赛季 2018] `official/provincial/sd/sdcpc9th.srk.json` — “浪潮杯”第九届山东省ACM大学生程序设计竞赛（山东财经大学） (2018-06-06)
- [赛季 2018] `official/provincial/sd/sdcpc9th-rejudged.srk.json` — “浪潮杯”第九届山东省ACM大学生程序设计竞赛（山东财经大学）- 重判 (2018-06-06)
- [赛季 2019] `official/provincial/sd/sdcpc10th.srk.json` — “浪潮杯”第十届山东省大学生ACM程序设计竞赛（济南大学） (2019-05-12)
- [赛季 2019] `official/provincial/hn/hncpc15th.srk.json` — 2019年（第15届）“强智杯”湖南省大学生计算机程序设计竞赛（湖南师范大学） (2019-08-30)
- [赛季 2022] `official/provincial/sd/sdcpc12th.srk.json` — “山大地纬杯”第十二届山东省大学生程序设计竞赛（线上赛，山东大学） (2022-05-22)
- [赛季 2022] `official/provincial/ha/haccpc4th.srk.json` — 2022年河南省CCPC大学生程序设计竞赛（线上赛，郑州轻工业大学） (2022-10-02)
- [赛季 2022] `official/provincial/he/hecpc6th.srk.json` — HBCPC2022-第六届河北省大学生程序设计竞赛 (2022-10-22)
- [赛季 2023] `official/provincial/sc/sccpc15th.srk.json` — 第十五届四川省大学生程序设计竞赛（阿坝师范学院） (2023-06-04)
- [赛季 2024] `official/provincial/nm/nmcpc17th.srk.json` — “华讯杯”内蒙古自治区第十七届大学生程序设计竞赛 (2024-05-12)
- [赛季 2024] `official/provincial/jl/jlcpc17th.srk.json` — 2024年中国大学生程序设计竞赛全国邀请赛（长春）暨第十七届CCPC吉林省大学生程序设计竞赛 (2024-05-18)
- [赛季 2024] `official/provincial/northeast/northeastcpc18th.srk.json` — 2024年中国大学生程序设计竞赛全国邀请赛（东北）暨第十八届CCPC东北地区大学生程序设计竞赛 (2024-05-19)
- [赛季 2024] `official/provincial/gz/gzcpc2024.srk.json` — 第 7 届 ICPC 贵州省大学生程序设计竞赛 (2024-07-14)

</details>

<details><summary><b>2025+（24 个）</b></summary>

- [赛季 2025] `official/provincial/bj/bjcpc2025.srk.json` — 2025北京市大学生程序设计竞赛暨小米杯全国邀请赛 (2025-04-20)
- [赛季 2025] `official/provincial/cq/cqcpc13th.srk.json` — 重庆市第十三届大学生程序设计大赛 (2025-05-10)
- [赛季 2025] `official/provincial/hl/hlcpc20th.srk.json` — 第二十届黑龙江省大学生程序设计竞赛 (2025-05-11)
- [赛季 2025] `official/provincial/jx/jxcpc2025.srk.json` — 2025年icpc全国邀请赛（南昌）暨2025年（icpc）江西省大学生程序设计竞赛 - 正式赛 (2025-05-18)
- [赛季 2025] `official/provincial/northeast/northeastcpc19th.srk.json` — 2025 年 CCPC 全国邀请赛（东北）暨第十九届 CCPC 东北地区大学生程序设计竞赛 - 正式赛 (2025-05-25)
- [赛季 2025] `official/provincial/gd/gdcpc22nd.srk.json` — 2025 年（第二十二届）广东省大学生程序设计竞赛暨“汇丰科技（中国）”中国大学生程序设计竞赛邀请赛（广东）预赛 (2025-06-02)
- [赛季 2025] `official/provincial/ha/haccpc7th.srk.json` — 2025CCPC全国邀请赛（郑州）暨第七届河南省赛 (2025-06-02)
- [赛季 2025] `official/provincial/gz/gzcpc2025.srk.json` — 2025-2026 国际大学生程序设计竞赛贵州省赛 (2025-06-08)
- [赛季 2025] `official/provincial/fj/fjcpc12th.srk.json` — 第十二届福建省大学生程序设计竞赛暨2025年CCPC福建邀请赛 (2025-06-21)
- [赛季 2025] `official/provincial/nm/nmcpc18th.srk.json` — “华讯杯”内蒙古自治区第十八届大学生程序设计竞赛 (2025-06-22)
- [赛季 2025] `official/provincial/jx/jxccpc2nd.srk.json` — 2025 CCPC 全国邀请赛（南昌）暨第二届江西省赛 - 正式赛 (2025-09-13)
- [赛季 2026] `official/provincial/bj/bjcpc2026.srk.json` — 2026年北京市大学生程序设计竞赛 (2026-05-10)
- [赛季 2026] `official/provincial/ah/ahcpc2026preliminary.srk.json` — 2026年安徽省机器人大赛——算法设计赛道 初赛 (2026-05-10)
- [赛季 2026] `official/provincial/hl/hlcpc21st.srk.json` — 第二十一届黑龙江省大学生程序设计竞赛 (2026-05-10)
- [赛季 2026] `official/provincial/jx/jxcpc2026.srk.json` — 2026 年 ICPC 国际大学生程序设计竞赛全国邀请赛（南昌）暨江西省赛 (2026-05-17)
- [赛季 2026] `official/provincial/hb/hbcpc7th.srk.json` — 2026 年 ICPC 国际大学生程序设计竞赛全国邀请赛（武汉）暨湖北省赛 (2026-05-17)
- [赛季 2026] `official/provincial/gd/gdcpc23rd.srk.json` — 广东省第二十三届大学生程序设计竞赛 (2026-05-17)
- [赛季 2026] `official/provincial/he/hecpc10th.srk.json` — 2026年中国大学生程序设计竞赛全国邀请赛（秦皇岛）暨第十届河北省大学生程序设计竞赛-正式赛 (2026-05-24)
- [赛季 2026] `official/provincial/ah/ahcpc2026.srk.json` — 2026年安徽省机器人大赛——算法设计赛道 (2026-05-24)
- [赛季 2026] `official/provincial/fj/fjcpc13th.srk.json` — 第十三届福建省大学生程序设计竞赛 暨2026年CCPC全国邀请赛（福州） (2026-05-30)
- [赛季 2026] `official/provincial/nm/nmcpc19th.srk.json` — “绿盟杯”内蒙古自治区第十九届大学生程序设计竞赛 (2026-05-31)
- [赛季 2026] `official/provincial/gx/gxcpc9th.srk.json` — 第九届广西大学生程序设计大赛暨2026中国-东盟国际大学生程序设计大赛 (2026-05-31)
- [赛季 2026] `official/provincial/gz/gzcpc2026.srk.json` — 2026 CCPC 中国大学生程序设计竞赛全国邀请赛（贵州）暨贵州省赛 (2026-06-07)
- [赛季 2026] `official/provincial/cq/cqcpc14th.srk.json` — 重庆市第十四届大学生程序设计大赛 (2026-06-14)

</details>

