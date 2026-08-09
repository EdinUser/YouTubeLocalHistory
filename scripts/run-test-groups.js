const { spawnSync } = require('node:child_process');

const groups = process.argv.slice(2);

if (groups.length === 0) {
  console.error('Usage: node scripts/run-test-groups.js <npm-script> [...]');
  process.exitCode = 1;
} else {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const failures = [];

  for (const group of groups) {
    console.log(`\n=== npm run ${group} ===`);
    const result = spawnSync(npmCommand, ['run', group], {
      env: process.env,
      stdio: 'inherit',
    });

    if (result.error || result.status !== 0) {
      failures.push(group);
      if (result.error) console.error(result.error.message);
    }
  }

  if (failures.length > 0) {
    console.error(`\nFailed test groups: ${failures.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${groups.length} test groups passed.`);
  }
}
