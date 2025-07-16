#!/usr/bin/env python3
import argparse
import json
import sys
import cv2
import numpy as np
from collections import Counter
from pathlib import Path


def parse_args():
    """解析命令行参数"""
    parser = argparse.ArgumentParser(description='转换表格数据到 srk')
    parser.add_argument('input', help='输入 JSON 文件路径')
    parser.add_argument('-o', '--output', help='输出文件路径')
    parser.add_argument('-d', '--detection', help='detection目录路径，用于检测表头背景色')
    return parser.parse_args()


def is_empty_cell(cell):
    """检查单元格是否为空"""
    return len(cell) == 0 or (len(cell) == 1 and cell[0] == "")


def is_integer_string(s):
    """检查字符串是否可以转换为整数"""
    try:
        int(s)
        return True
    except (ValueError, TypeError):
        return False


def format_cell_content(cell):
    """格式化单元格内容用于显示"""
    if len(cell) == 0:
        return "[]"
    elif len(cell) == 1:
        return f'["{cell[0]}"]'
    else:
        items = [f'"{item}"' for item in cell]
        return f'[{", ".join(items)}]'


def check_header(header, warnings):
    """检查表头的正确性"""
    for i, cell in enumerate(header):
        # 检查1: 如果长度不是1，或里面的字符串是空串
        if len(cell) != 1:
            warnings.append(f"警告: header[{i}] 长度不是1，当前长度为 {len(cell)} - 内容: {format_cell_content(cell)}")
        elif cell[0] == "":
            warnings.append(f"警告: header[{i}] 内容为空串 - 内容: {format_cell_content(cell)}")


def check_body_row(row_idx, row, warnings):
    """检查表格主体中单行的正确性"""
    if len(row) < 2:
        warnings.append(f"警告: body[{row_idx}] 行长度不足2，当前长度为 {len(row)}")
        return
    
    # 检查2.1: 如果行中前两项单元格为空，打印警告
    for i in range(2):
        if is_empty_cell(row[i]):
            warnings.append(f"警告: body[{row_idx}][{i}] {i == 0 and 'NAME' or 'SCORE'} 单元格为空 - 内容: {format_cell_content(row[i])}，行: {format_cell_content(row)}")
    
    # 检查2.2: 如果 row[0] 数组的长度不是 2
    if len(row) > 0 and len(row[0]) > 0 and len(row[0]) != 2:
        warnings.append(f"警告: body[{row_idx}][0] NAME 单元格内数组长度不是2，当前长度为 {len(row[0])} - 内容: {format_cell_content(row[0])}")
    
    # 检查2.3: 如果 row[1] 数组的长度不是 2，或读取内容发现里面的每一项并不是可转为整数的字符串
    if len(row) > 1:
        if len(row[1]) > 0 and len(row[1]) != 2:
            warnings.append(f"警告: body[{row_idx}][1] SCORE 单元格内数组长度不是2，当前长度为 {len(row[1])} - 内容: {format_cell_content(row[1])}")
        else:
            for j, item in enumerate(row[1]):
                if not is_integer_string(item):
                    warnings.append(f"警告: body[{row_idx}][1][{j}] 不是可转换为整数的字符串: '{item}' - 内容: {format_cell_content(row[1])}")
    
    # 检查2.4: 遍历 row[2:]
    for i in range(2, len(row)):
        cell = row[i]
        
        # 2.4.1: 如果单元格为空，这是允许的，继续下一个
        if is_empty_cell(cell):
            continue
        
        # 2.4.2: 检查单元格内数组长度和最后一项是否以 try 或 tries 结尾
        if len(cell) == 1 or len(cell) == 2:
            last_item = cell[-1]
            if not (last_item.endswith('try') or last_item.endswith('tries')):
                warnings.append(f"警告: body[{row_idx}][{i}] 最后一项不以 'try' 或 'tries' 结尾: '{last_item}' - 内容: {format_cell_content(cell)}")
        elif len(cell) > 2:
            warnings.append(f"警告: body[{row_idx}][{i}] 数组长度大于2，当前长度为 {len(cell)} - 内容: {format_cell_content(cell)}")
        
        # 2.4.3: 如果单元格内数组长度为 2，则检查第一项（col[0]）
        if len(cell) == 2:
            first_item = cell[0]
            if not is_integer_string(first_item):
                warnings.append(f"警告: body[{row_idx}][{i}][0] 不是可转换为整数的字符串: '{first_item}' - 内容: {format_cell_content(cell)}")


