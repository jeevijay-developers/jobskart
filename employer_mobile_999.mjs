import WebSocket from "ws";
import fs from "fs";
const PORT = 9333;
const OUT = "C:/Users/ADMIN/AppData/Local/Temp/claude/c--Users-ADMIN-Desktop-jobskart/fcbf72c6-0bb5-4164-b25d-3dce073e0e1a/scratchpad";
async function main() {
  const resp = await fetch(`http://localhost:${PORT}/json/new?about:blank`, { method: "PUT" });
  const target = await resp.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  await new Promise((res) => ws.on("open", res));
  function send(method, params = {}) {
    return new Promise((resolve) => { const thisId = ++id; pending.set(thisId, resolve); ws.send(JSON.stringify({ id: thisId, method, params })); });
  }
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url: "http://localhost:8080/caltest999" });
  await new Promise((r) => setTimeout(r, 15000));
  async function evalJs(expr) {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description;
  }
  const desigSelector = 'input[placeholder="Optional"]';
  async function clickAndType(selector, text) {
    await evalJs(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    for (const ch of text) {
      await send("Input.dispatchKeyEvent", { type: "keyDown", text: ch, key: ch });
      await send("Input.dispatchKeyEvent", { type: "keyUp", text: ch, key: ch });
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  await clickAndType(desigSelector, "Man");
  await new Promise((r) => setTimeout(r, 400));
  const overflowCheck = await evalJs(`
    (() => {
      const dropdown = document.querySelector(${JSON.stringify(desigSelector)}).closest('.relative').querySelector('div.absolute');
      const rect = dropdown.getBoundingClientRect();
      return { right: rect.right, viewportWidth: window.innerWidth, overflows: rect.right > window.innerWidth };
    })()
  `);
  console.log("Mobile dropdown overflow check:", JSON.stringify(overflowCheck));
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${OUT}/employer_mobile_dropdown.png`, Buffer.from(r.result.data, "base64"));
  console.log("saved");
  ws.close();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
