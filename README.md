# 榜单爬虫
> 目前支持两个平台的数据爬取，pta 和 sdutoj

## 使用方式
> 根据不同的平台数据导入方式略有不同

### pta 平台
需要提供包含用户信息的名单，启动 database.py 爬虫将数据导入，在比赛开始时执行 spider.py 即可

**注意**
1. 爬虫仅支持 python3（开发使用版本 python 3.8.7）
2. 用户信息格式可看 ccpc_template.csv 文件。Excel 可以直接使用软件选择另存为 csv 文件即可，csv 文件也可用 Excel 软件打开
3. 修改配置时，需将 config.tempalte.yml 复制重命名为 config.yml 使用
4. 爬虫具体配置在 config.template.yml 中有详细解释

### sdutoj 平台
仅需提供对应的比赛 id，同时提供管理员 cookie，所有数据即可从网站抓取

**注意**
1. 爬虫仅支持 python3（开发使用版本 python 3.8.7）
2. 修改配置时，需将 config.tempalte.yaml 复制重命名为 config.yaml 使用
3. 爬虫具体配置在 config.template.yaml 中有详细解释
4. 针对第 14 届校赛的一个整理总结文档：[SDUT 第 14 届校赛总结](/sdutoj/SDUTACM%20%E6%A0%A1%E8%B5%9B%E6%80%BB%E7%BB%93.md)
