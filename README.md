# rank-spider

srk 爬虫转换脚本。

目前分为两个部分，请查看对应目录下的 README：
- `rank_spider/`：传统 Python 脚本
- `spidercraft/`：（新）支持多种数据源的 Node.js 脚本

## XCPCIO MCP Agent Tool

`rank_spider/xcpc.py` 的单场榜单生成能力可以作为本地 MCP stdio server 暴露给支持 MCP 的 Agent 调用。

### 安装依赖

```bash
pip install requests mcp
```

### 启动 MCP server

在仓库根目录运行：

```bash
python -m rank_spider.tools.xcpc_mcp_server
```

### 暴露的 tool

`generate_xcpc_rank`

参数：

- `contest_path`：XCPCIO 榜单路径，例如 `/provincial-contest/2026/sichuan`
- `output_path`：输出 SRK JSON 路径，相对于当前工作目录解析，例如 `temp/sichuan.srk.json`
- `download_banner`：是否下载图片资源到 `assets/`，默认 `true`

返回：

- `ok`
- `output_path`
- `contest_name`
- `contest_url`
- `unknown_statuses`
- `warnings`
- `error`

### Agent 配置示例

```json
{
  "mcpServers": {
    "rank-spider-xcpc": {
      "command": "python",
      "args": ["-m", "rank_spider.tools.xcpc_mcp_server"],
      "cwd": "/path/to/rank-spider"
    }
  }
}
```
