/**
 * The caption and sync gate. It measures what was produced and refuses to infer anything.
 *
 * WHAT IT IS FOR. Two entries in this workspace have shipped a video whose voice had drifted away
 * from the picture, and one shipped a cut whose closing beats of speech were missing because the
 * capture was shorter than the narration. Both passed a check that read the build's own constants
 * instead of the file. So every number below comes out of ffprobe, run against the files that would
 * be uploaded.
 *
 * A MISSING TAKE IS A FAILURE, NEVER AN ABSENCE. The failure this gate exists to make impossible is
 * the one where nine beats are declared, three were cut, and the gate reports PASS because it
 * happened to iterate over the three that exist. So it iterates over the MANIFEST, counts what it
 * checked, and asserts that count equals the declared beat count before it reports anything. A run
 * that checked zero beats is an instrument failure and is reported as red, never as clean.
 *
 * IT IS A FUNCTION, NOT A SCRIPT. `runGate` takes a media root and a manifest and returns a result.
 * That is what lets video/selftest.mjs point THIS function, not a copy of it, at deliberately
 * broken media. A gate whose self test re-implements its own rules proves nothing about the gate,
 * and this repository has already shipped that defect twice.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { probeSeconds, probeStreamSeconds, probeStreamTypes } from './ffmpeg.mjs';
import { validate } from './manifest.mjs';

/** Drift allowance between the two streams of one file, in frames. Never widen this. */
export const DRIFT_FRAMES = 1.5;

/** Per beat filename, zero padded so a directory listing is in playing order. */
export const beatFileName = (index, id, extension = 'mp4') =>
  `${String(index + 1).padStart(2, '0')}-${id}.${extension}`;

const round = (n) => Number(Number(n).toFixed(3));

/**
 * Parse an SRT into windows, strictly.
 *
 * Anything it cannot read is returned as a problem rather than skipped, because a caption file the
 * parser quietly drops half of is a caption file nobody is checking.
 */
export function parseSrt(text) {
  const cues = [];
  const problems = [];
  const blocks = String(text).replace(/\r\n/g, '\n').trim().split(/\n{2,}/);
  const timing = /^(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})$/;
  const toSeconds = (h, m, s, ms) => Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;

  blocks.forEach((block, index) => {
    const lines = block.split('\n');
    if (lines.length < 3) {
      problems.push(`caption block ${index + 1} has ${lines.length} lines, and a cue needs at least three`);
      return;
    }
    const match = timing.exec(lines[1].trim());
    if (!match) {
      problems.push(`caption block ${index + 1} has an unreadable timing line: "${lines[1]}"`);
      return;
    }
    cues.push({
      index: Number(lines[0].trim()),
      start: toSeconds(match[1], match[2], match[3], match[4]),
      end: toSeconds(match[5], match[6], match[7], match[8]),
      text: lines.slice(2).join(' ').trim(),
    });
  });
  return { cues, problems };
}

/**
 * Run the gate.
 *
 * @param {{root: string, spec: object}} input the media root to measure and the manifest to measure
 *   it against. The manifest is re validated here rather than trusted from the caller.
 * @returns {{ok: boolean, checked: number, declared: number, problems: string[], measured: object}}
 */
