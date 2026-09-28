import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from './Modal';
import type { WorkspaceStore } from '../lib/workspace';

type Props = { store: WorkspaceStore; onClose: () => void; onOpen: (pageId: string) => void };

export function SearchDialog({ store, onClose, onOpen }: Props) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => store.search(query).slice(0, 30), [store, query]);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => setIndex(0), [query]);

  const open = (id: string) => {
    onOpen(id);
    onClose();
  };

  return (
    <Modal title="Rechercher une page" onClose={onClose}>
      <input
        ref={inputRef}
        className="nb-input nb-input--lg"
        placeholder="Titre de la page…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setIndex((i) => Math.min(results.length - 1, i + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setIndex((i) => Math.max(0, i - 1));
          } else if (e.key === 'Enter' && results[index]) {
            open(results[index].id);
          }
        }}
      />
      <div className="nb-search-results">
        {results.length === 0 ? <div className="nb-muted nb-pad">Aucune page trouvée.</div> : null}
        {results.map((p, i) => {
          const crumbs = store.ancestors(p.id).map((a) => a.title || 'Sans titre');
          return (
            <button
              key={p.id}
              type="button"
              className={`nb-search-item${i === index ? ' nb-search-item--active' : ''}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => open(p.id)}
            >
              <span className="nb-tree-icon">{p.icon || '📄'}</span>
              <span className="nb-search-title">{p.title || 'Sans titre'}</span>
              {crumbs.length ? <span className="nb-search-crumbs">{crumbs.join(' / ')}</span> : null}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
