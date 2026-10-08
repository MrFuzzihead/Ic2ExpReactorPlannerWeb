#!/usr/bin/env node
/**
 * The Component List tab's oracle: what the design holds, counted by display name, under every
 * corpus design.
 *
 * The desktop's tab is a `JTextArea` in a `JScrollPane` (`ReactorPlannerFrame:634-638`) rewritten
 * after every action with `reactor.getComponentList().toString()` — one of the same four sites that
 * rewrite the max-heat label (`:280`, `:322`, `:2068`, `:2690`), and all four read the design's
 * reactor rather than the last run's grid. `Reactor.getComponentList` (`Reactor.java:203`) walks the
 * grid column-major and adds each component's `name` — the *localized display name*, since
 * `ComponentName` is an i18n key — to a `MaterialsList`, so the tab is that class's `count name`
 * lines in `String.compareTo` order.
 *
 * There is no frozen baseline for this tab: the corpus baseline carries a run's figures, and the
 * component list is never part of a report. The oracle is therefore the board itself — the counts
 * have to agree with what the decoder found cell by cell, the names have to be the catalog's, and
 * the order has to be the list class's — plus the one thing the walk's direction decides: a
 * column-major walk and a row-major walk put the same components in the same counts, so the order
 * of the walk is not what this tab shows, and the test says so rather than assuming it.
 *
 * Run: `node web/test/component-list.test.js`
 *
 * @see web/ui/component-list.js, WEB_MIGRATION_PLAN.md §33
 */

import { loadBundle, getI18n } from '../engine/i18n.js';
import { parseCatalog } from '../engine/components.js';
import { describeBoard } from '../ui/board.js';
import { componentList } from '../ui/component-list.js';
import { readFile } from 'node:fs/promises';

const designsFixture = await readFile('testResources/corpus-designs.json', 'utf8');
const catalogFixture = await readFile('web/data/components.json', 'utf8');
const bundleFixture = await readFile('web/data/i18n/en.json', 'utf8');

loadBundle(bundleFixture);
const catalog = parseCatalog(catalogFixture);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// The list class prints `count name` with the bundle's own number format, one line per material.
const numberFormat = getI18n('UI.MaterialDecimalFormat');
assert(numberFormat.length > 0, 'the list class has no number format to print counts with');

const designs = JSON.parse(designsFixture).designs;
let checked = 0;
let empty = 0;
const lists = new Set();

for (const design of designs) {
  const board = describeBoard(design.code, catalog);
  if (!board.ok) continue; // a design the decoder rejects has no components to count

  const got = componentList(design.code, catalog);
  if (!got.ok) {
    assert(false, `the list refused ${design.id}: ${got.message}`);
  }

  // The engine's whole string, exactly as Java writes it: every line terminated, including the last.
  assert(got.text === '' || got.text.endsWith('\n'),
    `${design.id}'s list lost the trailing newline the list class writes after every entry`);
  assert(got.text === '' || !got.text.endsWith('\n\n'),
    `${design.id}'s list wrote a blank line the list class never emits`);

  // The rows are the whole string split at those newlines, not a re-derivation of it.
  const rejoined = got.lines.length === 0 ? '' : `${got.lines.join('\n')}\n`;
  assert(got.text === rejoined,
    `${design.id}'s rows are not the whole list split at its newlines`);

  // Counts against the board, name by name.
  const expected = new Map();
  for (const cell of board.cells) {
    expected.set(cell.name, (expected.get(cell.name) ?? 0) + 1);
  }
  const seen = new Map();
  for (const line of got.lines) {
    const match = /^(?<count>\d+) (?<name>.+)$/.exec(line);
    assert(match !== null, `${design.id}'s row ${line} is not a count followed by a name`);
    // `match.count` is shadowed on a match object (`name` and `count` are properties the match
    // object already has), so the groups come out of `groups`.
    const count = Number(match.groups.count);
    assert(count >= 1, `${design.id}'s row ${line} counts a component nobody placed`);
    assert(!seen.has(match.groups.name), `${design.id} lists ${match.groups.name} twice, which the list class cannot do`);
    seen.set(match.groups.name, count);
  }
  assert(seen.size === expected.size,
    `${design.id} lists ${seen.size} kinds of component, the board holds ${expected.size}`);
  for (const [name, count] of expected) {
    assert(seen.get(name) === count, `${design.id} counts ${seen.get(name) ?? 'nothing'} ${name}, the board holds ${count}`);
  }

  // The order is the list class's: UTF-16 code-unit order, which is what JS's default sort does.
  const names = got.lines.map((line) => line.replace(/^\d+ /, ''));
  assert(`${names.join('\n')}` === [...names].sort().join('\n'),
    `${design.id}'s rows are not in the order the list class walks`);

  // The names are the catalog's display names, not the `ComponentName.*` keys the code carries.
  for (const name of names) {
    assert(!name.startsWith('ComponentName.'),
      `${design.id}'s list printed a bundle key (${name}) instead of the name the block prints`);
  }

  if (got.lines.length === 0) empty += 1;
  assert(got.lines.length === board.filled || board.filled === 0 || got.lines.length > 0,
    `${design.id}'s list is empty while the board holds ${board.filled} components`);

  lists.add(got.text);
  checked += 1;
}

assert(checked > 0, 'no corpus design reached the list');
assert(lists.size > 1, `every design printed the same list, so the tab never moves with the design`);
assert(empty < checked, `every corpus design printed an empty list (${empty}/${checked})`);

// A code the decoder rejects is refused rather than answered with an empty tab, which is what a
// visitor would otherwise read as "this reactor holds nothing".
const bad = componentList('not a reactor code', catalog);
assert(!bad.ok, 'a code the decoder rejects was answered with a list');
assert(bad.message.length > 0, `the refusal for a bad code said nothing`);

console.log(`component-list.test.js: ${checked} corpus designs (${empty} empty) counted every component the decoder found, in the list class's order, under the catalog's names`);
