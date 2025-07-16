#!/usr/bin/env python3
import argparse
import os
import json
import csv
import shutil
import time
from pathlib import Path
from paddleocr import PaddleOCR


def parse_args():
    """解析命令行参数"""
    parser = argparse.ArgumentParser(description='表格图片经检测结果 OCR 识别')
    parser.add_argument('input', help='输入数据目录路径')
    parser.add_argument('-o', '--output', required=True, help='输出目录路径')
    return parser.parse_args()


def init_paddleocr():
    """初始化PaddleOCR实例"""
    return PaddleOCR(
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        enable_mkldnn=False
    )


def process_cell_image(ocr, image_path, output_dir, filename):
    """
    处理单个单元格图片的OCR识别
    
    Args:
        ocr: PaddleOCR实例
        image_path: 图片路径
        output_dir: 输出目录
        filename: 文件名（用于创建子目录）
    
    Returns:
        tuple: (识别出的文本字符串, 原始rec_texts数组)
    """
    # 创建输出子目录
    filename_without_ext = Path(filename).stem
    cell_output_dir = Path(output_dir) / "ocr_result" / filename_without_ext
    cell_output_dir.mkdir(parents=True, exist_ok=True)
    
    # 执行OCR识别
    result = ocr.predict(input=str(image_path))
    
    # 保存调试信息
    for res in result:
        res.save_to_img(str(cell_output_dir))
        res.save_to_json(str(cell_output_dir))
    
    # 提取识别文本
    rec_texts = []
    if result and len(result) > 0:
        # 从保存的JSON文件中读取结果
        json_file = cell_output_dir / f"{filename_without_ext}_res.json"
        if json_file.exists():
            try:
                with open(json_file, 'r', encoding='utf-8') as f:
                    json_data = json.load(f)
                    rec_texts = json_data.get('rec_texts', [])
            except Exception as e:
                print(f"警告: 无法读取JSON文件 {json_file}: {e}")
    
    # 返回拼接的文本字符串和原始rec_texts数组
    text_string = '\\n'.join(rec_texts) if rec_texts else ""
    return text_string, rec_texts


def process_cells(ocr, input_dir, output_dir, cells, cell_type="单元格"):
    """
    处理单元格列表的OCR识别
    
    Args:
        ocr: PaddleOCR实例
        input_dir: 输入目录
        output_dir: 输出目录
        cells: 单元格列表
        cell_type: 单元格类型描述（用于日志输出）
    
    Returns:
        tuple: (识别出的文本列表, 原始rec_texts数组列表)
    """
    texts = []
    rec_texts_list = []
    
    for cell in cells:
        filename = cell.get('filename', '')
        if not filename:
            continue
            
        # 构建图片路径（统一从detection_result_optimized读取）
        image_path = Path(input_dir) / "detection_result_optimized" / filename
        
        if not image_path.exists():
            print(f"警告: 图片文件不存在: {image_path}")
            texts.append("")
            rec_texts_list.append([])
            continue
        
        # 处理单元格图片
        text, rec_texts = process_cell_image(ocr, image_path, output_dir, filename)
        texts.append(text)
        rec_texts_list.append(rec_texts)
        print(f"处理{cell_type} {filename}: {text}")
    
    return texts, rec_texts_list


def save_to_csv(header_texts, table_data, output_path):
    """
    保存结果到CSV文件
    
    Args:
        header_texts: 表头文本列表
        table_data: 表格数据行列表
        output_path: 输出CSV文件路径
    """
    with open(output_path, 'w', newline='', encoding='utf-8') as csvfile:
        writer = csv.writer(csvfile)
        
        # 写入表头
        if header_texts:
            writer.writerow(header_texts)
        
        # 写入数据行
        for row in table_data:
            writer.writerow(row)
    
    print(f"CSV文件已保存到: {output_path}")


