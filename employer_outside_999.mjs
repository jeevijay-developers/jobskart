import WebSocket from "ws";
const PORT = 9333;
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
      await new Promise((r) => setTimeout(r, 60));
    }
  }
  await clickAndType(desigSelector, "Man");
  await new Promise((r) => setTimeout(r, 500));
  const before = await evalJs(`document.querySelector(${JSON.stringify(desigSelector)}).closest('.relative').querySelectorAll('button').length`);
  console.log("dropdown button count right after typing 'Man':", before);

  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 700, y: 700 });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: 700, y: 700, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 700, y: 700, button: "left", clickCount: 1 });
  await new Promise((r) => setTimeout(r, 400));
  const after = await evalJs(`document.querySelector(${JSON.stringify(desigSelector)}).closest('.relative').querySelectorAll('button').length`);
  console.log("dropdown button count after clicking far outside (700,700):", after);

  ws.close();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
