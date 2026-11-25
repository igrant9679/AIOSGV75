#!/usr/bin/env node
/**
 * Add a local (Ollama) chat model to this machine's Mission Control, so a model
 * the installer just pulled shows up as an agent without a trip to Settings.
 *
 *   node scripts/register-local-model.mjs <model> [--dry-run] [--file <registry.json>]
 *
 * Called by install.ps1 and install.sh after the model is pulled. Written in
 * Node rather than in each shell on purpose: data/registry.json is the file that
 * holds API keys, and the only safe way to add one entry to it is to parse and
 * re-write it exactly the way the app does. One implementation, not two.
 *
 * What it does, in order:
 *   - an entry for this model on a local address already exists → nothing
 *   - a local entry still points at the old default (llama3.2)   → repoint it
 *   - otherwise                                                   → add one
 * It never touches a keyed entry, and if registry.json exists but cannot be
 * parsed it stops and changes nothing rather than replace a file full of keys.
 *
 * Prints one line the installer shows, and exits 0 unless it had to stop.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const fileFlag = args.indexOf("--file");
const model = args.find((a, i) => !a.startsWith("--") && (fileFlag < 0 || i !== fileFlag + 1)) ?? "";
const file = fileFlag >= 0 ? args[fileFlag + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "registry.json");

const BASE_URL = "http://localhost:11434/v1";
const OLD_DEFAULT = "llama3.2";
const isLocal = (url) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(String(url ?? ""));
const sameModel = (a, b) => String(a ?? "").replace(/:latest$/, "") === String(b ?? "").replace(/:latest$/, "");

if (!/^[\w.:/-]{1,100}$/.test(model)) {
  console.error("usage: register-local-model.mjs <model> [--dry-run]");
  process.exit(2);
}

let reg = { llms: [], commandAgents: [], workspaces: ["Default"] };
if (fs.existsSync(file)) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch (e) {
    // on stdout, like every other outcome: the installers show this line to the person installing
    console.log(`left alone - ${path.basename(file)} could not be read as JSON (${e.message})`);
    process.exit(3);
  }
  // keep everything that is there, including fields this script knows nothing about
  reg = { ...raw, llms: Array.isArray(raw?.llms) ? raw.llms : [], commandAgents: Array.isArray(raw?.commandAgents) ? raw.commandAgents : [], workspaces: Array.isArray(raw?.workspaces) ? raw.workspaces : ["Default"] };
}

const label = `Local (${model.replace(/:latest$/, "").replace(/[:]/g, " ")})`.slice(0, 40);
let outcome;

if (reg.llms.some((l) => isLocal(l.baseUrl) && sameModel(l.model, model))) {
  outcome = `already in Mission Control as a local model (${model})`;
} else {
  const old = reg.llms.find((l) => isLocal(l.baseUrl) && !l.apiKey && sameModel(l.model, OLD_DEFAULT));
  if (old) {
    old.model = model;
    // only rename the name the app itself used to give it; a name someone chose stays
    if (/^llama$/i.test(String(old.name ?? ""))) old.name = label;
    outcome = `${dry ? "would update" : "updated"} the existing local agent "${old.id}" from ${OLD_DEFAULT} to ${model}`;
  } else {
    const taken = new Set([...reg.llms, ...reg.commandAgents].map((x) => x.id));
    let id = "local";
    for (let n = 2; taken.has(id); n++) id = `local-${n}`;
    reg.llms.push({ id, name: label, provider: "ollama", baseUrl: BASE_URL, model, apiKey: "", accent: "lime" });
    outcome = `${dry ? "would add it" : "added"} to Mission Control as "${label}"`;
  }
  if (!dry) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(reg, null, 2), "utf8");
    fs.renameSync(tmp, file);
  }
}

console.log(outcome);
