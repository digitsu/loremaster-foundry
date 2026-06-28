/**
 * message-formatter.mjs — render-time transformations and formatting utilities
 * for Loremaster AI responses in Foundry VTT chat.
 *
 * Provides two main capabilities:
 * 1. stripAudioTagsFromMessage() — strips ElevenLabs v3 audio tags (e.g.
 *    [whispers], [excited]) from rendered chat DOM so readers see clean prose,
 *    while the persisted ChatMessage.content keeps the brackets for TTS reuse.
 *    Hooks into renderChatMessageHTML. Idempotent: safe to call multiple times
 *    on the same message; only touches text-node content, never button/data
 *    attributes (so the v0.4 replay icon + canon data-message-id stay intact).
 * 2. formatResponse() and related helpers — convert markdown AI responses to
 *    styled HTML for chat display.
 */

// ---------------------------------------------------------------------------
// Audio-tag stripping (ElevenLabs v3 / Voice V2)
// ---------------------------------------------------------------------------

// Allow-list of audio tag tokens that ElevenLabs v3 interprets. Mirrors the
// parser allow-list in the v2 spec §4.2 and the server-side AudioTagPrompt
// module. Add tokens here as ElevenLabs publishes new ones; do NOT add speaker
// names — those are stripped via different regex in Phase 2.
const AUDIO_TAG_REGEX =
  /\[(whispers|excited|sighs|laughs|crying|shouting|nervously|sarcastic|pleading|tired|breathless|serious|surprised)\]/gi;

/**
 * Strip ElevenLabs v3 audio tags from the rendered chat-message DOM.
 * Walks text nodes inside .message-content in-place; preserves all other DOM
 * structure. Idempotent — safe to call on the same element multiple times.
 *
 * @param {HTMLElement} element - the rendered chat message element passed by
 *   the renderChatMessageHTML hook.
 * @returns {void}
 */
export function stripAudioTagsFromMessage(element) {
  if (!(element instanceof HTMLElement)) return;
  const content = element.querySelector('.message-content');
  if (!content) return;

  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  const toReplace = [];
  let node;
  while ((node = walker.nextNode())) {
    if (AUDIO_TAG_REGEX.test(node.nodeValue)) {
      toReplace.push(node);
    }
  }
  // Reset regex state — the g flag makes test() stateful.
  AUDIO_TAG_REGEX.lastIndex = 0;

  for (const textNode of toReplace) {
    textNode.nodeValue = textNode.nodeValue.replace(AUDIO_TAG_REGEX, '');
    AUDIO_TAG_REGEX.lastIndex = 0;
  }
}

// ---------------------------------------------------------------------------
// Markdown → HTML formatting (pre-existing helpers)
// ---------------------------------------------------------------------------

const MODULE_ID = 'loremaster';

/**
 * Normalize an HTML fragment into well-formed, balanced markup.
 *
 * Our markdown converter (and any HTML Claude echoes back from conversation
 * history) can emit malformed fragments — stray `</p>` with no opening tag,
 * an unclosed trailing `<p>`, block elements such as `<ul>`/`<li>` illegally
 * nested inside `<p>`, etc. Foundry V13's chat-render pipeline (and the dnd5e
 * system's `_displayChatActionButtons`) throws `html.querySelector is not a
 * function` on such content, aborting the render so the message displays only
 * partially ("half the message"). Round-tripping the fragment through a detached
 * DOM element forces the browser's HTML parser to produce a valid, balanced
 * tree, which we then re-serialize. Idempotent on already-valid HTML.
 *
 * @param {string} html - Possibly-malformed HTML fragment.
 * @returns {string} Well-formed, balanced HTML (unchanged if no DOM available).
 */
function ensureBalancedHtml(html) {
  if (typeof html !== 'string' || !html) return html;
  // `document` is always present in the Foundry browser runtime; guard anyway so
  // the function degrades gracefully in non-DOM contexts (e.g. unit tests).
  if (typeof document === 'undefined') return html;
  try {
    const container = document.createElement('div');
    container.innerHTML = html;
    return container.innerHTML;
  } catch (err) {
    console.warn('loremaster | ensureBalancedHtml failed, returning raw HTML:', err);
    return html;
  }
}

/**
 * Format an AI response for display in Foundry chat.
 * Detects if response is already HTML-formatted and skips processing if so.
 * Handles arrays and objects by rendering them as structured HTML.
 *
 * @param {string|Array|Object} text - Raw response from Claude API.
 * @returns {string} Formatted HTML for chat display.
 */
