/**
 * Prove the gate can fail, by breaking real media and real manifests and watching it go red.
 *
 * IT CALLS THE GATE, NOT A COPY OF IT. `runGate` is imported from video/gate.mjs and handed each
 * broken tree. This repository has twice shipped a self test that re-implemented the rules it was
 * meant to be proving, so mutating the real checker left the self test printing PASS. If someone
 * breaks the gate below this line, every case here goes red, which is the only property that makes
 * a detect-only gate worth anything.
 *
 * EACH CASE NAMES THE RULE IT IS MEANT TO TRIP, and the failure has to mention that rule. A case
 * caught by the wrong rule is not counted as proof: a manifest that is broken in two ways would
 * otherwise "prove" a rule that never ran.
 *
 * THE HEALTHY CASE IS PART OF THE PROOF. A gate that fails everything is not a gate. So the same
 * function is handed a correct tree first and has to pass it, and only then are the breakages
 * introduced one at a time into copies of that tree.
 *
 * It needs ffmpeg and ffprobe. It needs no key and no network.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { requireBinaries, run, synthesise, probeSeconds } from './ffmpeg.mjs';
import { runGate, beatFileName } from './gate.mjs';
import { load } from './manifest.mjs';

const SHA = 'a'.repeat(40);
const URL = 'https://upgradedev.github.io/ninthtool/';

/**
 * A small three beat manifest, valid by the same validator the shipped one goes through.
 *
 * It is small so the self test runs in seconds. The band is small to match, and the SHIPPED band is
 * asserted separately at the bottom, so shrinking one here can never quietly excuse the other.
 */
function selftestSpec() {
  const beat = (id, seconds) => ({
    id,
    expectedSeconds: seconds,
    onScreen: `whatever beat ${id} has to be showing while it plays, at least twenty characters`,
    captionText: `The caption a viewer reads during beat ${id} of this deliberately small tree.`,
    speechText: `The words the voice says during beat ${id} of this deliberately small tree.`,
  });
  return {
    schemaVersion: 'ninthtool.submission-video/v1',
    frozenSha: SHA,
    deployedUrl: URL,
    provider: 'elevenlabs',
    elevenLabs: { voiceId: 'x', modelId: 'y', outputFormat: 'mp3_44100_128' },
    planning: { wordsPerSecond: 2.5, tailSeconds: 0.5, expectedDriftTolerance: 0.15 },
    duration: { targetMinSeconds: 6, targetMaxSeconds: 12, hardCapSeconds: 15 },
    video: { width: 320, height: 180, fps: 25, outputName: 'selftest.mp4' },
    beats: [beat('alpha', 3), beat('beta', 3.2), beat('gamma', 3.4)],
  };
}

const HOLDS = { alpha: 3, beta: 3.2, gamma: 3.4 };

const stamp = (seconds) => {
  const ms = Math.round(seconds * 1000);
  const pad = (n, w) => String(n).padStart(w, '0');
  return `${pad(Math.floor(ms / 3600000), 2)}:${pad(Math.floor((ms % 3600000) / 60000), 2)}:`
    + `${pad(Math.floor((ms % 60000) / 1000), 2)},${pad(ms % 1000, 3)}`;
};

