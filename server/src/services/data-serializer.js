/**
 * Data Serializer
 *
 * Serializes Foundry VTT game data into formats suitable for Claude context.
 * Handles actors, items, scenes, and other game entities.
 *
 * TODO: Implement in Step 4 - Claude Files API Integration
 */

/**
 * Serialize an actor for Claude context.
 *
 * @param {Object} actor - Foundry actor data.
 * @returns {Object} Serialized actor.
 */
export function serializeActor(actor) {
  return {
    id: actor._id,
    name: actor.name,
    type: actor.type,
    attributes: actor.system?.attributes,
    skills: actor.system?.skills,
    health: actor.system?.health,
    items: actor.items?.map(serializeItem) || [],
    bio: {
      concept: actor.system?.bio?.concept,
      background: actor.system?.bio?.background,
      appearance: actor.system?.bio?.appearance
    }
  };
}

/**
 * Serialize an item for Claude context.
 *
 * @param {Object} item - Foundry item data.
 * @returns {Object} Serialized item.
 */
export function serializeItem(item) {
  return {
    id: item._id,
    name: item.name,
    type: item.type,
    description: item.system?.description,
    // Type-specific data
    ...(item.type === 'weapon' && {
      damage: item.system?.damage,
      range: item.system?.range,
      features: item.system?.features
    }),
    ...(item.type === 'armor' && {
      rating: item.system?.armorRating || item.system?.damageReduction
    })
  };
}

/**
 * Serialize game system rules to Markdown.
 *
 * @param {Object} systemConfig - Game system configuration.
 * @returns {string} Markdown-formatted rules.
 */
export function serializeSystemRules(systemConfig) {
  let markdown = '# Game System Rules Reference\n\n';

  if (systemConfig.attributes) {
    markdown += '## Attributes\n';
    for (const [key, value] of Object.entries(systemConfig.attributes)) {
      markdown += `- **${key}**: ${value}\n`;
    }
    markdown += '\n';
  }

  if (systemConfig.skills) {
    markdown += '## Skills\n';
    for (const [key, value] of Object.entries(systemConfig.skills)) {
      markdown += `- **${key}**: ${value}\n`;
    }
    markdown += '\n';
  }

  return markdown;
}

/**
 * Serialize world state for Claude context.
 *
 * @param {Object} worldData - World data from Foundry.
 * @returns {string} Serialized world state.
 */
export function serializeWorldState(worldData) {
  const sections = [];

  if (worldData.actors && worldData.actors.length > 0) {
    sections.push('## Actors\n');
    for (const actor of worldData.actors) {
      const serialized = serializeActor(actor);
      sections.push(`### ${serialized.name} (${serialized.type})\n`);
      sections.push(JSON.stringify(serialized, null, 2) + '\n');
    }
  }

  if (worldData.scenes && worldData.scenes.length > 0) {
    sections.push('## Scenes\n');
    for (const scene of worldData.scenes) {
      sections.push(`### ${scene.name}\n`);
      if (scene.description) {
        sections.push(`${scene.description}\n`);
      }
    }
  }

  return sections.join('\n');
}
