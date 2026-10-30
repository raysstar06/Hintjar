const hintPatterns = [
  /\bgo\s+(left|right|back|up|down)\b/i,
  /\btry\s+(the|using)\b/i,
  /\bit['’]s\s+(behind|under|in)\b/i,
  /\byou\s+(need|have)\s+to\b/i,
  /\buse\s+the\b/i,
  /\bdon['’]t\s+forget\b/i,
  /\bthe\s+answer\s+is\b/i,
  /\blook\s+(behind|under|for)\b/i
];

export function detectMessage(text, { spoilerWords = [], isBroadcaster = false, isMod = false } = {}) {
  if (isBroadcaster || isMod || /^\s*!/.test(text)) return { flagged: false, type: null, reason: null };
  const normalized = String(text ?? '');
  const spoiler = spoilerWords.find(word => word.trim() && normalized.toLocaleLowerCase().includes(word.trim().toLocaleLowerCase()));
  if (spoiler) return { flagged: true, type: 'spoiler', reason: `spoiler word: ${spoiler.trim()}` };
  const pattern = hintPatterns.find(regex => regex.test(normalized));
  return pattern
    ? { flagged: true, type: 'hint', reason: `matched hint pattern: ${pattern}` }
    : { flagged: false, type: null, reason: null };
}
