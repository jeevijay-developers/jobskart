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

  function typeInto(id, text) {
    return evalJs(`
      (() => {
        const el = document.getElementById(${JSON.stringify(id)});
        el.focus();
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        let acc = "";
        for (const ch of ${JSON.stringify(text)}) {
          acc += ch;
          setter.call(el, acc);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          acc = el.value; // pick up whatever the controlled handler actually committed
        }
        return el.value;
      })()
    `);
  }

  // Test 1: "rahul kumar" -> "Rahul Kumar"
  const nameInputId = await evalJs(`
    (() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      const el = inputs.find(i => i.placeholder === 'Your full name');
      if (!el.id) el.id = 'test-fullname-input';
      return el.id;
    })()
  `);
  const result1 = await typeInto(nameInputId, "rahul kumar");
  console.log('Test "rahul kumar' + '" typed char-by-char ->', JSON.stringify(result1));

  // clear and test numbers rejected
  await evalJs(`document.getElementById(${JSON.stringify(nameInputId)}).value = ''`);
  const result2 = await typeInto(nameInputId, "Rahul123");
  console.log('Test "Rahul123" ->', JSON.stringify(result2));

  // clear and test special chars rejected
  await evalJs(`document.getElementById(${JSON.stringify(nameInputId)}).value = ''`);
  const result3 = await typeInto(nameInputId, "Rahul@Kumar");
  console.log('Test "Rahul@Kumar" ->', JSON.stringify(result3));

  await screenshot("employer_fullname_tests");

  // Reset name, now test Designation autocomplete
  await evalJs(`document.getElementById(${JSON.stringify(nameInputId)}).value = ''`);

  const desigInputId = await evalJs(`
    (() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      const el = inputs.find(i => i.placeholder === 'Optional');
      if (!el.id) el.id = 'test-designation-input';
      return el.id;
    })()
  `);

  // Type 2 chars -> no dropdown
  await typeInto(desigInputId, "Fo");
  await new Promise((r) => setTimeout(r, 200));
  const dropdown2chars = await evalJs(`document.querySelectorAll('button').length`);
  console.log("After 2 chars 'Fo', dropdown button count (should show none from autocomplete):", dropdown2chars);
  await screenshot("employer_designation_2chars");

  // Type 3rd char -> dropdown should appear
  await typeInto(desigInputId, "u");
  await new Promise((r) => setTimeout(r, 200));
  const suggestionsAfter3 = await evalJs(`
    (() => {
      const container = document.getElementById(${JSON.stringify(desigInputId)}).closest('.relative');
      const buttons = Array.from(container.querySelectorAll('button'));
      return buttons.map(b => b.textContent);
    })()
  `);
  console.log("After 3 chars 'Fou', suggestions:", JSON.stringify(suggestionsAfter3));
  await screenshot("employer_designation_3chars");

  // Click first suggestion
  await evalJs(`
    (() => {
      const container = document.getElementById(${JSON.stringify(desigInputId)}).closest('.relative');
      const btn = container.querySelector('button');
      if (btn) btn.click();
    })()
  `);
  await new Promise((r) => setTimeout(r, 200));
  const afterPick = await evalJs(`document.getElementById(${JSON.stringify(desigInputId)}).value`);
  console.log("After clicking first suggestion, field value:", JSON.stringify(afterPick));

  // Outside click closes dropdown
  await typeInto(desigInputId, "Man");
  await new Promise((r) => setTimeout(r, 200));
  const dropdownBeforeOutsideClick = await evalJs(`
    (() => {
      const container = document.getElementById(${JSON.stringify(desigInputId)}).closest('.relative');
      return container.querySelectorAll('button').length;
    })()
  `);
  await evalJs(`document.getElementById('debug').click()`);
  await new Promise((r) => setTimeout(r, 200));
  const dropdownAfterOutsideClick = await evalJs(`
    (() => {
      const container = document.getElementById(${JSON.stringify(desigInputId)}).closest('.relative');
      return container.querySelectorAll('button').length;
    })()
  `);
  console.log("Dropdown button count before/after outside click:", dropdownBeforeOutsideClick, "/", dropdownAfterOutsideClick);

  ws.close();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
