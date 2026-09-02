#!/usr/bin/env node
/**
 * The submission video pipeline, in one entry point.
 *
 *   node video/pipeline.mjs --plan            the beat list and the total, with no media at all
 *   node video/pipeline.mjs --narrate         synthesize and measure each beat's voice
 *   node video/pipeline.mjs --build           cut each beat to its own voice and join them
 *   node video/pipeline.mjs --build --beat surfaces      re-render exactly one beat
 *   node video/pipeline.mjs --gate            measure the shipped file and refuse a bad one
 *   node video/pipeline.mjs --selftest        prove the gate can fail
 *
 * THE ORDER MATTERS AND IT IS NOT THE OBVIOUS ONE. Narrate first, then record. The narration
 * decides how long each take has to be, so a take recorded before the voice exists is a guess, and
 * a take shorter than its voice loses the end of a sentence. `--plan` exists so the whole beat list
 * can be argued about, and the total checked, before a single second is recorded or a single text
 * to speech call is spent.
 *
 * WHAT THIS DOES NOT DO. It does not record the owner's takes and it does not upload anything.
 * Recording and publishing are the owner's, deliberately: an agent that can publish is an agent
 * that can publish the wrong cut.
 *
 * NO DEPENDENCIES. Node 20, the standard library, and ffmpeg. No package manager runs here and
 * there is no lock file, which is the same rule the rest of this repository keeps.
 */
import fs from 'node:fs';

import { load, paths, planFor, PLACEHOLDER } from './manifest.mjs';
import { runGate, report } from './gate.mjs';

function parse(argv) {
  const args = { mode: null, beat: null, force: null, only: null, help: false };
  const modes = {
    '--plan': 'plan', '--narrate': 'narrate', '--build': 'build', '--gate': 'gate',
    '--selftest': 'selftest',
  };
  const errors = [];
  const needsValue = new Set(['--beat', '--force', '--only']);

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (needsValue.has(a) && (i + 1 >= argv.length || String(argv[i + 1]).startsWith('--'))) {
      errors.push(`${a} needs a value`);
      continue;
    }
    if (modes[a]) {
      if (args.mode) errors.push(`${a} and --${args.mode} cannot both run in one command`);
      args.mode = modes[a];
    } else if (a === '--beat') args.beat = String(argv[++i]);
    else if (a === '--force') args.force = String(argv[++i]);
    else if (a === '--only') args.only = String(argv[++i]);
    else if (a === '--help' || a === '-h') args.help = true;
    // A misspelled flag is refused rather than ignored. A tool that quietly does something other
    // than what it was asked is the failure this whole repository is about.
    else errors.push(`unrecognised argument "${a}"`);
  }
  return { args, errors };
}

const HELP = `Ninth Tool submission video pipeline

  --plan                 print the beats and the planned total. Needs no media, no key, no ffmpeg.
  --narrate              synthesize each beat, measure it, write the timing and the captions.
    --force all|<id>     re-roll everything, or one beat, without changing its words.
    --only <id>          re-synthesize one beat and reuse the cached rest.
  --build                cut each beat to its own measured voice, then join them.
    --beat <id>          re-render exactly one beat and rejoin. Every other cut is left alone.
  --gate                 measure the composed file and refuse it if anything drifted or is missing.
  --selftest             run video/selftest.mjs, which proves the gate fails on broken media.

Environment
  NINTHTOOL_VIDEO_ROOT   where takes, audio and output live. Defaults to tmp/video, which is
                         ignored by git. Never inside the tracked tree.
  ELEVENLABS_API_KEY     the text to speech key, or XI_API_KEY, or ELEVEN_LABS_KEY. Read in that
                         order, never printed. Absent means stop, not carry on.
  FFMPEG, FFPROBE        full paths, if they are not on PATH.

The order is narrate, record, build, gate. The narration decides how long each take must be.`;

