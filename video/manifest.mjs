/**
 * Load and validate video/narration.json, and resolve the media root.
 *
 * ONE LOADER, FOUR READERS. --plan, narrate, build and the gate all come through here, so a beat
 * list that --plan accepted cannot be a different beat list by the time the gate reads it. The
 * validator is exported as a pure function over an already parsed object, which is what lets the
 * selftest hand it deliberately broken manifests without writing a file anywhere.
 *
 * NOTHING HERE INVENTS A DURATION. `expectedSeconds` is an authored planning figure and
 * `wordsPerSecond` derives a second one from the word count. --plan compares them and complains
 * when they disagree, because a planning number nobody checks is a number that rots. The only
 * durations that ever gate anything are measured with ffprobe.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..');
export const MANIFEST_PATH = path.join(HERE, 'narration.json');

/** The unfilled marker. A field still holding one of these refuses to narrate or build. */
export const PLACEHOLDER = /<[A-Z_0-9]+>/;

const ID_PATTERN = /^[a-z][a-z-]{1,24}$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;

/** A beat's measured speech may not be shorter or longer than this, whatever the total says. */
export const BEAT_MIN_SECONDS = 3;
export const BEAT_MAX_SECONDS = 40;

/**
 * Where the media lives. Outside the tracked tree by default.
 *
 * `tmp/` is in .gitignore AND in the style gate's ignored directories, so generated audio, takes
 * and receipts can never quietly create a new directory of files the style gate does not walk.
 * Point NINTHTOOL_VIDEO_ROOT somewhere else if the disk here is tight.
 */
export function mediaRoot() {
  const set = process.env.NINTHTOOL_VIDEO_ROOT;
  return set && set.trim() ? path.resolve(set.trim()) : path.join(REPO_ROOT, 'tmp', 'video');
}

export const paths = () => {
  const root = mediaRoot();
  return {
    root,
    takes: path.join(root, 'takes'),
    narration: path.join(root, 'narration'),
    beats: path.join(root, 'beats'),
    output: path.join(root, 'output'),
    timing: path.join(root, 'narration', 'timing.json'),
    captions: path.join(root, 'narration', 'captions.en.srt'),
    receipt: path.join(root, 'output', 'video-receipt.json'),
  };
};

/** Words as a human counts them, which is what the planning figure is calibrated against. */
export const wordCount = (text) => String(text).trim().split(/\s+/).filter(Boolean).length;

/**
 * Every structural rule the manifest has to satisfy, as a pure function.
 *
 * Returns a list of problems rather than throwing, so one run reports everything wrong at once and
 * so the selftest can assert WHICH rule fired rather than only that something did.
 *
 * @param {any} spec a parsed manifest
 * @param {{requireFrozen?: boolean}} options requireFrozen is false for --plan and true for
 *   anything that produces media, because the SHA cannot be known until the takes are recorded.
 * @returns {string[]}
 */
export function validate(spec, options = {}) {
  const problems = [];
  const requireFrozen = options.requireFrozen === true;

  if (!spec || typeof spec !== 'object') return ['the manifest is not a JSON object'];
  if (spec.schemaVersion !== 'ninthtool.submission-video/v1') {
    problems.push(`schemaVersion is "${spec.schemaVersion}", not ninthtool.submission-video/v1`);
  }

  if (typeof spec.deployedUrl !== 'string' || !/^https:\/\/\S+$/.test(spec.deployedUrl)) {
    problems.push('deployedUrl must be an https URL, and it is the URL the takes are recorded against');
  }

  const sha = String(spec.frozenSha ?? '');
  if (requireFrozen && !SHA_PATTERN.test(sha)) {
    problems.push(PLACEHOLDER.test(sha)
      ? 'frozenSha is still the placeholder. Freeze the commit the live surface is serving, put its '
        + '40 character SHA here, and only then record or build'
      : `frozenSha must be 40 hexadecimal characters, and it is "${sha}"`);
  }

  const plan = spec.planning ?? {};
  if (!(plan.wordsPerSecond > 0)) problems.push('planning.wordsPerSecond must be a positive number');
  if (!(plan.tailSeconds >= 0)) problems.push('planning.tailSeconds must be zero or more');

  const d = spec.duration ?? {};
  if (!(d.targetMinSeconds > 0 && d.targetMaxSeconds > d.targetMinSeconds)) {
    problems.push('duration.targetMinSeconds and targetMaxSeconds must be a positive ascending pair');
  }
  if (!(d.hardCapSeconds > d.targetMaxSeconds)) {
    problems.push('duration.hardCapSeconds must be above the target band');
  }
  if (d.hardCapSeconds > 180) {
    problems.push(`duration.hardCapSeconds is ${d.hardCapSeconds}, and the rule limit is under 180 `
      + 'seconds. Never widen this to make a run pass');
  }

  const beats = spec.beats;
  if (!Array.isArray(beats) || beats.length === 0) {
    problems.push('beats must be a non empty array');
    return problems;
  }

  const seen = new Set();
  beats.forEach((beat, index) => {
    const at = `beat ${index + 1}`;
    const id = beat?.id;
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
      problems.push(`${at}: id "${id}" must match ${ID_PATTERN}`);
    } else if (seen.has(id)) {
      problems.push(`${at}: id "${id}" is used twice, and the take filenames would collide`);
    } else {
      seen.add(id);
    }

    for (const field of ['captionText', 'speechText', 'onScreen']) {
      const value = beat?.[field];
      if (typeof value !== 'string' || value.length < 20 || value.length > 800) {
        problems.push(`${at} (${id}): ${field} must be a string of 20 to 800 characters`);
      } else if (PLACEHOLDER.test(value)) {
        problems.push(`${at} (${id}): ${field} still holds an unfilled placeholder`);
      }
    }

    if (!(beat?.expectedSeconds > 0)) {
      problems.push(`${at} (${id}): expectedSeconds must be a positive number`);
    }
  });

  return problems;
}

/**
 * Read the manifest off disk and validate it. Throws with every problem listed, not just the first.
 *
 * @param {{requireFrozen?: boolean}} options
 */
export function load(options = {}) {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`no manifest at ${MANIFEST_PATH}`);
  }
  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch (error) {
    throw new Error(`${MANIFEST_PATH} is not valid JSON: ${error.message}`);
  }
  const problems = validate(spec, options);
  if (problems.length) {
    throw new Error(`the manifest is not usable:\n  - ${problems.join('\n  - ')}`);
  }
  return spec;
}

/** The plan a beat implies before any media exists: words, the derived seconds, the authored ones. */
export function planFor(spec) {
  const wps = spec.planning.wordsPerSecond;
  const tail = spec.planning.tailSeconds;
  const rows = spec.beats.map((beat, index) => {
    const words = wordCount(beat.speechText);
    const derived = words / wps + tail;
    const authored = beat.expectedSeconds;
    return {
      index: index + 1,
      id: beat.id,
      words,
      derivedSeconds: Number(derived.toFixed(2)),
      expectedSeconds: authored,
      drift: Math.abs(derived - authored) / authored,
    };
  });
  return {
    rows,
    totalWords: rows.reduce((sum, row) => sum + row.words, 0),
    totalDerived: Number(rows.reduce((sum, row) => sum + row.derivedSeconds, 0).toFixed(2)),
    totalExpected: Number(rows.reduce((sum, row) => sum + row.expectedSeconds, 0).toFixed(2)),
  };
}
