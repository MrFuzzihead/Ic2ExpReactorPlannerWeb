/**
 * A minimal DOM, window, localStorage and fetch, so `web/ui/app.js` can be executed by Node.
 *
 * This is not a browser and does not pretend to be one: it checks that the page glue runs at all,
 * that it finds the elements the stylesheet styles, and that the values it puts into the DOM are
 * the values the engine decoded. Layout, painting and image loading are the browser's job and are
 * checked by eye.
 *
 * Imported before `../ui/app.js` in `page.test.js`; ESM evaluation order is import order, so these
 * globals exist by the time the page module's top-level `await main()` runs.
 */

import { readFile } from 'node:fs/promises';

const created = [];

function element(tag) {
  const node = {
    tag,
    attributes: new Map(),
    kids: [],
    textContent: '',
    value: '',
    defaultValue: '',
    props: new Map(),
  };
  node.style = { setProperty: (name, value) => { node.props.set(name, value); } };
  node.appendChild = (kid) => { kid.parent = node; node.kids.push(kid); return kid; };
  // `replaceChildren()` with no argument clears; with arguments it clears and then fills, which is
  // how `app.js` swaps the palette's entry list while keeping the filter chips.
  node.replaceChildren = (...kids) => {
    node.kids = kids.filter((kid) => kid !== undefined && kid !== null);
    for (const kid of node.kids) kid.parent = node;
    node.textContent = '';
  };
  node.setAttribute = (name, value) => { node.attributes.set(name, value); };
  node.getAttribute = (name) => node.attributes.get(name) ?? null;
  node.removeAttribute = (name) => { node.attributes.delete(name); };
  node.hasAttribute = (name) => node.attributes.has(name);
  // Only the selectors `app.js` actually asks for: one attribute, optional quoted value.
  node.querySelector = (selector) => {
    const match = /^\[([\w-]+)(?:=(?:"([^"]*)"|([\w-]*)))?\]/.exec(selector);
    if (match === null) throw new Error(`the shim cannot answer ${selector}`);
    const want = match[2] ?? '';
    return node.kids.find((kid) => kid.tag !== undefined && kid.attributes.get(match[1]) === want) ?? null;
  };
  node.addEventListener = (type, handler) => { node.listeners ??= {}; node.listeners[type] = handler; };
  // `select()` is the copy fallback's gesture: a browser highlights the field's text so the visitor
  // can copy it with their own keyboard. What a headless test can know is that the page asked, so the
  // shim records the request rather than pretending to paint a selection.
  node.select = () => { node.selected = true; };
  Object.defineProperty(node, 'hidden', {
    get: () => node.attributes.has('hidden'),
    set: (value) => { if (value) node.attributes.set('hidden', ''); else node.attributes.delete('hidden'); },
  });
  // `app.js` walks `parentNode` to resolve a tap, which is the DOM's name for it; the shim keeps its
  // own `parent` data property for the bubbling click and mirrors it here.
  Object.defineProperty(node, 'parentNode', { get: () => node.parent ?? null });
  // The shim's `children` is an array, where a browser's is a live HTMLCollection: it has `length`
  // and index access but no `filter`, `map`, or `find`. That divergence is what made `app.js`'s
  // `clearPopovers` throw in the browser and pass here, so `app.js` copies the collection with
  // `[...slot.children]` rather than calling a method on it -- and a test that reads `children` with
  // an array method is testing the shim, not the page.
  Object.defineProperty(node, 'children', { get: () => node.kids.filter((kid) => kid.tag !== undefined) });
  // A browser's chain of parents ends at the `Document` node; `parentElement` is the accessor that
  // stops at the root element instead, which is what `tapped` walks. The shim ends at `null` either
  // way, but it has to answer the name the page uses.
  Object.defineProperty(node, 'parentElement', { get: () => node.parent ?? null });
  Object.defineProperty(node, 'firstElementChild', { get: () => node.kids.find((kid) => kid.tag !== undefined) });
  created.push(node);
  return node;
}

const registry = new Map();
for (const [id, tag] of [['design', 'div'], ['board', 'div'], ['code', 'textarea'], ['error', 'div'], ['modes', 'div'], ['palette', 'div'], ['automation', 'div'], ['materials', 'div'], ['comparison', 'div'], ['copy', 'button'], ['cleargrid', 'button'], ['simulate', 'button'], ['chambers', 'div'], ['temperature', 'div'], ['simulation', 'div'], ['config', 'div'], ['components', 'div'], ['runlegend', 'div']]) {
  registry.set(id, element(tag));
}
registry.get('code').value = process.env.ERP_CODE ?? '';
registry.get('code').defaultValue = process.env.ERP_SAMPLE ?? ''; // mirrors index.html's authored textarea

// `index.html` authors the nine chips that do something, with `Place` lit and the drawer, the
// automation panel, the materials panel, the config panel, the component list and the comparison
// panel closed; the shim mirrors all six panels and all nine chips, so a test that finds the drawer
// open proves `app.js` opened it rather than proving the shim forgot to close it.
{
  for (const [mode, active] of [['Place', true], ['Clear', false], ['Pick', false], ['Inspect', false], ['Automate', false], ['Config', false], ['Materials', false], ['Components', false], ['Compare', false], ['Simulation', false]]) {
    const chip = element('button');
    chip.attributes.set('data-mode', mode);
    if (active) chip.attributes.set('data-active', '');
    registry.get('modes').appendChild(chip);
  }
  registry.get('palette').attributes.set('hidden', '');
  registry.get('automation').attributes.set('hidden', '');
  registry.get('materials').attributes.set('hidden', '');
  registry.get('comparison').attributes.set('hidden', '');
  registry.get('simulation').attributes.set('hidden', '');
  registry.get('config').attributes.set('hidden', '');
  registry.get('components').attributes.set('hidden', '');
  // The run legend is authored closed in `index.html`, and stays closed until a run marks a cell.
  registry.get('runlegend').attributes.set('hidden', '');
}

const lookedUp = [];

globalThis.document = {
  getElementById: (id) => {
    lookedUp.push(id);
    return registry.get(id);
  },
  createElement: (tag) => element(tag),
  createTextNode: (text) => ({ text }),
};

const windowListeners = new Map();
globalThis.window = {
  innerWidth: 390,
  innerHeight: 844, // a phone: the tight case
  // The device's own width, which is what the cell math anchors on: a layout viewport can be widened
  // by content that overflows, a screen cannot. A monitor number here, so the shim's 390 px window
  // is the binding constraint and a test that widens the window still gets the window's answer.
  screen: { width: 1920, height: 1080 },
  // No media engine in Node, so the answer is the desktop's: every shim test exercises the fine
  // pointer path (16-pixel cells), and `page.test.js` covers the coarse path by answering true.
  matchMedia: (media) => ({ media, matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  addEventListener: (type, handler) => { windowListeners.set(type, handler); },
  // A browser matches an Event to its listeners by `type`; a test's plain object carries the same
  // one field a resize listener needs, and no layout.
  dispatchEvent: (event) => {
    const handler = windowListeners.get(event.type);
    if (handler !== undefined) handler(event);
  },
};

/** Computed styles, as far as the cell math can tell. There is no stylesheet here, so every value
 * that comes back is the inline one -- which is empty -- and `parseFloat('') || 0` is the zero the
 * shim's single 3 px assumption would otherwise have to hardcode. Kept because `sizeBoard` reads the
 * board's gaps and padding to compute a fit, and a missing function would be a page that cannot run
 * under test at all. */
globalThis.getComputedStyle = (node) => ({
  getPropertyValue: (name) => node?.props?.get(name) ?? '',
  columnGap: '',
  paddingLeft: '',
  paddingRight: '',
});

const storage = { blob: null };
globalThis.localStorage = {
  getItem: () => storage.blob,
  setItem: (_key, value) => { storage.blob = value; },
};

globalThis.fetch = (url) => {
  const path = url.startsWith('../data/') ? 'web/data/' + url.slice(7) : url;
  return { ok: true, text: async () => await readFile(path, 'utf8') };
};

/**
 * A tap. The shim has no layout, so a click is aimed at an element rather than at a point, and it
 * bubbles the way a real click does: every ancestor's handler runs, with `target` the tapped node.
 * That is what makes `app.js`'s delegated handlers — one per container, not one per cell — testable.
 */
function click(node) {
  for (let at = node; at !== undefined && at !== null; at = at.parent) {
    const handler = at.listeners?.click;
    if (handler !== undefined) handler({ target: node });
  }
}

/**
 * Typing a number into an input. A real browser fires `change` on the input and leaves it there:
 * a probe page dispatched one on a live page and found a listener on the panel never ran, while a
 * real click on a child did reach the panel. So `type` runs only the node's own handler, and a page
 * that wants to hear a typed number listens on the field — which is what the desktop's per-spinner
 * `ChangeListener` does. Setting `.value` alone would model a script writing into a field, not a
 * visitor changing one.
 */
function type(node, value) {
  node.value = String(value);
  const handler = node.listeners?.change;
  if (handler !== undefined) handler({ target: node });
}

/** What `page.test.js` asserts on. */
globalThis.PAGE = { registry, lookedUp, created, storage, element, click, type };
