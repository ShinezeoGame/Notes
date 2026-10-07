// Homelab à régler : présentation de la section, recherche automatique des applications du réseau local et import du
// fichier services.yaml de Homepage. Les applications trouvées s'ajoutent d'un clic ; leurs clés API se saisissent
// ensuite dans « Configurer » (statistiques).
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { api, serverBase } from '../lib/api';
import { DEVICE_TYPES, SERVICE_TYPES, deviceVisual, saveHomelabConfig, serviceVisual, useHomelabConfig, type DeviceType, type ServiceType } from '../lib/homelab';
import { addCandidates, fromDiscovery, fromHomepage, localPageHost, type Candidate, type DiscoverResult } from '../lib/homelabImport';
import { AppContext } from '../editor/context';
import { AppTile, Icon } from '../icons/Icon';
import { Modal } from './Modal';
import { NeedsServerIntro, SectionIntro } from './SectionIntro';
import { toast } from './Toast';
import { t, tn } from '../lib/i18n';

const errorText = (err: unknown) => (err instanceof Error ? err.message : t('Erreur'));

/** Section Homelab encore vide : ce qu'elle apporte et les trois façons de la remplir. */
export function HomelabIntro({ doc, onConfigure, onHide }: { doc: Y.Doc; onConfigure: () => void; onHide?: () => void }) {
  const ctx = useContext(AppContext);
  const [dialog, setDialog] = useState<'discover' | 'homepage' | null>(null);
  const pitch = t('En ligne ou pas, processeur, mémoire, disques, téléchargements et lectures en cours : votre serveur maison et ses applications, d’un coup d’œil.');
  if (!serverBase()) {
    return (
      <NeedsServerIntro icon="server" title={t('Votre serveur maison d’un coup d’œil')} onJoin={ctx?.joinServer} onHide={onHide}>
        {pitch}
      </NeedsServerIntro>
    );
  }
  return (
    <>
      <SectionIntro
        icon="server"
        title={t('Votre serveur maison d’un coup d’œil')}
        needs={[
          t('Un serveur chez vous (NAS, mini-PC, Raspberry Pi…) sur le même réseau que Melo.'),
          t('Des applications web : Jellyfin, Plex, Nextcloud, Pi-hole, Home Assistant, la suite *arr… ou n’importe laquelle.'),
        ]}
        actions={
          <>
            <button type="button" className="nb-btn nb-btn--primary" onClick={() => setDialog('discover')}>
              <Icon name="search" size={15} /> {t('Rechercher mes applications')}
            </button>
            <button type="button" className="nb-btn" onClick={() => setDialog('homepage')}>
              <Icon name="upload" size={15} /> {t('Importer depuis Homepage')}
            </button>
            <button type="button" className="nb-btn" onClick={onConfigure}>
              <Icon name="plus" size={15} /> {t('Ajouter à la main')}
            </button>
          </>
        }
        note={t('Vous avez déjà un tableau de bord (Homepage, Homarr, Dashy…) ? Il peut aussi s’afficher sur l’accueil, dans un widget « Site web ».')}
        onHide={onHide}
      >
        {pitch}
      </SectionIntro>
      {dialog === 'discover' ? <DiscoverDialog doc={doc} onClose={() => setDialog(null)} /> : null}
      {dialog === 'homepage' ? <HomepageImportDialog doc={doc} onClose={() => setDialog(null)} /> : null}
    </>
  );
}

/** Ajoute les éléments choisis et dit ce qu'il reste à faire (clés API). */
function useAdd(doc: Y.Doc, onClose: () => void) {
  const cfg = useHomelabConfig(doc);
  return (chosen: Candidate[]) => {
    saveHomelabConfig(doc, addCandidates(cfg, chosen));
    const keys = chosen.filter((c) => c.missingSecret).length;
    toast(
      keys
        ? tn(
            chosen.length,
            '{n} élément ajouté. Ajoutez sa clé API dans « Configurer » pour voir ses statistiques.',
            '{n} éléments ajoutés. Ajoutez les clés API dans « Configurer » pour voir les statistiques.',
          )
        : tn(chosen.length, '{n} élément ajouté au homelab.', '{n} éléments ajoutés au homelab.'),
    );
    onClose();
  };
}

