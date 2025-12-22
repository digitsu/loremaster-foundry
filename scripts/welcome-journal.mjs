/**
 * Loremaster Welcome Journal
 *
 * Creates and displays introductory documentation for the Loremaster module.
 * Shows a welcome journal on first run to guide users through setup and usage.
 */

const MODULE_ID = 'loremaster';

/**
 * Journal content for the Loremaster documentation.
 * Each entry becomes a page in the welcome journal.
 */
const JOURNAL_PAGES = [
  {
    name: 'Welcome to Loremaster',
    type: 'text',
    sort: 100,
    text: {
      format: 1,
      content: `
<h1>Welcome to Loremaster</h1>

<p><strong>Loremaster</strong> is an AI-powered Game Master assistant for Foundry VTT. It uses Claude AI to help run your tabletop RPG sessions, providing dynamic narration, NPC interactions, rules assistance, and more.</p>

<h2>What Loremaster Can Do</h2>
<ul>
  <li><strong>Narrate scenes</strong> - Describe locations, events, and atmosphere</li>
  <li><strong>Voice NPCs</strong> - Roleplay non-player characters with distinct personalities</li>
  <li><strong>Assist with rules</strong> - Look up and interpret game rules</li>
  <li><strong>Roll dice</strong> - Make dice rolls within the narrative</li>
  <li><strong>Track combat</strong> - Understand and describe combat situations</li>
  <li><strong>Manage story</strong> - Remember context across the session</li>
</ul>

<h2>Getting Started</h2>
<ol>
  <li><strong>Configure the Proxy Server</strong> - Set up the Loremaster proxy server (see Configuration page)</li>
  <li><strong>Enter your API Key</strong> - Add your Claude API key in module settings</li>
  <li><strong>Load Adventure Content</strong> - Upload PDFs or sync compendium data</li>
  <li><strong>Start Playing!</strong> - Use <code>@lm</code> in chat to talk to Loremaster</li>
</ol>

<h2>Quick Start</h2>
<p>Once configured, simply type in the Foundry chat:</p>
<pre>@lm Describe the tavern we just entered</pre>
<p>Loremaster will respond with an evocative description based on your loaded adventure content and game context.</p>

<p><em>Continue to the next pages to learn about all features and setup options.</em></p>
`
    }
  },
  {
    name: 'For Game Masters',
    type: 'text',
    sort: 200,
    text: {
      format: 1,
      content: `
<h1>Game Master Features</h1>

<p>As the GM, you have full control over Loremaster and can use it to enhance your storytelling.</p>

<h2>GM-Only Capabilities</h2>
<ul>
  <li><strong>Upload Adventure PDFs</strong> - Add adventure modules, supplements, and reference materials</li>
  <li><strong>Sync World Data</strong> - Share actors, items, and journals with Loremaster</li>
  <li><strong>GM Rulings</strong> - Override or correct Loremaster's responses</li>
  <li><strong>Veto Responses</strong> - Request regeneration with corrections</li>
  <li><strong>Manage Conversations</strong> - Create, switch, and delete conversation histories</li>
</ul>

<h2>Content Manager</h2>
<p>Access the <strong>Content Manager</strong> from the scene controls (brain icon) to:</p>
<ul>
  <li>Upload PDF adventure modules</li>
  <li>Categorize content (Adventure, Supplement, Reference)</li>
  <li>View processing status</li>
  <li>Delete uploaded content</li>
</ul>

<h2>GM Rulings</h2>
<p>To provide instructions that Loremaster <em>must</em> follow, use the GM Ruling prefix:</p>
<pre>@lm [GM RULING: The merchant is secretly a spy] Describe the merchant</pre>
<p>GM Rulings are absolute - Loremaster will always follow them.</p>

<h2>Veto System</h2>
<p>After Loremaster responds, GMs can:</p>
<ul>
  <li><strong>Veto</strong> - Provide a correction and regenerate the response</li>
  <li><strong>Regenerate</strong> - Get a new response without specific corrections</li>
</ul>
<p>Use this when Loremaster's response doesn't fit your vision for the scene.</p>

<h2>Multi-Player Batching</h2>
<p>When multiple players send messages:</p>
<ul>
  <li><strong>Timer Mode</strong> - Messages collected for a set time (3-30 seconds)</li>
  <li><strong>Manual Mode</strong> - GM triggers when ready with <code>@lm !send</code></li>
</ul>
<p>Loremaster responds to all player actions simultaneously, creating a cohesive narrative.</p>

<h2>Conversation Management</h2>
<p>Access from scene controls (comments icon) to:</p>
<ul>
  <li>View all conversation sessions</li>
  <li>Switch between conversations</li>
  <li>Start new conversations for different scenes or sessions</li>
  <li>Clear or delete old conversations</li>
  <li><strong>Export to Journal</strong> - Save conversation history as a Foundry journal</li>
</ul>

<h2>API Usage Monitor</h2>
<p>Access from scene controls (chart icon) to track:</p>
<ul>
  <li>Token usage (input, output, cache)</li>
  <li>Session and all-time statistics</li>
  <li>Estimated API costs</li>
</ul>
`
    }
  },
  {
    name: 'GM Prep & Cast Management',
    type: 'text',
    sort: 250,
    text: {
      format: 1,
      content: \`
<h1>GM Prep & Cast Management</h1>

<p>Loremaster can generate comprehensive adventure scripts and help manage character assignments for your sessions.</p>

<h2>GM Prep Scripts</h2>
<p>For uploaded adventure PDFs, Loremaster can generate a <strong>GM Prep Script</strong> - a detailed guide for running the adventure.</p>

<h3>Generating a GM Prep Script</h3>
<ol>
  <li>Upload an adventure PDF in the <strong>Content Manager</strong></li>
  <li>Click the <strong>GM Prep</strong> button on the PDF entry</li>
  <li>Wait for generation (may take a few minutes)</li>
  <li>A Foundry journal entry will be created with the script</li>
</ol>

<h3>What's Included</h3>
<ul>
  <li><strong>Adventure Overview</strong> - Synopsis, themes, and structure</li>
  <li><strong>Scene-by-Scene Guide</strong> - Detailed breakdown of each encounter</li>
  <li><strong>NPC Roster</strong> - All characters with stats and personalities</li>
  <li><strong>Quick Reference Tables</strong> - Key information at a glance</li>
  <li><strong>GM Tips</strong> - Running advice and potential issues</li>
</ul>

<h3>Editing GM Prep Scripts</h3>
<p>You can edit the GM Prep journal directly in Foundry. Changes are <strong>automatically synced</strong> back to the server after 30 seconds of inactivity. Look for the sync indicator in the journal header:</p>
<ul>
  <li><strong>Pending sync...</strong> - Changes waiting to sync</li>
  <li><strong>Syncing...</strong> - Upload in progress</li>
  <li><strong>Synced</strong> - Changes saved to server</li>
</ul>

<h2>Cast Management</h2>
<p>When you activate an adventure with a GM Prep script, Loremaster helps assign characters to players.</p>

<h3>Cast Selection Dialog</h3>
<p>When activating an adventure, a dialog appears showing:</p>
<ul>
  <li><strong>Playable Characters</strong> - Assign to players via dropdown</li>
  <li><strong>NPCs for AI Control</strong> - Check which NPCs Loremaster should roleplay</li>
</ul>

<h3>Cast Tab in Content Manager</h3>
<p>For ongoing management, use the <strong>Cast</strong> tab:</p>
<ul>
  <li>View all extracted characters</li>
  <li>Change player assignments</li>
  <li>Toggle GM or Loremaster control</li>
  <li><strong>Extract from Script</strong> - Re-parse characters if needed</li>
</ul>

<h3>How Loremaster Uses Assignments</h3>
<p>Characters marked as <strong>Loremaster Controls</strong> will be actively roleplayed by the AI during the session. The AI knows:</p>
<ul>
  <li>Which characters it should voice</li>
  <li>Which characters belong to players (won't control these)</li>
  <li>Character personalities and motivations from the script</li>
</ul>

<h2>Best Practices</h2>
<ul>
  <li><strong>Generate scripts before session zero</strong> - Review and edit as needed</li>
  <li><strong>Assign characters before play</strong> - Use Cast Selection at adventure start</li>
  <li><strong>Mark key NPCs for AI</strong> - Let Loremaster handle recurring characters</li>
  <li><strong>Edit freely</strong> - Your journal changes sync automatically</li>
</ul>
\`
    }
  },
  {
    name: 'For Players',
    type: 'text',
    sort: 300,
    text: {
      format: 1,
      content: `
<h1>Player Guide</h1>

<p>As a player, you can interact with Loremaster to enhance your roleplaying experience.</p>

<h2>Talking to Loremaster</h2>
<p>Use the <code>@lm</code> prefix in Foundry chat to send messages:</p>
<pre>@lm I search the room for hidden compartments</pre>
<pre>@lm What does the bartender look like?</pre>
<pre>@lm I try to intimidate the guard</pre>

<h2>What You Can Ask</h2>
<ul>
  <li><strong>Describe actions</strong> - Tell Loremaster what your character does</li>
  <li><strong>Ask questions</strong> - About NPCs, locations, or the situation</li>
  <li><strong>Roleplay dialogue</strong> - Speak to NPCs in character</li>
  <li><strong>Request information</strong> - What your character would know</li>
</ul>

<h2>Character Context</h2>
<p>If you have a linked character, Loremaster knows about:</p>
<ul>
  <li>Your character's name and background</li>
  <li>Skills and abilities</li>
  <li>Equipment and inventory</li>
  <li>Current condition (HP, status effects)</li>
</ul>

<h2>Multi-Player Sessions</h2>
<p>When playing with others:</p>
<ul>
  <li>Your messages may be batched with other players'</li>
  <li>Loremaster will address everyone's actions together</li>
  <li>The GM controls when batched messages are sent</li>
</ul>

<h2>Tips for Better Interactions</h2>
<ul>
  <li><strong>Be specific</strong> - "I check under the bed" is better than "I search"</li>
  <li><strong>Stay in character</strong> - Roleplay enhances the AI's responses</li>
  <li><strong>Trust the GM</strong> - They can correct or veto responses as needed</li>
  <li><strong>Describe intent</strong> - What is your character trying to achieve?</li>
</ul>

<h2>Limitations</h2>
<p>As a player, you cannot:</p>
<ul>
  <li>Upload adventure content (GM only)</li>
  <li>Modify world data files (GM only)</li>
  <li>Veto or correct responses (GM only)</li>
</ul>
<p>Your interactions affect the game world only through proper game mechanics - dice rolls, skill checks, and narrative actions resolved by Loremaster and the GM.</p>
`
    }
  },
  {
    name: 'Setting Up Adventures',
    type: 'text',
    sort: 400,
    text: {
      format: 1,
      content: `
<h1>Setting Up Adventures</h1>

<p>Loremaster can use adventure content from two sources: <strong>Foundry Modules</strong> and <strong>PDF Documents</strong>.</p>

<h2>Option 1: Foundry Modules (Recommended)</h2>
<p>If your adventure is available as a Foundry VTT module:</p>
<ol>
  <li>Install the adventure module in Foundry</li>
  <li>Import the content into your world</li>
  <li>Click the <strong>Sync World Data</strong> button in Loremaster settings</li>
  <li>Select what to sync: Actors, Items, Journals, Tables</li>
</ol>
<p><strong>Advantages:</strong></p>
<ul>
  <li>Structured data with proper relationships</li>
  <li>NPCs, items, and locations properly linked</li>
  <li>Automatic updates when you modify content</li>
</ul>

<h2>Option 2: PDF Adventures</h2>
<p>For PDF-only adventures:</p>
<ol>
  <li>Open the <strong>Content Manager</strong> (brain icon in scene controls)</li>
  <li>Go to the <strong>Upload</strong> tab</li>
  <li>Drag and drop your PDF or click to browse</li>
  <li>Select a category:
    <ul>
      <li><strong>Adventure</strong> - Main adventure module</li>
      <li><strong>Supplement</strong> - Additional rules or content</li>
      <li><strong>Reference</strong> - Core rulebooks or guides</li>
    </ul>
  </li>
  <li>Click <strong>Upload PDF</strong></li>
</ol>
<p>The PDF will be processed and its content extracted for Loremaster to reference.</p>

<h2>Combining Sources</h2>
<p>You can use both methods together:</p>
<ul>
  <li>Sync Foundry module compendiums for actors and items</li>
  <li>Upload PDF supplements for additional lore</li>
  <li>Upload GM notes as reference documents</li>
</ul>

<h2>Content Categories</h2>
<table>
  <tr>
    <th>Category</th>
    <th>Use For</th>
    <th>Examples</th>
  </tr>
  <tr>
    <td><strong>Adventure</strong></td>
    <td>Main adventure content</td>
    <td>Adventure modules, scenarios</td>
  </tr>
  <tr>
    <td><strong>Supplement</strong></td>
    <td>Additional game content</td>
    <td>Bestiaries, equipment guides</td>
  </tr>
  <tr>
    <td><strong>Reference</strong></td>
    <td>Rules and system info</td>
    <td>Core rulebooks, GM guides</td>
  </tr>
</table>

<h2>Best Practices</h2>
<ul>
  <li>Upload adventure content <em>before</em> starting the session</li>
  <li>Keep PDF file sizes reasonable (under 50MB)</li>
  <li>Use descriptive names when uploading</li>
  <li>Re-sync world data after making significant changes</li>
</ul>
`
    }
  },
  {
    name: 'Using Loremaster Tools',
    type: 'text',
    sort: 500,
    text: {
      format: 1,
      content: `
<h1>Loremaster Tools</h1>

<p>Loremaster can interact with Foundry VTT through various tools. These happen automatically during conversation.</p>

<h2>Available Tools</h2>

<h3>Dice Rolling</h3>
<p>Loremaster can roll dice when appropriate:</p>
<pre>@lm I attack the goblin with my sword</pre>
<p>Loremaster may automatically roll attack and damage dice based on your character's weapon.</p>

<h3>Actor Information</h3>
<p>Loremaster can look up character and NPC details:</p>
<ul>
  <li>Character stats and attributes</li>
  <li>Skills and skill levels</li>
  <li>Inventory and equipment</li>
  <li>Current health and conditions</li>
</ul>

<h3>Scene Information</h3>
<p>Loremaster knows about the current scene:</p>
<ul>
  <li>Scene description and notes</li>
  <li>Visible tokens and their positions</li>
  <li>Environmental conditions</li>
</ul>

<h3>Combat Tracking</h3>
<p>During combat, Loremaster understands:</p>
<ul>
  <li>Current round and turn</li>
  <li>Initiative order</li>
  <li>Combatant status</li>
</ul>

<h3>Item Lookup</h3>
<p>Loremaster can search compendiums for:</p>
<ul>
  <li>Weapons and armor stats</li>
  <li>Equipment descriptions</li>
  <li>Talents and abilities</li>
</ul>

<h3>Roll Tables</h3>
<p>Loremaster can find and roll on tables:</p>
<pre>@lm Roll on the random encounter table</pre>

<h3>NPC Speech</h3>
<p>Loremaster can post messages as NPCs in chat, appearing with the NPC's name and token.</p>

<h2>Tool Usage Examples</h2>
<pre>@lm What are my character's combat skills?</pre>
<p><em>Loremaster looks up your character and lists relevant skills.</em></p>

<pre>@lm I make a stealth check to sneak past the guards</pre>
<p><em>Loremaster rolls your stealth skill and narrates the result.</em></p>

<pre>@lm The captain speaks to the crew</pre>
<p><em>Loremaster posts a message in chat as the captain NPC.</em></p>

<h2>Automatic Context</h2>
<p>Loremaster automatically includes relevant context:</p>
<ul>
  <li>Active scene information</li>
  <li>Combat state if in combat</li>
  <li>Your character's current stats</li>
  <li>Recent conversation history</li>
</ul>
<p>You don't need to repeat information - Loremaster remembers the context of your session.</p>
`
    }
  },
  {
    name: 'Configuration',
    type: 'text',
    sort: 600,
    text: {
      format: 1,
      content: `
<h1>Configuration Guide</h1>

<h2>Prerequisites</h2>
<ol>
  <li><strong>Loremaster Proxy Server</strong> - A running instance of the proxy server</li>
  <li><strong>Claude API Key</strong> - An Anthropic API key for Claude</li>
</ol>

<h2>Setting Up the Proxy Server</h2>
<p>The proxy server handles communication between Foundry and Claude API.</p>

<h3>Installation</h3>
<pre>cd loremaster/server
npm install
</pre>

<h3>Configuration</h3>
<p>Set environment variables:</p>
<pre>ENCRYPTION_KEY=your-secure-encryption-key
PORT=3001
</pre>

<h3>Running</h3>
<pre>npm start</pre>
<p>The server will start on the configured port (default: 3001).</p>

<h2>Module Settings</h2>
<p>Configure the module in Foundry: <strong>Settings > Module Settings > Loremaster</strong></p>

<h3>Basic Settings</h3>
<table>
  <tr>
    <th>Setting</th>
    <th>Description</th>
  </tr>
  <tr>
    <td><strong>Enable Loremaster</strong></td>
    <td>Turn the module on/off</td>
  </tr>
  <tr>
    <td><strong>Proxy URL</strong></td>
    <td>URL of your proxy server (e.g., http://localhost:3001)</td>
  </tr>
  <tr>
    <td><strong>Claude API Key</strong></td>
    <td>Your Anthropic API key</td>
  </tr>
  <tr>
    <td><strong>Chat Trigger Prefix</strong></td>
    <td>Prefix to activate Loremaster (default: @lm)</td>
  </tr>
</table>

<h3>Response Settings</h3>
<table>
  <tr>
    <th>Setting</th>
    <th>Options</th>
  </tr>
  <tr>
    <td><strong>AI Response Visibility</strong></td>
    <td>Everyone, GM Only, or Whisper to Requester</td>
  </tr>
  <tr>
    <td><strong>Include Game Context</strong></td>
    <td>Include scene/combat info in prompts</td>
  </tr>
</table>

<h3>Multi-Player Settings</h3>
<table>
  <tr>
    <th>Setting</th>
    <th>Description</th>
  </tr>
  <tr>
    <td><strong>Batching Mode</strong></td>
    <td>Timer (auto-send) or Manual (GM triggers)</td>
  </tr>
  <tr>
    <td><strong>Timer Duration</strong></td>
    <td>Seconds to wait for messages (3-30)</td>
  </tr>
  <tr>
    <td><strong>Player Message Visibility</strong></td>
    <td>Who sees pending messages</td>
  </tr>
  <tr>
    <td><strong>Show Batch Indicator</strong></td>
    <td>Display collection status UI</td>
  </tr>
</table>

<h2>Troubleshooting</h2>

<h3>Connection Issues</h3>
<ul>
  <li>Verify proxy server is running</li>
  <li>Check the proxy URL in settings</li>
  <li>Ensure no firewall blocking the connection</li>
</ul>

<h3>API Errors</h3>
<ul>
  <li>Verify your Claude API key is valid</li>
  <li>Check your API usage limits</li>
  <li>Review proxy server logs for details</li>
</ul>

<h3>No Response</h3>
<ul>
  <li>Ensure message starts with trigger prefix (@lm)</li>
  <li>Check browser console for errors</li>
  <li>Verify authentication succeeded (check notifications)</li>
</ul>
`
    }
  },
  {
    name: 'Tips & Best Practices',
    type: 'text',
    sort: 700,
    text: {
      format: 1,
      content: `
<h1>Tips & Best Practices</h1>

<h2>For Game Masters</h2>

<h3>Session Preparation</h3>
<ul>
  <li><strong>Upload content before sessions</strong> - Give Loremaster time to process</li>
  <li><strong>Start a new conversation</strong> - Begin each session fresh if needed</li>
  <li><strong>Test with simple prompts</strong> - Verify everything works before players arrive</li>
</ul>

<h3>During Play</h3>
<ul>
  <li><strong>Use GM Rulings liberally</strong> - Guide the narrative with corrections</li>
  <li><strong>Let players drive</strong> - Loremaster responds to their actions</li>
  <li><strong>Veto when needed</strong> - Don't hesitate to correct off-track responses</li>
  <li><strong>Maintain pacing</strong> - Use manual batching for dramatic moments</li>
</ul>

<h3>Content Management</h3>
<ul>
  <li><strong>Organize by campaign</strong> - Keep adventures separate</li>
  <li><strong>Remove outdated content</strong> - Delete finished adventures</li>
  <li><strong>Sync after updates</strong> - Re-sync when you modify world data</li>
</ul>

<h2>For Players</h2>

<h3>Effective Communication</h3>
<ul>
  <li><strong>Be descriptive</strong> - Paint a picture of your actions</li>
  <li><strong>State intent</strong> - What are you trying to accomplish?</li>
  <li><strong>Stay in character</strong> - Roleplay enhances responses</li>
</ul>

<h3>What Works Well</h3>
<pre>@lm I carefully examine the ancient tome, looking for any hidden compartments or secret pages while checking for magical traps</pre>

<h3>What Doesn't Work</h3>
<pre>@lm I find the treasure</pre>
<p><em>(Too vague, doesn't describe actions)</em></p>

<h2>Prompt Crafting</h2>

<h3>Scene Setting</h3>
<pre>@lm Describe the marketplace at midday - focus on the sounds and smells</pre>

<h3>NPC Interaction</h3>
<pre>@lm I approach the blacksmith and ask about unusual weapon orders lately</pre>

<h3>Investigation</h3>
<pre>@lm I use my investigation skills to search the crime scene for any clues the guards might have missed</pre>

<h3>Combat Narration</h3>
<pre>@lm Describe how my critical hit with the warhammer affects the skeleton</pre>

<h2>Performance Tips</h2>
<ul>
  <li>Shorter prompts get faster responses</li>
  <li>Clear conversations periodically for long campaigns</li>
  <li>Use specific names for NPCs and locations</li>
</ul>

<h2>Getting Help</h2>
<p>If you encounter issues:</p>
<ol>
  <li>Check the <strong>Configuration</strong> page for troubleshooting</li>
  <li>Review browser console for error messages</li>
  <li>Check proxy server logs</li>
  <li>Restart both Foundry and the proxy server</li>
</ol>
`
    }
  }
];

/**
 * Create the welcome journal with all documentation pages.
 *
 * @returns {Promise<JournalEntry>} The created journal entry.
 */
async function createWelcomeJournal() {
  // Check if journal already exists
  const existingJournal = game.journal.find(j => j.name === 'Loremaster Guide');
  if (existingJournal) {
    return existingJournal;
  }

  // Create the journal entry with all pages
  const journalData = {
    name: 'Loremaster Guide',
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
    flags: {
      [MODULE_ID]: {
        isWelcomeJournal: true,
        version: game.modules.get(MODULE_ID)?.version || '0.1.0'
      }
    },
    pages: JOURNAL_PAGES
  };

  const journal = await JournalEntry.create(journalData);
  console.log(`${MODULE_ID} | Created welcome journal: ${journal.id}`);
  return journal;
}

/**
 * Show the welcome journal to the user.
 *
 * @param {JournalEntry} journal - The journal entry to display.
 */
async function showWelcomeJournal(journal) {
  // Open the journal sheet
  journal.sheet.render(true, {
    width: 700,
    height: 600
  });
}

/**
 * Check if welcome journal should be shown and display it.
 * Shows on first run or when module version changes.
 */
export async function checkAndShowWelcome() {
  // Only show for GMs
  if (!game.user.isGM) return;

  const currentVersion = game.modules.get(MODULE_ID)?.version || '0.1.0';
  const lastShownVersion = game.settings.get(MODULE_ID, 'welcomeShownVersion');

  // Show if first time or version changed
  if (!lastShownVersion || lastShownVersion !== currentVersion) {
    try {
      const journal = await createWelcomeJournal();
      await showWelcomeJournal(journal);

      // Update the shown version
      await game.settings.set(MODULE_ID, 'welcomeShownVersion', currentVersion);
      console.log(`${MODULE_ID} | Showed welcome journal for version ${currentVersion}`);
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to show welcome journal:`, error);
    }
  }
}

/**
 * Open the welcome journal manually.
 * Creates it if it doesn't exist.
 *
 * @returns {Promise<void>}
 */
export async function openWelcomeJournal() {
  try {
    const journal = await createWelcomeJournal();
    await showWelcomeJournal(journal);
  } catch (error) {
    console.error(`${MODULE_ID} | Failed to open welcome journal:`, error);
    ui.notifications.error('Failed to open Loremaster Guide');
  }
}

/**
 * Register the welcome journal setting.
 */
export function registerWelcomeSettings() {
  game.settings.register(MODULE_ID, 'welcomeShownVersion', {
    name: 'Welcome Shown Version',
    hint: 'Tracks which version of the welcome journal has been shown',
    scope: 'world',
    config: false,
    type: String,
    default: ''
  });
}
