import { openSession } from './src/probe/cdp.mjs';
import { launchWithWebMCP, waitForPageTarget, targetFor, waitForDocument } from './src/probe/launch.mjs';
const url = process.argv[2]; const port = Number(process.argv[3]);
const l = await launchWithWebMCP({ url, port }); await waitForPageTarget(port, url);
const c = await openSession(port, targetFor(url)); await c.session.send('Runtime.enable');
await waitForDocument(c.session, url); await new Promise(r=>setTimeout(r,1500));
console.log('BEFORE:', await c.session.evaluate('JSON.stringify(window.__sideEffects)'));
c.socket.destroy();
