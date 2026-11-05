import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { generateRank } from '../src/adapters/xcpcio';

const contestPath = '/provincial-contest/2026/shanghai';
const dataBaseUrl = `https://board.xcpcio.com/data${contestPath}`;
const organizationLogoUrl =
  'https://board.xcpcio.com/data/provincial-contest/2026/shanghai-assets/organizations/INST-001.png';
const logoBytes = Buffer.from('fixture organization logo');

const fixtures: Record<string, unknown> = {
  [`${dataBaseUrl}/config.json`]: {
    contest_name: 'XCPCIO organization assets fixture',
    start_time: 1_700_000_000,
    end_time: 1_700_014_400,
    frozen_time: 0,
    problem_id: ['A'],
    group: {},
    balloon_color: [{ background_color: '#ff0000' }],
    medal: { all: { gold: 1, silver: 0, bronze: 0 } },
  },
  [`${dataBaseUrl}/team.json`]: {
    'TEAM-001': {
      name: 'Fixture Team',
      organization_id: 'INST-001',
      avatar: '',
      members: [],
    },
  },
  [`${dataBaseUrl}/run.json`]: [
    {
      team_id: 'TEAM-001',
      problem_id: 'A',
      timestamp: 600,
      status: 'ACCEPTED',
    },
  ],
  [`${dataBaseUrl}/organizations.json`]: [
    {
      id: 'INST-001',
      name: 'Fixture University',
      logo: [
        {
          href: '/data/provincial-contest/2026/shanghai-assets/organizations/INST-001.png',
          mime: 'image/png',
        },
      ],
    },
  ],
};

async function main(): Promise<void> {
  const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xcpcio-organization-assets-'));
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url === organizationLogoUrl) {
      return new Response(logoBytes, { status: 200, headers: { 'Content-Type': 'image/png' } });
    }
    if (Object.prototype.hasOwnProperty.call(fixtures, url)) {
      return new Response(JSON.stringify(fixtures[url]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  try {
    const result = await generateRank(contestPath, 'out.srk.json', { cwd: testDir });
    assert.equal(result.ok, true, result.error ?? 'rank generation failed');

    const rankObject = await fs.readJson(path.join(testDir, 'out.srk.json'));
    const avatarPath = 'assets/out/organization-INST-001-logo.png';
    assert.equal(rankObject.rows[0].user.organization, 'Fixture University');
    assert.equal(rankObject.rows[0].user.avatar, avatarPath);
    assert.deepEqual(await fs.readFile(path.join(testDir, avatarPath)), logoBytes);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.remove(testDir);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
