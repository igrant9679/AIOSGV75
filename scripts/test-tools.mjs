import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Tests lib/toolRules.ts: a form becomes a prompt; an owner-made tool is cleaned. Run: node scripts/test-tools.mjs
const here = path.dirname(fileURLToPath(import.meta.url));
const R = await import(pathToFileURL(path.join(here, "..", "lib", "toolRules.ts")).href);
let n = 0;
const t = (name, fn) => { fn(); console.log(`ok ${++n} - ${name}`); };

t("every built-in tool has fields that match its prompt", () => {
  for (const tool of R.BUILTIN_TOOLS) {
    for (const f of tool.fields) assert.ok(tool.prompt.includes(`{${f.key}}`), `${tool.name}: {${f.key}} missing from the prompt`);
    for (const m of tool.prompt.matchAll(/\{([a-z_]+)\}/g)) assert.ok(tool.fields.some((f) => f.key === m[1]), `${tool.name}: no field for {${m[1]}}`);
  }
});
t("a form is filled in; required answers are asked for", () => {
  const email = R.BUILTIN_TOOLS.find((x) => x.id === "b-email");
  assert.deepEqual(R.fillTool(email, { to: "Sam" }), { error: "Fill in: What you need to say or ask" });
  const r = R.fillTool(email, { to: "Sam", point: "Thanks for Friday" });
  assert.ok(r.prompt.includes("To: Sam") && r.prompt.includes("Thanks for Friday") && r.prompt.includes("Tone: (not given)"));
});
t("an owner-made tool gets a field for every blank in its prompt", () => {
  const tool = R.cleanTool({ name: "Case study", prompt: "Write a case study for {client}. What we did: {what_we_did}", fields: [{ key: "client", label: "Client" }] }, 1);
  assert.deepEqual(tool.fields.map((f) => f.key), ["client", "what_we_did"]);
  assert.equal(tool.category, "Mine");
  assert.throws(() => R.cleanTool({ name: "", prompt: "x".repeat(30) }), /name/);
  assert.throws(() => R.cleanTool({ name: "X", prompt: "short" }), /prompt/);
});
console.log(`\n${n} tests passed`);
