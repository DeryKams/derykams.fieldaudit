// node tests/browser.mjs; requires an existing Chromium, no npm dependencies.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdirSync} from 'node:fs';

const artifacts = fileURLToPath(new URL('./.artifacts/', import.meta.url));
mkdirSync(artifacts, {recursive:true});
const browser = spawn(process.env.CHROMIUM_PATH || 'chromium', [
  '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + artifacts + '/profile', '--window-size=1440,1100',
  '--dump-dom', '--virtual-time-budget=5000', new URL('./browser.html', import.meta.url).href
], {stdio:['ignore','pipe','pipe']});
let output='', stderr='';
browser.stdout.on('data', chunk => output += chunk);
browser.stderr.on('data', chunk => stderr += chunk);
const timer=setTimeout(() => browser.kill('SIGTERM'), 25000);
browser.on('exit', code => {
  clearTimeout(timer);
  const result=output.match(/<pre id="test-result">([^<]*)<\/pre>/)?.[1];
  console.log(result || stderr.slice(-3000) || 'Browser returned no test result');
  process.exitCode=code===0 && result?.startsWith('OK:') ? 0 : 1;
});
