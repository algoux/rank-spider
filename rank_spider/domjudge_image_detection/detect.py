#!/usr/bin/env python3
import argparse
import os
import json
import numpy as np
import cv2
from pathlib import Path
import time

def is_gray_or_black(pixel, threshold=20):
    """
    判断像素是否接近纯灰或纯黑
    :param pixel: RGB像素值
    :param threshold: 允许的RGB通道差异阈值
    :return: bool
    """
    r, g, b = pixel
    # 检查RGB通道是否接近（灰色）
    is_gray = r < 235 and g < 235 and b < 235 and abs(r - g) < threshold and abs(g - b) < threshold and abs(r - b) < threshold
    # 检查是否接近黑色
    is_dark = r < 70 and g < 70 and b < 70
    return is_gray or is_dark

def is_white(pixel, threshold=240):
    """
    判断像素是否接近纯白
    :param pixel: RGB像素值
    :param threshold: 白色的阈值
    :return: bool
    """
    r, g, b = pixel
    return r >= threshold and g >= threshold and b >= threshold

def is_white_line(pixels, threshold=0.95):
    """
    判断一行/列像素是否都是白色
    :param pixels: RGB像素行/列
    :param threshold: 判断为白色的像素比例阈值
    :return: bool
    """
    white_pixels = np.array([is_white(pixel) for pixel in pixels])
    return np.mean(white_pixels) > threshold

def is_separator_line(pixels, threshold=0.8):
    """
    判断一行像素是否为分隔线
    :param pixels: RGB像素行
    :param threshold: 判断为分隔线的像素比例阈值
    :return: bool
    """
    # 统计每个像素是否为灰色或黑色
    gray_or_black_pixels = np.array([is_gray_or_black(pixel) for pixel in pixels])
    return np.mean(gray_or_black_pixels) > threshold

def is_white_region(pixels, threshold=0.9):
    """
    判断区域是否为白色区域
    :param pixels: RGB像素区域
    :param threshold: 判断为白色的像素比例阈值
    :return: bool
    """
    white_pixels = np.array([is_white(pixel) for pixel in pixels])
    return np.mean(white_pixels) > threshold

def merge_continuous_ranges(separator_lines):
    """
    合并连续的分隔线行号
    :param separator_lines: 分隔线行号列表
    :return: 合并后的范围列表 [(start, end), ...]
    """
    if not separator_lines:
        return []
    
    # 排序行号
    lines = sorted(separator_lines)
    ranges = []
    start = lines[0]
    prev = lines[0]
    
    for curr in lines[1:]:
        if curr != prev + 1:
            ranges.append((start, prev))
            start = curr
        prev = curr
    
    ranges.append((start, prev))
    return ranges

def find_table_bounds(img):
    """
    找到表格的实际有效范围
    :param img: RGB图像
    :return: (x0, y0, x1, y1) 表格的有效范围
    """
    print("正在检测表格边界...")
    height, width = img.shape[:2]
    print(f"图片尺寸: {width} x {height}")
    
    # 从上往下扫描
    y0 = 0
    while y0 < height and is_white_line(img[y0:y0+1, :].reshape(-1, 3)):
        y0 += 1
    
    # 从下往上扫描
    y1 = height - 1
    while y1 > y0 and is_white_line(img[y1:y1+1, :].reshape(-1, 3)):
        y1 -= 1
    y1 += 1  # 包含最后一行
    
    # 从左往右扫描
    x0 = 0
    while x0 < width and is_white_line(img[:, x0:x0+1].reshape(-1, 3)):
        x0 += 1
    
    # 从右往左扫描
    x1 = width - 1
    while x1 > x0 and is_white_line(img[:, x1:x1+1].reshape(-1, 3)):
        x1 -= 1
    x1 += 1  # 包含最后一列
    
    print(f"表格边界检测完成: ({x0}, {y0}) -> ({x1}, {y1})")
    return x0, y0, x1, y1

