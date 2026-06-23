import * as core from '@actions/core';
import * as github from '@actions/github';

const RUNNER_STATUS_ONLINE = 'online';

/**
 * Parse a comma-separated list of values into a trimmed, non-empty array.
 * Returns [] for blank input.
 *
 * @param {string} raw
 * @returns {string[]}
 */
function parseList(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/**
 * Returns true if the runner has every label in `required`.
 *
 * @param {{ name: string, labels?: { name: string }[] }} runner
 * @param {string[]} required
 */
function hasAllLabels(runner, required) {
  if (required.length === 0) return true;
  const have = new Set((runner.labels || []).map((l) => l.name));
  return required.every((label) => have.has(label));
}

/**
 * Shape a runner into a small, stable JSON object for the `runners` output.
 *
 * @param {{ id: number, name: string, status: string, busy: boolean, labels?: { name: string }[], os?: string }} runner
 */
function shapeRunner(runner) {
  return {
    id: runner.id,
    name: runner.name,
    status: runner.status,
    busy: Boolean(runner.busy),
    os: runner.os,
    labels: (runner.labels || []).map((l) => l.name)
  };
}

/**
 * Resolve the org context from inputs + the current payload.
 * Prefers an explicit `org` input, falls back to the repo's owner when it is
 * an organization.
 *
 * @param {string} orgInput
 */
function resolveOrg(orgInput) {
  if (orgInput) return orgInput;
  const repoOwner = github.context?.payload?.repository?.owner?.login;
  if (repoOwner) return repoOwner;
  throw new Error(
    'Cannot determine organization. Provide the `org` input when scope=org, or run on a repository owned by an organization.'
  );
}

async function run() {
  try {
    const token = core.getInput('token', { required: true });
    const scope = (core.getInput('scope') || 'repo').toLowerCase();
    const orgInput = core.getInput('org');
    const ownerInput = core.getInput('owner');
    const repoInput = core.getInput('repo');
    const labels = parseList(core.getInput('labels'));
    const names = parseList(core.getInput('names'));
    const failOnOffline = (core.getInput('fail-on-offline') || 'true').toLowerCase() !== 'false';
    const serverUrl = 'https://api.github.com';

    if (scope !== 'repo' && scope !== 'org') {
      throw new Error(`Invalid scope: "${scope}". Must be "repo" or "org".`);
    }

    // Repo scope uses owner/repo inputs (defaulting to the current repo);
    // org scope only needs the org name.
    const ctxRepo = github.context.repo;
    const owner = ownerInput || ctxRepo.owner;
    const repo = repoInput || ctxRepo.repo;
    const octokit = github.getOctokit(token, { baseUrl: serverUrl });

    core.info(`Checking self-hosted runner availability`);
    core.info(`  api:          ${serverUrl}`);
    core.info(`  scope:        ${scope}`);
    if (scope === 'repo') {
      core.info(`  target repo:  ${owner}/${repo}`);
    } else {
      core.info(`  target org:   ${resolveOrg(orgInput)}`);
    }
    if (labels.length) core.info(`  labels filter: ${labels.join(', ')}`);
    if (names.length) core.info(`  names filter:  ${names.join(', ')}`);
    core.info(`  fail-on-offline: ${failOnOffline}`);

    // Pull every page until GitHub stops sending `Link: rel="next"`.
    const listParams =
      scope === 'repo'
        ? { owner, repo, per_page: 100 }
        : { org: resolveOrg(orgInput), per_page: 100 };
    const listFn =
      scope === 'repo'
        ? octokit.rest.actions.listSelfHostedRunnersForRepo
        : octokit.rest.actions.listSelfHostedRunnersForOrg;
    const runners = await octokit.paginate(listFn, listParams);

    const matchingNames = names.length ? new Set(names) : null;
    const filtered = runners.filter((runner) => {
      if (matchingNames && !matchingNames.has(runner.name)) return false;
      return hasAllLabels(runner, labels);
    });

    const shaped = filtered.map(shapeRunner);
    const online = shaped.filter((r) => r.status === RUNNER_STATUS_ONLINE);

    core.info(`Found ${shaped.length} matching runner(s); ${online.length} online.`);
    for (const r of shaped) {
      const busy = r.busy ? ', busy' : '';
      core.info(`  - ${r.name} [${r.status}${busy}] labels=${r.labels.join(',')}`);
    }

    const available = online.length > 0;
    core.info(`Result: available=${available} online=${online.length} total=${shaped.length}`);
    core.setOutput('available', String(available));
    core.setOutput('online-count', String(online.length));
    core.setOutput('total-count', String(shaped.length));
    core.setOutput('runners', JSON.stringify(shaped));

    if (!available) {
      const filterDesc =
        `scope=${scope}` +
        (labels.length ? ` labels=[${labels.join(',')}]` : '') +
        (names.length ? ` names=[${names.join(',')}]` : '');
      const msg = failOnOffline
        ? `No online self-hosted runner matched (${filterDesc}). Failing workflow.`
        : `No online self-hosted runner matched (${filterDesc}). Setting available=false and continuing (fail-on-offline=false).`;
      core.warning(msg);
      if (failOnOffline) {
        // Throwing makes the step red and skips dependent jobs by default —
        // this is the "cancel workflow immediately" behavior the action promises.
        throw new Error(msg);
      }
    }
  } catch (err) {
    core.setFailed(err instanceof Error ? err.message : String(err));
  }
}

run();
