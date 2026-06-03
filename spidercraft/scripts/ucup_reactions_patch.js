#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const VERDICT_TO_SRK_RESULT = {
  AC: 'AC',
  WA: 'WA',
  TL: 'TLE',
  RE: 'RTE',
  CE: 'CE',
  NO: 'NOUT',
  RJ: 'RJ',
};

function usage() {
  return `Usage: node ${path.basename(__filename)} <input.srk.json> <reactions-url> [output.srk.json]

Options:
  --input <path>             Input SRK file.
  --reactions-url <url>      UCup Reactions page URL, for example https://scoreboard.ucup.ac/reactions/2026/.
  --output <path>            Output patched SRK file.
  --contest-info-url <url>   Override contestInfo.json URL.
  --runs-url <url>           Override runs.json URL.
`;
}

function parseArgs(argv) {
  const options = {};
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[index];
    };

    if (arg === '--input') options.input = next();
    else if (arg === '--reactions-url') options.reactionsUrl = next();
    else if (arg === '--output') options.output = next();
    else if (arg === '--contest-info-url') options.contestInfoUrl = next();
    else if (arg === '--runs-url') options.runsUrl = next();
    else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown argument: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }

  if (!options.input && positionals[0]) options.input = positionals[0];
  if (!options.reactionsUrl && positionals[1]) options.reactionsUrl = positionals[1];
  if (!options.output && positionals[2]) options.output = positionals[2];

  if (!options.input) throw new Error('Missing input SRK path.');
  if (!options.reactionsUrl && (!options.contestInfoUrl || !options.runsUrl)) {
    throw new Error('Missing reactions URL.');
  }

  options.input = path.resolve(options.input);
  options.output = path.resolve(options.output || defaultOutputPath(options.input));

  if (options.input === options.output) {
    throw new Error('Output path must not be the same as input path.');
  }

  return options;
}

function defaultOutputPath(input) {
  const dir = path.dirname(input);
  const base = path.basename(input);
  if (base.endsWith('.srk.json')) {
    return path.join(dir, `${base.slice(0, -'.srk.json'.length)}_reactions_patch.srk.json`);
  }
  const ext = path.extname(base);
  return path.join(dir, `${base.slice(0, -ext.length)}_reactions_patch${ext}`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function fetchText(url) {
  if (typeof fetch === 'function') {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
    }
    return response.text();
  }

  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const request = client.get(
      url,
      { headers: { 'User-Agent': 'rank-spider ucup reactions patch' } },
      (response) => {
        if (
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();
          fetchText(new URL(response.headers.location, url).toString()).then(resolve, reject);
          return;
        }

        if (response.statusCode < 200 || response.statusCode >= 300) {
          response.resume();
          reject(new Error(`GET ${url} failed: ${response.statusCode}`));
          return;
        }

        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => resolve(body));
      },
    );
    request.on('error', reject);
  });
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

function createWarningCollector() {
  const warnings = [];
  return {
    warnings,
    add(code, message, details = {}) {
      warnings.push({ code, message, details });
      const suffix = Object.keys(details).length > 0 ? ` ${JSON.stringify(details)}` : '';
      console.warn(`[warning:${code}] ${message}${suffix}`);
    },
  };
}

