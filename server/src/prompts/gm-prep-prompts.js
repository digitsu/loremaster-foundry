/**
 * GM Prep Prompts
 *
 * Specialized prompts for generating adventure scripts from PDF content
 * and for guiding the AI during gameplay sessions.
 */

/**
 * Get the prompt for generating a GM Prep script from an adventure PDF.
 * This prompt instructs Claude to analyze the adventure and create a structured guide.
 *
 * @param {string} adventureName - The display name of the adventure.
 * @returns {string} The generation prompt text.
 */
export function getGMPrepGenerationPrompt(adventureName) {
  return `You are creating a GM Prep Script for the adventure "${adventureName}".

## Your Task
Analyze the adventure PDF content thoroughly and generate a structured GM preparation script.
This script will be used to help an AI Game Master guide players through the adventure while:
- Maintaining narrative coherence and story momentum
- Preserving player agency and creative freedom
- Providing subtle guidance when players deviate significantly from the main plot
- Tracking story progress through clear milestones

## Output Format
Generate the script in the following structure with clear Markdown formatting:

# GM Prep Script: ${adventureName}

## Adventure Overview
[2-3 sentence summary of the adventure premise, core themes, and ultimate stakes]

---

## Session 0: Setup & Introduction

### Goals for Session Zero
- [List 3-5 goals for pre-game setup and player buy-in]

### Key Information to Convey
- [List essential world/situation information players need before starting]
- [Include setting details, the inciting incident, and why characters are involved]

### Character Hooks
- [Suggested ways to connect character backgrounds to the adventure]
- [Potential motivations that align with the story]

### Anticipated Player Questions
- [Common questions players might ask and suggested answers]
- [Information that can be revealed vs. what should remain hidden]

---

## Act 1: [Give this act a thematic title]

### Story Goals
- [List 2-4 narrative goals that define success for this act]
- [What must the players understand or accomplish?]

### Key Events
1. [Ordered list of major plot points in this act]
2. [Include triggers that cause each event]
3. [Note which events are mandatory vs. optional]

### Milestones (Progress Markers)
- [ ] [Specific, observable achievement indicating progress]
- [ ] [Another milestone]
- [ ] [Final milestone that signals readiness for Act 2]

### NPCs Involved
- **[NPC Name]**: [Role, motivation, useful information they hold]
- **[NPC Name]**: [Role, motivation, useful information they hold]

### Locations
- **[Location]**: [Brief description and what happens here]

### Signs Players Are Deviating
- [Observable behaviors indicating players are going off-track]
- [How far off-track is acceptable vs. concerning]

### Gentle Redirect Strategies
- [In-world methods to guide players back without railroading]
- [NPC interventions, environmental cues, consequences]
- [Use of Darkness Points or random events if system supports it]

---

## Act 2: [Give this act a thematic title]

### Story Goals
- [List 2-4 narrative goals for this act]

### Key Events
1. [Major plot points]
2. [Include rising tension and complications]

### Milestones (Progress Markers)
- [ ] [Milestone]
- [ ] [Milestone]
- [ ] [Final milestone signaling readiness for Act 3]

### NPCs Involved
- **[NPC Name]**: [Role, motivation, useful information]

### Locations
- **[Location]**: [Description and significance]

### Signs Players Are Deviating
- [Warning signs]

### Gentle Redirect Strategies
- [Guidance methods]

---

## Act 3: [Give this act a thematic title - the climax]

### Story Goals
- [Climactic narrative goals]

### Key Events
1. [The major confrontation or challenge]
2. [Resolution mechanics]

### Milestones (Progress Markers)
- [ ] [Milestone]
- [ ] [Milestone leading to conclusion]

### NPCs Involved
- **[NPC Name]**: [Final role in the story]

### Locations
- **[Location]**: [Climactic setting]

### Signs Players Are Deviating
- [Critical deviations that could derail the climax]

### Gentle Redirect Strategies
- [Emergency guidance for keeping the finale on track]

---

## Epilogue: Resolution

### Victory Conditions
- [What constitutes a successful conclusion]
- [Degrees of success if applicable]

### Failure Conditions
- [What happens if players fail]
- [Partial failure outcomes]

### Loose Threads
- [Unresolved plot elements for future adventures]
- [Character arcs that could continue]

### Suggested Character Arc Resolutions
- [How character stories might conclude based on the adventure]

---

## Quick Reference Tables

### Key NPCs Summary
| NPC | Role | Location | Motivation | Key Info |
|-----|------|----------|------------|----------|
| [Name] | [Role] | [Where found] | [What they want] | [What they know] |

### Important Locations
| Location | Description | What Happens Here |
|----------|-------------|-------------------|
| [Name] | [Brief desc] | [Key events] |

### Critical Items/MacGuffins
| Item | Significance | Location |
|------|--------------|----------|
| [Name] | [Why it matters] | [Where to find it] |

---

## AI GM Guidance Notes

### Tone & Atmosphere
- [Guidance on the adventure's mood - horror, wonder, tension, etc.]
- [Descriptive elements to emphasize]

### Pacing Recommendations
- [When to speed up or slow down]
- [Which scenes should breathe vs. which should be urgent]

### Player Agency vs. Story Needs
- [Where players have complete freedom]
- [Where story beats are essential and should be preserved]
- [How to balance improvisation with narrative structure]

### Using Game Mechanics for Guidance
- [How to use Darkness Points, random events, or system mechanics]
- [When mechanical interventions are appropriate]
- [GM tools available in the game system for steering]

---

## Important Instructions
- Read the entire adventure PDF carefully before generating this script
- Extract specific names, locations, and events from the source material
- Preserve the adventure's intended tone and themes
- Make milestones specific and observable, not vague
- Redirect strategies should feel natural, not forced
- Include all essential NPCs and their motivations
- Note any branching paths or alternative routes through the adventure`;
}