/** Build a tree the gate has to accept. Everything else in this file is a copy of it, broken. */
function buildHealthy(root, spec) {
  for (const dir of ['narration', 'beats', 'output']) fs.mkdirSync(path.join(root, dir), { recursive: true });

  const timing = { schemaVersion: spec.schemaVersion, frozenSha: SHA, deployedUrl: URL, beats: [] };
  let start = 0;
  const cuts = [];
  spec.beats.forEach((beat, index) => {
    const hold = HOLDS[beat.id];
    const cut = path.join(root, 'beats', beatFileName(index, beat.id));
    synthesise(cut, hold, { width: spec.video.width, height: spec.video.height, fps: spec.video.fps });
    cuts.push(cut);
    timing.beats.push({
      id: beat.id, index: index + 1, file: `${String(index + 1).padStart(2, '0')}-${beat.id}.mp3`,
      measuredSeconds: hold - spec.planning.tailSeconds, holdSeconds: hold,
      startSeconds: Number(start.toFixed(3)),
    });
    start += hold;
  });
  timing.totalSeconds = Number(start.toFixed(3));
  fs.writeFileSync(path.join(root, 'narration', 'timing.json'), JSON.stringify(timing, null, 2));

  const cues = timing.beats.map((entry, i) =>
    `${i + 1}\n${stamp(entry.startSeconds)} --> ${stamp(entry.startSeconds + entry.measuredSeconds)}\n`
    + `${spec.beats[i].captionText}\n`);
  fs.writeFileSync(path.join(root, 'narration', 'captions.en.srt'), `${cues.join('\n')}\n`);

  const list = path.join(root, 'beats', 'concat.txt');
  fs.writeFileSync(list, `${cuts.map((c) => `file '${c.split(path.sep).join('/')}'`).join('\n')}\n`);
  const output = path.join(root, 'output', spec.video.outputName);
  run(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', output]);

  fs.writeFileSync(path.join(root, 'output', 'video-receipt.json'), JSON.stringify({
    schemaVersion: 'ninthtool.submission-video-receipt/v1',
    frozenSha: SHA, deployedUrl: URL, outputName: spec.video.outputName,
    beatCount: cuts.length, totalSeconds: Number(probeSeconds(output).toFixed(3)),
    sha256: crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex'),
  }, null, 2));
  return root;
}

function main() {
  requireBinaries();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ninthtool-video-gate-'));
  const spec = selftestSpec();
  const healthy = buildHealthy(path.join(workspace, 'healthy'), spec);
  let broken = 0;

  /* ---- a gate that fails everything is not a gate */

  const good = runGate({ root: healthy, spec });
  if (!good.ok) {
    console.error('selftest: the CORRECT tree was rejected, so every failure below proves nothing.');
    for (const problem of good.problems) console.error(`  - ${problem}`);
    broken++;
  } else if (good.checked !== spec.beats.length) {
    console.error(`selftest: the correct tree passed while only ${good.checked} of `
      + `${spec.beats.length} beats were measured.`);
    broken++;
  } else {
    console.log(`selftest: the correct tree PASSED, ${good.checked} of ${good.declared} beats `
      + `measured, total ${good.measured.totalSeconds}s.`);
  }

  /*
   * One breakage per case, introduced into its own copy of the healthy tree, plus the rule its
   * failure has to name. `mutate` may edit the tree, the spec, or both.
   */
  const cases = [
    ['audio and picture drift apart in one beat', /DRIFT/, (root) => {
      synthesise(path.join(root, 'beats', beatFileName(1, 'beta')), HOLDS.beta,
        { width: 320, height: 180, fps: 25, audioSeconds: 1.5 });
    }],
    ['a take is missing rather than a cut being wrong', /MISSING TAKE/, (root) => {
      fs.rmSync(path.join(root, 'beats', beatFileName(2, 'gamma')));
    }],
    ['no beat was measured at all', /measured 0 of 3/, (root) => {
      for (const [index, id] of ['alpha', 'beta', 'gamma'].entries()) {
        fs.rmSync(path.join(root, 'beats', beatFileName(index, id)));
      }
    }],
    ['a cut is stale after its narration changed', /Re render this beat/, (root) => {
      const timingPath = path.join(root, 'narration', 'timing.json');
      const timing = JSON.parse(fs.readFileSync(timingPath, 'utf8'));
      timing.beats[0].holdSeconds = 6.5;
      timing.beats[0].measuredSeconds = 6;
      fs.writeFileSync(timingPath, JSON.stringify(timing, null, 2));
    }],
    ['the cut runs past the rule limit', /hard cap/, (root, s) => {
      s.duration = { targetMinSeconds: 1, targetMaxSeconds: 2, hardCapSeconds: 3 };
    }],
    ['the cut lands outside the target band', /outside the target band/, (root, s) => {
      s.duration = { targetMinSeconds: 30, targetMaxSeconds: 40, hardCapSeconds: 50 };
    }],
    ['a caption runs past the end of the video', /past the end of a/, (root) => {
      const file = path.join(root, 'narration', 'captions.en.srt');
      fs.writeFileSync(file, `${fs.readFileSync(file, 'utf8')}\n4\n${stamp(9)} --> ${stamp(400)}\n`
        + 'a caption nobody will ever see, because the video ends first\n');
    }],
    ['the receipt describes a file that has since been replaced', /the receipt's hash/, (root) => {
      const file = path.join(root, 'output', 'video-receipt.json');
      const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
      receipt.sha256 = 'b'.repeat(64);
      fs.writeFileSync(file, JSON.stringify(receipt, null, 2));
    }],
    ['the video is of a different commit than the one submitted', /different commit/, (root) => {
      const file = path.join(root, 'output', 'video-receipt.json');
      const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
      receipt.frozenSha = 'c'.repeat(40);
      fs.writeFileSync(file, JSON.stringify(receipt, null, 2));
    }],
    ['the manifest never froze a commit', /placeholder/, (root, s) => {
      s.frozenSha = '<FROZEN_SHA_40_HEX>';
    }],
    ['the narration step never ran', /no narration timing/, (root) => {
      fs.rmSync(path.join(root, 'narration', 'timing.json'));
    }],
    ['a planning threshold was quietly removed', /expectedDriftTolerance/, (root, s) => {
      delete s.planning.expectedDriftTolerance;
    }],
  ];

  cases.forEach(([label, expected, mutate], i) => {
    const root = path.join(workspace, `case-${i + 1}`);
    fs.cpSync(healthy, root, { recursive: true });
    const mutated = JSON.parse(JSON.stringify(spec));
    mutate(root, mutated);

    const result = runGate({ root, spec: mutated });
    if (result.ok) {
      console.error(`selftest: "${label}" was NOT caught. The gate passed a broken tree.`);
      broken++;
    } else if (!result.problems.some((problem) => expected.test(problem))) {
      console.error(`selftest: "${label}" was caught by the wrong rule. Wanted ${expected}, got:`);
      for (const problem of result.problems) console.error(`    - ${problem}`);
      broken++;
    } else {
      console.log(`selftest: caught "${label}".`);
    }
  });

  /*
   * The band above is a small one so the media stays cheap. The SHIPPED band is a different number
   * and is asserted here from the real manifest, so a shrunken test band can never stand in for it.
   */
  const shipped = load();
  const { targetMinSeconds, targetMaxSeconds, hardCapSeconds } = shipped.duration;
  if (targetMinSeconds !== 150 || targetMaxSeconds !== 165 || hardCapSeconds !== 180) {
    console.error(`selftest: the shipped manifest targets ${targetMinSeconds} to ${targetMaxSeconds}s `
      + `with a cap of ${hardCapSeconds}s, and the contract is 150 to 165 with a cap of 180.`);
    broken++;
  } else {
    console.log('selftest: the shipped manifest still targets 150 to 165 seconds, capped under 180.');
  }

  fs.rmSync(workspace, { recursive: true, force: true });

  if (broken) {
    console.error(`selftest: FAIL, ${broken} of ${cases.length + 2} checks did not hold.`);
    return 1;
  }
  console.log(`selftest: PASS. The gate accepted one correct tree, and each of the ${cases.length} `
    + 'deliberate breakages was caught by the rule it was aimed at.');
  return 0;
}

process.exit(main());
