// Widget Recherche : barre de recherche sur le web (moteur au choix) ou dans les pages de notes.
import { useMemo, useState } from 'react';
import { useAppCtx } from '../../editor/context';
import { useWorkspacePages } from '../../lib/workspace';
import { Icon } from '../../icons/Icon';
import { PageIcon } from '../../icons/pageIcon';
import { str, type SettingsProps, type WidgetProps } from '../types';
import { t, getLang } from '../../lib/i18n';

export const ENGINES: { id: string; label: string; url: string }[] = [
  { id: 'google', label: 'Google', url: 'https://www.google.com/search?q=' },
  { id: 'duckduckgo', label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  { id: 'qwant', label: 'Qwant', url: 'https://www.qwant.com/?q=' },
  { id: 'bing', label: 'Bing', url: 'https://www.bing.com/search?q=' },
  { id: 'ecosia', label: 'Ecosia', url: 'https://www.ecosia.org/search?q=' },
  { id: 'wikipedia', label: t('Wikipédia'), url: `https://${getLang() === 'fr' ? 'fr' : 'en'}.wikipedia.org/w/index.php?search=` },
  { id: 'youtube', label: 'YouTube', url: 'https://www.youtube.com/results?search_query=' },
  { id: 'notes', label: t('Mes notes'), url: '' },
];

export function SearchWidget({ widget, store }: WidgetProps) {
  useWorkspacePages(store);
  const ctx = useAppCtx();
  const engine = ENGINES.find((e) => e.id === str(widget.config.engine, 'google')) ?? ENGINES[0];
  const [query, setQuery] = useState('');
  const results = useMemo(() => (engine.id === 'notes' && query.trim() ? store.search(query).slice(0, 6) : []), [engine.id, query, store]);
  return (
    <div className="w-search">
      <form
        className="w-search-form"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const q = query.trim();
          if (!q) return;
          if (engine.id === 'notes') {
            if (results[0]) ctx.openPage(results[0].id);
            return;
          }
          window.open(engine.url + encodeURIComponent(q), '_blank', 'noopener');
          setQuery('');
        }}
      >
        <Icon name="search" size={17} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={engine.id === 'notes' ? t('Rechercher une page…') : t('Rechercher avec {engine}…', { engine: engine.label })}
          aria-label={t('Rechercher')}
          enterKeyHint="search"
        />
      </form>
      {results.length ? (
        <ul className="w-search-results">
          {results.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => ctx.openPage(p.id)}>
                <PageIcon icon={p.icon} size={15} /> {p.title || t('Sans titre')}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function SearchSettings({ config, set }: SettingsProps) {
  return (
    <label className="nb-field">
      <span>{t('Rechercher avec')}</span>
      <select className="nb-input" value={str(config.engine, 'google')} onChange={(e) => set({ engine: e.target.value })}>
        {ENGINES.map((e) => (
          <option key={e.id} value={e.id}>
            {e.label}
          </option>
        ))}
      </select>
    </label>
  );
}
