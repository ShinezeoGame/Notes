import { useEffect, useRef, useState } from 'react';

const EMOJIS =
  '📄 📝 📚 📖 ✏️ 📌 📍 📎 🗂️ 📁 📂 🗒️ 📅 📆 🗓️ ✅ ☑️ ⭐ 🌟 💡 🔥 🎯 🚀 💼 🏠 🏡 🌍 🌱 🌸 🍀 🎉 🎁 🎨 🎵 🎬 📷 💻 ⌨️ 🖥️ 📱 🔧 ⚙️ 🔒 🔑 🧠 ❤️ 💙 💚 💛 🧡 💜 🖤 🤍 ⚡ 🌈 ☀️ 🌙 ⏰ 🧭 🗺️ ✈️ 🚗 🚲 ⚽ 🏀 🎮 🧩 🍎 🍕 ☕ 🍵 🧪 🔬 🧬 📊 📈 📉 💰 🛒 🏷️ 🎓 🏆 🥇 🔔 📣 💬 💭 🙂 😀 😎 🤔 🤓 🥳 🙌 👍 👋 👀 🐶 🐱 🐻 🦊 🐼 🐸 🦋 🌵 🌲 🍁 🎸 🎧 📺 🕹️ 🧸 🛠️ 🧹 🧺 🛏️ 🚿 🍳 🥗 🍰 🧁 🍫 🍷 🍺 🏖️ ⛰️ 🏕️ 🎪 🏥 🏫 🏢 🏛️ ⛪ 🕌 🗼 🗽 🌋 🏝️ 💊 🩺 🧘 🏋️ 🚴 🏊 ⛷️ 🎿 🥊 🎾 🏐 🏈 ⚾ 🥎 🏉 🎱 🪀 🪁 🎲 ♟️ 🎭 🖼️ 🧵 🪡 🧶'.split(
    ' ',
  );

type Props = { value: string; onSelect: (emoji: string) => void; onClose: () => void };

export function EmojiPicker({ value, onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [custom, setCustom] = useState('');

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div className="nb-emoji-picker" ref={ref}>
      <div className="nb-emoji-head">
        <input
          className="nb-input"
          placeholder="Coller un emoji…"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && custom.trim()) onSelect(Array.from(custom.trim())[0]);
          }}
        />
        <button
          type="button"
          className="nb-btn"
          onClick={() => onSelect(EMOJIS[Math.floor(Math.random() * EMOJIS.length)])}
        >
          Aléatoire
        </button>
        {value ? (
          <button type="button" className="nb-btn" onClick={() => onSelect('')}>
            Retirer
          </button>
        ) : null}
      </div>
      <div className="nb-emoji-grid">
        {EMOJIS.map((e) => (
          <button
            key={e}
            type="button"
            className={`nb-emoji${e === value ? ' nb-emoji--active' : ''}`}
            onClick={() => onSelect(e)}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