function plan() {
  // Deliberately no requireFrozen and no ffmpeg: this mode has to work on a machine with nothing
  // installed and nothing recorded, which is the whole point of having it.
  const spec = load();
  const { rows, totalWords, totalDerived, totalExpected } = planFor(spec);
  const { targetMinSeconds, targetMaxSeconds, hardCapSeconds } = spec.duration;
  const frozen = PLACEHOLDER.test(String(spec.frozenSha)) ? 'NOT YET FROZEN' : spec.frozenSha;

  console.log(`plan: ${spec.beats.length} beats, ${spec.provider}, ${spec.video.width}x`
    + `${spec.video.height} at ${spec.video.fps} fps, output ${spec.video.outputName}`);
  console.log(`plan: deployed URL ${spec.deployedUrl}`);
  console.log(`plan: frozen commit ${frozen}`);
  console.log('');
  console.log(' #  id            words  planned  derived  on screen');
  for (const row of rows) {
    const beat = spec.beats[row.index - 1];
    console.log(` ${String(row.index).padStart(2)}  ${row.id.padEnd(12)}  `
      + `${String(row.words).padStart(5)}  ${String(row.expectedSeconds).padStart(6)}s  `
      + `${String(row.derivedSeconds).padStart(6)}s  ${beat.onScreen.slice(0, 60)}`);
  }
  console.log('');
  console.log(`plan: ${totalWords} spoken words. Planned total ${totalExpected}s, derived from word `
    + `count ${totalDerived}s at ${spec.planning.wordsPerSecond} words per second.`);
  console.log(`plan: target band ${targetMinSeconds} to ${targetMaxSeconds}s, hard cap under ${hardCapSeconds}s.`);

  /*
   * The two planning numbers are cross checked against each other, because an authored figure
   * nobody compares to anything is a figure that rots the first time a beat is reworded. Neither
   * of them gates the video: the only durations that do that are ffprobe's.
   */
  const problems = [];
  const tolerance = spec.planning.expectedDriftTolerance ?? 0.15;
  for (const row of rows) {
    if (row.drift > tolerance) {
      problems.push(`beat ${row.index} (${row.id}): expectedSeconds says ${row.expectedSeconds}s and `
        + `${row.words} words at ${spec.planning.wordsPerSecond} per second imply ${row.derivedSeconds}s`);
    }
  }
  if (totalExpected >= hardCapSeconds || totalDerived >= hardCapSeconds) {
    problems.push(`the plan already reaches the ${hardCapSeconds}s hard cap before a word is spoken`);
  }
  if (totalDerived < targetMinSeconds || totalDerived > targetMaxSeconds) {
    problems.push(`the derived total ${totalDerived}s is outside the ${targetMinSeconds} to `
      + `${targetMaxSeconds}s band. Cut or add words now, while it costs nothing`);
  }

  if (problems.length) {
    console.error(`plan: FAIL, ${problems.length} problems.`);
    for (const problem of problems) console.error(`  - ${problem}`);
    return 1;
  }
  console.log('plan: PASS. Nothing was measured here, only counted. The narrate step is what '
    + 'measures, and it fails outside the band on the real voice.');
  return 0;
}

function gate() {
  const spec = load({ requireFrozen: true });
  const p = paths();
  if (!fs.existsSync(p.root)) {
    console.error(`gate: FAIL, there is no media root at ${p.root}. Nothing was measured, which is `
      + 'a failure and not a clean run.');
    return 1;
  }
  return report(runGate({ root: p.root, spec }));
}

async function main() {
  const { args, errors } = parse(process.argv.slice(2));
  if (errors.length) {
    for (const error of errors) console.error(`error: ${error}`);
    console.error('Nothing was run.');
    return 2;
  }
  if (args.help || !args.mode) {
    console.log(HELP);
    return args.help ? 0 : 2;
  }

  try {
    if (args.mode === 'plan') return plan();
    if (args.mode === 'gate') return gate();
    // selftest.mjs ends by exiting with its own verdict, so this import never returns.
    if (args.mode === 'selftest') { await import('./selftest.mjs'); return 0; }
    if (args.mode === 'narrate') {
      const { narrate } = await import('./narrate.mjs');
      await narrate({ force: args.force, only: args.only });
      return 0;
    }
    if (args.mode === 'build') {
      const { build } = await import('./build.mjs');
      build({ beat: args.beat });
      return 0;
    }
  } catch (error) {
    console.error(`${args.mode}: FAIL.`);
    console.error(error.message);
    return 1;
  }
  return 2;
}

process.exit(await main());
