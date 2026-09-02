/**
 * Compose the video: one cut per beat, each locked to its own measured voice, then joined.
 *
 * WHY PER BEAT AND NOT ONE LONG STRETCH. A single capture stretched to fit a single narration track
 * drifts, and worse, it means one wrong word costs a whole re-record. Here each beat is a file of
 * its own whose picture is cut to exactly that beat's measured audio length. Re-rendering beat six
 * touches beats/06 and nothing else, then the join is a stream copy. That is the whole argument for
 * recording early instead of at the end.
 *
 * A SHORT TAKE IS REFUSED, NOT PADDED. If a take is shorter than the voice it has to carry, ffmpeg
 * asked the obvious way will quietly end the beat early and the closing words are lost. That exact
 * failure shipped once in this workspace and passed its duration check. So the take is measured
 * first and a short one stops the build with the number of seconds it is short by.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { requireBinaries, run, probeSeconds, probeStreamTypes } from './ffmpeg.mjs';
import { load, paths, PLACEHOLDER } from './manifest.mjs';
import { beatFileName } from './gate.mjs';

/** Take container formats the recorder may produce, in the order they are looked for. */
const TAKE_EXTENSIONS = ['mp4', 'webm', 'mov', 'mkv', 'm4v'];

function findTake(takesDir, index, id) {
  for (const extension of TAKE_EXTENSIONS) {
    const candidate = path.join(takesDir, beatFileName(index, id, extension));
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Cut one beat: its take, trimmed to its own voice, at the target size and frame rate. */
function composeBeat({ spec, take, audio, hold, out }) {
  const { width, height, fps } = spec.video;
  const filter = [
    `[0:v]trim=start=0:duration=${hold},setpts=PTS-STARTPTS,`
    + `scale=${width}:${height}:force_original_aspect_ratio=decrease,`
    + `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${fps},setsar=1[v]`,
    `[1:a]apad,atrim=start=0:duration=${hold},asetpts=PTS-STARTPTS[a]`,
  ].join(';');

  run([
    '-y', '-i', take, '-i', audio,
    '-filter_complex', filter,
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2',
    '-video_track_timescale', String(fps * 1000),
    out,
  ]);
}

/**
 * Run the build.
 *
 * @param {{beat?: string}} options beat re-renders exactly one id and rejoins, leaving every other
 *   cut and every other measured duration untouched.
 */
export function build(options = {}) {
  requireBinaries();
  const spec = load({ requireFrozen: true });
  const p = paths();

  if (!fs.existsSync(p.timing)) {
    throw new Error(`no narration timing at ${p.timing}. Narrate before building: the capture length `
      + 'is decided by the narration, never the other way round.');
  }
  const timing = JSON.parse(fs.readFileSync(p.timing, 'utf8'));
  const timed = new Map(timing.beats.map((entry) => [entry.id, entry]));

  if (timing.frozenSha !== spec.frozenSha) {
    throw new Error(`the narration was generated against commit ${timing.frozenSha} and the manifest `
      + `now freezes ${spec.frozenSha}. Re-run the narrate step so the two agree.`);
  }

  fs.mkdirSync(p.beats, { recursive: true });
  fs.mkdirSync(p.output, { recursive: true });

  if (options.beat && !spec.beats.some((b) => b.id === options.beat)) {
    throw new Error(`no beat called "${options.beat}". The manifest declares: `
      + spec.beats.map((b) => b.id).join(', '));
  }

  /* ---- one cut per beat */

  let sumHolds = 0;
  const records = [];
  spec.beats.forEach((beat, index) => {
    const entry = timed.get(beat.id);
    if (!entry) throw new Error(`the narration timing has no entry for beat "${beat.id}"`);
    const hold = entry.holdSeconds;
    sumHolds += hold;

    const cut = path.join(p.beats, beatFileName(index, beat.id));
    const audio = path.join(p.narration, entry.file);
    const rebuilding = !options.beat || options.beat === beat.id;

    if (!rebuilding && fs.existsSync(cut)) {
      records.push({ id: beat.id, index: index + 1, holdSeconds: hold, cut, state: 'kept' });
      console.log(`  ${beat.id.padEnd(12)} kept`);
      return;
    }

    const take = findTake(p.takes, index, beat.id);
    if (!take) {
      throw new Error(`beat "${beat.id}" has no take. Record it to `
        + `${path.join(p.takes, beatFileName(index, beat.id, 'mp4'))} `
        + `(or ${TAKE_EXTENSIONS.slice(1).join(', ')}), at least ${hold.toFixed(2)}s long, showing:\n`
        + `  ${beat.onScreen}`);
    }
    if (!fs.existsSync(audio)) {
      throw new Error(`beat "${beat.id}" has no narration audio at ${audio}. Run the narrate step.`);
    }

    const takeSeconds = probeSeconds(take);
    if (takeSeconds + 1e-3 < hold) {
      throw new Error(`beat "${beat.id}": the take is ${takeSeconds.toFixed(2)}s and the voice for it `
        + `runs ${hold.toFixed(2)}s, so it is ${(hold - takeSeconds).toFixed(2)}s short. Record a `
        + 'longer take. Do not shorten the beat to fit the take.');
    }

    composeBeat({ spec, take, audio, hold, out: cut });
    records.push({ id: beat.id, index: index + 1, holdSeconds: hold, cut, state: 'rendered' });
    console.log(`  ${beat.id.padEnd(12)} rendered ${hold.toFixed(2)}s from ${path.basename(take)}`);
  });

  /* ---- join, and carry the captions as a track of the file rather than a loose promise */

  const listPath = path.join(p.beats, 'concat.txt');
  fs.writeFileSync(listPath, `${records
    .map((record) => `file '${record.cut.split(path.sep).join('/')}'`).join('\n')}\n`);

  const output = path.join(p.output, spec.video.outputName);
  const args = ['-y', '-f', 'concat', '-safe', '0', '-i', listPath];
  const hasCaptions = fs.existsSync(p.captions);
  if (hasCaptions) args.push('-i', p.captions);
  args.push('-map', '0:v', '-map', '0:a');
  if (hasCaptions) args.push('-map', '1', '-c:s', 'mov_text');
  args.push('-c:v', 'copy', '-c:a', 'copy', '-movflags', '+faststart', output);
  run(args);

  /* ---- measure what was produced, before writing a receipt that says anything about it */

  const total = probeSeconds(output);
  const kinds = probeStreamTypes(output);
  const frame = 1 / spec.video.fps;
  const allowance = spec.beats.length * frame;

  if (!kinds.includes('video') || !kinds.includes('audio')) {
    throw new Error(`the composed file carries streams [${kinds.join(', ')}], and it needs both a `
      + 'video and an audio stream');
  }
  if (Math.abs(total - sumHolds) > allowance) {
    throw new Error(`the composed video is ${total.toFixed(3)}s and the beats measure `
      + `${sumHolds.toFixed(3)}s. The join dropped or stretched something.`);
  }
  if (total >= spec.duration.hardCapSeconds) {
    throw new Error(`the composed video is ${total.toFixed(3)}s and the hard cap is under `
      + `${spec.duration.hardCapSeconds}s.`);
  }

  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');
  fs.writeFileSync(p.receipt, `${JSON.stringify({
    schemaVersion: 'ninthtool.submission-video-receipt/v1',
    frozenSha: spec.frozenSha,
    deployedUrl: spec.deployedUrl,
    outputName: spec.video.outputName,
    builtAt: new Date().toISOString(),
    beatCount: records.length,
    totalSeconds: Number(total.toFixed(3)),
    captionsMuxed: hasCaptions,
    sha256,
    beats: records.map(({ id, index, holdSeconds, state }) => ({ id, index, holdSeconds, state })),
  }, null, 2)}\n`);

  console.log(`build: ${output}`);
  console.log(`build: ${total.toFixed(3)}s across ${records.length} beats, sha256 ${sha256.slice(0, 16)}`);
  if (PLACEHOLDER.test(String(spec.frozenSha))) throw new Error('unreachable: the loader refuses a placeholder SHA');
  return { output, total, sha256 };
}
