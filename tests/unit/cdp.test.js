/**
 * The frame codec and the message pump inside the only code here that speaks a wire protocol.
 *
 * WHY THIS FILE EXISTS. `src/probe/cdp.mjs` is the one module in the repository that reads bytes off
 * a socket and decides what they mean. Everything a run reports about a page arrives through it. A
 * wrong offset in the pump does not crash: it drops a message, or splices two together, and the run
 * carries on and reports fewer behaviours than it saw. That failure is silent, which is exactly the
 * shape of defect an audit found this suite was not looking for. There was no Chrome in the 146
 * tests that came before, so there was nothing looking at the pump either.
 *
 * THE FIXTURES ARE BUILT BY HAND, ON PURPOSE. `serverFrame` below writes the header out from the
 * wire format rather than calling the module's own `frame()`. A test whose input comes from the
 * code under test agrees with that code by construction and can never fail. It would also be the
 * wrong direction: `frame()` masks, because a client must, and a server never does. So the fixtures
 * here set no mask bit, and `readClientFrame` unmasks in the other direction to read what the
 * session wrote.
 *
 * WHAT IS NOT HERE. `openSession` does an HTTP GET for `/json` and then `net.connect`, and
 * `evaluateInPage` goes through it, so neither runs without a live Chrome. They are marked below
 * with a skip rather than faked into something that always passes. The outgoing side of the codec
 * IS here: the commands `send` writes are read back off the fake socket and unmasked, at all three
 * header widths, because a short command would otherwise be the only one ever built.
 *
 * No socket, no browser, no files. Everything below is the Session class fed buffers by hand.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { Session, openSession, evaluateInPage } from '../../src/probe/cdp.mjs';

/* ------------------------------------------------------------------ the wire format, by hand */

/**
 * One server to client frame, written from RFC 6455 section 5.2 rather than from `frame()`.
 *
 * A server never masks, so byte 1 is the length with no 0x80 bit and the payload follows the header
 * directly. Get that wrong and the pump reads four mask bytes as the start of the JSON, drops the
 * frame, and every assertion about what landed passes for the wrong reason.
 */
function serverFrame(payload, { opcode = 1, final = true } = {}) {
  const data = Buffer.from(payload, 'utf8');
  const first = Buffer.from([(final ? 0x80 : 0x00) | opcode]);
  let lengthBytes;
  if (data.length < 126) {
    lengthBytes = Buffer.from([data.length]);
  } else if (data.length < 65536) {
    lengthBytes = Buffer.alloc(3);
    lengthBytes[0] = 126;
    lengthBytes.writeUInt16BE(data.length, 1);
  } else {
    lengthBytes = Buffer.alloc(9);
    lengthBytes[0] = 127;
    lengthBytes.writeBigUInt64BE(BigInt(data.length), 1);
  }
  return Buffer.concat([first, lengthBytes, data]);
}

/**
 * Read back one frame the session wrote. The client masks with four random bytes, so the bytes on
 * the wire differ on every run and comparing them would be a test that can never pass. Unmask, then
 * assert the text.
 */
function readClientFrame(buffer) {
  assert.equal(buffer[0], 0x81, 'the client must send a final text frame');
  assert.ok((buffer[1] & 0x80) !== 0, 'a client frame must be masked, or Chrome closes the socket');
  let length = buffer[1] & 0x7f;
  let at = 2;
  if (length === 126) { length = buffer.readUInt16BE(at); at += 2; } else if (length === 127) {
    length = Number(buffer.readBigUInt64BE(at)); at += 8;
  }
  const mask = buffer.subarray(at, at + 4);
  at += 4;
  const body = buffer.subarray(at, at + length);
  const clear = Buffer.alloc(body.length);
  for (let i = 0; i < body.length; i++) clear[i] = body[i] ^ mask[i % 4];
  return clear.toString('utf8');
}

/** A stand in for the socket. `send` only ever writes to it. */
function fakeSocket() {
  return { writes: [], write(chunk) { this.writes.push(Buffer.from(chunk)); return true; } };
}

