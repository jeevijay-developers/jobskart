import WebSocket from "ws";
const CDP = "http://localhost:9351";
async function jsonFetch(path) { const res = await fetch(CDP + path); return res.json(); }
function connect(wsUrl) { return new Promise((resolve, reject) => { const ws = new WebSocket(wsUrl, { maxPayload: 1024*1024*50 }); ws.on("open", () => resolve(ws)); ws.on("error", reject); }); }
function send(ws, method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const msg = { id, method, params }; if (sessionId) msg.sessionId = sessionId;
    const handler = (data) => { const m = JSON.parse(data.toString()); if (m.id === id) { ws.off("message", handler); if (m.error) reject(new Error(JSON.stringify(m.error))); else resolve(m.result); } };
    ws.on("message", handler); ws.send(JSON.stringify(msg));
  });
}
async function ev(browserWs, sessionId, expression) {
  const r = await send(browserWs, "Runtime.evaluate", { expression, returnByValue: true }, sessionId);
  return r.result.value;
}
async function main() {
  const version = await jsonFetch("/json/version");
  const browserWs = await connect(version.webSocketDebuggerUrl);
  const { targetId } = await send(browserWs, "Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send(browserWs, "Target.attachToTarget", { targetId, flatten: true });
  await send(browserWs, "Page.enable", {}, sessionId);
  await send(browserWs, "Runtime.enable", {}, sessionId);
  await send(browserWs, "Page.navigate", { url: "http://localhost:5201/ivfix999" }, sessionId);
  await new Promise((r) => setTimeout(r, 12000));

  const hasDialog = await ev(browserWs, sessionId, `!!document.querySelector('[role="dialog"]')`);
  console.log("has dialog:", hasDialog);
  const hasReschedule = await ev(browserWs, sessionId, `document.body.textContent.includes('Reschedule')`);
  console.log("has 'Reschedule' text:", hasReschedule);
  const labels = await ev(browserWs, sessionId, `JSON.stringify([...document.querySelectorAll('label')].map(l=>l.textContent))`);
  console.log("labels:", labels);

  await send(browserWs, "Target.closeTarget", { targetId });
  browserWs.close();
}
main().catch(e=>{console.error(e);process.exit(1);});
