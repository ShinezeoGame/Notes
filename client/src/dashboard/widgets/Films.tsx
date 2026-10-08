// Widget « Films et séries » : une barre de recherche (résultats dans la section Films et séries, où l'on demande en un
// geste) et les dernières demandes faites à Seerr, avec leur état.
import { useState, type FormEvent } from 'react';
import { navigate } from '../../lib/router';
import { useRecentRequests, useSeerr } from '../../lib/seerr';
import { RequestList } from '../../media/MediaView';
import { Icon } from '../../icons/Icon';
import type { WidgetProps } from '../types';
import { t } from '../../lib/i18n';

export function FilmsWidget({ doc, editing }: WidgetProps) {
  const seerr = useSeerr(doc);
  const [text, setText] = useState('');
  const { list, error } = useRecentRequests(Boolean(seerr));
  if (!seerr) {
    return (
      <div className="w-empty">
        <Icon name="film" size={24} />
        <span className="w-muted">{t('Demandez un film ou une série à Seerr, depuis l’accueil.')}</span>
        <button type="button" className="nb-btn nb-btn--sm" onClick={() => navigate('#/films')} disabled={editing}>
          {t('Relier Seerr')}
        </button>
      </div>
    );
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    navigate(text.trim() ? `#/films/chercher/${encodeURIComponent(text.trim())}` : '#/films');
  };
  return (
    <div className="w-films">
      <form className="md-search md-search--widget" role="search" onSubmit={submit}>
        <Icon name="search" size={16} />
        <input
          type="search"
          enterKeyHint="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('Rechercher un film ou une série…')}
          aria-label={t('Rechercher un film ou une série')}
          disabled={editing}
        />
      </form>
      {list.length ? (
        <RequestList requests={list.slice(0, 8)} compact disabled={editing} />
      ) : error ? (
        <p className="w-muted">{error}</p>
      ) : (
        <p className="w-muted">{t('Vos demandes apparaîtront ici.')}</p>
      )}
    </div>
  );
}