/** A JSON message of an exact byte length, so the header boundaries can be hit on the nose. */
function messageOfBytes(id, bytes) {
  const shell = JSON.stringify({ id, v: '' });
  const text = JSON.stringify({ id, v: 'p'.repeat(bytes - shell.length) });
  assert.equal(Buffer.byteLength(text), bytes, 'the fixture builder is off by a byte');
  return text;
}

/* ------------------------------------------------------------------ one frame at a time */

test('a frame with an id becomes an answer, and one without becomes an event', () => {
  const session = new Session(fakeSocket());
  session.feed(serverFrame(JSON.stringify({ id: 7, result: { value: 'yes' } })));
  session.feed(serverFrame(JSON.stringify({ method: 'Log.entryAdded', params: { entry: {} } })));

  assert.deepEqual(session.answers.get(7), { id: 7, result: { value: 'yes' } });
  assert.equal(session.answers.size, 1, 'the event was filed as an answer');
  assert.equal(session.events.length, 1);
  assert.equal(session.events[0].method, 'Log.entryAdded');
  assert.equal(session.buffer.length, 0, 'both frames should have been consumed');
});

test('an answer with id zero is an answer, not an event', () => {
  // The split is on `id !== undefined`. A falsy test would file this one as an event and the send
  // that asked for it would then time out.
  const session = new Session(fakeSocket());
  session.feed(serverFrame(JSON.stringify({ id: 0, result: { first: true } })));
  assert.ok(session.answers.has(0));
  assert.equal(session.events.length, 0);
});

/* ------------------------------------------------------------------ the length headers */

test('a payload of 126 to 65535 bytes arrives through the 16 bit length header', () => {
  const text = JSON.stringify({ id: 1, result: { value: 'x'.repeat(4000) } });
  const bytes = serverFrame(text);
  assert.equal(bytes[1], 126, 'the fixture must use the 16 bit header or this test proves nothing');
  assert.equal(bytes.readUInt16BE(2), Buffer.byteLength(text));

  const session = new Session(fakeSocket());
  session.feed(bytes);
  assert.equal(session.answers.get(1).result.value.length, 4000);
  assert.equal(session.buffer.length, 0);
});

test('a payload over 65535 bytes arrives through the 64 bit length header', () => {
  const text = JSON.stringify({ id: 2, result: { value: 'y'.repeat(70000) } });
  const bytes = serverFrame(text);
  assert.equal(bytes[1], 127, 'the fixture must use the 64 bit header or this test proves nothing');
  assert.equal(Number(bytes.readBigUInt64BE(2)), Buffer.byteLength(text));

  const session = new Session(fakeSocket());
  session.feed(bytes);
  assert.equal(session.answers.get(2).result.value.length, 70000);
  assert.equal(session.buffer.length, 0);
});

test('every length header boundary is parsed, on the byte', () => {
  // 125 is the last small frame, 126 the first extended one, 65535 the last 16 bit and 65536 the
  // first 64 bit. An off by one in either comparison shows up here and nowhere else.
  for (const [size, marker] of [[125, 125], [126, 126], [65535, 126], [65536, 127]]) {
    const bytes = serverFrame(messageOfBytes(1, size));
    assert.equal(bytes[1], marker, `a ${size} byte payload should carry the marker ${marker}`);

    const session = new Session(fakeSocket());
    session.feed(bytes);
    const answer = session.answers.get(1);
    assert.ok(answer, `a ${size} byte payload never landed`);
    assert.equal(answer.v.length, size - 15, `a ${size} byte payload came back a different size`);
    assert.equal(session.buffer.length, 0, `a ${size} byte frame left bytes behind`);
  }
});

/* ------------------------------------------------------------------ reassembly */

