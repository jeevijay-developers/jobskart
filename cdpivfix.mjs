import WebSocket from "ws";

const CDP = "http://localhost:9351";

async function jsonFetch(path) {
  const res = await fetch(CDP + path);
  return res.json();
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { maxPayload: 1024 * 1024 * 50 });
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function send(ws, method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    const handler = (data) => {
      const m = JSON.parse(data.toString());
      if (m.id === id) {
        ws.off("message", handler);
        if (m.error) reject(new Error(JSON.stringify(m.error)));
        else resolve(m.result);
      }
    };
    ws.on("message", handler);
    ws.send(JSON.stringify(msg));
  });
}

async function ev(browserWs, sessionId, expression) {
  const r = await send(browserWs, "Runtime.evaluate", { expression, returnByValue: true }, sessionId);
  return r.result.value;
}

// Dispatch a REAL mousedown+mouseup+click sequence at exact coordinates,
// matching actual browser event order (mousedown fires before click) —
// this is what a real user's mouse click produces, unlike a bare .click().
function realClickAt(browserWs, sessionId, x, y) {
  return (async () => {
    await send(browserWs, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, sessionId);
    await send(browserWs, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, sessionId);
    await new Promise((r) => setTimeout(r, 50));
    await send(browserWs, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, sessionId);
  })();
}

