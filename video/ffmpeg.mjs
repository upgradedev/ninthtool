/**
 * The only place this pipeline shells out to ffmpeg, and the only place it measures anything.
 *
 * IT FAILS LOUDLY WHEN THE BINARY IS ABSENT. ffmpeg may be assumed present on a build machine, but
 * "assumed present" is how a pipeline ends up printing a green line for a step that never ran. So
 * every entry point calls requireBinaries() first and gets either the two resolved paths or a stop,
 * never a silent continue.
 *
 * MEASURED, NEVER ASSUMED. probeSeconds reads the container's real duration through ffprobe. No
 * caller is allowed to carry a duration it computed itself into a gate.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';

function resolvable(binary) {
  const probe = spawnSync(binary, ['-version'], { encoding: 'utf8' });
  return !probe.error && probe.status === 0;
}

/**
 * Resolve both binaries or explain exactly which one is missing and how it was looked for.
 *
 * @returns {{ffmpeg: string, ffprobe: string}}
 */
export function requireBinaries() {
  const missing = [];
  if (!resolvable(FFMPEG)) missing.push(`ffmpeg (looked for "${FFMPEG}")`);
  if (!resolvable(FFPROBE)) missing.push(`ffprobe (looked for "${FFPROBE}")`);
  if (missing.length) {
    throw new Error(
      `this step needs ffmpeg and ffprobe and could not run ${missing.join(' and ')}.\n`
      + 'Install them, or set FFMPEG and FFPROBE to their full paths. Nothing was produced.',
    );
  }
  return { ffmpeg: FFMPEG, ffprobe: FFPROBE };
}

/** The container duration in seconds, measured. Throws when the file is unreadable by ffprobe. */
export function probeSeconds(file) {
  if (!fs.existsSync(file)) throw new Error(`cannot measure a file that does not exist: ${file}`);
  const out = execFileSync(FFPROBE, [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file,
  ], { encoding: 'utf8' }).trim();
  const seconds = Number(out);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`ffprobe returned "${out}" for ${file}, which is not a duration`);
  }
  return seconds;
}

/** The stream kinds present, so a build cannot ship a file whose audio track never made it. */
export function probeStreamTypes(file) {
  const out = execFileSync(FFPROBE, [
    '-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'default=nw=1:nk=1', file,
  ], { encoding: 'utf8' }).trim();
  return out ? out.split(/\r?\n/) : [];
}

/**
 * The measured length of one stream inside a file, in seconds.
 *
 * THE CONTAINER DURATION IS NOT ENOUGH. A file whose picture runs six seconds past its voice has a
 * container duration equal to the longer of the two and looks fine to any check that reads only
 * that number. Drift is a difference BETWEEN the streams, so it has to be measured per stream.
 *
 * Some encoders leave the per stream duration tag unset, in which case this counts packets, which
 * is slower and always available.
 *
 * @param {string} file
 * @param {'v'|'a'} kind
 * @returns {number|null} null when the file carries no stream of that kind
 */
export function probeStreamSeconds(file, kind) {
  if (!fs.existsSync(file)) throw new Error(`cannot measure a file that does not exist: ${file}`);
  const tagged = execFileSync(FFPROBE, [
    '-v', 'error', '-select_streams', kind, '-show_entries', 'stream=duration',
    '-of', 'default=nw=1:nk=1', file,
  ], { encoding: 'utf8' }).trim();
  const first = tagged.split(/\r?\n/)[0];
  if (first && first !== 'N/A' && Number.isFinite(Number(first))) return Number(first);

  const counted = execFileSync(FFPROBE, [
    '-v', 'error', '-select_streams', kind, '-count_packets',
    '-show_entries', 'stream=nb_read_packets,duration_time', '-of', 'json', file,
  ], { encoding: 'utf8' });
  let parsed;
  try { parsed = JSON.parse(counted); } catch { return null; }
  const stream = parsed?.streams?.[0];
  if (!stream) return null;
  const time = Number(stream.duration_time);
  return Number.isFinite(time) && time > 0 ? time : null;
}

/** Run ffmpeg, surfacing its own error text rather than a bare exit code. */
export function run(args) {
  const result = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...args], {
    encoding: 'utf8',
  });
  if (result.error) throw new Error(`could not start ffmpeg: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`ffmpeg exited ${result.status}\n${(result.stderr || '').trim()}`);
  }
  return result;
}

/**
 * A tiny video of an exact picture length and an exact voice length, for the gate selftest.
 *
 * It lives here because the selftest must not carry a second copy of the ffmpeg invocation logic.
 * There is deliberately no `-shortest`: the whole point is to be able to build a file whose two
 * streams disagree, which is what the drift case needs.
 */
export function synthesise(file, seconds, options = {}) {
  const { width = 320, height = 180, fps = 25, withAudio = true, audioSeconds = seconds } = options;
  const args = [
    '-y',
    '-f', 'lavfi', '-t', String(seconds), '-i', `color=c=black:s=${width}x${height}:r=${fps}`,
  ];
  if (withAudio) args.push('-f', 'lavfi', '-t', String(audioSeconds), '-i', 'anullsrc=r=44100:cl=mono');
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast');
  if (withAudio) args.push('-c:a', 'aac');
  args.push(file);
  run(args);
  return file;
}