def detect_table_regions(image_path, no_header=False):
    """
    检测表格区域
    :param image_path: 图片路径
    :param no_header: 是否没有表头
    :return: dict 包含检测到的区域信息
    """
    if no_header:
        raise ValueError("暂不支持无表头的情况")
    
    print(f"开始处理图片: {image_path}")
    
    # 读取图片
    print("正在读取图片...")
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError(f"无法读取图片: {image_path}")
    
    # 转换为RGB（OpenCV默认是BGR）
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    
    # 找到表格的实际有效范围
    x0, y0, x1, y1 = find_table_bounds(img)
    
    # 检测水平分隔线
    print("正在检测水平分隔线...")
    separator_lines = []
    total_rows = y1 - y0
    for i, y in enumerate(range(y0, y1)):
        if i % 100 == 0:  # 每100行显示一次进度
            print(f"  进度: {i}/{total_rows} ({i/total_rows*100:.1f}%)")
        line = img[y:y+1, x0:x1].reshape(-1, 3)
        if is_separator_line(line):
            separator_lines.append(y)
    
    print(f"检测到 {len(separator_lines)} 条水平分隔线")
    
    # 合并连续的分隔线
    horizontal_separators = merge_continuous_ranges(separator_lines)
    print(f"合并后得到 {len(horizontal_separators)} 个水平分隔区域")
    
    # 确定表头区域
    header_y0 = y0
    header_y1 = y1
    
    # 找到第一条分隔线
    if horizontal_separators:
        first_sep_start, first_sep_end = horizontal_separators[0]
        # 检查分隔线上方是否为白色区域
        if is_white_region(img[y0:first_sep_start, x0:x1].reshape(-1, 3)):
            header_y0 = first_sep_end + 1
        else:
            header_y1 = first_sep_start
    
    print(f"表头区域: y0={header_y0}, y1={header_y1}")
    
    # 在表头区域内检测垂直分隔线
    print("正在检测垂直分隔线...")
    vertical_separator_lines = []
    total_cols = x1 - x0
    for i, x in enumerate(range(x0, x1)):
        if i % 50 == 0:  # 每50列显示一次进度
            print(f"  进度: {i}/{total_cols} ({i/total_cols*100:.1f}%)")
        line = img[header_y0:header_y1, x:x+1].reshape(-1, 3)
        if is_separator_line(line):
            vertical_separator_lines.append(x)
    
    print(f"检测到 {len(vertical_separator_lines)} 条垂直分隔线")
    
    # 合并垂直分隔线
    vertical_separators = merge_continuous_ranges(vertical_separator_lines)
    print(f"合并后得到 {len(vertical_separators)} 个垂直分隔区域")
    
    # 确定表头单元格区域
    print("正在确定表头单元格...")
    header_cells = []
    
    # 处理垂直分隔线之间的单元格
    if vertical_separators:
        # 添加第一个单元格（从表格左边缘到第一条分隔线）
        if vertical_separators[0][0] > x0:
            header_cells.append({
                'x0': x0,
                'x1': vertical_separators[0][0],
                'y0': header_y0,
                'y1': header_y1
            })
        
        # 添加分隔线之间的单元格
        for i in range(len(vertical_separators) - 1):
            header_cells.append({
                'x0': vertical_separators[i][1] + 1,
                'x1': vertical_separators[i + 1][0],
                'y0': header_y0,
                'y1': header_y1
            })
        
        # 添加最后一个单元格（从最后一条分隔线到表格右边缘）
        # 只有当剩余空间大于阈值时才添加
        if vertical_separators[-1][1] < x1 - 1:
            last_cell_width = x1 - (vertical_separators[-1][1] + 1)
            if last_cell_width > 10:  # 宽度阈值
                header_cells.append({
                    'x0': vertical_separators[-1][1] + 1,
                    'x1': x1,
                    'y0': header_y0,
                    'y1': header_y1
                })
    else:
        # 如果没有垂直分隔线，整个表头区域就是一个单元格
        header_cells.append({
            'x0': x0,
            'x1': x1,
            'y0': header_y0,
            'y1': header_y1
        })
    
    print(f"表头单元格数量: {len(header_cells)}")
    
    # 处理表格body部分
    print("正在处理表格主体部分...")
    body_rows = []
    
    if horizontal_separators:
        # 确定body的起始位置
        # 找到第一个起始位置大于等于 header_y1 的分隔线
        body_start_separator = None
        for sep in horizontal_separators:
            if sep[0] >= header_y1:
                body_start_separator = sep
                break
        
        if body_start_separator:
            body_start_y = body_start_separator[1] + 1
        else:
            # 如果没有找到合适的分隔线，body从header_y1开始
            body_start_y = header_y1
        
        # 确定body的结束位置
        body_end_y = y1
        if len(horizontal_separators) > 1:
            last_sep_y = horizontal_separators[-1][0]
            # 如果最后一条分隔线距离底部大于40像素，则认为底部没有分隔线
            if y1 - last_sep_y > 40:
                body_end_y = y1
            else:
                body_end_y = last_sep_y
        
        print(f"表格主体区域: y0={body_start_y}, y1={body_end_y}")
        
        # 在body范围内按分隔线切割行
        body_separators = [sep for sep in horizontal_separators if sep[0] >= body_start_y and sep[0] < body_end_y]
        
        if body_separators:
            # 处理第一行（从body开始到第一条分隔线）
            if body_separators[0][0] > body_start_y:
                row_y0 = body_start_y
                row_y1 = body_separators[0][0]
                
                # 按表头确定的x范围切割单元格
                row_cells = []
                for i, header_cell in enumerate(header_cells):
                    row_cells.append({
                        'x0': header_cell['x0'],
                        'x1': header_cell['x1'],
                        'y0': row_y0,
                        'y1': row_y1,
                        'row': 0,
                        'col': i
                    })
                
                body_rows.append({
                    'y0': row_y0,
                    'y1': row_y1,
                    'cells': row_cells
                })
            
            # 处理中间的行
            for row_idx in range(len(body_separators) - 1):
                row_y0 = body_separators[row_idx][1] + 1
                row_y1 = body_separators[row_idx + 1][0]
                
                # 按表头确定的x范围切割单元格
                row_cells = []
                for i, header_cell in enumerate(header_cells):
                    row_cells.append({
                        'x0': header_cell['x0'],
                        'x1': header_cell['x1'],
                        'y0': row_y0,
                        'y1': row_y1,
                        'row': row_idx + 1,
                        'col': i
                    })
                
                body_rows.append({
                    'y0': row_y0,
                    'y1': row_y1,
                    'cells': row_cells
                })
            
            # 处理最后一行（从最后一条分隔线到body结束）
            last_sep_y = body_separators[-1][1] + 1
            if last_sep_y < body_end_y:
                row_y0 = last_sep_y
                row_y1 = body_end_y
                
                # 按表头确定的x范围切割单元格
                row_cells = []
                for i, header_cell in enumerate(header_cells):
                    row_cells.append({
                        'x0': header_cell['x0'],
                        'x1': header_cell['x1'],
                        'y0': row_y0,
                        'y1': row_y1,
                        'row': len(body_separators),
                        'col': i
                    })
                
                body_rows.append({
                    'y0': row_y0,
                    'y1': row_y1,
                    'cells': row_cells
                })
        else:
            # 如果没有body分隔线，整个body区域就是一行
            row_cells = []
            for i, header_cell in enumerate(header_cells):
                row_cells.append({
                    'x0': header_cell['x0'],
                    'x1': header_cell['x1'],
                    'y0': body_start_y,
                    'y1': body_end_y,
                    'row': 0,
                    'col': i
                })
            
            body_rows.append({
                'y0': body_start_y,
                'y1': body_end_y,
                'cells': row_cells
            })
    
    print(f"表格主体行数: {len(body_rows)}")
    total_cells = sum(len(row['cells']) for row in body_rows)
    print(f"表格主体单元格总数: {total_cells}")
    
    return {
        'table_bounds': {
            'x0': x0,
            'y0': y0,
            'x1': x1,
            'y1': y1
        },
        'header': {
            'y0': header_y0,
            'y1': header_y1
        },
        'header_cells': header_cells,
        'body': {
            'rows': body_rows
        }
    }