async function main() {
  const version = await jsonFetch("/json/version");
  const browserWs = await connect(version.webSocketDebuggerUrl);

  const { targetId } = await send(browserWs, "Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send(browserWs, "Target.attachToTarget", { targetId, flatten: true });
  await send(browserWs, "Page.enable", {}, sessionId);
  await send(browserWs, "Runtime.enable", {}, sessionId);
  await send(browserWs, "Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  await send(browserWs, "Page.navigate", { url: "http://localhost:5201/ivfix999" }, sessionId);
  await new Promise((r) => setTimeout(r, 12000));

  const modalOpen = await ev(browserWs, sessionId, `document.body.textContent.includes('Reschedule interview') || document.body.textContent.includes('Schedule interview')`);
  console.log("modal opened:", modalOpen);

  const beforeTime = await ev(browserWs, sessionId, `
    (function(){
      const label = [...document.querySelectorAll('label')].find(l=>l.textContent.includes('New time') || l.textContent.includes('Time (IST)'));
      return label.nextElementSibling.textContent;
    })()
  `);
  console.log("time BEFORE:", beforeTime);

  console.log("viewport:", await ev(browserWs, sessionId, "JSON.stringify({ innerHeight: window.innerHeight, scrollY: window.scrollY, visualHeight: window.visualViewport?.height })"));

  const timeTriggerRect = await ev(browserWs, sessionId, `
    JSON.stringify((function(){
      const label = [...document.querySelectorAll('label')].find(l=>l.textContent.includes('New time') || l.textContent.includes('Time (IST)'));
      return label.nextElementSibling.getBoundingClientRect();
    })())
  `);
  const ttr = JSON.parse(timeTriggerRect);
  console.log("time trigger rect:", timeTriggerRect);
  await ev(browserWs, sessionId, `window.scrollTo({ top: Math.max(0, ${ttr.top} - 180), behavior: "instant" })`);
  await new Promise(r=>setTimeout(r, 300));
  const scrolledTriggerRect = JSON.parse(await ev(browserWs, sessionId, `JSON.stringify((function(){ const label = [...document.querySelectorAll('label')].find(l=>l.textContent.includes('New time') || l.textContent.includes('Time (IST)')); return label.nextElementSibling.getBoundingClientRect(); })())`));
  await realClickAt(browserWs, sessionId, scrolledTriggerRect.left + scrolledTriggerRect.width/2, scrolledTriggerRect.top + scrolledTriggerRect.height/2);
  await new Promise(r=>setTimeout(r, 700));

  const menuFound = await ev(browserWs, sessionId, `
    !!([...document.querySelectorAll('div')].find(d => typeof d.className === 'string' && d.className.includes('z-[100]') && d.className.includes('overflow-y-auto')))
  `);
  console.log("dropdown menu found:", menuFound);
  console.log("time menu rect:", await ev(browserWs, sessionId, `JSON.stringify((function(){ const menu = [...document.querySelectorAll('div')].find(d => typeof d.className === 'string' && d.className.includes('z-[100]') && d.className.includes('overflow-y-auto')); return menu?.getBoundingClientRect() ?? null; })())`));

  const opt930Rect = await ev(browserWs, sessionId, `
    JSON.stringify((function(){
      const menu = [...document.querySelectorAll('div')].find(d => typeof d.className === 'string' && d.className.includes('z-[100]') && d.className.includes('overflow-y-auto'));
      const opt = [...menu.querySelectorAll('button')].find(b => b.textContent.trim() === '09:30');
      opt?.scrollIntoView({ block: 'center' });
      return opt ? opt.getBoundingClientRect() : null;
    })())
  `);
  console.log("09:30 option rect:", opt930Rect);
  const or = JSON.parse(opt930Rect);
  await realClickAt(browserWs, sessionId, or.left + or.width/2, or.top + or.height/2);
  await new Promise(r=>setTimeout(r, 600));

  const afterTime = await ev(browserWs, sessionId, `
    (function(){
      const label = [...document.querySelectorAll('label')].find(l=>l.textContent.includes('New time') || l.textContent.includes('Time (IST)'));
      return label.nextElementSibling.textContent;
    })()
  `);
  console.log("time AFTER real mousedown+click on 09:30:", afterTime);

  const dropdownStillOpen = await ev(browserWs, sessionId, `
    !!([...document.querySelectorAll('div')].find(d => d.className.includes('z-[100]') && d.className.includes('overflow-y-auto')))
  `);
  console.log("dropdown still open after selection (should be false):", dropdownStillOpen);

  const selectedTimeTriggerRect = JSON.parse(await ev(browserWs, sessionId, `JSON.stringify((function(){ const label = [...document.querySelectorAll('label')].find(l=>l.textContent.includes('New time') || l.textContent.includes('Time (IST)')); return label.nextElementSibling.getBoundingClientRect(); })())`));
  await realClickAt(browserWs, sessionId, selectedTimeTriggerRect.left + selectedTimeTriggerRect.width/2, selectedTimeTriggerRect.top + selectedTimeTriggerRect.height/2);
  await new Promise(r=>setTimeout(r, 250));
  const timeStillSelected = await ev(browserWs, sessionId, `
    (function(){
      const menu = [...document.querySelectorAll('div')].find(d => typeof d.className === 'string' && d.className.includes('z-[100]') && d.className.includes('overflow-y-auto'));
      const option = [...menu.querySelectorAll('button')].find(b => b.textContent.trim() === '09:30');
      return option.className.includes('bg-primary/10');
    })()
  `);
  console.log("09:30 selected after reopen:", timeStillSelected);
  await realClickAt(browserWs, sessionId, selectedTimeTriggerRect.left + selectedTimeTriggerRect.width/2, selectedTimeTriggerRect.top + selectedTimeTriggerRect.height/2);
  await new Promise(r=>setTimeout(r, 150));

  const durationTriggerRect = JSON.parse(await ev(browserWs, sessionId, `
    JSON.stringify((function(){
      const label = [...document.querySelectorAll('label')].find(l=>l.textContent.includes('Duration'));
      return label.nextElementSibling.getBoundingClientRect();
    })())
  `));
  await realClickAt(browserWs, sessionId, durationTriggerRect.left + durationTriggerRect.width/2, durationTriggerRect.top + durationTriggerRect.height/2);
  await new Promise(r=>setTimeout(r, 300));
  const durationOptionRect = JSON.parse(await ev(browserWs, sessionId, `
    JSON.stringify((function(){
      const menu = [...document.querySelectorAll('div')].find(d => typeof d.className === 'string' && d.className.includes('z-[100]') && d.className.includes('overflow-y-auto'));
      const opt = [...menu.querySelectorAll('button')].find(b => b.textContent.trim() === '45 min');
      return opt?.getBoundingClientRect() ?? null;
    })())
  `));
  await realClickAt(browserWs, sessionId, durationOptionRect.left + durationOptionRect.width/2, durationOptionRect.top + durationOptionRect.height/2);
  await new Promise(r=>setTimeout(r, 300));
  const afterDuration = await ev(browserWs, sessionId, `
    (function(){
      const label = [...document.querySelectorAll('label')].find(l=>l.textContent.includes('Duration'));
      return label.nextElementSibling.textContent;
    })()
  `);
  console.log("duration AFTER real mousedown+click on 45 min:", afterDuration);

  const selectedDurationTriggerRect = JSON.parse(await ev(browserWs, sessionId, `JSON.stringify((function(){ const label = [...document.querySelectorAll('label')].find(l=>l.textContent.includes('Duration')); return label.nextElementSibling.getBoundingClientRect(); })())`));
  await realClickAt(browserWs, sessionId, selectedDurationTriggerRect.left + selectedDurationTriggerRect.width/2, selectedDurationTriggerRect.top + selectedDurationTriggerRect.height/2);
  await new Promise(r=>setTimeout(r, 250));
  const durationStillSelected = await ev(browserWs, sessionId, `
    (function(){
      const menu = [...document.querySelectorAll('div')].find(d => typeof d.className === 'string' && d.className.includes('z-[100]') && d.className.includes('overflow-y-auto'));
      const option = [...menu.querySelectorAll('button')].find(b => b.textContent.trim() === '45 min');
      return option.className.includes('bg-primary/10');
    })()
  `);
  console.log("45 min selected after reopen:", durationStillSelected);

  await send(browserWs, "Target.closeTarget", { targetId });
  browserWs.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
