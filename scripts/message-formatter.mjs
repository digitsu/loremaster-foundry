/**
 * Loremaster Message Formatter
 *
 * Formats AI responses for display in Foundry VTT chat.
 * Converts markdown to HTML and adds appropriate styling.
 */

const MODULE_ID = 'loremaster';

/**
 * Format an AI response for display in Foundry chat.
 * Detects if response is already HTML-formatted and skips processing if so.
 *
 * @param {string} text - Raw text from Claude API.
 * @returns {string} Formatted HTML for chat display.
 */
export function formatResponse(text) {
  if (!text) return '';

  // Check if the response is already HTML-formatted (Claude sometimes mimics
  // the format from conversation history)
  const trimmed = text.trim();
  if (trimmed.startsWith('<div class="loremaster-response">') ||
      trimmed.startsWith('<div class=\'loremaster-response\'>')) {
    // Already formatted - return as-is
    console.log('loremaster | Response already HTML-formatted, skipping formatResponse');
    return trimmed;
  }

  // Also check for partial HTML formatting (has HTML tags but no wrapper)
  if (trimmed.startsWith('<h3 class="loremaster-header">') ||
      trimmed.startsWith('<h4 class="loremaster-header">') ||
      trimmed.startsWith('<p class="loremaster-paragraph">')) {
    // Has our formatting classes - just wrap it
    console.log('loremaster | Response has HTML formatting, wrapping only');
    return `<div class="loremaster-response">${trimmed}</div>`;
  }

  let formatted = text;

  // Escape HTML first to prevent XSS
  formatted = escapeHtml(formatted);

  // Convert markdown to HTML
  formatted = convertMarkdown(formatted);

  // Wrap in container div for styling
  formatted = `<div class="loremaster-response">${formatted}</div>`;

  return formatted;
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