def optimize_cell_image(img, cell_bounds, white_threshold=0.95):
    """
    优化单元格图片
    :param img: 原始图片
    :param cell_bounds: 单元格边界 {'x0': int, 'y0': int, 'x1': int, 'y1': int}
    :param white_threshold: 白色区域判断阈值
    :return: (optimized_img, optimized_bounds)
    """
    # 提取单元格区域
    cell_img = img[cell_bounds['y0']:cell_bounds['y1'], cell_bounds['x0']:cell_bounds['x1']]
    
    # 检查整个单元格是否都是白色区域
    if is_white_region(cell_img.reshape(-1, 3), white_threshold):
        # 如果都是白色，返回原图片和新的边界字典
        return cell_img, {
            'x0': cell_bounds['x0'],
            'y0': cell_bounds['y0'],
            'x1': cell_bounds['x1'],
            'y1': cell_bounds['y1']
        }
    
    # 否则进行白边裁切
    height, width = cell_img.shape[:2]
    
    # 从上往下扫描，找到第一个非白色行
    top = 0
    while top < height and is_white_line(cell_img[top:top+1, :].reshape(-1, 3)):
        top += 1
    
    # 从下往上扫描，找到第一个非白色行
    bottom = height - 1
    while bottom > top and is_white_line(cell_img[bottom:bottom+1, :].reshape(-1, 3)):
        bottom -= 1
    bottom += 1  # 包含最后一行
    
    # 从左往右扫描，找到第一个非白色列
    left = 0
    while left < width and is_white_line(cell_img[:, left:left+1].reshape(-1, 3)):
        left += 1
    
    # 从右往左扫描，找到第一个非白色列
    right = width - 1
    while right > left and is_white_line(cell_img[:, right:right+1].reshape(-1, 3)):
        right -= 1
    right += 1  # 包含最后一列
    
    # 裁切后的图片
    optimized_img = cell_img[top:bottom, left:right]
    
    # 构造新的边界信息字典
    optimized_bounds = {
        'x0': cell_bounds['x0'] + left,
        'y0': cell_bounds['y0'] + top,
        'x1': cell_bounds['x0'] + right,
        'y1': cell_bounds['y0'] + bottom
    }
    
    return optimized_img, optimized_bounds

