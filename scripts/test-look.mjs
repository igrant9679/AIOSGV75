import assert from "node:assert/strict";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

// Tests lib/lookCustom.ts: the custom look's CSS (and that nothing unsafe gets into it), cleaning, the
// menu arrangement, and the pre-paint script. Run: node scripts/test-look.mjs
const here = path.dirname(fileURLToPath(import.meta.url));
const L = await import(pathToFileURL(path.join(here, "..", "lib", "lookCustom.ts")).href);

let n = 0;
const t = (name, fn) => {
  fn();
  console.log(`ok ${++n} - ${name}`);
};

t("an empty look makes no CSS", () => {
  assert.equal(L.buildLookCss({ v: 1 }), "");
  assert.equal(L.buildLookCss(null), "");
});

t("colours per theme, fonts, sizes, menu switches", () => {
  const css = L.buildLookCss({ v: 1, colors: { dark: { cyan: "#112233", panel: "#000000" }, light: { ink: "#101010" } }, fontUi: "Segoe UI, Arial", fontHeading: "Georgia", fontMono: "Consolas", zoom: 115, radius: 6, panelOpacity: 80, sidebarWidth: 300, menu: { hideSub: true, hideHost: true } });
  assert.match(css, /:root\[data-theme="dark"\]\{[^}]*--ac-cyan:#112233 !important;--nb-cyan:#112233 !important/);
  assert.match(css, /--panel-bg:color-mix\(in srgb, #000000 80%, transparent\)/);
  assert.match(css, /:root\[data-theme="light"\]\{[^}]*--tone-ink:#101010/);
  assert.match(css, /--mc-font-ui:"Segoe UI", "Arial", ui-sans-serif/);
  assert.match(css, /font-family:"Georgia"/);
  assert.match(css, /--mc-font-code:"Consolas"/);
  assert.match(css, /\.deck-frame\{zoom:1\.15 !important\}/);
  assert.match(css, /--panel-radius:6px/);
  assert.match(css, /\.mc-sidebar\{width:300px !important\}/);
  assert.match(css, /\.sb-sub\{display:none/);
  assert.match(css, /\.sb-host\{display:none/);
});

t("nothing unsafe gets into the CSS", () => {
  const evil = L.buildLookCss({
    v: 1,
    colors: { dark: { cyan: "red;}body{display:none", rose: "#12345g", lime: "#abc" } },
    fontUi: 'x"}body{display:none}/*',
    fontMono: "Arial; } * { color: red",
    zoom: "9999",
    radius: 1e9,
    background: { kind: "image", image: "data:image/png;base64,AAAA\");}body{display:none" },
  });
  assert.doesNotMatch(evil, /display:none/);
  assert.doesNotMatch(evil, /red/);
  assert.doesNotMatch(evil, /--ac-rose|--ac-lime|--ac-cyan/);
  assert.doesNotMatch(evil, /--mc-font/);
  assert.doesNotMatch(evil, /zoom/);
  assert.match(evil, /--panel-radius:32px/); // a number, clamped
  assert.doesNotMatch(L.buildLookCss({ background: { kind: "image", image: "https://example.com/x.png" } }), /url\(/);
});

t("backgrounds: colour, gradient, picture with dim and blur", () => {
  assert.match(L.buildLookCss({ background: { kind: "color", color: "#202020" } }), /body\{background:#202020 !important\}/);
  assert.match(L.buildLookCss({ background: { kind: "gradient", from: "#000000", to: "#ffffff", angle: 90 } }), /linear-gradient\(90deg, #000000, #ffffff\)/);
  const img = L.buildLookCss({ background: { kind: "image", image: "data:image/jpeg;base64,QUJD", fit: "tile", dim: 40, blur: 6 } });
  assert.match(img, /body::before\{[^}]*url\("data:image\/jpeg;base64,QUJD"\) top left\/auto repeat;filter:blur\(6px\)/);
  assert.match(img, /rgba\(5,6,15,0\.4\)/);
  assert.match(img, /\.ambient\{display:none/);
  assert.match(L.buildLookCss({ background: { kind: "none" } }), /\.ambient\{display:none/);
});

t("cleanLook keeps only what is valid", () => {
  const c = L.cleanLook({ colors: { dark: { cyan: "#ABCDEF", bogus: "#000000", rose: "nope" } }, zoom: 500, fontUi: "  Calibri ", background: { kind: "video" }, menu: { hidden: ["/arena", 3], labels: { "/work": "  Jobs  ", "/x": "" }, hideSub: "yes" }, extra: 1 });
  assert.deepEqual(c, { v: 1, colors: { dark: { cyan: "#abcdef" } }, fontUi: "Calibri", zoom: 160, menu: { hidden: ["/arena"], labels: { "/work": "Jobs" } } });
});

t("the menu: the owner's order first, the rest after in their usual order; hidden and renamed", () => {
  const items = [{ href: "/a", label: "A" }, { href: "/b", label: "B" }, { href: "/c", label: "C" }, { href: "/d", label: "D" }];
  const menu = { order: { g: ["/c", "/a"] }, hidden: ["/b"], labels: { "/d": "Dee" } };
  assert.deepEqual(L.arrangeGroup("g", items, menu).map((x) => x.label), ["C", "A", "Dee"]);
  assert.deepEqual(L.arrangeGroup("g", items, menu, true).map((x) => `${x.label}${x.hidden ? "*" : ""}`), ["C", "A", "B*", "Dee"]);
  assert.deepEqual(L.arrangeGroup("other", items, menu).map((x) => x.href), ["/a", "/c", "/d"]);
  assert.deepEqual(L.arrangeGroups(["brain", "agents", "workspace"], { groupOrder: ["workspace", "nope"] }), ["workspace", "brain", "agents"]);
});

t("the pre-paint script runs on its own and applies the look", () => {
  const appended = [];
  const store = { "mc-look-custom": JSON.stringify({ v: 1, zoom: 120, colors: { dark: { cyan: "#123456" } } }) };
  const ctx = {
    localStorage: { getItem: (k) => store[k] ?? null },
    document: { createElement: () => ({ id: "", textContent: "" }), head: { appendChild: (el) => appended.push(el) } },
  };
  vm.runInNewContext(L.lookBootScript(), ctx);
  assert.equal(appended.length, 1);
  assert.equal(appended[0].id, "mc-look-custom");
  assert.match(appended[0].textContent, /zoom:1\.2/);
  assert.match(appended[0].textContent, /--ac-cyan:#123456/);
  // nothing saved → nothing added; broken JSON → no error escapes
  const none = [];
  vm.runInNewContext(L.lookBootScript(), { localStorage: { getItem: () => "{oops" }, document: { createElement: () => ({}), head: { appendChild: (e) => none.push(e) } } });
  assert.equal(none.length, 0);
});

console.log(`\n${n} tests passed`);