test('a message split across a text frame and a continuation frame is put back together', () => {
  const text = JSON.stringify({ id: 5, result: { value: 'split down the middle' } });
  const opening = serverFrame(text.slice(0, 12), { opcode: 1, final: false });
  const closing = serverFrame(text.slice(12), { opcode: 0, final: true });
  assert.equal(opening[0], 0x01, 'the opening frame must be text with FIN clear');
  assert.equal(closing[0], 0x80, 'the closing frame must be a continuation with FIN set');

  const session = new Session(fakeSocket());
  session.feed(opening);
  assert.equal(session.answers.size, 0, 'nothing may be filed before the final frame arrives');
  assert.equal(session.events.length, 0);
  assert.equal(session.partial.length, 12, 'the first half should be held for the second');

  session.feed(closing);
  assert.deepEqual(session.answers.get(5).result, { value: 'split down the middle' });
  assert.equal(session.partial.length, 0, 'the holding buffer must be emptied after a message');
});

test('a message in three fragments is reassembled, and the next message is unaffected', () => {
  const text = JSON.stringify({ id: 6, result: { value: 'one two three' } });
  const session = new Session(fakeSocket());
  session.feed(serverFrame(text.slice(0, 8), { opcode: 1, final: false }));
  session.feed(serverFrame(text.slice(8, 20), { opcode: 0, final: false }));
  session.feed(serverFrame(text.slice(20), { opcode: 0, final: true }));
  assert.deepEqual(session.answers.get(6).result, { value: 'one two three' });

  // If the holding buffer were not cleared, this second message would be prefixed by the first.
  session.feed(serverFrame(JSON.stringify({ id: 7, result: { clean: true } })));
  assert.deepEqual(session.answers.get(7).result, { clean: true });
});

test('a control frame between fragments does not corrupt the message', () => {
  // Chrome sends pings. The pump keeps only opcodes 0 and 1, so a ping arriving mid message must
  // step past without entering the reassembly.
  const text = JSON.stringify({ id: 8, result: { value: 'held together' } });
  const session = new Session(fakeSocket());
  session.feed(serverFrame(text.slice(0, 10), { opcode: 1, final: false }));
  session.feed(serverFrame('ping', { opcode: 9, final: true }));
  session.feed(serverFrame(text.slice(10), { opcode: 0, final: true }));

  assert.deepEqual(session.answers.get(8).result, { value: 'held together' });
  assert.equal(session.buffer.length, 0, 'the ping should have been consumed, not left in place');
});

/* ------------------------------------------------------------------ chunk boundaries */

test('two frames arriving in one chunk are both parsed', () => {
  const session = new Session(fakeSocket());
  session.feed(Buffer.concat([
    serverFrame(JSON.stringify({ id: 1, result: { a: 1 } })),
    serverFrame(JSON.stringify({ method: 'Runtime.consoleAPICalled', params: { type: 'log' } })),
  ]));
  assert.equal(session.answers.size, 1, 'the second frame was swallowed by the first');
  assert.equal(session.events.length, 1);
  assert.equal(session.buffer.length, 0);
});

test('one frame split across two chunks waits for the rest', () => {
  const bytes = serverFrame(JSON.stringify({ id: 9, result: { done: true } }));
  const session = new Session(fakeSocket());
  session.feed(bytes.subarray(0, 6));
  assert.equal(session.answers.size, 0);
  assert.equal(session.buffer.length, 6, 'the half frame must be kept, not discarded');

  session.feed(bytes.subarray(6));
  assert.deepEqual(session.answers.get(9).result, { done: true });
  assert.equal(session.buffer.length, 0);
});

test('a frame delivered one byte at a time still parses', () => {
  const bytes = serverFrame(JSON.stringify({ id: 12, result: { patient: true } }));
  const session = new Session(fakeSocket());
  for (const byte of bytes) session.feed(Buffer.from([byte]));
  assert.deepEqual(session.answers.get(12).result, { patient: true });
  assert.equal(session.buffer.length, 0);
});

