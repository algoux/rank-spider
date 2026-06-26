import base64
import os
import re
import requests
from typing import Any, Dict, Optional, Tuple
from urllib.parse import urljoin, urlparse


IMAGE_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'}
MIME_EXTENSIONS = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
    'image/x-icon': 'ico',
    'image/vnd.microsoft.icon': 'ico',
}


def normalize_path(path: str) -> str:
    return path.replace(os.sep, '/')


def safe_filename_component(value: Any, fallback: str = 'image') -> str:
    text = str(value or fallback).strip()
    text = re.sub(r'[^A-Za-z0-9._-]+', '-', text)
    text = text.strip('.-_')
    return text or fallback


def resolve_image_url(url: str, base_url: str = 'https://board.xcpcio.com/data/') -> str:
    if url.startswith('http://') or url.startswith('https://'):
        return url
    return urljoin(base_url, url)


def parse_base64_image(image_data: Any) -> Optional[Tuple[str, str]]:
    if isinstance(image_data, str):
        match = re.match(r'^data:([^;,]+)?;base64,(.*)$', image_data, re.DOTALL)
        if not match:
            return None
        return match.group(1) or 'image/png', match.group(2)

    if not isinstance(image_data, dict):
        return None

    base64_value = image_data.get('base64')
    if not isinstance(base64_value, str) or not base64_value:
        return None
    if base64_value.startswith('data:'):
        return parse_base64_image(base64_value)

    mime = image_data.get('mime')
    if not mime:
        image_type = image_data.get('type', 'png')
        mime = f'image/{image_type}'
    return str(mime), base64_value


def write_base64_image(image_data: Any, save_path: str) -> Optional[str]:
    parsed = parse_base64_image(image_data)
    if parsed is None:
        return None

    _, base64_value = parsed
    try:
        save_dir = os.path.dirname(save_path)
        if save_dir:
            os.makedirs(save_dir, exist_ok=True)
        with open(save_path, 'wb') as file:
            file.write(base64.b64decode(base64_value, validate=False))
        print(f'图片已保存到: {save_path}')
        return save_path
    except Exception as e:
        print(f'保存 base64 图片失败: {save_path}, 错误: {str(e)}')
        return None


def get_image_url(image_data: Any) -> Optional[str]:
    if isinstance(image_data, str):
        if image_data.startswith('data:'):
            return None
        return image_data
    if isinstance(image_data, dict):
        url = image_data.get('url')
        if isinstance(url, str) and url:
            return url
    return None


def get_srk_image_without_download(
    image_data: Any,
    base_url: str = 'https://board.xcpcio.com/data/',
) -> Optional[str]:
    if isinstance(image_data, str):
        if image_data.startswith('data:'):
            return None
        return resolve_image_url(image_data, base_url)

    url = get_image_url(image_data)
    if url:
        return resolve_image_url(url, base_url)
    return None


def image_link(
    image_data: Any,
    base_url: str = 'https://board.xcpcio.com/data/',
) -> Optional[str]:
    url = get_image_url(image_data)
    if url:
        return resolve_image_url(url, base_url)
    return None


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
    image_url = resolve_image_url(url, base_url)
    
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
        if ext.lower() in IMAGE_EXTENSIONS:
            return ext.lower()
    
    return default_ext


def extract_image_extension(image_data: Any, default_ext: str = 'png') -> str:
    url = get_image_url(image_data)
    if url:
        ext = extract_extension(url, '')
        if ext:
            return ext

    if isinstance(image_data, dict):
        mime = image_data.get('mime')
        if mime in MIME_EXTENSIONS:
            return MIME_EXTENSIONS[mime]
        image_type = image_data.get('type')
        if isinstance(image_type, str) and image_type.lower() in IMAGE_EXTENSIONS:
            return image_type.lower()

    return default_ext


def download_asset(
    image_data: Any,
    contest_id: str,
    filename_stem: str,
    base_dir: str = 'assets',
    base_url: str = 'https://board.xcpcio.com/data/',
    default_ext: str = 'png',
) -> Tuple[Optional[str], bool]:
    """
    Convert an XCPCIO Image object to a standard-ranklist Image value.

    URL images are downloaded and base64 images are decoded to
    ./assets/{contest_id}/..., returning the relative SRK path.
    """
    ext = extract_image_extension(image_data, default_ext)
    filename = f'{safe_filename_component(filename_stem)}.{ext}'
    save_path = normalize_path(os.path.join(base_dir, safe_filename_component(contest_id), filename))

    if parse_base64_image(image_data):
        local_path = write_base64_image(image_data, save_path)
        return (normalize_path(local_path), True) if local_path is not None else (None, False)

    url = get_image_url(image_data)
    if not url:
        return None, False

    local_path = download_image(url, save_path, base_url=base_url)
    if local_path is None:
        return get_srk_image_without_download(image_data, base_url), False
    return normalize_path(local_path), True


def download_banner(banner_data: dict, contest_id: str, base_dir: str = 'assets') -> Optional[str]:
    """
    下载 banner 图片
    
    Args:
        banner_data: banner 数据对象，支持 url 或 base64 字段
        contest_id: 比赛 ID，如 ccpc7thfinal
        base_dir: 图片保存的基础目录
    
    Returns:
        保存的本地图片路径，如果下载失败则返回 None
    """
    asset_path, _ = download_asset(banner_data, contest_id, 'banner', base_dir=base_dir)
    return asset_path
