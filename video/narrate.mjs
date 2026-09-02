/**
 * Synthesize one audio file per beat, measure each one, and write the timing and the captions.
 *
 * THE CACHE IS A CORRECTNESS REQUIREMENT, NOT A SPEED ONE. A text to speech engine does not return
 * identical audio for identical input. Without a cache, fixing one word in beat six re-rolls every
 * other beat, every measured duration moves, and every start offset after it moves with them, so a
 * one word fix invalidates the whole cut. With it, an unchanged beat keeps its exact file and its
 * exact measured length, and only the edited beat is re-synthesized. That is the property that
 * makes "leave the video to the end" stop being an argument.
 *
 * NOTHING HERE AUTHORS A TIMESTAMP. Every duration is ffprobe's reading of the file that was just
 * written, and the caption windows are shares of those same readings. A caption cannot drift from
 * audio it was derived from.
 *
 * THE KEY IS READ, NEVER PRINTED, NEVER DEFAULTED. If no key is set this stops and says so. It does
 * not fall back to a silent tone, and it does not carry on and leave an empty directory looking
 * like a completed step.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { requireBinaries, probeSeconds } from './ffmpeg.mjs';
import { load, paths, PLACEHOLDER, BEAT_MIN_SECONDS, BEAT_MAX_SECONDS } from './manifest.mjs';

/** Read in this order, because past repositories here used different names for the same key. */
export const KEY_NAMES = ['ELEVENLABS_API_KEY', 'XI_API_KEY', 'ELEVEN_LABS_KEY'];

/**
 * Find the key, or explain exactly what is missing.
 *
 * @returns {{name: string, value: string}}
 */
export function requireKey() {
  for (const name of KEY_NAMES) {
    const value = process.env[name];
    if (value && value.trim()) return { name, value: value.trim() };
  }
  throw new Error(
    'no text to speech key is set, so no narration can be produced and nothing was written.\n'
    + `Set one of: ${KEY_NAMES.join(', ')}.\n`
    + 'In CI it is a repository secret of the same name. The value is never printed by this pipeline.',
  );
}

/** What a beat's audio depends on. Change any of it and that beat, and only that beat, re-rolls. */
function cacheKey(spec, beat) {
  return crypto.createHash('sha256').update(JSON.stringify({
    provider: spec.provider,
    voice: spec.elevenLabs,
    speech: beat.speechText,
  })).digest('hex');
}