def save_detection_results(image_path, regions, output_dir):
    """
    保存检测结果和裁剪的图片
    :param image_path: 原始图片路径
    :param regions: 检测到的区域信息
    :param output_dir: 输出目录
    """
    print(f"正在保存检测结果到: {output_dir}")
    
    # 删除旧的输出目录（如果存在）
    output_path = Path(output_dir)
    if output_path.exists():
        import shutil
        shutil.rmtree(output_path)
    
    # 创建输出目录
    output_path.mkdir(parents=True, exist_ok=True)
    
    # 读取原始图片
    img = cv2.imread(image_path)
    
    # 创建检测结果目录
    detection_dir = output_path / 'detection_result'
    detection_dir.mkdir(parents=True, exist_ok=True)
    
    # 创建优化后的检测结果目录
    optimized_dir = output_path / 'detection_result_optimized'
    optimized_dir.mkdir(parents=True, exist_ok=True)
    
    # 保存表格有效范围
    print("保存表格边界图片...")
    bounds = regions['table_bounds']
    table_img = img[bounds['y0']:bounds['y1'], bounds['x0']:bounds['x1']]
    cv2.imwrite(str(detection_dir / 'table_bounds.png'), table_img, [cv2.IMWRITE_PNG_COMPRESSION, 0])
    
    # 保存表头区域
    print("保存表头区域图片...")
    header = regions['header']
    header_img = img[header['y0']:header['y1'], bounds['x0']:bounds['x1']]
    cv2.imwrite(str(detection_dir / 'header.png'), header_img, [cv2.IMWRITE_PNG_COMPRESSION, 0])
    
    # 保存表头单元格（使用新的命名规则）
    print("保存表头单元格...")
    for i, cell in enumerate(regions['header_cells']):
        # 保存原始单元格
        cell_img = img[cell['y0']:cell['y1'], cell['x0']:cell['x1']]
        cv2.imwrite(str(detection_dir / f'thead_cell_{i}.png'), cell_img, [cv2.IMWRITE_PNG_COMPRESSION, 0])
        
        # 优化并保存单元格
        optimized_img, optimized_bounds = optimize_cell_image(img, cell)
        filename = f'thead_cell_{i}.png'
        cv2.imwrite(str(optimized_dir / filename), optimized_img, [cv2.IMWRITE_PNG_COMPRESSION, 0])
        
        # 添加文件名到单元格信息
        cell['filename'] = filename
        cell['optimized_bounds'] = optimized_bounds
    
    print(f"表头单元格保存完成: {len(regions['header_cells'])} 个")
    
    # 保存body行和单元格
    if 'body' in regions and 'rows' in regions['body']:
        print("保存表格主体...")
        total_rows = len(regions['body']['rows'])
        total_cells = sum(len(row['cells']) for row in regions['body']['rows'])
        
        for row_idx, row in enumerate(regions['body']['rows']):
            if row_idx % 10 == 0:  # 每10行显示一次进度
                print(f"  处理行: {row_idx + 1}/{total_rows}")
            
            # 保存行图片
            row_img = img[row['y0']:row['y1'], bounds['x0']:bounds['x1']]
            cv2.imwrite(str(detection_dir / f'tbody_row_{row_idx}.png'), row_img, [cv2.IMWRITE_PNG_COMPRESSION, 0])
            
            # 保存行中的每个单元格
            for cell in row['cells']:
                # 保存原始单元格
                cell_img = img[cell['y0']:cell['y1'], cell['x0']:cell['x1']]
                cv2.imwrite(str(detection_dir / f'tbody_cell_{cell["row"]}_{cell["col"]}.png'), cell_img, [cv2.IMWRITE_PNG_COMPRESSION, 0])
                
                # 优化并保存单元格
                optimized_img, optimized_bounds = optimize_cell_image(img, cell)
                filename = f'tbody_cell_{cell["row"]}_{cell["col"]}.png'
                cv2.imwrite(str(optimized_dir / filename), optimized_img, [cv2.IMWRITE_PNG_COMPRESSION, 0])
                
                # 添加文件名到单元格信息
                cell['filename'] = filename
                cell['optimized_bounds'] = optimized_bounds
        
        print(f"表格主体保存完成: {total_rows} 行, {total_cells} 个单元格")
    
    # 保存检测结果
    print("保存检测结果JSON文件...")
    with open(output_path / 'detection.json', 'w', encoding='utf-8') as f:
        json.dump(regions, f, indent=2, ensure_ascii=False)
    
    print("所有文件保存完成！")

