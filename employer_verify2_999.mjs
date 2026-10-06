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
  await send("Page.navigate", { url: "http://localhost:8080/caltest999" });
  await new Promise((r) => setTimeout(r, 15000));
  async function evalJs(expr) {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description;
  }
  async function screenshot(name) {
    const r = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, "base64"));
    console.log("saved", name);
  }

  // Use real CDP keyboard input instead of synthetic value-setting, so React
  // sees genuine sequential input events and timing matches real typing.
  async function clickAndType(selector, text) {
    await evalJs(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    for (const ch of text) {
      await send("Input.dispatchKeyEvent", { type: "keyDown", text: ch, key: ch });
      await send("Input.dispatchKeyEvent", { type: "keyUp", text: ch, key: ch });
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  const nameSelector = 'input[placeholder="Your full name"]';
  const desigSelector = 'input[placeholder="Optional"]';

  await clickAndType(nameSelector, "ankit");
  await new Promise((r) => setTimeout(r, 200));
  console.log("Full name after typing 'ankit':", JSON.stringify(await evalJs(`document.querySelector(${JSON.stringify(nameSelector)}).value`)));

  await evalJs(`
    (() => {
      const el = document.querySelector(${JSON.stringify(nameSelector)});
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()
  `);
  await clickAndType(nameSelector, "ankit kumar");
  await new Promise((r) => setTimeout(r, 200));
  console.log("Full name after typing 'ankit kumar':", JSON.stringify(await evalJs(`document.querySelector(${JSON.stringify(nameSelector)}).value`)));

  await evalJs(`
    (() => {
      const el = document.querySelector(${JSON.stringify(nameSelector)});
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()
  `);
  await clickAndType(nameSelector, "rohit sharma");
  await new Promise((r) => setTimeout(r, 200));
  console.log("Full name after typing 'rohit sharma':", JSON.stringify(await evalJs(`document.querySelector(${JSON.stringify(nameSelector)}).value`)));

  await evalJs(`
    (() => {
      const el = document.querySelector(${JSON.stringify(nameSelector)});
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, 'ankit123');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()
  `);
  await new Promise((r) => setTimeout(r, 200));
  console.log("Full name after typing 'ankit123':", JSON.stringify(await evalJs(`document.querySelector(${JSON.stringify(nameSelector)}).value`)));

  await evalJs(`
    (() => {
      const el = document.querySelector(${JSON.stringify(nameSelector)});
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, 'ankit@kumar');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()
  `);
  await new Promise((r) => setTimeout(r, 200));
  console.log("Full name after typing 'ankit@kumar':", JSON.stringify(await evalJs(`document.querySelector(${JSON.stringify(nameSelector)}).value`)));

  await evalJs(`
    (() => {
      const el = document.querySelector(${JSON.stringify(nameSelector)});
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, 'aakash singh');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()
  `);
  await new Promise((r) => setTimeout(r, 200));
  console.log("Full name after pasting 'aakash singh':", JSON.stringify(await evalJs(`document.querySelector(${JSON.stringify(nameSelector)}).value`)));

  // Designation: no suggestions below three characters, then search the
  // database-backed master list at three and four characters.
  await clickAndType(desigSelector, "a");
  await new Promise((r) => setTimeout(r, 300));
  console.log("Designation suggestions after 'a' (1 char):", JSON.stringify(await evalJs(`
    Array.from(document.querySelector(${JSON.stringify(desigSelector)}).closest('.relative').querySelectorAll('button')).map(b => b.textContent)
  `)));
  await clickAndType(desigSelector, "b");
  await new Promise((r) => setTimeout(r, 300));
  console.log("Designation suggestions after 'ab' (2 chars):", JSON.stringify(await evalJs(`
    Array.from(document.querySelector(${JSON.stringify(desigSelector)}).closest('.relative').querySelectorAll('button')).map(b => b.textContent)
  `)));
  await screenshot("v2_designation_2chars");

  await evalJs(`
    (() => {
      const el = document.querySelector(${JSON.stringify(desigSelector)});
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.focus();
    })()
  `);
  await clickAndType(desigSelector, "eng");
  await new Promise((r) => setTimeout(r, 300));
  const suggestions3 = await evalJs(`
    Array.from(document.querySelector(${JSON.stringify(desigSelector)}).closest('.relative').querySelectorAll('button')).map(b => b.textContent)
  `);
  console.log("Designation suggestions after 'eng' (3 chars):", JSON.stringify(suggestions3));
  await screenshot("v2_designation_3chars");
  await clickAndType(desigSelector, "i");
  await new Promise((r) => setTimeout(r, 300));
  console.log("Designation suggestions after 'engi' (4 chars):", JSON.stringify(await evalJs(`
    Array.from(document.querySelector(${JSON.stringify(desigSelector)}).closest('.relative').querySelectorAll('button')).map(b => b.textContent)
  `)));

  await evalJs(`
    (() => {
      const el = document.querySelector(${JSON.stringify(desigSelector)});
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, 'eng');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.focus();
    })()
  `);
  await new Promise((r) => setTimeout(r, 300));

  // Click the first suggestion by text match (not stale index)
  await evalJs(`
    (() => {
      const btns = Array.from(document.querySelector(${JSON.stringify(desigSelector)}).closest('.relative').querySelectorAll('button'));
      if (btns[0]) btns[0].click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 200));
  console.log("Designation field value after clicking first suggestion:", JSON.stringify(await evalJs(`document.querySelector(${JSON.stringify(desigSelector)}).value`)));
  await screenshot("v2_designation_after_pick");

  // Outside click test: type again, then click far outside
  await clickAndType(desigSelector, "Man");
  await new Promise((r) => setTimeout(r, 300));
  const beforeOutside = await evalJs(`document.querySelector(${JSON.stringify(desigSelector)}).closest('.relative').querySelectorAll('button').length`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: 10, y: 10, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 10, y: 10, button: "left", clickCount: 1 });
  await new Promise((r) => setTimeout(r, 300));
  const afterOutside = await evalJs(`document.querySelector(${JSON.stringify(desigSelector)}).closest('.relative').querySelectorAll('button').length`);
  console.log("Dropdown button count before/after outside click:", beforeOutside, "/", afterOutside);

  // Keyboard navigation test
  await evalJs(`
    (() => {
      const el = document.querySelector(${JSON.stringify(desigSelector)});
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.focus();
    })()
  `);
  await clickAndType(desigSelector, "Man");
  await new Promise((r) => setTimeout(r, 300));
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 });
  await new Promise((r) => setTimeout(r, 150));
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await new Promise((r) => setTimeout(r, 200));
  console.log("Designation field value after ArrowDown+Enter:", JSON.stringify(await evalJs(`document.querySelector(${JSON.stringify(desigSelector)}).value`)));

  ws.close();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
