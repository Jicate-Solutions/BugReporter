/**
 * Verifies the guard that decides where BUILDWISE_JOBS_SECRET may be sent.
 *
 * This repo has no test framework (no test script, no runner in devDependencies),
 * and adding one is out of scope for a security patch, so this is a standalone
 * check that runs on the repo's own TypeScript compiler and nothing else:
 *
 *   npx tsc scripts/verify-buildwise-url-guard.ts --outDir /tmp/bw-verify \
 *     --module commonjs --moduleResolution node --target ES2022 \
 *     --strict --skipLibCheck --esModuleInterop \
 *   && node /tmp/bw-verify/scripts/verify-buildwise-url-guard.js
 *
 * --strict matters: without it the ok/error union stops narrowing and the compile
 * reports phantom errors that have nothing to do with this file.
 *
 * It exercises the REAL resolveBuildWiseJobUrl from lib/routines/registry.ts —
 * the point is that a hostile app_url is REFUSED, not merely that a good one works,
 * so most cases below are attacks that must fail closed.
 *
 * Exits non-zero on any failure.
 */

import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { resolveBuildWiseJobUrl } from '../lib/routines/registry';

const EXPECTED_HOST = 'buildwise.example.com';
const SECRET = 'not-the-real-secret-value';

let failures = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/**
 * The secret must be refused for this URL, and the refusal must not echo it.
 * `host` has NO default on purpose: a default parameter also fires on an explicit
 * `undefined`, which silently turned the "host unset" case into "host configured"
 * and made it pass for the wrong reason.
 */
function mustRefuse(label: string, appUrl: string | null, host: string | undefined): void {
  const r = resolveBuildWiseJobUrl(appUrl, 'cash-digest', host);
  check(label, r.ok === false, r.ok ? `ALLOWED and would call ${r.url}` : '');
  if (!r.ok) check(`${label} — refusal text carries no secret`, !r.error.includes(SECRET));
}

function mustAllow(label: string, appUrl: string, expectedUrl: string): void {
  const r = resolveBuildWiseJobUrl(appUrl, 'cash-digest', EXPECTED_HOST);
  check(label, r.ok === true && r.url === expectedUrl, r.ok ? `built ${r.url}` : `refused: ${r.error}`);
}

console.log('\nURL guard — hostile app_url must be refused');
mustRefuse('attacker-owned host', 'https://evil.attacker.test/', EXPECTED_HOST);
mustRefuse('lookalike suffix (buildwise.example.com.evil.test)', 'https://buildwise.example.com.evil.test/', EXPECTED_HOST);
mustRefuse('lookalike prefix (buildwise.example.com.co)', 'https://buildwise.example.com.co/', EXPECTED_HOST);
mustRefuse('userinfo trick (real host in the credentials slot)', `https://${EXPECTED_HOST}@evil.attacker.test/`, EXPECTED_HOST);
mustRefuse('http:// on the right host (secret in clear text)', `http://${EXPECTED_HOST}/`, EXPECTED_HOST);
mustRefuse('localhost', 'http://localhost:3000/', EXPECTED_HOST);
mustRefuse('private range 10.x', 'https://10.0.0.7/', EXPECTED_HOST);
mustRefuse('private range 192.168.x', 'https://192.168.1.5/', EXPECTED_HOST);
mustRefuse('malformed url', 'not a url at all', EXPECTED_HOST);
mustRefuse('null app_url', null, EXPECTED_HOST);
mustRefuse('BUILDWISE_JOBS_HOST unset — fail closed', `https://${EXPECTED_HOST}/`, undefined);
mustRefuse('BUILDWISE_JOBS_HOST blank — fail closed', `https://${EXPECTED_HOST}/`, '   ');

console.log('\nURL guard — the legitimate BuildWise URL still works');
mustAllow('plain host', `https://${EXPECTED_HOST}`, `https://${EXPECTED_HOST}/api/jobs/cash-digest`);
mustAllow('trailing slash', `https://${EXPECTED_HOST}/`, `https://${EXPECTED_HOST}/api/jobs/cash-digest`);
mustAllow('host cased differently', `https://BuildWise.Example.COM/`, `https://buildwise.example.com/api/jobs/cash-digest`);
mustAllow('base path preserved', `https://${EXPECTED_HOST}/app/`, `https://${EXPECTED_HOST}/app/api/jobs/cash-digest`);

/**
 * The redirect hole is a fetch() behaviour, not a URL-shape one: a vetted host that
 * answers 302 would, under the default redirect:'follow', hand the x-jobs-secret
 * header to wherever it points. Two local servers prove both halves.
 */
async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

async function verifyRedirect(): Promise<void> {
  console.log('\nRedirect — a 302 must not carry the secret onward');
  const received: string[] = [];
  const landing = createServer((req, res) => {
    received.push(String(req.headers['x-jobs-secret'] ?? '(header absent)'));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, summary: 'landed' }));
  });
  const landingPort = await listen(landing);

  const redirector = createServer((_req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${landingPort}/api/jobs/cash-digest` });
    res.end();
  });
  const redirectorPort = await listen(redirector);
  const start = `http://127.0.0.1:${redirectorPort}/api/jobs/cash-digest`;

  // Old behaviour (fetch's default): the secret reaches the redirect target.
  await fetch(start, { method: 'POST', headers: { 'x-jobs-secret': SECRET }, redirect: 'follow' }).catch(() => null);
  check('control: with redirect:follow the secret DOES reach the second host', received.includes(SECRET), `saw ${JSON.stringify(received)}`);

  // Fixed behaviour: the call fails instead of following.
  received.length = 0;
  let threw = false;
  await fetch(start, { method: 'POST', headers: { 'x-jobs-secret': SECRET }, redirect: 'error' }).catch(() => {
    threw = true;
  });
  check('with redirect:error the call fails instead of following', threw);
  check('with redirect:error the second host received nothing', received.length === 0, `saw ${JSON.stringify(received)}`);

  await new Promise<void>((r) => landing.close(() => r()));
  await new Promise<void>((r) => redirector.close(() => r()));
}

/**
 * The deadline fix assumes an aborted call comes back as a catchable rejection —
 * that is what lets the dispatcher still write a run row instead of being killed
 * mid-call with nothing recorded. Prove it against a server that never answers.
 */
async function verifyDeadlineAbort(): Promise<void> {
  console.log('\nDeadline — a hung target aborts at the budget, catchably');
  const hung = createServer(() => {
    /* deliberately never responds */
  });
  const port = await listen(hung);

  const budgetMs = 750;
  const started = Date.now();
  let caught = false;
  await fetch(`http://127.0.0.1:${port}/api/jobs/cash-digest`, {
    method: 'POST',
    signal: AbortSignal.timeout(budgetMs)
  }).catch(() => {
    caught = true;
  });
  const elapsed = Date.now() - started;

  check('the abort surfaced as a catchable rejection (so a run row can still be written)', caught);
  check(`aborted at the budget, not later (${elapsed}ms for a ${budgetMs}ms budget)`, elapsed < budgetMs + 1000);

  hung.closeAllConnections();
  await new Promise<void>((r) => hung.close(() => r()));
}

verifyRedirect()
  .then(verifyDeadlineAbort)
  .then(() => {
    console.log(failures === 0 ? '\nALL CHECKS PASSED\n' : `\n${failures} CHECK(S) FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e: unknown) => {
    console.error('harness crashed:', e);
    process.exit(1);
  });