/**
 * Get the guidance prompt to include in the system context when a GM Prep script exists.
 * This is added to regular chat messages to help the AI consider the script.
 *
 * @param {string} scriptContent - The full GM Prep script content.
 * @param {string} canonHistory - The canon history text for position inference.
 * @returns {string} The guidance prompt text.
 */
export function getGMPrepGuidancePrompt(scriptContent, canonHistory) {
  return `
## Active Adventure: GM Prep Script

You have access to a GM Prep Script for the current adventure. Use this script to:
1. Understand the overall story arc, themes, and narrative goals
2. Identify which act/phase the players are currently in based on canon history
3. Subtly guide responses toward story milestones without railroading
4. Recognize when players deviate and apply gentle redirect strategies
5. Reference appropriate NPCs, locations, and plot elements naturally

### GM Prep Script Content
<gm-prep-script>
${scriptContent}
</gm-prep-script>

### Canon History (Recent Published Events)
<canon-history>
${canonHistory || 'No canon history established yet. This appears to be the beginning of the adventure.'}
</canon-history>

### Your Responsibilities

**Determining Current Position:**
Based on the canon history provided, silently determine:
- Which Act the party is currently in
- Which milestones have been achieved
- What the immediate story goals should be
- Whether players have deviated from the main plot

**Guiding the Story:**
When formulating responses:
- If players are on track: Advance toward the next milestone naturally
- If players are mildly off track: Incorporate subtle environmental cues or NPC hints
- If players are significantly off track for multiple exchanges: Use redirect strategies from the script
- Always maintain player agency - guide, don't force

**Narrative Principles:**
- NEVER force players onto a specific path - use environmental cues, NPC suggestions, natural consequences
- If players are creative, adapt the story to incorporate their ideas while preserving key story beats
- Reference the "Signs Players Are Deviating" and "Gentle Redirect Strategies" sections when needed
- Maintain the script's intended tone and atmosphere
- Introduce NPCs and locations at appropriate moments

**When Players Ask About Story:**
- If the GM asks you to "check campaign status" or similar, provide a brief assessment of:
  - Current estimated Act
  - Recent milestones achieved
  - Current story goals
  - Any deviation from the main plot and suggested corrections
- Only share this meta-information with the GM, not players

**Do NOT:**
- Mention the existence of the GM Prep Script to players
- Quote directly from the script in player-facing responses
- Make meta-comments about "following the script" or "getting back on track"
- Force outcomes that contradict player agency
`;
}

/**
 * Build a system prompt message for requesting a GM Prep script generation.
 * Used when sending the PDF to Claude for analysis.
 *
 * @param {string} adventureName - The display name of the adventure.
 * @returns {Array} Array of message objects for the Claude API.
 */
export function buildGMPrepGenerationMessages(adventureName) {
  return [
    {
      role: 'user',
      content: `Please analyze the attached adventure PDF and generate a comprehensive GM Prep Script following the format provided in your instructions. The adventure is called "${adventureName}".

Read through the entire document carefully, extracting:
- The main plot structure and act breaks
- Key NPCs, their motivations, and locations
- Important items and MacGuffins
- Victory and failure conditions
- The intended tone and atmosphere

Generate a complete, detailed GM Prep Script that will help me run this adventure effectively while keeping players engaged and on track.`
    }
  ];
}
