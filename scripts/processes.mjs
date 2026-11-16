import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * Starts a long-running process in its own process group, so stopProcessTree also stops
 * whatever it starts in turn, such as the servers behind an npm script.
 */
export function startProcessTree(command, args, options = {}) {
  return spawn(command, args, {
    stdio: 'inherit',
    windowsHide: true,
    ...options,
    detached: process.platform !== 'win32',
  });
}

export async function stopProcessTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.once('exit', resolve);
      killer.once('error', resolve);
    });
  } else {
    signalGroup(child, 'SIGTERM');
  }
  await Promise.race([exited, delay(10000)]);
  if (child.exitCode === null) signalGroup(child, 'SIGKILL');
}

function signalGroup(child, signal) {
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

/** Runs a command to completion; resolves with its trimmed output when `capture` is set. */
export function run(command, args, { cwd, capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'],
      windowsHide: true,
    });
    let output = '';
    child.stdout?.on('data', (chunk) => (output += chunk));
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0
        ? resolve(output.trim())
        : reject(new Error(`${command} ${args.join(' ')} exited with ${code}`)),
    );
  });
}

/**
 * Calls `ready` once a second until it returns true, for up to `seconds`. `ready` throws to
 * give up early, for example when the process being waited on has exited.
 */
export async function waitUntil(description, ready, seconds = 120) {
  for (let attempt = 0; attempt < seconds; attempt += 1) {
    if (await ready()) return;
    await delay(1000);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

/** Whether `url` answers with a success status; false while nothing is listening. */
export function answers(url) {
  return fetch(url).then(
    (response) => response.ok,
    () => false,
  );
}