/** Recherche faite dans Docker sans le relais réseau : seule la machine du serveur a pu être interrogée. */
function discoverWarning(r: DiscoverResult): string {
  if (r.relay === 'down') return t('Le relais réseau du serveur Melo ne répond pas : la recherche s’est limitée à la machine du serveur.');
  if (r.isolated) return t('Le serveur Melo tourne dans Docker sans son relais réseau : la recherche s’est limitée à la machine du serveur.');
  return '';
}

export function DiscoverDialog({ doc, onClose }: { doc: Y.Doc; onClose: () => void }) {
  const cfg = useHomelabConfig(doc);
  const add = useAdd(doc, onClose);
  const [result, setResult] = useState<DiscoverResult | null>(null);
  const [error, setError] = useState('');
  const [round, setRound] = useState(0);
  useEffect(() => {
    let alive = true;
    setResult(null);
    setError('');
    api.homelabDiscover().then(
      (r) => alive && setResult(r),
      (err) => alive && setError(errorText(err)),
    );
    return () => {
      alive = false;
    };
  }, [round]);
  const candidates = useMemo(
    () => (result ? fromDiscovery(result.apps, cfg, result.isolated || result.relay === 'down' ? localPageHost(location.hostname) : undefined) : []),
    [result, cfg],
  );
  return (
    <Modal title={t('Rechercher mes applications')} onClose={onClose} width={620}>
      {!result && !error ? (
        <div className="hl-discover-wait" role="status">
          <Icon name="refresh" size={18} className="hl-spin" />
          {t('Recherche sur votre réseau… (une dizaine de secondes)')}
        </div>
      ) : null}
      {error ? (
        <div className="nb-error">
          {error}{' '}
          <button type="button" className="nb-btn nb-btn--sm" onClick={() => setRound((n) => n + 1)}>
            {t('Réessayer')}
          </button>
        </div>
      ) : null}
      {result ? (
        <CandidatePicker
          candidates={candidates}
          warning={discoverWarning(result)}
          intro={tn(result.hosts, 'Appareil interrogé : {n}. Cochez ce que vous voulez suivre.', 'Appareils interrogés : {n}. Cochez ce que vous voulez suivre.')}
          onAdd={add}
          onRetry={() => setRound((n) => n + 1)}
        />
      ) : null}
    </Modal>
  );
}

export function HomepageImportDialog({ doc, onClose }: { doc: Y.Doc; onClose: () => void }) {
  const cfg = useHomelabConfig(doc);
  const add = useAdd(doc, onClose);
  const file = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<{ candidates: Candidate[]; error?: string } | null>(null);
  const read = async (value: string) => {
    // Lecteur YAML chargé seulement ici.
    const { parse } = await import('yaml');
    setParsed(fromHomepage(value, cfg, (s) => parse(s)));
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const value = await f.text();
    setText(value);
    await read(value);
  };
  return (
    <Modal title={t('Importer depuis Homepage')} onClose={onClose} width={620}>
      {!parsed || parsed.error ? (
        <>
          <p className="hl-import-help">
            {t('Dans le dossier de configuration de Homepage, ouvrez le fichier services.yaml, copiez tout son contenu et collez-le ici, ou choisissez le fichier.')}
          </p>
          <textarea
            className="nb-input hl-import-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            spellCheck={false}
            aria-label={t('Contenu de services.yaml')}
            placeholder={'- Media:\n    - Jellyfin:\n        href: http://192.168.1.10:8096\n        widget:\n          type: jellyfin\n          key: …' /* i18n-ignore : exemple de fichier */}
          />
          {parsed?.error ? <div className="nb-error">{parsed.error}</div> : null}
          <div className="nb-row nb-gap hl-import-actions">
            <button type="button" className="nb-btn" onClick={() => file.current?.click()}>
              <Icon name="upload" size={15} /> {t('Choisir le fichier')}
            </button>
            <button type="button" className="nb-btn nb-btn--primary" disabled={!text.trim()} onClick={() => void read(text)}>
              {t('Lire')}
            </button>
          </div>
          <input
            ref={file}
            type="file"
            accept=".yaml,.yml,text/yaml,text/plain"
            hidden
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </>
      ) : (
        <CandidatePicker
          candidates={parsed.candidates}
          intro={t('Applications trouvées dans services.yaml. Cochez celles à suivre dans Melo.')}
          onAdd={add}
          onRetry={() => setParsed(null)}
          retryLabel={t('Autre fichier')}
        />
      )}
    </Modal>
  );
}

