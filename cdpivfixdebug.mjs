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
async function main() {
  const version = await jsonFetch("/json/version");
  const browserWs = await connect(version.webSocketDebuggerUrl);
  const { targetId } = await send(browserWs, "Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send(browserWs, "Target.attachToTarget", { targetId, flatten: true });
  await send(browserWs, "Page.enable", {}, sessionId);
  await send(browserWs, "Runtime.enable", {}, sessionId);
  browserWs.on("message", (data) => {
    const m = JSON.parse(data.toString());
    if (m.method === "Runtime.exceptionThrown") {
      console.log("EXCEPTION:", JSON.stringify(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    }
  });
  await send(browserWs, "Page.navigate", { url: "http://localhost:5201/ivfix999" }, sessionId);
  await new Promise((r) => setTimeout(r, 10000));
  const body = await send(browserWs, "Runtime.evaluate", { expression: "document.body.innerHTML.slice(0,1500)", returnByValue: true }, sessionId);
  console.log(body.result.value);
  await send(browserWs, "Target.closeTarget", { targetId });
  browserWs.close();
}
main().catch(e=>{console.error(e);process.exit(1);});
