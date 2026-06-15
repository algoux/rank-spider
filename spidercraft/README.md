# spidercraft

爬取榜单数据并生成 srk，支持多种数据源。

## 环境准备

- Node.js 18+（推荐使用 [fnm](https://github.com/Schniz/fnm) 并开启 `--use-on-cd` 来自动切换 Node 环境）

## 安装依赖

```bash
npm i
```

## 使用

查看 `src/programs/` 下的 CLI 脚本来使用。通常根据文件名即可判断用途，也可以添加 `-h` 参数了解使用方法。

示例：

```bash
./src/programs/cf-gym.ts -h
./src/programs/cf-gym.ts 102056
```

### XCPCIO

`xcpcio.ts` 支持直接输入 `board.xcpcio.com` 的完整榜单 URL，脚本会自动提取 path 并抓取对应的 `config.json`、`team.json`、`run.json` 等数据。

```bash
npm run xcpcio -- https://board.xcpcio.com/ccpc/12th/guizhou-invitational -o out.srk.json
```

也可以继续传入 path：

```bash
npm run xcpcio -- /ccpc/12th/guizhou-invitational -o out.srk.json
```

参数说明：

- `<contest-url-or-path>`：XCPCIO 榜单完整 URL 或 path。完整 URL 会自动提取 path，例如 `https://board.xcpcio.com/ccpc/12th/guizhou-invitational` 会按 `/ccpc/12th/guizhou-invitational` 抓取。
- `-o, --output <file>`：输出 SRK JSON 的路径。省略时按 Python 版批量脚本规则自动生成文件名：
  - `/icpc/<year>/<name>` -> `icpc/icpc<year><name>.srk.json`
  - `/ccpc/<series>/<name>` -> `ccpc/ccpc<series><name>.srk.json`
  - `/provincial-contest/<year>/<name>` -> `province/ccpc<year><name>.srk.json`
- `--no-download-banner`：只生成 SRK JSON，不下载 banner。

省略 `-o` 时：

```bash
npm run xcpcio -- https://board.xcpcio.com/ccpc/12th/guizhou-invitational
```

会输出到：

```text
ccpc/ccpc12thguizhou-invitational.srk.json
```

默认会按 Python 版 `rank_spider/xcpc.py` 的单次爬虫逻辑下载 banner 资源；如只想生成 SRK JSON，可以加上：

```bash
npm run xcpcio -- https://board.xcpcio.com/ccpc/12th/guizhou-invitational -o out.srk.json --no-download-banner
```

banner 保存位置同 Python 版单次逻辑：`images/<输出文件名去掉 .srk.json>/assets/banner.<ext>`。