function decodeHtmlAttribute(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function ensureTrailingSlash(url) {
  return url.endsWith('/') ? url : `${url}/`;
}

async function resolveDataUrls(options, warnings) {
  if (options.contestInfoUrl && options.runsUrl) {
    return {
      dataBaseUrl: null,
      contestInfoUrl: options.contestInfoUrl,
      runsUrl: options.runsUrl,
    };
  }

  const pageUrl = ensureTrailingSlash(new URL(options.reactionsUrl).toString());
  const html = await fetchText(pageUrl);
  const dataBaseMatch =
    html.match(/\bdata-data-base=(["'])(.*?)\1/i) ||
    html.match(/\bdata-data-base=([^\s>]+)/i);

  let dataBaseUrl;
  if (dataBaseMatch) {
    const rawValue = decodeHtmlAttribute(dataBaseMatch[2] || dataBaseMatch[1]);
    dataBaseUrl = ensureTrailingSlash(new URL(rawValue, pageUrl).toString());
  } else {
    dataBaseUrl = new URL('data/', pageUrl).toString();
    warnings.add('data-base-not-found', 'Reactions page did not expose data-data-base; using ./data.', {
      reactionsUrl: pageUrl,
      dataBaseUrl,
    });
  }

  return {
    dataBaseUrl,
    contestInfoUrl: new URL('contestInfo.json', dataBaseUrl).toString(),
    runsUrl: new URL('runs.json', dataBaseUrl).toString(),
  };
}

function cellKey(teamId, problemAlias) {
  return `${teamId}\u0000${problemAlias}`;
}

function normalizeText(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200b-\u200f\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameKey(value) {
  return normalizeText(value).toLowerCase();
}

function buildTeamResolver(rows, contestInfo, warnings) {
  const resolver = new Map();
  const nameToRowId = new Map();
  const matchCounters = {
    id: 0,
    location: 0,
    name: 0,
  };

  const addResolver = (sourceTeamId, rowId, method) => {
    if (!sourceTeamId || !rowId) return;
    const existing = resolver.get(sourceTeamId);
    if (existing && existing.rowId !== rowId) {
      warnings.add('duplicate-team-mapping', 'Multiple SRK rows match the same Reactions team id.', {
        sourceTeamId,
        oldRowId: existing.rowId,
        oldMethod: existing.method,
        newRowId: rowId,
        newMethod: method,
      });
      return;
    }
    if (!existing) {
      resolver.set(sourceTeamId, { rowId, method });
      matchCounters[method] += 1;
    }
  };

  for (const row of rows || []) {
    const rowId = row.user && row.user.id;
    addResolver(rowId, rowId, 'id');
    addResolver(row.user && row.user.location, rowId, 'location');

    const key = nameKey(row.user && row.user.name);
    if (!key) continue;
    const existing = nameToRowId.get(key);
    if (existing && existing !== rowId) {
      warnings.add('duplicate-team-name', 'Multiple SRK rows share the same normalized team name.', {
        name: row.user.name,
        oldRowId: existing,
        newRowId: rowId,
      });
      nameToRowId.delete(key);
    } else if (!existing) {
      nameToRowId.set(key, rowId);
    }
  }

  for (const team of contestInfo.teams || []) {
    if (resolver.has(team.id)) continue;
    const rowId =
      nameToRowId.get(nameKey(team.displayName)) ||
      nameToRowId.get(nameKey(team.fullName));
    addResolver(team.id, rowId, 'name');
  }

  return { resolver, matchCounters };
}

function resultLiteForCompare(result) {
  if (result === 'AC' || result === 'FB') return result;
  if (result == null) return null;
  return 'RJ';
}

function timeToMs(time) {
  if (!Array.isArray(time) || time.length !== 2 || typeof time[0] !== 'number') return null;
  const [value, unit] = time;
  const unitMs = {
    ms: 1,
    s: 1000,
    min: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  if (!unitMs[unit]) return null;
  return value * unitMs[unit];
}

function minuteOfTime(time) {
  const ms = timeToMs(time);
  return ms == null ? null : Math.floor(ms / 60000);
}

function normalizeRunVerdict(run, warnings) {
  if (run.verdict === 'AC' && run.isAccepted !== true) {
    warnings.add('accepted-flag-mismatch', 'AC verdict is not marked as accepted.', {
      runId: run.id,
      teamId: run.teamId,
      problemId: run.problemId,
      isAccepted: run.isAccepted,
    });
  } else if (run.verdict !== 'AC' && run.isAccepted === true) {
    warnings.add('accepted-flag-mismatch', 'Non-AC verdict is marked as accepted.', {
      runId: run.id,
      verdict: run.verdict,
      teamId: run.teamId,
      problemId: run.problemId,
    });
  }

  if (run.isAccepted || run.verdict === 'AC') {
    return run.isFirstToSolve ? 'FB' : 'AC';
  }

  const mapped = VERDICT_TO_SRK_RESULT[run.verdict];
  if (mapped) return mapped;

  warnings.add('unknown-verdict', 'Unknown Reactions verdict; preserving it as custom SRK result.', {
    runId: run.id,
    verdict: run.verdict,
    teamId: run.teamId,
    problemId: run.problemId,
  });
  return run.verdict || 'RJ';
}

function compareExistingSolutions({ row, problemAlias, oldSolutions, newSolutions, warnings }) {
  if (oldSolutions.length === 0) return;

  const baseDetails = { teamId: row.user.id, problem: problemAlias };
  if (oldSolutions.length !== newSolutions.length) {
    warnings.add('solution-count-mismatch', 'Existing and Reactions solution counts differ.', {
      ...baseDetails,
      oldCount: oldSolutions.length,
      newCount: newSolutions.length,
    });
    return;
  }

  oldSolutions.forEach((oldSolution, index) => {
    const newSolution = newSolutions[index];
    const oldMinute = minuteOfTime(oldSolution.time);
    const newMinute = minuteOfTime(newSolution.time);
    if (oldMinute !== newMinute) {
      warnings.add('solution-minute-mismatch', 'Existing and Reactions solution minutes differ.', {
        ...baseDetails,
        index,
        oldMinute,
        newMinute,
        newTime: newSolution.time,
      });
    }

    const oldLite = resultLiteForCompare(oldSolution.result);
    const newLite = resultLiteForCompare(newSolution.result);
    if (oldLite !== newLite) {
      warnings.add('solution-result-mismatch', 'Existing and Reactions solution result classes differ.', {
        ...baseDetails,
        index,
        oldResult: oldSolution.result,
        newResult: newSolution.result,
      });
    }
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const warnings = createWarningCollector();
  const srk = readJson(options.input);
  const { dataBaseUrl, contestInfoUrl, runsUrl } = await resolveDataUrls(options, warnings);
  const [contestInfo, runs] = await Promise.all([fetchJson(contestInfoUrl), fetchJson(runsUrl)]);

  if (!Array.isArray(runs)) {
    throw new Error(`Invalid runs payload from ${runsUrl}`);
  }

  const problemAliasByReactionId = new Map();
  for (const problem of contestInfo.problems || []) {
    if (!problem.id || !problem.letter) {
      warnings.add('invalid-reactions-problem', 'Problem in contestInfo is missing id or letter.', {
        problem,
      });
      continue;
    }
    problemAliasByReactionId.set(problem.id, problem.letter);
  }

  const srkProblemAliases = (srk.problems || []).map((problem) => problem.alias);
  const srkProblemAliasSet = new Set(srkProblemAliases);
  const { resolver: teamResolver, matchCounters } = buildTeamResolver(
    srk.rows || [],
    contestInfo,
    warnings,
  );
  const sourceTeamMatchCounters = {
    id: 0,
    location: 0,
    name: 0,
  };

  const runsByCell = new Map();
  for (const run of runs) {
    const problemAlias = problemAliasByReactionId.get(run.problemId);
    if (!problemAlias) {
      warnings.add('unknown-reactions-problem', 'Run references a problem not found in contestInfo.', {
        runId: run.id,
        problemId: run.problemId,
      });
      continue;
    }
    if (!srkProblemAliasSet.has(problemAlias)) {
      warnings.add('unmatched-srk-problem', 'Run problem is not present in the SRK problems list.', {
        runId: run.id,
        problemId: run.problemId,
        problemAlias,
      });
      continue;
    }
    const teamMatch = teamResolver.get(run.teamId);
    if (!teamMatch) {
      warnings.add('unmatched-srk-team', 'Run team is not present in the SRK rows list.', {
        runId: run.id,
        teamId: run.teamId,
      });
      continue;
    }
    if (typeof run.time !== 'number') {
      warnings.add('invalid-run-time', 'Run has a non-numeric time and was skipped.', {
        runId: run.id,
        time: run.time,
      });
      continue;
    }

    sourceTeamMatchCounters[teamMatch.method] += 1;
    const key = cellKey(teamMatch.rowId, problemAlias);
    if (!runsByCell.has(key)) runsByCell.set(key, []);
    runsByCell.get(key).push({
      runId: run.id,
      sourceTeamId: run.teamId,
      solution: {
        result: normalizeRunVerdict(run, warnings),
        time: [run.time, 'ms'],
      },
    });
  }

  for (const entries of runsByCell.values()) {
    entries.sort((a, b) => {
      const timeDiff = a.solution.time[0] - b.solution.time[0];
      if (timeDiff !== 0) return timeDiff;
      return Number(a.runId) - Number(b.runId);
    });
  }

  const oldSolutionCount = (srk.rows || []).reduce(
    (total, row) =>
      total +
      (row.statuses || []).reduce(
        (rowTotal, status) => rowTotal + (status.solutions ? status.solutions.length : 0),
        0,
      ),
    0,
  );
  if (oldSolutionCount > 0 && oldSolutionCount !== runs.length) {
    warnings.add('total-solution-count-mismatch', 'Existing and Reactions total solution counts differ.', {
      oldCount: oldSolutionCount,
      newCount: runs.length,
    });
  }

  const visitedCells = new Set();
  let patchedCells = 0;
  let filledEmptyCells = 0;
  let comparedCells = 0;
  let patchedSolutions = 0;

  for (const row of srk.rows || []) {
    if (!row.statuses) row.statuses = [];
    srkProblemAliases.forEach((problemAlias, problemIndex) => {
      const key = cellKey(row.user.id, problemAlias);
      const entries = runsByCell.get(key) || [];
      const oldStatus = row.statuses[problemIndex] || { result: null };
      const oldSolutions = oldStatus.solutions || [];

      if (entries.length === 0) {
        if (oldSolutions.length > 0) {
          warnings.add('source-solutions-missing', 'Existing cell has solutions but Reactions has none.', {
            teamId: row.user.id,
            problem: problemAlias,
            oldCount: oldSolutions.length,
          });
        }
        return;
      }

      visitedCells.add(key);
      const newSolutions = entries.map((entry) => entry.solution);
      if (oldSolutions.length > 0) comparedCells += 1;
      else filledEmptyCells += 1;

      compareExistingSolutions({
        row,
        problemAlias,
        oldSolutions,
        newSolutions,
        warnings,
      });

      row.statuses[problemIndex] = { ...oldStatus, solutions: newSolutions };
      patchedCells += 1;
      patchedSolutions += newSolutions.length;
    });
  }

  for (const [key, entries] of runsByCell) {
    if (visitedCells.has(key)) continue;
    const [teamId, problemAlias] = key.split('\u0000');
    warnings.add('source-cell-unmatched', 'Reactions cell could not be patched into SRK.', {
      teamId,
      problem: problemAlias,
      count: entries.length,
    });
  }

  fs.writeFileSync(options.output, `${JSON.stringify(srk, null, 2)}\n`);

  console.log(`[info] input: ${options.input}`);
  if (options.reactionsUrl) console.log(`[info] reactions: ${ensureTrailingSlash(new URL(options.reactionsUrl).toString())}`);
  if (dataBaseUrl) console.log(`[info] data base: ${dataBaseUrl}`);
  console.log(`[info] contestInfo: ${contestInfoUrl}`);
  console.log(`[info] runs: ${runsUrl}`);
  console.log(`[info] output: ${options.output}`);
  console.log(`[info] patched cells: ${patchedCells}`);
  console.log(`[info] compared existing cells: ${comparedCells}`);
  console.log(`[info] filled empty cells: ${filledEmptyCells}`);
  console.log(`[info] patched solutions: ${patchedSolutions}`);
  console.log(`[info] team mappings: ${JSON.stringify(matchCounters)}`);
  console.log(`[info] run team matches: ${JSON.stringify(sourceTeamMatchCounters)}`);
  console.log(`[info] warnings: ${warnings.warnings.length}`);
  if (warnings.warnings.length === 0) {
    console.log('[ok] no replacement warnings');
  }
}

main().catch((error) => {
  console.error(`[error] ${error.message}`);
  console.error(usage());
  process.exitCode = 1;
});