test('a frame whose declared length has not arrived is held, not misparsed', () => {
  const text = JSON.stringify({ id: 3, result: { value: 'p'.repeat(300) } });
  const bytes = serverFrame(text);
  const session = new Session(fakeSocket());

  session.feed(bytes.subarray(0, 40));
  assert.equal(session.answers.size, 0, 'a body that has not arrived was parsed anyway');
  assert.equal(session.events.length, 0);
  assert.equal(session.partial.length, 0, 'a short body must not enter the reassembly');
  assert.equal(session.buffer.length, 40, 'the bytes so far must be kept');

  session.feed(bytes.subarray(40));
  assert.equal(session.answers.get(3).result.value.length, 300);
});

test('an extended length header that has not fully arrived is held', () => {
  // Two early exits, one per header width. The 16 bit length needs two more bytes and the 64 bit
  // length needs eight. Reading either before it has arrived gives a length from whatever follows.
  const wide = serverFrame(messageOfBytes(4, 300));
  const sixteen = new Session(fakeSocket());
  sixteen.feed(wide.subarray(0, 2));
  assert.equal(sixteen.buffer.length, 2, 'the marker byte must be kept while the length is short');
  assert.equal(sixteen.answers.size, 0);
  sixteen.feed(wide.subarray(2));
  assert.equal(sixteen.answers.get(4).v.length, 285);

  const huge = serverFrame(messageOfBytes(6, 70000));
  const sixtyFour = new Session(fakeSocket());
  sixtyFour.feed(huge.subarray(0, 6));
  assert.equal(sixtyFour.buffer.length, 6, 'four of the eight length bytes must be kept');
  assert.equal(sixtyFour.answers.size, 0);
  sixtyFour.feed(huge.subarray(6));
  assert.equal(sixtyFour.answers.get(6).v.length, 69985);
});

test('a payload that is not JSON is dropped, and the frame after it still parses', () => {
  // Dropping without throwing is half of it. The half that matters is that the pump stepped over
  // the junk by its declared length, so the good frame behind it is still found.
  const session = new Session(fakeSocket());
  const junk = serverFrame('this is not JSON {');
  const good = serverFrame(JSON.stringify({ id: 11, result: { ok: true } }));

  assert.doesNotThrow(() => session.feed(Buffer.concat([junk, good])));
  assert.equal(session.events.length, 0, 'the junk was filed as an event');
  assert.deepEqual(session.answers.get(11).result, { ok: true },
    'the pump lost its place after the unparseable frame');
  assert.equal(session.buffer.length, 0);
});

/* ------------------------------------------------------------------ problems */

test('problems picks up errors and warnings, and leaves ordinary console output alone', () => {
  const session = new Session(fakeSocket());
  const events = [
    { method: 'Runtime.consoleAPICalled', params: { type: 'log', args: [{ value: 'ordinary chatter' }] } },
    { method: 'Runtime.consoleAPICalled', params: { type: 'error', args: [{ value: 'boom' }] } },
    { method: 'Runtime.consoleAPICalled', params: { type: 'info', args: [{ value: 'also ignored' }] } },
    {
      method: 'Runtime.consoleAPICalled',
      params: { type: 'warning', args: [{ value: 'careful' }, { description: 'Object' }] },
    },
    {
      method: 'Runtime.exceptionThrown',
      params: { exceptionDetails: { text: 'Uncaught', exception: { description: 'TypeError: nope' } } },
    },
    { method: 'Log.entryAdded', params: { entry: { level: 'error', text: 'failed to load' } } },
    { method: 'Log.entryAdded', params: { entry: { level: 'info', text: 'quiet noise' } } },
    { method: 'Log.entryAdded', params: { entry: { level: 'verbose', text: 'quieter noise' } } },
    { method: 'Runtime.executionContextCreated', params: { context: { id: 1 } } },
  ];
  for (const event of events) session.feed(serverFrame(JSON.stringify(event)));
  assert.equal(session.events.length, events.length, 'not every event reached the session');

  assert.deepEqual(session.problems(), [
    'console.error: boom',
    'console.warning: careful Object',
    'page error: Uncaught TypeError: nope',
    'log error: failed to load',
  ]);
});

