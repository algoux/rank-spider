import os
import requests
from typing import Optional, Dict
from urllib.parse import urlparse

def download_image(
    url: str,
    save_path: str,
    base_url: str = 'https://board.xcpcio.com/data/',
    headers: Optional[Dict[str, str]] = None,
    timeout: int = 30
) -> Optional[str]:
    """
    下载图片到本地
    
    Args:
        url: 图片 URL，可以是完整 URL 或相对路径
        save_path: 保存的本地路径（包含文件名和扩展名）
        base_url: 当 url 为相对路径时使用的基础 URL
        headers: 自定义请求头，如果为 None 则使用默认请求头
        timeout: 请求超时时间（秒）
    
    Returns:
        保存的本地图片路径，如果下载失败则返回 None
    """
    if not url:
        return None
    
    # 构建完整 URL
    if url.startswith('http://') or url.startswith('https://'):
        image_url = url
    else:
        image_url = f'{base_url}{url}'
    
    # 使用默认请求头（如果未提供）
    if headers is None:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br, zstd',
            'Accept-Language': 'zh-CN,zh;q=0.5',
            'Referer': 'https://board.xcpcio.com',
            'Sec-Fetch-Dest': 'image',
            'Sec-Fetch-Mode': 'no-cors',
            'Sec-Fetch-Site': 'same-origin'
        }
    
    try:
        # 确保保存目录存在
        save_dir = os.path.dirname(save_path)
        if save_dir:
            os.makedirs(save_dir, exist_ok=True)
        
        # 发送请求下载图片
        response = requests.get(image_url, headers=headers, stream=True, timeout=timeout)
        response.raise_for_status()
        
        # 保存图片到本地
        with open(save_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
        
        print(f'图片已保存到: {save_path}')
        return save_path
    
    except Exception as e:
        print(f'下载图片失败: {image_url}, 错误: {str(e)}')
        return None


def extract_extension(url: str, default_ext: str = 'png') -> str:
    """
    从 URL 中提取文件扩展名
    
    Args:
        url: 图片 URL
        default_ext: 默认扩展名（当无法从 URL 提取时使用）
    
    Returns:
        文件扩展名（不包含点号）
    """
    if not url:
        return default_ext
    
    parsed_url = urlparse(url)
    path_parts = parsed_url.path.split('/')
    filename = path_parts[-1] if path_parts else ''
    
    if '.' in filename:
        ext = filename.split('.')[-1]
        # 确保扩展名是常见的图片格式
        if ext.lower() in ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']:
            return ext
    
    return default_ext


def download_banner(banner_data: dict, contest_id: str, base_dir: str = 'images') -> Optional[str]:
    """
    下载 banner 图片
    
    Args:
        banner_data: banner 数据对象，包含 url 字段
        contest_id: 比赛 ID，如 ccpc7thfinal
        base_dir: 图片保存的基础目录
    
    Returns:
        保存的本地图片路径，如果下载失败则返回 None
    """
    if not banner_data or not isinstance(banner_data, dict):
        return None
    
    # 获取 URL
    url = banner_data.get('url')
    if not url:
        return None
    
    # 提取扩展名
    ext = extract_extension(url)
    
    # 构建保存路径
    save_path = f'{base_dir}/{contest_id}/assets/banner.{ext}'
    
    # 下载图片
    return download_image(url, save_path)