function visualOf(c: Candidate) {
  return c.kind === 'service' ? serviceVisual({ type: c.type as ServiceType }) : deviceVisual({ type: c.type as DeviceType });
}

function typeLabel(c: Candidate): string {
  if (c.kind === 'device') return DEVICE_TYPES[c.type as DeviceType]?.label ?? '';
  return c.type === 'generic' ? t('Disponibilité seulement') : (SERVICE_TYPES[c.type as ServiceType]?.label ?? '');
}

function CandidatePicker({
  candidates,
  intro,
  warning,
  onAdd,
  onRetry,
  retryLabel,
}: {
  candidates: Candidate[];
  intro: string;
  warning?: string;
  onAdd: (chosen: Candidate[]) => void;
  onRetry: () => void;
  retryLabel?: string;
}) {
  // Tout est coché d'office, sauf ce qui est déjà dans le homelab.
  const [off, setOff] = useState<Set<string>>(() => new Set());
  const chosen = candidates.filter((c) => !c.exists && !off.has(c.key));
  const toggle = (key: string, on: boolean) =>
    setOff((s) => {
      const next = new Set(s);
      if (on) next.delete(key);
      else next.add(key);
      return next;
    });
  const found = candidates.filter((c) => c.type !== 'local');
  return (
    <div className="hl-picker">
      {warning ? <div className="nb-error">{warning}</div> : null}
      {found.length ? (
        <p className="hl-picker-intro">{intro}</p>
      ) : (
        <p className="hl-picker-intro">{t('Aucune application trouvée. Vos applications sont peut-être sur d’autres ports : ajoutez-les à la main dans « Configurer ».')}</p>
      )}
      <div className="hl-picker-list">
        {candidates.map((c) => (
          <label key={c.key} className={`hl-cand${c.exists ? ' hl-cand--exists' : ''}`}>
            <input type="checkbox" disabled={c.exists} checked={!c.exists && !off.has(c.key)} onChange={(e) => toggle(c.key, e.target.checked)} />
            <AppTile name={visualOf(c).name} color={visualOf(c).color} size={28} />
            <span className="hl-cand-text">
              <b>{c.name}</b>
              <small>
                {c.type === 'local'
                  ? t('Processeur, mémoire et disques de la machine du serveur Melo')
                  : [typeLabel(c) !== c.name ? typeLabel(c) : '', c.url].filter(Boolean).join(' · ')}
              </small>
            </span>
            {c.exists ? (
              <span className="hl-cand-tag">{t('Déjà ajouté')}</span>
            ) : c.missingSecret ? (
              <span className="hl-cand-tag hl-cand-tag--warn" title={t('Les statistiques demandent sa clé API (à saisir ensuite dans « Configurer »).')}>
                {t('Clé à saisir')}
              </span>
            ) : null}
          </label>
        ))}
      </div>
      <div className="nb-row nb-gap nb-end hl-picker-actions">
        <button type="button" className="nb-btn" onClick={onRetry}>
          {retryLabel ?? t('Chercher de nouveau')}
        </button>
        <button type="button" className="nb-btn nb-btn--primary" disabled={!chosen.length} onClick={() => onAdd(chosen)}>
          {tn(chosen.length, 'Ajouter {n} élément', 'Ajouter {n} éléments')}
        </button>
      </div>
    </div>
  );
}