export function formatResponse(text) {
  // Always log the input type for debugging
  const inputType = text === null ? 'null' :
                    text === undefined ? 'undefined' :
                    Array.isArray(text) ? 'array' :
                    typeof text;

  // Log non-string inputs for debugging
  if (typeof text !== 'string' && text !== null && text !== undefined) {
    console.warn(`loremaster | formatResponse received non-string input:`, {
      type: inputType,
      constructor: text?.constructor?.name,
      value: text
    });
  }

  if (!text) return '';

  // Check if it's a string that looks like a serialized object (e.g., "[object HTMLCollection]")
  // This can happen if something was stringified before reaching this function
  if (typeof text === 'string') {
    const trimmed = text.trim();
    // Catch any [object X] pattern
    const objectPattern = /^\[object \w+\]$/;
    if (objectPattern.test(trimmed)) {
      console.error('loremaster | Received pre-stringified object in chat:', trimmed);
      console.error('loremaster | Stack trace:', new Error().stack);
      return `<div class="loremaster-response"><p class="loremaster-paragraph"><em>(Invalid response format - check console)</em></p></div>`;
    }
  }

  // Handle DOM collections (HTMLCollection, NodeList) - extract text content
  // Use duck-typing in addition to instanceof for cross-frame compatibility
  const isDOMCollection = (typeof HTMLCollection !== 'undefined' && text instanceof HTMLCollection) ||
                          (typeof NodeList !== 'undefined' && text instanceof NodeList) ||
                          (typeof text === 'object' && text !== null &&
                           typeof text.length === 'number' &&
                           typeof text.item === 'function' &&
                           !Array.isArray(text));

  if (isDOMCollection) {
    console.warn('loremaster | Response is DOM collection, extracting text. Stack:', new Error().stack);
    const textParts = [];
    for (let i = 0; i < text.length; i++) {
      const node = text[i] || text.item(i);
      if (node && node.textContent) {
        textParts.push(node.textContent);
      }
    }
    text = textParts.join('\n');
    if (!text) {
      return `<div class="loremaster-response"><p class="loremaster-paragraph"><em>(Empty DOM collection)</em></p></div>`;
    }
  }

  // Handle DOM elements - extract text content
  // Use duck-typing for cross-frame compatibility
  const isDOMElement = (typeof Element !== 'undefined' && text instanceof Element) ||
                       (typeof Node !== 'undefined' && text instanceof Node) ||
                       (typeof text === 'object' && text !== null &&
                        typeof text.nodeType === 'number' &&
                        typeof text.textContent === 'string');

  if (isDOMElement) {
    console.warn('loremaster | Response is DOM element, extracting text. Stack:', new Error().stack);
    text = text.textContent || '';
    if (!text) {
      return `<div class="loremaster-response"><p class="loremaster-paragraph"><em>(Empty DOM element)</em></p></div>`;
    }
  }

  // Handle arrays - render as collapsible list
  if (Array.isArray(text)) {
    console.log('loremaster | Response is array, formatting as list');
    return formatArrayResponse(text);
  }

  // Handle objects (but not strings) - render as structured view
  if (typeof text === 'object' && text !== null) {
    console.warn('loremaster | Response is unexpected object type:', text?.constructor?.name);
    console.warn('loremaster | Object value:', JSON.stringify(text, null, 2));
    return formatObjectResponse(text);
  }

  // Ensure we have a string
  if (typeof text !== 'string') {
    text = String(text);
  }

  // Check if the response is already HTML-formatted (Claude sometimes mimics
  // the format from conversation history)
  const trimmed = text.trim();
  if (trimmed.startsWith('<div class="loremaster-response">') ||
      trimmed.startsWith('<div class=\'loremaster-response\'>')) {
    // Already formatted - return as-is (balanced so a malformed echo can't break render)
    console.log('loremaster | Response already HTML-formatted, skipping formatResponse');
    return ensureBalancedHtml(trimmed);
  }

  // Also check for partial HTML formatting (has HTML tags but no wrapper)
  if (trimmed.startsWith('<h3 class="loremaster-header">') ||
      trimmed.startsWith('<h4 class="loremaster-header">') ||
      trimmed.startsWith('<p class="loremaster-paragraph">')) {
    // Has our formatting classes - just wrap it
    console.log('loremaster | Response has HTML formatting, wrapping only');
    return ensureBalancedHtml(`<div class="loremaster-response">${trimmed}</div>`);
  }

  let formatted = text;

  // Escape HTML first to prevent XSS
  formatted = escapeHtml(formatted);

  // Convert markdown to HTML
  formatted = convertMarkdown(formatted);

  // Wrap in container div for styling
  formatted = `<div class="loremaster-response">${formatted}</div>`;

  // Balance the markup before it becomes ChatMessage.content. convertMarkdown's
  // regex-based block handling can emit malformed HTML (stray/unclosed <p>,
  // <ul>/<li> nested in <p>) that breaks Foundry V13's chat render pipeline.
  return ensureBalancedHtml(formatted);
}

