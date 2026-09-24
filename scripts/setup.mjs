// Interactive first-run setup: asks for the Spotify Client ID and writes it to .env.
// Uses only Node built-ins so it works before or after `npm install`.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KEY = 'VITE_SPOTIFY_CLIENT_ID';
const REDIRECT_URI = 'http://127.0.0.1:5173/callback';

/** Returns the trimmed Client ID if it looks like one (32 hex characters), otherwise null. */
export function parseClientId(input) {
  const id = input.trim();
  return /^[0-9a-f]{32}$/i.test(id) ? id : null;
}

/** Returns the valid Client ID already set in the given .env contents, or null. */
export function currentClientId(env) {
  const line = env?.split(/\r?\n/).find((l) => l.startsWith(`${KEY}=`));
  return line ? parseClientId(line.slice(KEY.length + 1)) : null;
}

/** Returns .env contents with the Client ID set, keeping any other lines. */
export function envWithClientId(env, id) {
  const entry = `${KEY}=${id}`;
  if (!env) return `${entry}\n`;
  const lines = env.replace(/\r?\n$/, '').split(/\r?\n/);
  const index = lines.findIndex((l) => l.startsWith(`${KEY}=`));
  if (index === -1) lines.push(entry);
  else lines[index] = entry;
  return `${lines.join('\n')}\n`;
}

async function main() {
  const envPath = fileURLToPath(new URL('../.env', import.meta.url));
  const existing = existsSync(envPath) ? readFileSync(envPath, 'utf8') : null;
  const rl = createInterface({ input: stdin, output: stdout });
  // Reading through the line iterator (not rl.question) keeps piped lines that arrive early.
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (prompt) => {
    stdout.write(prompt);
    const { value, done } = await lines.next();
    if (done) throw new Cancelled();
    return value;
  };

  try {
    console.log(`
Swipify setup

If you haven't yet, create a Spotify app at https://developer.spotify.com/dashboard
  - Redirect URI (exactly): ${REDIRECT_URI}
  - APIs used: Web API and Web Playback SDK
Then open the app's Settings and copy its Client ID.
`);

    const current = currentClientId(existing);
    if (current) {
      const answer = await ask(`.env already has Client ID ${current}. Replace it? (y/N) `);
      if (!/^y(es)?$/i.test(answer.trim())) {
        console.log('\nKept the existing Client ID. Run `npm start` to launch Swipify.');
        return;
      }
    }

    let id = null;
    while (!id) {
      id = parseClientId(await ask('Client ID: '));
      if (!id) console.log("That doesn't look like a Client ID (32 characters, 0-9 and a-f). Try again.");
    }

    writeFileSync(envPath, envWithClientId(existing, id));
    console.log(`
Saved to .env. Now run:

    npm start

and open http://127.0.0.1:5173 (not localhost).`);
  } catch (error) {
    if (!(error instanceof Cancelled)) throw error;
    console.log('\n\nSetup cancelled; .env was not changed.');
    process.exitCode = 1;
  } finally {
    rl.close();
  }
}

/** Input ended (Ctrl+C, Ctrl+D or a closed pipe) before an answer was given. */
class Cancelled extends Error {}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
