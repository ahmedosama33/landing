import { runDiagnostics } from './integrationDiagnostics.js';

// No write flag exists: live writes require a separate reviewed operation.
if (process.argv.length > 2) {
  console.error('Read-only command takes no arguments. No live write tests are supported.');
  process.exitCode = 1;
} else {
  try { console.log(JSON.stringify(await runDiagnostics(), null, 2)); }
  catch { console.error('Integration diagnostic failed; raw error withheld to protect credentials.'); process.exitCode = 1; }
}