test('problems is empty when the page behaved', () => {
  const session = new Session(fakeSocket());
  session.feed(serverFrame(JSON.stringify({
    method: 'Runtime.consoleAPICalled', params: { type: 'log', args: [{ value: 'all well' }] },
  })));
  assert.deepEqual(session.problems(), []);
});

test('a long problem is cut short rather than carried whole', () => {
  const session = new Session(fakeSocket());
  session.feed(serverFrame(JSON.stringify({
    method: 'Runtime.consoleAPICalled', params: { type: 'error', args: [{ value: 'z'.repeat(900) }] },
  })));
  session.feed(serverFrame(JSON.stringify({
    method: 'Runtime.exceptionThrown', params: { exceptionDetails: { text: 'w'.repeat(900) } },
  })));
  const found = session.problems();
  assert.equal(found[0].length, 'console.error: '.length + 200, 'the console text is capped at 200');
  assert.equal(found[1].length, 200, 'the whole page error line is capped at 200');
});

/* ------------------------------------------------------------------ send and evaluate */

test('send rejects when the answer never arrives, and names the method', async () => {
  const session = new Session(fakeSocket());
  await assert.rejects(
    () => session.send('Runtime.evaluate', {}, 120),
    /Runtime\.evaluate did not answer in time/,
    'the caller needs to know which command was lost',
  );
});

test('send writes a masked frame carrying the method, its params and a fresh id', async () => {
  const socket = fakeSocket();
  const session = new Session(socket);
  const pending = session.send('Page.navigate', { url: 'https://example.test/' }, 2000);

  assert.equal(socket.writes.length, 1, 'the command should be on the wire before anything is awaited');
  assert.deepEqual(JSON.parse(readClientFrame(socket.writes[0])), {
    id: 1, method: 'Page.navigate', params: { url: 'https://example.test/' },
  });

  session.feed(serverFrame(JSON.stringify({ id: 1, result: { frameId: 'F1' } })));
  assert.deepEqual(await pending, { frameId: 'F1' });
  assert.equal(session.answers.size, 0, 'a delivered answer must be taken out of the map');
});

test('answers are matched by id, not by the order they come back in', async () => {
  const socket = fakeSocket();
  const session = new Session(socket);
  const first = session.send('Runtime.enable', {}, 2000);
  const second = session.send('Log.enable', {}, 2000);
  assert.equal(JSON.parse(readClientFrame(socket.writes[0])).id, 1);
  assert.equal(JSON.parse(readClientFrame(socket.writes[1])).id, 2, 'the id did not move on');

  session.feed(Buffer.concat([
    serverFrame(JSON.stringify({ id: 2, result: { which: 'second' } })),
    serverFrame(JSON.stringify({ id: 1, result: { which: 'first' } })),
  ]));
  assert.deepEqual(await first, { which: 'first' });
  assert.deepEqual(await second, { which: 'second' });
});

test('an answer carrying an error rejects, and names the method and the reason', async () => {
  const session = new Session(fakeSocket());
  const pending = session.send('Runtime.evaluate', {}, 2000);
  session.feed(serverFrame(JSON.stringify({
    id: 1, error: { code: -32000, message: 'no such frame' },
  })));
  await assert.rejects(() => pending, /Runtime\.evaluate: .*no such frame/);
});

test('evaluate asks for the value itself, and for a promise to be awaited', async () => {
  // Without returnByValue the answer is a remote handle and every reading is undefined. Without
  // awaitPromise an async expression answers with a pending promise instead of its result.
  const socket = fakeSocket();
  const session = new Session(socket);
  const pending = session.evaluate('document.title', 2000);
  const sent = JSON.parse(readClientFrame(socket.writes[0]));
  assert.equal(sent.method, 'Runtime.evaluate');
  assert.equal(sent.params.expression, 'document.title');
  assert.equal(sent.params.returnByValue, true);
  assert.equal(sent.params.awaitPromise, true);

  session.feed(serverFrame(JSON.stringify({ id: 1, result: { result: { value: 'the page' } } })));
  assert.equal(await pending, 'the page');
});

