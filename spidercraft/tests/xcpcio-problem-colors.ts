import assert from 'node:assert/strict';
import { run } from '../src/adapters/xcpcio';

const contestPath = '/icpc/51st/problem-colors-fixture';
const dataBaseUrl = `https://board.xcpcio.com/data${contestPath}`;

const fixtures: Record<string, unknown> = {
  [`${dataBaseUrl}/config.json`]: {
    contest_name: 'XCPCIO problem colors fixture',
    start_time: 1_700_000_000,
    end_time: 1_700_014_400,
    frozen_time: 0,
    problems: [
      {
        id: '0',
        label: 'A',
        balloon_color: {
          color: '#112233',
          background_color: '#fbbde6',
        },
      },
    ],
    group: {},
    medal: { all: { gold: 1, silver: 0, bronze: 0 } },
  },
  [`${dataBaseUrl}/team.json`]: {
    'TEAM-001': {
      name: 'Fixture Team',
      organization: 'Fixture University',
      members: [],
    },
  },
  [`${dataBaseUrl}/run.json`]: [
    {
      team_id: 'TEAM-001',
      problem_id: '0',
      timestamp: 600,
      status: 'ACCEPTED',
    },
  ],
  [`${dataBaseUrl}/organizations.json`]: [],
};

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (Object.prototype.hasOwnProperty.call(fixtures, url)) {
      return new Response(JSON.stringify(fixtures[url]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  try {
    const rankObject = await run(contestPath);
    assert.deepEqual(rankObject.problems[0].style, {
      backgroundColor: '#fbbde6',
      textColor: '#112233',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
