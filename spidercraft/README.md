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
