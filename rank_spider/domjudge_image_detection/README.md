# domjudge_image_detection

从 DOMjudge 榜单截图中提取数据并转换到 srk。

## 环境要求

- Python 3.7+

## 安装依赖

### 1. 创建并激活虚拟环境（推荐）

```bash
# 创建虚拟环境
python3 -m venv venv

# 激活虚拟环境
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate
```

### 2. 安装依赖包

```bash
pip install -r requirements.txt
```

## 使用方法

### Step 0. 准备榜单截图

需要准备完整榜单截图，如果图片不是完整的一张图，需要先无缝拼接成一张完整图片。

图片需要进行裁剪，要求如下：
- 左边界：从队伍图标右侧开始（不包含 RANK 和图标）
- 右边界：截止到最后一个题目列
- 上边界：从表头开始，不要包含网站导航栏、比赛标题等部分
- 下边界：截止到最后一个队伍的行，不要包含底部的数据统计和单元格图例

可以参考 `demo` 目录下的示例图片。

### Step 1. detect.py

执行脚本检测图片中的表格结构，识别表头和单元格边界。

```bash
python detect.py <图片路径> [选项]
```

**参数说明:**
- `<图片路径>`: 要处理的图片文件路径
- `--no-header`: 指定图片没有表头（暂不支持）

**示例:**
```bash
python detect.py ranklist.png
```

**输出:**
- `detection/detection.json`: 检测结果数据
- `detection/detection_result/`: 原始检测结果图片
- `detection/detection_result_optimized/`: 优化后的单元格图片

### Step 2. convert.py

对 Step 1 检测到的单元格图片进行识别，生成 CSV 和 JSON 格式结果。

```bash
python convert.py <检测结果目录> -o <转换结果输出目录>
```

**参数说明:**
- `<检测结果目录>`: 包含 detection 结果的目录路径
- `-o, --output`: 转换结果输出目录

**示例:**
```bash
python convert.py detection -o result
```

**输出:**
- `result/result.csv`: CSV 式的识别结果
- `result/result.json`: JSON 格式的识别结果
- `result/ocr_result/`: 每个单元格的 OCR 详细结果

### Step 3. srk 数据转换 (srk.py)

将 Step 2 得到的数据（仅读取 JSON 结果）转换为 srk。

建议在执行脚本前先对上一步的结果进行手动修正。注意事项：
- 对于有分组标记（每个组的第一个队伍）的，需要检查结果，把标记部分删除
- 主要检查每一行的队名、校名、解题数和时间这几列，是否出现文字识别不准或解题数/时间粘连。题目状态单元格一般不会有问题（数字和 `try/tries` 粘连的情况如 `1try` 不需要修复）

```bash
python srk.py <转换结果 JSON 文件路径> [选项]
```

**参数说明:**
- `<转换结果 JSON 文件路径>`: OCR 识别结果的 JSON 文件路径
- `-o, --output`: srk 输出文件路径
- `-d, --detection`: 表格检测结果目录路径，用于检测表头背景色

**示例:**
```bash
# 仅检查数据合法性
python srk.py result/result.json

# 检查数据合法性并输出 srk 到指定文件
python srk.py result/result.json -o out.srk.json

# 检查数据合法性并输出 srk 到指定文件（包含表头题目颜色）
python srk.py result/result.json -d detection -o out.srk.json
```

### Step 4. 手动完善 srk 数据

需要后续手动对照截图完善的数据：
- FB
- 是否打星（`official`）
- 正式和打星之外的其他分组（`markers`）
- 金银铜获奖配置（如有）

## 注意事项

1. 确保输入图片尽量清晰，表格线条完整
2. 处理大图片时可能需要较多内存
3. PaddleOCR 首次运行时会下载模型文件，需要网络连接
