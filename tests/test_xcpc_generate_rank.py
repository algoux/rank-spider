import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch


REPO_ROOT = Path(__file__).resolve().parents[1]
RANK_SPIDER_DIR = REPO_ROOT / 'rank_spider'
sys.path.insert(0, str(RANK_SPIDER_DIR))
sys.modules.setdefault('requests', types.SimpleNamespace(get=None))

import xcpc  # noqa: E402


class FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self.payload = payload
        self.encoding = None

    def json(self):
        return self.payload


def build_payloads(runs=None):
    return {
        'config.json': {
            'contest_name': 'Test Contest',
            'start_time': 1700000000000,
            'end_time': 1700018000000,
            'problem_id': ['A'],
            'group': {},
        },
        'team.json': {
            'T1': {
                'team_id': 'T1',
                'name': 'Team One',
                'official': 1,
            },
        },
        'run.json': runs
        if runs is not None
        else [
            {
                'team_id': 'T1',
                'problem_id': 'A',
                'status': 'ACCEPTED',
                'timestamp': 60000,
            }
        ],
        'organizations.json': [],
    }


def fake_get_from_payloads(payloads):
    def fake_get(url, timeout=180):
        for suffix, payload in payloads.items():
            if url.endswith(suffix):
                if payload is None:
                    return FakeResponse(404, None)
                return FakeResponse(200, payload)
        return FakeResponse(404, None)

    return fake_get


class GenerateRankTest(unittest.TestCase):
    def setUp(self):
        xcpc.contest_url.clear()
        xcpc.unkown_contest.clear()

    def run_in_temp_cwd(self, func):
        old_cwd = os.getcwd()
        with tempfile.TemporaryDirectory() as tmpdir:
            os.chdir(tmpdir)
            try:
                return func(Path(tmpdir))
            finally:
                os.chdir(old_cwd)

    def test_generate_rank_writes_srk_file(self):
        def scenario(tmpdir):
            with patch.object(xcpc.requests, 'get', fake_get_from_payloads(build_payloads())):
                result = xcpc.generate_rank(
                    '/provincial-contest/2026/test',
                    'temp/test.srk.json',
                    download_banner=False,
                )

            self.assertTrue(result['ok'])
            self.assertIsNone(result['error'])
            output_path = Path(result['output_path'])
            self.assertTrue(output_path.exists())
            data = json.loads(output_path.read_text(encoding='utf-8'))
            self.assertEqual(data['contest']['title']['fallback'], 'Test Contest')
            self.assertEqual(data['rows'][0]['user']['name'], 'Team One')

        self.run_in_temp_cwd(scenario)

    def test_generate_rank_uses_team_organization_when_org_file_missing(self):
        payloads = build_payloads(
            runs=[
                {
                    'team_id': 'T1',
                    'problem_id': 'A',
                    'status': 'ACCEPTED',
                    'timestamp': 60000,
                },
                {
                    'team_id': 'T2',
                    'problem_id': 'A',
                    'status': 'ACCEPTED',
                    'timestamp': 120000,
                },
            ]
        )
        payloads['team.json'] = [
            {
                'id': 'T1',
                'name': 'Team One',
                'organization': 'School One',
                'group': ['official'],
            },
            {
                'id': 'T2',
                'name': 'Team Two',
                'organization': {'texts': {'zh-CN': 'School Two'}},
                'group': ['official'],
            },
        ]
        payloads['organizations.json'] = None

        def scenario(tmpdir):
            with patch.object(xcpc.requests, 'get', fake_get_from_payloads(payloads)):
                result = xcpc.generate_rank(
                    '/ccpc/12th/guizhou-invitational',
                    'temp/test.srk.json',
                    download_banner=False,
                )

            self.assertTrue(result['ok'])
            self.assertIn('organizations.json', result['warnings'][0])
            data = json.loads(Path(result['output_path']).read_text(encoding='utf-8'))
            self.assertEqual(data['rows'][0]['user']['organization'], 'School One')
            self.assertEqual(data['rows'][1]['user']['organization'], 'School Two')

        self.run_in_temp_cwd(scenario)

    def test_generate_rank_returns_error_when_config_missing(self):
        payloads = build_payloads()
        payloads['config.json'] = None

        def scenario(tmpdir):
            with patch.object(xcpc.requests, 'get', fake_get_from_payloads(payloads)):
                result = xcpc.generate_rank(
                    '/provincial-contest/2026/test',
                    'temp/test.srk.json',
                    download_banner=False,
                )

            self.assertFalse(result['ok'])
            self.assertIn('config.json', result['error'])
            self.assertFalse((tmpdir / 'temp/test.srk.json').exists())

        self.run_in_temp_cwd(scenario)

    def test_generate_rank_returns_error_for_empty_runs(self):
        def scenario(tmpdir):
            with patch.object(xcpc.requests, 'get', fake_get_from_payloads(build_payloads(runs=[]))):
                result = xcpc.generate_rank(
                    '/provincial-contest/2026/test',
                    'temp/test.srk.json',
                    download_banner=False,
                )

            self.assertFalse(result['ok'])
            self.assertIn('提交记录为空', result['error'])
            self.assertFalse((tmpdir / 'temp/test.srk.json').exists())

        self.run_in_temp_cwd(scenario)

    def test_generate_rank_reports_unknown_problem_and_status(self):
        runs = [
            {
                'team_id': 'T1',
                'problem_id': 'B',
                'status': 'ACCEPTED',
                'timestamp': 60000,
            },
            {
                'team_id': 'T1',
                'problem_id': 'A',
                'status': 'STRANGE_RESULT',
                'timestamp': 70000,
            },
        ]

        def scenario(tmpdir):
            with patch.object(xcpc.requests, 'get', fake_get_from_payloads(build_payloads(runs=runs))):
                result = xcpc.generate_rank(
                    '/provincial-contest/2026/test',
                    'temp/test.srk.json',
                    download_banner=False,
                )

            self.assertTrue(result['ok'])
            self.assertEqual(result['unknown_statuses']['count'], 2)
            self.assertEqual(
                result['unknown_statuses']['status'],
                ['STRANGE_RESULT', 'unknown_problem_id:B'],
            )

        self.run_in_temp_cwd(scenario)

    def test_generate_rank_rejects_output_outside_cwd(self):
        def scenario(tmpdir):
            result = xcpc.generate_rank(
                '/provincial-contest/2026/test',
                '../outside.srk.json',
                download_banner=False,
            )
            self.assertFalse(result['ok'])
            self.assertIn('current working directory', result['error'])

        self.run_in_temp_cwd(scenario)


if __name__ == '__main__':
    unittest.main()