test('evaluate throws when the page threw, rather than returning undefined', async () => {
  const session = new Session(fakeSocket());
  const pending = session.evaluate('boom()', 2000);
  session.feed(serverFrame(JSON.stringify({
    id: 1,
    result: { exceptionDetails: { text: 'Uncaught ReferenceError: boom is not defined' } },
  })));
  await assert.rejects(() => pending, /the page threw/);
});

test('evaluate returns undefined when the answer carries no result object', async () => {
  const session = new Session(fakeSocket());
  const pending = session.evaluate('void 0', 2000);
  session.feed(serverFrame(JSON.stringify({ id: 1, result: {} })));
  assert.equal(await pending, undefined);
});

/* ------------------------------------------------------------------ the outgoing headers */

test('a command too long for a small header goes out through the 16 bit header', async () => {
  // Every command above is short, so only the first branch of the outgoing frame builder runs. A
  // long expression is the only thing that reaches the other two, and a page script easily is one.
  const socket = fakeSocket();
  const session = new Session(socket);
  const pending = session.evaluate('x'.repeat(300), 2000);

  const written = socket.writes[0];
  assert.ok((written[1] & 0x80) !== 0, 'the frame must stay masked at any size');
  assert.equal(written[1] & 0x7f, 126, 'a command of this size must use the 16 bit header');
  const text = readClientFrame(written);
  assert.equal(written.readUInt16BE(2), Buffer.byteLength(text),
    'the declared length must match the payload, most significant byte first');
  assert.equal(JSON.parse(text).params.expression.length, 300);

  session.feed(serverFrame(JSON.stringify({ id: 1, result: { result: { value: 'ok' } } })));
  assert.equal(await pending, 'ok');
});

test('a command over 65535 bytes goes out through the 64 bit header', async () => {
  const socket = fakeSocket();
  const session = new Session(socket);
  const pending = session.evaluate('y'.repeat(70000), 2000);

  const written = socket.writes[0];
  assert.ok((written[1] & 0x80) !== 0, 'the frame must stay masked at any size');
  assert.equal(written[1] & 0x7f, 127, 'a command of this size must use the 64 bit header');
  const text = readClientFrame(written);
  assert.equal(Number(written.readBigUInt64BE(2)), Buffer.byteLength(text),
    'the declared length must match the payload, most significant byte first');
  assert.equal(JSON.parse(text).params.expression.length, 70000);

  session.feed(serverFrame(JSON.stringify({ id: 1, result: { result: { value: 'ok' } } })));
  assert.equal(await pending, 'ok');
});

test('every frame carries its own mask', async () => {
  // Masking is what stops an intermediary being handed a chosen plaintext. A fixed mask would still
  // decode correctly at the far end, so only comparing two frames catches it.
  const socket = fakeSocket();
  const session = new Session(socket);
  const first = session.send('Runtime.enable', {}, 2000);
  const second = session.send('Runtime.enable', {}, 2000);
  session.feed(Buffer.concat([
    serverFrame(JSON.stringify({ id: 1, result: {} })),
    serverFrame(JSON.stringify({ id: 2, result: {} })),
  ]));
  await Promise.all([first, second]);

  assert.notDeepEqual(socket.writes[0].subarray(2, 6), socket.writes[1].subarray(2, 6),
    'the same four mask bytes were used for both frames');
});

/* ------------------------------------------------------------------ what is left uncovered */

test('openSession and evaluateInPage are exported', () => {
  assert.equal(typeof openSession, 'function');
  assert.equal(typeof evaluateInPage, 'function');
});

test('openSession picks the right target and completes the upgrade', {
  skip: 'openSession does an HTTP GET for /json and then net.connect. There is no honest unit '
    + 'assertion about it without a listening socket, and this suite opens none. It is driven for '
    + 'real by tests/integration/side_effect_isolation.mjs line 111, which needs Chrome. '
    + 'evaluateInPage has no caller anywhere in the repository, so nothing drives it at all.',
}, () => {});
