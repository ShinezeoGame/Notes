// Correspondance des anciens emojis (icônes de pages ou d'applications déjà enregistrées) vers les icônes SVG.
import type { IconName } from './registry';
import type { PageColor } from './pageIcon';

const MAP: Record<string, [IconName, PageColor?]> = {
  '📄': ['file'], '📝': ['note'], '📚': ['book'], '📖': ['book'], '✏': ['pencil'], '📌': ['pin', 'red'], '📍': ['mapPin', 'red'],
  '📎': ['paperclip'], '🗂': ['folder'], '📁': ['folder'], '📂': ['folder'], '🗒': ['note'], '📅': ['calendar'], '📆': ['calendar'],
  '🗓': ['calendar'], '✅': ['checkSquare', 'green'], '☑': ['checkSquare'], '⭐': ['star', 'yellow'], '🌟': ['star', 'yellow'],
  '💡': ['bulb', 'yellow'], '🔥': ['flame', 'orange'], '🎯': ['target', 'red'], '🚀': ['rocket'], '💼': ['briefcase', 'brown'],
  '🏠': ['home'], '🏡': ['home'], '🌍': ['globe', 'blue'], '🌱': ['leaf', 'green'], '🌸': ['sparkles', 'pink'], '🍀': ['leaf', 'green'],
  '🎉': ['sparkles', 'yellow'], '🎁': ['gift', 'red'], '🎨': ['sparkles', 'purple'], '🎵': ['music'], '🎧': ['music'], '🎸': ['music'],
  '🎬': ['film'], '🎞': ['film'], '📷': ['camera'], '💻': ['laptop'], '⌨': ['laptop'], '🖥': ['monitor'], '📱': ['smartphone'],
  '🔧': ['wrench'], '🛠': ['wrench'], '⚙': ['settings'], '🔒': ['lock'], '🔑': ['key', 'yellow'], '🧠': ['bulb', 'pink'],
  '❤': ['heart', 'red'], '💙': ['heart', 'blue'], '💚': ['heart', 'green'], '💛': ['heart', 'yellow'], '🧡': ['heart', 'orange'],
  '💜': ['heart', 'purple'], '🖤': ['heart', 'gray'], '🤍': ['heart'], '⚡': ['zap', 'yellow'], '🌈': ['sparkles', 'purple'],
  '☀': ['sun', 'yellow'], '🌙': ['moon', 'yellow'], '⏰': ['clock'], '🧭': ['compass'], '🗺': ['map'], '✈': ['globe', 'blue'],
  '🎮': ['gamepad'], '🕹': ['gamepad'], '🧩': ['gamepad'], '☕': ['coffee', 'brown'], '🍵': ['coffee', 'green'], '📊': ['chartBar'],
  '📈': ['chartBar', 'green'], '📉': ['chartBar', 'red'], '💰': ['wallet', 'yellow'], '🛒': ['cart'], '🏷': ['tag'],
  '🎓': ['graduation'], '🏆': ['trophy', 'yellow'], '🥇': ['trophy', 'yellow'], '🔔': ['bell', 'yellow'], '📣': ['bell'],
  '💬': ['message'], '💭': ['message'], '🙂': ['smile', 'yellow'], '😀': ['smile', 'yellow'], '😎': ['smile', 'yellow'],
  '👋': ['sparkles', 'yellow'], '📺': ['tv'], '▶': ['play'], '🍿': ['play'], '🎟': ['ticket'], '⬇': ['download'],
  '🛡': ['shield'], '🐳': ['cube'], '💓': ['heartPulse', 'red'], '☁': ['cloud'], '🖼': ['image'], '🔗': ['link'], '🧊': ['cube'],
  '💾': ['hardDrive'], '🔍': ['search'], '📑': ['filePdf'], '📋': ['copy'], '🗑': ['trash'], '📧': ['mail'], '✉': ['mail'],
  '👤': ['user'], '👥': ['users'], '🏢': ['briefcase'], '🏫': ['graduation'], '📦': ['cube'], '🔬': ['target'], '🧪': ['zap'],
};

/** Renvoie l'icône SVG correspondant à un ancien emoji, ou null. */
export function legacyEmojiIcon(value: string): [IconName, PageColor?] | null {
  const key = value.replace(/️/g, '').trim();
  return MAP[key] ?? null;
}
