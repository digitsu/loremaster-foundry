/**
 * Tests for message-formatter.mjs list handling.
 *
 * Regression: markdown ORDERED lists were converted to bare <li> elements with
 * no <ol> wrapper (unordered lists got a <ul>). Bare <li> content nested inside
 * Foundry's chat template root (itself an <li class="chat-message">) force-closes
 * that ancestor li per the HTML parsing spec, so foundry.utils.parseHTML returns
 * an HTMLCollection instead of an HTMLElement and every renderChatMessageHTML
 * hook dies with "html.querySelector is not a function", aborting the message
 * render (observed in prod 2026-07-17, world dolmenwood-solo, msg jlAeM9FuODKozwWW).
 *
 * Run: node tests/message-formatter.test.mjs
 * (No DOM in plain node — these tests cover the pure regex conversion pipeline.
 * The DOM-dependent ensureBalancedHtml orphan-<li> defense is exercised in the
 * browser; see fix branch notes.)
 */
import assert from 'node:assert/strict';
import { formatResponse } from '../scripts/message-formatter.mjs';

/**
 * Assert every <li> in `html` sits inside a <ul> or <ol> ancestor, using a tiny
 * tag-stack scan (no DOM in node). Fails on any list item opened while no list
 * container is open.
 */
function assertNoBareLi(html, label) {
  const tags = [...html.matchAll(/<\/?(ul|ol|li)\b/gi)];
  let listDepth = 0;
  for (const t of tags) {
    const tag = t[0].toLowerCase();
    if (tag === '<ul' || tag === '<ol') listDepth++;
    else if (tag === '</ul' || tag === '</ol') listDepth--;
    else if (tag === '<li') {
      assert.ok(listDepth > 0, `${label}: bare <li> outside <ul>/<ol> at index ${t.index}`);
    }
  }
  assert.equal(listDepth, 0, `${label}: unbalanced <ul>/<ol> tags`);
}

// --- Ordered list gets wrapped -------------------------------------------
const ordered = formatResponse(
  'The process:\n\n1. **Roll ability scores**\n2. **Choose your class**\n3. Roll Hit Points\n\nDone.'
);
assert.ok(/<ol[^>]*class="loremaster-list"/.test(ordered), 'ordered list should be wrapped in <ol class="loremaster-list">');
assertNoBareLi(ordered, 'ordered');

// --- Unordered list still wrapped (no regression) ------------------------
const unordered = formatResponse('Options:\n\n- Fighter\n- Cleric\n- Thief\n\nPick one.');
assert.ok(/<ul[^>]*class="loremaster-list"/.test(unordered), 'unordered list should be wrapped in <ul class="loremaster-list">');
assertNoBareLi(unordered, 'unordered');

// --- Mixed document: both list kinds, neither leaks bare <li> -------------
const mixed = formatResponse(
  'Classes:\n\n- Fighter\n- Magic-User\n\nSteps:\n\n1. Roll scores\n2. Choose class\n3. Buy equipment\n\nGo!'
);
assertNoBareLi(mixed, 'mixed');
assert.ok(/<ul[^>]*loremaster-list/.test(mixed), 'mixed: ul present');
assert.ok(/<ol[^>]*loremaster-list/.test(mixed), 'mixed: ol present');

// --- No double-wrapping: exactly one <ul> for one bulleted run ------------
const single = formatResponse('- a\n- b\n- c');
assert.equal((single.match(/<ul/g) || []).length, 1, 'single bulleted run wraps exactly once');
assert.equal((single.match(/<ol/g) || []).length, 0, 'no stray <ol> for bulleted run');

// --- Reproduction shape from the failing prod message ---------------------
const prodShape = formatResponse(
  '#### The Full Process (Overview)\n\n1. **Roll ability scores**\n2. **Choose your class** (must meet minimums)\n3. **Roll Hit Points** (based on class HD)\n4. **Choose alignment** (Law, Neutrality, or Chaos)\n5. **Roll starting gold** and buy **equipment**\n6. **Note class abilities**, saving throws, and attack values\n7. **Name your character** and establish background\n\n---\n\nShall I **roll your ability scores** to get started?'
);
assertNoBareLi(prodShape, 'prod-shape');

console.log('message-formatter list tests passed');