def save_to_json(header_rec_texts, body_rec_texts, output_path):
    """
    保存结果到JSON文件
    
    Args:
        header_rec_texts: 表头rec_texts数组列表
        body_rec_texts: 表格主体rec_texts数组列表（二维数组）
        output_path: 输出JSON文件路径
    """
    result = {
        "header": header_rec_texts,
        "body": body_rec_texts
    }
    
    with open(output_path, 'w', encoding='utf-8') as jsonfile:
        json.dump(result, jsonfile, ensure_ascii=False, indent=2)
    
    print(f"JSON文件已保存到: {output_path}")


def print_statistics(header_cells, body_rows, total_cells, elapsed_time):
    """
    打印统计信息概要
    
    Args:
        header_cells: 表头单元格列表
        body_rows: 表格主体行列表
        total_cells: 总识别单元格数
        elapsed_time: 总耗时（秒）
    """
    print("\n" + "="*50)
    print("统计概要")
    print("="*50)
    
    # 表格尺寸
    header_cols = len(header_cells)
    body_rows_count = len(body_rows)
    print(f"表格尺寸: {body_rows_count}×{header_cols}")
    
    # 总单元格数
    print(f"总识别单元格数: {total_cells}")
    
    # 总耗时
    minutes = int(elapsed_time // 60)
    seconds = elapsed_time % 60
    if minutes > 0:
        print(f"总耗时: {minutes}:{seconds:.3f}")
    else:
        print(f"总耗时: {seconds:.3f}")
    
    print("="*50)


def main():
    """主函数"""
    start_time = time.time()
    
    args = parse_args()
    
    # 检查输入目录
    input_dir = Path(args.input)
    if not input_dir.exists():
        print(f"错误: 输入目录不存在: {input_dir}")
        return 1
    
    # 检查detection.json文件
    detection_json_path = input_dir / "detection.json"
    if not detection_json_path.exists():
        print(f"错误: detection.json文件不存在: {detection_json_path}")
        return 1
    
    # 创建输出目录（如果存在则先删除）
    output_dir = Path(args.output)
    if output_dir.exists():
        print(f"删除已存在的输出目录: {output_dir}")
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # 读取detection.json
    try:
        with open(detection_json_path, 'r', encoding='utf-8') as f:
            detection_data = json.load(f)
    except Exception as e:
        print(f"错误: 无法读取detection.json文件: {e}")
        return 1
    
    # 初始化PaddleOCR
    print("初始化PaddleOCR...")
    ocr = init_paddleocr()
    
    # 处理表头
    print("处理表头单元格...")
    header_cells = detection_data.get('header_cells', [])
    header_texts, header_rec_texts = process_cells(ocr, input_dir, output_dir, header_cells, "表头单元格")
    
    # 处理表格主体
    print("处理表格主体单元格...")
    body = detection_data.get('body', {})
    body_rows = body.get('rows', [])
    table_data = []
    body_rec_texts = []
    
    for row_idx, row in enumerate(body_rows):
        cells = row.get('cells', [])
        row_texts, row_rec_texts = process_cells(ocr, input_dir, output_dir, cells, "主体单元格")
        if row_texts:  # 只添加非空行
            table_data.append(row_texts)
            body_rec_texts.append(row_rec_texts)
    
    # 保存CSV结果
    csv_output_path = output_dir / "result.csv"
    save_to_csv(header_texts, table_data, csv_output_path)
    
    # 保存JSON结果
    json_output_path = output_dir / "result.json"
    save_to_json(header_rec_texts, body_rec_texts, json_output_path)
    
    # 计算统计信息
    total_cells = len(header_cells) + sum(len(row.get('cells', [])) for row in body_rows)
    elapsed_time = time.time() - start_time
    
    # 打印统计信息
    print_statistics(header_cells, body_rows, total_cells, elapsed_time)
    
    print("处理完成")
    return 0


if __name__ == "__main__":
    exit(main()) 
