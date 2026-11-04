// Production-build smoke test using only synthetic settings and loopback HTTP.
// No Supabase account, database, API key or deployment is required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');
const { spawn, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const fixture = {
  NEXT_TELEMETRY_DISABLED: '1',
  DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:5432/platon_next_build',
  DIRECT_URL: 'postgresql://fixture:fixture@127.0.0.1:5432/platon_next_build',
  ENCRYPTION_KEY: '1234567890abcdef'.repeat(4),
  SUPABASE_SERVICE_ROLE_KEY: 'platon-synthetic-service-marker-not-a-real-key',
  NEXT_PUBLIC_SUPABASE_URL: 'https://platon-build-fixture.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'platon-synthetic-public-marker-not-a-real-key',
};
const env = { ...process.env, ...fixture };
const nextBin = require.resolve('next/dist/bin/next');

async function main() {
  if (!process.argv.includes('--existing-build')) {
    const build = spawnSync(process.execPath, [nextBin, 'build'], {
      cwd: root, env, stdio: 'inherit', timeout: 600000,
    });
    assert.equal(build.status, 0, 'Production build must pass without skipping type checks');
  }
  assert.ok(fs.existsSync(path.join(root, '.next/BUILD_ID')), 'A production build is required');

  // Check only public static files. Server artifacts intentionally contain
  // synthetic server settings and are not treated as public client bundles.
  const staticDir = path.join(root, '.next/static');
  const privateMarkers = [fixture.DATABASE_URL, fixture.ENCRYPTION_KEY, fixture.SUPABASE_SERVICE_ROLE_KEY];
  let publicFiles = 0;
  for (const relative of fs.readdirSync(staticDir, { recursive: true })) {
    const file = path.join(staticDir, relative);
    if (!fs.statSync(file).isFile()) continue;
    publicFiles++;
    const content = fs.readFileSync(file, 'utf8');
    for (const marker of privateMarkers) assert.ok(!content.includes(marker), 'Private fixture value in public file: ' + relative);
  }
  assert.ok(publicFiles > 0);
  console.log('PASS: no synthetic private settings in ' + publicFiles + ' public static files');

  const reservation = net.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const origin = 'http://127.0.0.1:' + port;
  const server = spawn(process.execPath, [nextBin, 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  server.stdout.on('data', chunk => { output += chunk; });
  server.stderr.on('data', chunk => { output += chunk; });
  const stopped = once(server, 'exit');
  try {
    const deadline = Date.now() + 60000;
    let ready = false;
    while (Date.now() < deadline) {
      assert.equal(server.exitCode, null, 'Next server exited before readiness');
      try {
        const response = await fetch(origin + '/login', { redirect: 'manual', signal: AbortSignal.timeout(2000) });
        if (response.status === 200) { await response.text(); ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'Login page did not become ready');
    console.log('PASS: production login page returns 200');

    const dashboard = await fetch(origin + '/', { redirect: 'manual' });
    assert.equal(dashboard.status, 307);
    assert.equal(new URL(dashboard.headers.get('location'), origin).pathname, '/login');
    console.log('PASS: anonymous dashboard request redirects to /login');

    const requests = [
      ['/api/projects', 'GET'],
      ['/api/projects/fixture', 'GET'],
      ['/api/projects/fixture/prompt-set/items/fixture', 'DELETE'],
      ['/api/projects/fixture/eval-runs/fixture', 'GET'],
      ['/api/projects/fixture/eval-runs/fixture/step', 'POST'],
    ];
    for (const [route, method] of requests) {
      const response = await fetch(origin + route, {
        method, redirect: 'manual', signal: AbortSignal.timeout(5000),
        ...(method === 'POST' ? { body: JSON.stringify({ step: 'init' }), headers: { 'content-type': 'application/json' } } : {}),
      });
      assert.equal(response.status, 401, method + ' ' + route);
      assert.deepEqual(await response.json(), { error: 'Unauthorized' });
      console.log('PASS: anonymous ' + method + ' ' + route + ' returns 401');
    }
    assert.doesNotMatch(output, /sync-dynamic-apis|cookies\(\) should be awaited|params should be awaited/);
    console.log('PASS: no synchronous request API warning');
  } catch (error) {
    console.error(output);
    throw error;
  } finally {
    server.kill('SIGTERM');
    await stopped;
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
