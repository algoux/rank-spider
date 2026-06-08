"""MCP stdio server for XCPCIO rank generation."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict

from mcp.server.fastmcp import FastMCP


REPO_ROOT = Path(__file__).resolve().parents[2]
RANK_SPIDER_DIR = REPO_ROOT / 'rank_spider'
if str(RANK_SPIDER_DIR) not in sys.path:
    sys.path.insert(0, str(RANK_SPIDER_DIR))

import xcpc  # noqa: E402


mcp = FastMCP('rank-spider-xcpc')


@mcp.tool()
def generate_xcpc_rank(
    contest_path: str,
    output_path: str,
    download_banner: bool = True,
) -> Dict[str, Any]:
    """Generate one SRK ranklist JSON file from board.xcpcio.com data.

    Args:
        contest_path: XCPCIO board path, for example /provincial-contest/2026/sichuan.
        output_path: Output SRK JSON path, resolved relative to the current working directory.
        download_banner: Whether to download contest banner assets into images/.
    """
    return xcpc.generate_rank(contest_path, output_path, download_banner)


def main() -> None:
    mcp.run()


if __name__ == '__main__':
    main()