/**
 * Escape HTML special characters.
 *
 * @param {string} text - Raw text.
 * @returns {string} Escaped text.
 */
function escapeHtml(text) {
  const escapeMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, char => escapeMap[char]);
}

/**
 * Convert markdown syntax to HTML.
 *
 * @param {string} text - Text with markdown.
 * @returns {string} HTML formatted text.
 */
function convertMarkdown(text) {
  let html = text;

  // Headers (## Header -> <h4>)
  html = html.replace(/^### (.+)$/gm, '<h5 class="loremaster-header">$1</h5>');
  html = html.replace(/^## (.+)$/gm, '<h4 class="loremaster-header">$1</h4>');
  html = html.replace(/^# (.+)$/gm, '<h3 class="loremaster-header">$1</h3>');

  // Bold (**text** or __text__)
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // Italic (*text* or _text_)
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

  // Inline code (`code`)
  html = html.replace(/`([^`]+)`/g, '<code class="loremaster-code">$1</code>');

  // Dice notation highlighting (e.g., 2d6, 3d8+2)
  html = html.replace(/\b(\d+d\d+(?:[+-]\d+)?)\b/g, '<span class="loremaster-dice">$1</span>');

  // Unordered lists
  html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul class="loremaster-list">$&</ul>');

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Blockquotes (> text) - great for NPC dialogue
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote class="loremaster-quote">$1</blockquote>');
  // Merge consecutive blockquotes
  html = html.replace(/<\/blockquote>\n<blockquote class="loremaster-quote">/g, '<br>');

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr class="loremaster-divider">');

  // Paragraphs - convert double newlines to paragraph breaks
  html = html.replace(/\n\n+/g, '</p><p class="loremaster-paragraph">');

  // Single newlines to <br> within paragraphs
  html = html.replace(/\n/g, '<br>');

  // Wrap in paragraph if not already wrapped
  if (!html.startsWith('<')) {
    html = `<p class="loremaster-paragraph">${html}</p>`;
  }

  // Clean up empty paragraphs
  html = html.replace(/<p class="loremaster-paragraph"><\/p>/g, '');

  return html;
}

/**
 * Format a tool result for display.
 *
 * @param {string} toolName - Name of the tool that was called.
 * @param {object} result - The tool result.
 * @returns {string} Formatted HTML.
 */
export function formatToolResult(toolName, result) {
  const toolLabels = {
    'roll_dice': '🎲 Dice Roll',
    'get_actor': '👤 Actor Info',
    'get_scene': '🗺️ Scene Info',
    'get_combat': '⚔️ Combat Status',
    'lookup_item': '📦 Item Lookup',
    'lookup_table': '📋 Table Lookup',
    'speak_as': '💬 NPC Speech',
    'play_audio': '🔊 Audio'
  };

  const label = toolLabels[toolName] || toolName;

  return `
    <div class="loremaster-tool-result">
      <div class="loremaster-tool-header">${label}</div>
      <div class="loremaster-tool-content">
        ${formatToolContent(toolName, result)}
      </div>
    </div>
  `;
}

/**
 * Format tool-specific content.
 *
 * @param {string} toolName - Name of the tool.
 * @param {object} result - The tool result.
 * @returns {string} Formatted content.
 */
function formatToolContent(toolName, result) {
  switch (toolName) {
    case 'roll_dice':
      return formatDiceResult(result);
    case 'get_actor':
      return formatActorResult(result);
    default:
      return `<pre>${JSON.stringify(result, null, 2)}</pre>`;
  }
}

/**
 * Format dice roll result.
 *
 * @param {object} result - Dice roll result.
 * @returns {string} Formatted HTML.
 */
function formatDiceResult(result) {
  const diceDisplay = result.dice?.map(d =>
    `[${d.results.join(', ')}]`
  ).join(' ') || '';

  return `
    <div class="loremaster-dice-result">
      <span class="dice-formula">${result.formula}</span>
      <span class="dice-values">${diceDisplay}</span>
      <span class="dice-total">= <strong>${result.total}</strong></span>
    </div>
  `;
}

/**
 * Format actor lookup result.
 *
 * @param {object} result - Actor data.
 * @returns {string} Formatted HTML.
 */
function formatActorResult(result) {
  return `
    <div class="loremaster-actor-result">
      <strong>${result.name}</strong> (${result.type})
    </div>
  `;
}

/**
 * Format an array response as a collapsible list.
 * Each item shows a summary line, expandable for full details.
 *
 * @param {Array} arr - Array to format.
 * @returns {string} Formatted HTML.
 */
function formatArrayResponse(arr) {
  if (arr.length === 0) {
    return '<div class="loremaster-response"><p class="loremaster-paragraph"><em>Empty list</em></p></div>';
  }

  const items = arr.map((item, index) => {
    const summary = getItemSummary(item, index);
    const details = formatValue(item, 1);
    const hasDetails = typeof item === 'object' && item !== null;

    if (hasDetails) {
      return `
        <li class="loremaster-list-item">
          <details class="loremaster-details">
            <summary class="loremaster-summary">${escapeHtml(summary)}</summary>
            <div class="loremaster-detail-content">${details}</div>
          </details>
        </li>`;
    } else {
      return `<li class="loremaster-list-item">${escapeHtml(summary)}</li>`;
    }
  }).join('');

  return `
    <div class="loremaster-response">
      <p class="loremaster-paragraph"><strong>${arr.length} item${arr.length !== 1 ? 's' : ''}</strong></p>
      <ul class="loremaster-structured-list">${items}</ul>
    </div>`;
}

/**
 * Format an object response as a structured view.
 *
 * @param {Object} obj - Object to format.
 * @returns {string} Formatted HTML.
 */
function formatObjectResponse(obj) {
  const content = formatValue(obj, 0);
  return `<div class="loremaster-response">${content}</div>`;
}

/**
 * Get a one-line summary of an item for display.
 *
 * @param {*} item - Item to summarize.
 * @param {number} index - Index in array.
 * @returns {string} Summary string.
 */
function getItemSummary(item, index) {
  if (item === null) return 'null';
  if (item === undefined) return 'undefined';

  if (typeof item === 'string') {
    return item.length > 60 ? item.substring(0, 60) + '...' : item;
  }

  if (typeof item === 'number' || typeof item === 'boolean') {
    return String(item);
  }

  if (Array.isArray(item)) {
    return `Array (${item.length} items)`;
  }

  if (typeof item === 'object') {
    // Try to find a good display field
    const displayFields = ['title', 'name', 'id', 'label', 'summary', 'description'];
    for (const field of displayFields) {
      if (item[field] && typeof item[field] === 'string') {
        const value = item[field];
        return value.length > 50 ? value.substring(0, 50) + '...' : value;
      }
    }

    // Fall back to showing keys
    const keys = Object.keys(item);
    if (keys.length === 0) return 'Empty object';
    if (keys.length <= 3) return keys.join(', ');
    return `Object (${keys.length} properties)`;
  }

  return `Item ${index + 1}`;
}

/**
 * Format a value for display, with indentation support.
 *
 * @param {*} value - Value to format.
 * @param {number} depth - Current nesting depth.
 * @returns {string} Formatted HTML.
 */
function formatValue(value, depth) {
  if (value === null) return '<span class="loremaster-null">null</span>';
  if (value === undefined) return '<span class="loremaster-undefined">undefined</span>';

  if (typeof value === 'string') {
    const escaped = escapeHtml(value);
    // Format long strings with line breaks
    if (value.length > 100) {
      return `<span class="loremaster-string">${escaped}</span>`;
    }
    return `<span class="loremaster-string">"${escaped}"</span>`;
  }

  if (typeof value === 'number') {
    return `<span class="loremaster-number">${value}</span>`;
  }

  if (typeof value === 'boolean') {
    return `<span class="loremaster-boolean">${value}</span>`;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '<span class="loremaster-empty">[]</span>';
    if (depth > 2) return `<span class="loremaster-truncated">[${value.length} items...]</span>`;

    const items = value.map(item => `<li>${formatValue(item, depth + 1)}</li>`).join('');
    return `<ul class="loremaster-nested-list">${items}</ul>`;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return '<span class="loremaster-empty">{}</span>';
    if (depth > 2) return `<span class="loremaster-truncated">{${keys.length} properties...}</span>`;

    const rows = keys.map(key => {
      const val = formatValue(value[key], depth + 1);
      return `<tr><td class="loremaster-key">${escapeHtml(key)}</td><td class="loremaster-value">${val}</td></tr>`;
    }).join('');

    return `<table class="loremaster-object-table"><tbody>${rows}</tbody></table>`;
  }

  return escapeHtml(String(value));
}