async function synthesizeElevenLabs(spec, beat, key) {
  const { voiceId, modelId, outputFormat } = spec.elevenLabs;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`
    + `?output_format=${encodeURIComponent(outputFormat)}`;

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
        body: JSON.stringify({ text: beat.speechText, model_id: modelId }),
      });
    } catch (error) {
      lastError = `network error: ${error.message}`;
      continue;
    }
    if (response.ok) return Buffer.from(await response.arrayBuffer());
    // The body can carry the provider's reason, which is worth surfacing. It never carries the key.
    const detail = await response.text().catch(() => '');
    lastError = `HTTP ${response.status} ${response.statusText} ${detail.slice(0, 300)}`;
    if (response.status < 500 && response.status !== 429) break;
  }
  throw new Error(`text to speech failed for beat "${beat.id}": ${lastError}`);
}

/** Split a caption into sentences, so each one gets its own share of the beat's measured audio. */
function sentences(text) {
  const parts = String(text).match(/[^.!?]+[.!?]*/g) || [text];
  return parts.map((s) => s.trim()).filter(Boolean);
}

const stamp = (seconds) => {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  return `${h}:${m}:${s},${String(ms % 1000).padStart(3, '0')}`;
};

/**
 * Run the narration step.
 *
 * @param {{force?: string, only?: string}} options force is 'all' to re-roll everything, or a beat
 *   id to re-roll one without changing its words. only restricts the run to a single beat.
 */
export async function narrate(options = {}) {
  requireBinaries();
  const spec = load();
  const { name: keyName, value: key } = requireKey();
  const p = paths();

  if (PLACEHOLDER.test(String(spec.frozenSha))) {
    console.warn('warning: frozenSha is still the placeholder. Narration does not need it, but the '
      + 'build and the gate refuse without it, and the freeze belongs BEFORE the takes are recorded.');
  }

  fs.mkdirSync(p.narration, { recursive: true });
  console.log(`narrate: provider ${spec.provider}, key from ${keyName}, media root ${p.root}`);

  const results = [];
  let start = 0;
  for (const [index, beat] of spec.beats.entries()) {
    const stem = `${String(index + 1).padStart(2, '0')}-${beat.id}`;
    const audioPath = path.join(p.narration, `${stem}.mp3`);
    const sidecarPath = path.join(p.narration, `${stem}.cache.json`);
    const wanted = cacheKey(spec, beat);

    const forced = options.force === 'all' || options.force === beat.id;
    const skipped = options.only && options.only !== beat.id;
    let state = 'reused';

    const cached = fs.existsSync(sidecarPath) && fs.existsSync(audioPath)
      && JSON.parse(fs.readFileSync(sidecarPath, 'utf8')).key === wanted;

    if (skipped && !cached) {
      throw new Error(`beat "${beat.id}" was excluded by --only but has no cached audio, so the `
        + 'timing this step writes would be incomplete. Run without --only once first.');
    }

    if (!skipped && (forced || !cached)) {
      const audio = await synthesizeElevenLabs(spec, beat, key);
      fs.writeFileSync(audioPath, audio);
      fs.writeFileSync(sidecarPath, JSON.stringify({ key: wanted, id: beat.id }, null, 1));
      state = forced && cached ? 're-rolled' : 'synthesized';
    }

    const measuredSeconds = probeSeconds(audioPath);
    if (measuredSeconds < BEAT_MIN_SECONDS || measuredSeconds > BEAT_MAX_SECONDS) {
      throw new Error(`beat "${beat.id}" measures ${measuredSeconds.toFixed(2)}s, outside the `
        + `${BEAT_MIN_SECONDS} to ${BEAT_MAX_SECONDS} second window one beat is allowed`);
    }
    const holdSeconds = measuredSeconds + spec.planning.tailSeconds;

    results.push({
      id: beat.id, index: index + 1, file: path.basename(audioPath), state,
      measuredSeconds: Number(measuredSeconds.toFixed(3)),
      holdSeconds: Number(holdSeconds.toFixed(3)),
      startSeconds: Number(start.toFixed(3)),
      expectedSeconds: beat.expectedSeconds,
    });
    console.log(`  ${stem.padEnd(16)} ${state.padEnd(12)} measured ${measuredSeconds.toFixed(2)}s `
      + `(planned ${beat.expectedSeconds}s)`);
    start += holdSeconds;
  }

  const total = start;
  const { targetMinSeconds, targetMaxSeconds, hardCapSeconds } = spec.duration;

  /* ---- captions, as shares of the measurements above and of nothing else */

  const cues = [];
  for (const [index, beat] of spec.beats.entries()) {
    const timed = results[index];
    const lines = sentences(beat.captionText);
    const weights = lines.map((line) => line.length);
    const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
    let cursor = timed.startSeconds;
    lines.forEach((line, i) => {
      const share = (weights[i] / totalWeight) * timed.measuredSeconds;
      cues.push({ start: cursor, end: cursor + share, text: line });
      cursor += share;
    });
  }
  const srt = cues.map((cue, i) =>
    `${i + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text}\n`).join('\n');
  fs.writeFileSync(p.captions, `${srt}\n`);

  fs.writeFileSync(p.timing, `${JSON.stringify({
    schemaVersion: spec.schemaVersion,
    frozenSha: spec.frozenSha,
    deployedUrl: spec.deployedUrl,
    tailSeconds: spec.planning.tailSeconds,
    totalSeconds: Number(total.toFixed(3)),
    beats: results,
  }, null, 2)}\n`);

  console.log(`narrate: ${results.filter((r) => r.state !== 'reused').length} of ${results.length} `
    + `beats synthesized. Measured total ${total.toFixed(3)}s across ${results.length} beats.`);
  console.log(`narrate: wrote ${p.timing} and ${p.captions}`);

  if (total >= hardCapSeconds) {
    throw new Error(`the narration measures ${total.toFixed(3)}s and the hard cap is under `
      + `${hardCapSeconds}s. Cut words. Never raise the cap.`);
  }
  if (total < targetMinSeconds || total > targetMaxSeconds) {
    throw new Error(`the narration measures ${total.toFixed(3)}s, outside the target band of `
      + `${targetMinSeconds} to ${targetMaxSeconds}s. Cut or add words and run again. Only the beats `
      + 'you edit are re-synthesized, so this costs one call per edited beat.');
  }

  console.log('narrate: inside the target band. Record the takes now, each one at least as long as '
    + 'its beat above.');
  return { total, results };
}