def parse_args():
    parser = argparse.ArgumentParser(
        description='处理图片并生成表格检测数据',
        formatter_class=argparse.ArgumentDefaultsHelpFormatter
    )
    
    parser.add_argument(
        'image_path',
        type=str,
        help='输入图片的路径'
    )
    
    parser.add_argument(
        '--no_header',
        action='store_true',
        help='指定表格是否没有表头，默认为False'
    )
    
    parser.add_argument(
        '-o', '--output',
        type=str,
        default='detection',
        help='指定输出目录，默认为当前目录下的 detection 目录'
    )
    
    args = parser.parse_args()
    
    # 验证输入图片路径是否存在
    if not os.path.exists(args.image_path):
        parser.error(f"输入图片路径 '{args.image_path}' 不存在")
    
    # 确保输出目录存在
    output_path = Path(args.output)
    output_path.mkdir(parents=True, exist_ok=True)
    
    return args

def main():
    start_time = time.time()
    args = parse_args()
    
    print("=" * 50)
    print("表格检测处理开始")
    print("=" * 50)
    
    # 检测表格区域
    print("\n步骤 1/2: 检测表格区域")
    regions = detect_table_regions(args.image_path, args.no_header)
    
    # 保存检测结果
    print("\n步骤 2/2: 保存检测结果")
    save_detection_results(args.image_path, regions, args.output)
    
    print("\n" + "=" * 50)
    print(f"处理完成！检测结果已保存到 {args.output} 目录")
    print("=" * 50)
    
    # ===== 统计概要 =====
    header_cells = regions.get('header_cells', [])
    body_rows = regions.get('body', {}).get('rows', [])
    total_cells = len(header_cells) + sum(len(row.get('cells', [])) for row in body_rows)
    elapsed_time = time.time() - start_time
    print("\n" + "="*50)
    print("统计概要")
    print("="*50)
    header_cols = len(header_cells)
    body_rows_count = len(body_rows)
    print(f"表格尺寸: {body_rows_count}×{header_cols}")
    print(f"总检测单元格数: {total_cells}")
    minutes = int(elapsed_time // 60)
    seconds = elapsed_time % 60
    if minutes > 0:
        print(f"总耗时: {minutes}:{seconds:.3f}")
    else:
        print(f"总耗时: {seconds:.3f}")
    print("="*50)
    
    return 0

if __name__ == '__main__':
    exit(main())