def check_json_file(input_path, warnings):
    """检查JSON文件的正确性"""
    try:
        with open(input_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except FileNotFoundError:
        warnings.append(f"错误: 文件不存在: {input_path}")
        return False
    except json.JSONDecodeError as e:
        warnings.append(f"错误: JSON格式错误: {e}")
        return False
    except Exception as e:
        warnings.append(f"错误: 读取文件失败: {e}")
        return False
    
    # 检查数据结构
    if not isinstance(data, dict):
        warnings.append("错误: 根节点不是字典类型")
        return False
    
    if 'header' not in data or 'body' not in data:
        warnings.append("错误: 缺少 'header' 或 'body' 字段")
        return False
    
    header = data['header']
    body = data['body']
    
    if not isinstance(header, list):
        warnings.append("错误: 'header' 不是数组类型")
        return False
    
    if not isinstance(body, list):
        warnings.append("错误: 'body' 不是数组类型")
        return False
    
    # 检查表头
    check_header(header, warnings)
    
    # 检查表格主体
    for row_idx, row in enumerate(body):
        if not isinstance(row, list):
            warnings.append(f"错误: body[{row_idx}] 不是数组类型")
            continue
        check_body_row(row_idx, row, warnings)
    
    return True


def extract_tries_from_string(s):
    """从字符串中提取尝试次数，去除 'try' 或 'tries' 后缀"""
    s = s.strip()
    if s.endswith('tries'):
        return int(s[:-5])
    elif s.endswith('try'):
        return int(s[:-3])
    else:
        return int(s)


def convert_problems(header, detection_data=None, detection_dir=None):
    """转换header[2:]为problems数组"""
    problems = []
    for i in range(2, len(header)):
        if len(header[i]) > 0:
            problem = {
                "alias": header[i][0],
                "style": {
                    "backgroundColor": ""
                }
            }
            
            # 如果提供了detection数据，尝试检测背景色
            if detection_data and detection_dir:
                cell_index = i  # 转换为detection中的索引
                filename = get_header_cell_filename(detection_data, cell_index)
                if filename:
                    image_path = Path(detection_dir) / "detection_result_optimized" / filename
                    if image_path.exists():
                        background_color = detect_background_color(image_path)
                        if background_color:
                            problem["style"]["backgroundColor"] = background_color
                            print(f"检测到表头 {i} ({header[i][0]}, {filename}) 的背景色: {background_color}")
                        else:
                            print(f"表头 {i} ({header[i][0]}) 未检测到背景色或为白色")
                    else:
                        print(f"警告: 表头图片文件不存在: {image_path}")
            
            problems.append(problem)
    return problems


def convert_status(cell):
    """转换单个状态单元格"""
    if is_empty_cell(cell):
        return {"result": None}
    
    if len(cell) == 1:
        # 长度为1时，结果为"RJ"
        tries = extract_tries_from_string(cell[0])
        return {
            "result": "RJ",
            "tries": tries
        }
    
    elif len(cell) == 2:
        # 长度为2时，结果为"AC"
        time = int(cell[0])
        tries = extract_tries_from_string(cell[1])
        return {
            "result": "AC",
            "time": [time, "min"],
            "tries": tries
        }
    
    else:
        # 其他情况，返回null
        return {"result": None}


def convert_row(row):
    """转换单行数据"""
    if len(row) < 2:
        return None
    
    # 转换user信息
    user = {
        "id": f"{row[0][1]}_{row[0][0].replace(row[0][1] + '_', '')}",
        "name": row[0][0],
        "organization": row[0][1],
        "official": True
    }
    
    # 转换score信息
    score = {
        "value": int(row[1][0]),
        "time": [int(row[1][1]), "min"]
    }
    
    # 转换statuses信息
    statuses = []
    for i in range(2, len(row)):
        status = convert_status(row[i])
        statuses.append(status)
    
    return {
        "user": user,
        "score": score,
        "statuses": statuses
    }


def convert_data(input_data, detection_data=None, detection_dir=None):
    """转换输入数据为最终格式"""
    # 读取模板文件
    template_path = Path(__file__).parent / "template.srk.json"
    try:
        with open(template_path, 'r', encoding='utf-8') as f:
            template = json.load(f)
    except FileNotFoundError:
        raise FileNotFoundError(f"模板文件不存在: {template_path}")
    except json.JSONDecodeError as e:
        raise ValueError(f"模板文件JSON格式错误: {e}")
    
    # 转换problems
    template["problems"] = convert_problems(input_data["header"], detection_data, detection_dir)
    
    # 转换rows
    rows = []
    for row in input_data["body"]:
        converted_row = convert_row(row)
        if converted_row is not None:
            rows.append(converted_row)
    
    template["rows"] = rows
    
    return template


def is_white(pixel, threshold=240):
    """
    判断像素是否接近纯白
    :param pixel: RGB像素值
    : threshold: 白色的阈值
    :return: bool
    """
    r, g, b = pixel
    return r >= threshold and g >= threshold and b >= threshold


def is_white_region(pixels, threshold=0.9):
    """
    判断区域是否为白色区域
    :param pixels: RGB像素区域
    :param threshold: 判断为白色的像素比例阈值
    :return: bool
    """
    white_pixels = np.array([is_white(pixel) for pixel in pixels])
    return np.mean(white_pixels) > threshold


def detect_background_color(image_path, color_threshold=50, min_ratio=0.1):
    """
    检测图片中最主要的背景色
    :param image_path: 图片路径
    :param color_threshold: 颜色相似度阈值
    :param min_ratio: 最小占比阈值
    :return: RGB颜色字符串或None
    """
    try:
        # 读取图片
        img = cv2.imread(str(image_path))
        if img is None:
            return None
        
        # 转换为RGB
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        
        # 检查是否为白色区域
        if is_white_region(img.reshape(-1, 3)):
            return None
        
        # 统计所有像素的颜色
        pixels = img.reshape(-1, 3)
        color_counts = Counter(map(tuple, pixels))
        
        # 找到出现最多的颜色
        most_common_color, max_count = color_counts.most_common(1)[0]
        total_pixels = len(pixels)
        
        # 统计所有与most_common_color相似（包含完全一致）的颜色的总数量
        similar_color_count = 0
        for color, count in color_counts.items():
            # 计算颜色距离
            distance = np.sum(np.abs(np.array(color) - np.array(most_common_color)))
            if distance <= color_threshold:
                similar_color_count += count
        
        # 计算相似颜色的占比
        similar_ratio = similar_color_count / total_pixels
        
        # 如果占比小于阈值，返回None
        if similar_ratio < min_ratio:
            return None
        
        # 返回RGB格式的字符串
        return f"rgb({most_common_color[0]}, {most_common_color[1]}, {most_common_color[2]})"
        
    except Exception as e:
        print(f"检测背景色时出错 {image_path}: {e}")
        return None


def load_detection_data(detection_dir):
    """
    加载detection.json文件
    :param detection_dir: detection目录路径
    :return: detection数据字典
    """
    detection_path = Path(detection_dir) / "detection.json"
    try:
        with open(detection_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"加载detection.json失败: {e}")
        return None


def get_header_cell_filename(detection_data, cell_index):
    """
    根据detection数据获取表头单元格的文件名
    :param detection_data: detection数据
    :param cell_index: 单元格索引（从0开始）
    :return: 文件名或None
    """
    try:
        header_cells = detection_data.get("header_cells", [])
        if cell_index < len(header_cells):
            return header_cells[cell_index].get("filename")
        return None
    except Exception as e:
        print(f"获取表头单元格文件名失败: {e}")
        return None


def main():
    """主函数"""
    args = parse_args()
    
    input_path = Path(args.input)
    warnings = []
    
    # 检查输入文件
    if not input_path.exists():
        print(f"错误: 输入文件不存在: {input_path}")
        return 1
    
    # 执行检查
    success = check_json_file(input_path, warnings)
    
    # 输出检查结果
    if warnings:
        for warning in warnings:
            print(warning)
        print(f"\n字段合法性校验失败，总共发现 {len(warnings)} 个问题")
        return 1
    else:
        print("字段合法性校验通过，请确保已人工校对所有字符串和数值数据。")
    
    # 如果指定了输出文件，执行数据转换
    if args.output:
        try:
            # 读取输入数据
            with open(input_path, 'r', encoding='utf-8') as f:
                input_data = json.load(f)
            
            # 加载detection数据（如果指定了detection目录）
            detection_data = None
            if args.detection:
                detection_data = load_detection_data(args.detection)
                if detection_data:
                    print(f"已加载 detection 数据，开始检测表头背景色...")
                else:
                    print(f"警告: 无法加载 detection 数据，将跳过背景色检测")
            
            # 转换数据
            output_data = convert_data(input_data, detection_data, args.detection)
            
            # 保存到输出文件
            output_path = Path(args.output)
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(output_data, f, ensure_ascii=False, indent=2)
            
            print(f"数据转换完成，结果已保存到: {output_path}")
            print(f"请手动填充题目 FB、official、markers 和 series 奖牌配置数据。")
            
        except Exception as e:
            print(f"数据转换失败: {e}")
            return 1
    
    return 0


if __name__ == "__main__":
    exit(main()) 