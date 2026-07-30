import { readFile, writeFile } from 'node:fs/promises';

const workerPath = new URL('./worker.js', import.meta.url);
const dashboardPath = new URL('./dashboard.html', import.meta.url);
const marker = 'const DASHBOARD_HTML = `';

const [workerSource, dashboardHtml] = await Promise.all([
    readFile(workerPath, 'utf8'),
    readFile(dashboardPath, 'utf8'),
]);

const markerIndex = workerSource.indexOf(marker);
if (markerIndex < 0) {
    throw new Error('DASHBOARD_HTML marker not found in worker.js');
}

const escapedHtml = dashboardHtml
    .replaceAll('`', '\\`')
    .replaceAll('${', '\\${');

const nextSource =
    workerSource.slice(0, markerIndex) +
    marker +
    escapedHtml +
    '`;\n';

await writeFile(workerPath, nextSource, 'utf8');
console.log(`Synced ${Buffer.byteLength(dashboardHtml)} bytes from dashboard.html`);