export function runGate({ root, spec }) {
  const problems = [];
  const measured = { beats: [], totalSeconds: null, outputFile: null, checkedBeats: 0 };

  const structural = validate(spec, { requireFrozen: true });
  if (structural.length) {
    return {
      ok: false,
      checked: 0,
      declared: Array.isArray(spec?.beats) ? spec.beats.length : 0,
      problems: structural.map((p) => `manifest: ${p}`),
      measured,
    };
  }

  const declared = spec.beats.length;
  const fps = spec.video.fps;
  const frame = 1 / fps;
  const drift = DRIFT_FRAMES * frame;

  const timingPath = path.join(root, 'narration', 'timing.json');
  const captionsPath = path.join(root, 'narration', 'captions.en.srt');
  const outputPath = path.join(root, 'output', spec.video.outputName);
  const receiptPath = path.join(root, 'output', 'video-receipt.json');
  measured.outputFile = outputPath;

  /* ---- the measured narration, which every downstream window is derived from */

  let timing = null;
  if (!fs.existsSync(timingPath)) {
    problems.push(`no narration timing at ${timingPath}. Run the narrate step before the gate`);
  } else {
    try {
      timing = JSON.parse(fs.readFileSync(timingPath, 'utf8'));
    } catch (error) {
      problems.push(`narration timing is not valid JSON: ${error.message}`);
    }
  }
  const timingById = new Map();
  if (Array.isArray(timing?.beats)) {
    for (const entry of timing.beats) timingById.set(entry.id, entry);
  } else if (timing) {
    problems.push('narration timing carries no beats array');
  }

  /* ---- every declared beat, whether or not a file for it exists */

  let sumHolds = 0;
  spec.beats.forEach((beat, index) => {
    const label = `beat ${index + 1} (${beat.id})`;
    const cutPath = path.join(root, 'beats', beatFileName(index, beat.id));
    const record = { id: beat.id, index: index + 1, cut: cutPath };

    const timed = timingById.get(beat.id);
    if (!timed) {
      problems.push(`${label}: the narration timing has no entry, so nothing states how long it runs`);
    } else if (!(timed.holdSeconds > 0)) {
      problems.push(`${label}: the narration timing gives holdSeconds ${timed.holdSeconds}`);
    } else {
      record.holdSeconds = round(timed.holdSeconds);
      sumHolds += timed.holdSeconds;
      if (timed.holdSeconds < 3 || timed.holdSeconds > 40) {
        problems.push(`${label}: measured ${round(timed.holdSeconds)}s, outside the 3 to 40 second `
          + 'window a single beat is allowed');
      }
    }

    if (!fs.existsSync(cutPath)) {
      problems.push(`${label}: MISSING TAKE. There is no cut at ${cutPath}, and a beat with no cut `
        + 'is not a beat that passed');
      measured.beats.push(record);
      return;
    }

    let videoSeconds = null;
    let audioSeconds = null;
    try {
      videoSeconds = probeStreamSeconds(cutPath, 'v');
      audioSeconds = probeStreamSeconds(cutPath, 'a');
    } catch (error) {
      problems.push(`${label}: could not be measured: ${error.message}`);
      measured.beats.push(record);
      return;
    }

    if (videoSeconds === null) problems.push(`${label}: the cut carries no video stream`);
    if (audioSeconds === null) problems.push(`${label}: the cut carries no audio stream, so the voice for it was never mixed in`);
    record.videoSeconds = videoSeconds === null ? null : round(videoSeconds);
    record.audioSeconds = audioSeconds === null ? null : round(audioSeconds);

    if (videoSeconds !== null && audioSeconds !== null) {
      const delta = Math.abs(videoSeconds - audioSeconds);
      record.driftSeconds = round(delta);
      if (delta > drift) {
        problems.push(`${label}: DRIFT. Picture runs ${round(videoSeconds)}s and voice runs `
          + `${round(audioSeconds)}s, a difference of ${round(delta)}s, and the allowance is `
          + `${round(drift)}s at ${fps} frames per second`);
      }
    }

    // A cut left over from before a narration edit is the quiet way one beat goes stale while every
    // other beat stays right, so the cut is compared against the measurement it was cut from.
    if (record.holdSeconds && videoSeconds !== null) {
      const staleBy = Math.abs(videoSeconds - timed.holdSeconds);
      if (staleBy > drift) {
        problems.push(`${label}: the cut is ${round(videoSeconds)}s but the narration it was cut `
          + `from measures ${round(timed.holdSeconds)}s. Re render this beat`);
      }
    }

    measured.beats.push(record);
    measured.checkedBeats += 1;
  });

  /*
   * THE INSTRUMENT CHECK, BEFORE ANY VERDICT.
   *
   * `0 beats checked` is an instrument failure, never a clean run. This is asserted rather than
   * assumed because a gate that iterates over files found on disk reports PASS on an empty
   * directory, and that is a green light for a video that does not exist.
   */
  if (measured.checkedBeats !== declared) {
    problems.push(`the gate measured ${measured.checkedBeats} of ${declared} declared beats. Every `
      + 'declared beat has to be measured before any verdict means anything');
  }

  /* ---- the shipped file */

  if (!fs.existsSync(outputPath)) {
    problems.push(`no composed video at ${outputPath}`);
  } else {
    let total = null;
    try {
      total = probeSeconds(outputPath);
      measured.totalSeconds = round(total);
      const kinds = probeStreamTypes(outputPath);
      if (!kinds.includes('video')) problems.push('the composed video carries no video stream');
      if (!kinds.includes('audio')) problems.push('the composed video carries no audio stream');

      const v = probeStreamSeconds(outputPath, 'v');
      const a = probeStreamSeconds(outputPath, 'a');
      measured.videoSeconds = v === null ? null : round(v);
      measured.audioSeconds = a === null ? null : round(a);
      if (v !== null && a !== null && Math.abs(v - a) > drift) {
        problems.push(`DRIFT in the composed video. Picture runs ${round(v)}s and voice runs `
          + `${round(a)}s, a difference of ${round(Math.abs(v - a))}s against an allowance of ${round(drift)}s`);
      }

      // One frame of rounding per concatenated segment, and not a second more.
      const concatAllowance = declared * frame;
      if (sumHolds > 0 && Math.abs(total - sumHolds) > concatAllowance) {
        problems.push(`the composed video is ${round(total)}s and the beats it was built from `
          + `measure ${round(sumHolds)}s. A gap of ${round(Math.abs(total - sumHolds))}s means the `
          + 'composition dropped or stretched something');
      }

      const { targetMinSeconds, targetMaxSeconds, hardCapSeconds } = spec.duration;
      if (total >= hardCapSeconds) {
        problems.push(`the composed video is ${round(total)}s and the hard cap is under `
          + `${hardCapSeconds}s. Cut words, never raise the cap`);
      } else if (total < targetMinSeconds || total > targetMaxSeconds) {
        problems.push(`the composed video is ${round(total)}s, outside the target band of `
          + `${targetMinSeconds} to ${targetMaxSeconds}s`);
      }
    } catch (error) {
      problems.push(`the composed video could not be measured: ${error.message}`);
    }

    /* ---- captions, in bounds of the file that was actually measured */

    if (!fs.existsSync(captionsPath)) {
      problems.push(`no captions at ${captionsPath}`);
    } else {
      const { cues, problems: parseProblems } = parseSrt(fs.readFileSync(captionsPath, 'utf8'));
      problems.push(...parseProblems.map((p) => `captions: ${p}`));
      if (!cues.length) {
        problems.push('captions: the file parsed to zero cues, so nothing was checked');
      }
      let previousEnd = -1;
      cues.forEach((cue, i) => {
        if (cue.end <= cue.start) {
          problems.push(`captions: cue ${i + 1} ends at or before it starts`);
        }
        if (cue.start < previousEnd) {
          problems.push(`captions: cue ${i + 1} starts at ${round(cue.start)}s, before cue ${i} ended `
            + `at ${round(previousEnd)}s`);
        }
        previousEnd = cue.end;
        if (total !== null && cue.end > total + frame) {
          problems.push(`captions: cue ${i + 1} ends at ${round(cue.end)}s, past the end of a `
            + `${round(total)}s video`);
        }
      });
    }
  }

  /* ---- the receipt binds the file to the commit and the URL it is a video of */

  if (!fs.existsSync(receiptPath)) {
    problems.push(`no build receipt at ${receiptPath}, so nothing states which commit this is a video of`);
  } else {
    let receipt = null;
    try {
      receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    } catch (error) {
      problems.push(`the build receipt is not valid JSON: ${error.message}`);
    }
    if (receipt) {
      if (receipt.frozenSha !== spec.frozenSha) {
        problems.push(`the receipt records commit ${receipt.frozenSha} and the manifest freezes `
          + `${spec.frozenSha}. The video is of a different commit than the one submitted`);
      }
      if (receipt.deployedUrl !== spec.deployedUrl) {
        problems.push(`the receipt records ${receipt.deployedUrl} and the manifest names ${spec.deployedUrl}`);
      }
      if (fs.existsSync(outputPath)) {
        const digest = crypto.createHash('sha256').update(fs.readFileSync(outputPath)).digest('hex');
        measured.sha256 = digest;
        if (receipt.sha256 !== digest) {
          problems.push('the receipt\'s hash is not the hash of the file beside it, so the receipt '
            + 'describes a build that has since been replaced');
        }
      }
    }
  }

  return { ok: problems.length === 0, checked: measured.checkedBeats, declared, problems, measured };
}

/** Print a gate result the same way for every caller. Returns the process exit code. */
export function report(result) {
  console.log(`gate: measured ${result.checked} of ${result.declared} declared beats.`);
  for (const beat of result.measured.beats) {
    const drift = beat.driftSeconds === undefined ? 'no cut' : `drift ${beat.driftSeconds}s`;
    console.log(`  ${String(beat.index).padStart(2, '0')} ${beat.id.padEnd(12)} `
      + `hold ${beat.holdSeconds ?? '?'}s  ${drift}`);
  }
  if (result.measured.totalSeconds !== null) {
    console.log(`  total ${result.measured.totalSeconds}s`
      + (result.measured.sha256 ? `  sha256 ${result.measured.sha256.slice(0, 16)}` : ''));
  }
  if (result.ok) {
    console.log('gate: PASS.');
    return 0;
  }
  console.error(`gate: FAIL, ${result.problems.length} problems.`);
  for (const problem of result.problems) console.error(`  - ${problem}`);
  return 1;
}
