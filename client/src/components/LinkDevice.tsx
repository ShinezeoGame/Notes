// Rejoindre un espace et le partager : relier un autre appareil (QR code, lien ou code à 6 chiffres), inviter une
// personne (son propre espace sur ce serveur), et les pages ouvertes par ces liens (#/pair/…, #/invite/…).
import { useEffect, useState, type ReactNode } from 'react';
import { api, canShareLinks, serverBase, type GuestInfo, type InviteInfo } from '../lib/api';
import { desktop, isDesktopLocal } from '../lib/desktop';
import {
  acceptInvite,
  asPairingCode,
  claimServer,
  formatPairingCode,
  inviteInfo,
  joinWithKey,
  linkWithCode,
  pairLink,
  parseOstalLink,
  type OstalLink,
} from '../lib/pairing';
import { navigate } from '../lib/router';
import { getSettings, isDefaultUserName, isNative, isStandaloneWeb, normalizeServerUrl, updateSettings, useSettings } from '../lib/settings';
import { Icon } from '../icons/Icon';
import { OstalLogo } from './Logo';
import { Modal } from './Modal';
import { QrCode } from './QrCode';
import { toast } from './Toast';
import { t, tx, locale } from '../lib/i18n';

/** Champ de saisie d'un code à 6 chiffres (« 482 913 »), clavier numérique sur téléphone. */
export function PairingCodeInput({ value, onChange, onEnter, autoFocus }: { value: string; onChange: (v: string) => void; onEnter?: () => void; autoFocus?: boolean }) {
  return (
    <input
      className="nb-input nb-input--lg nb-code-input"
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder="123 456"
      aria-label={t('Code à 6 chiffres')}
      value={formatPairingCode(value)}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
      autoFocus={autoFocus}
    />
  );
}

export async function copyText(text: string, message = t('Lien copié : collez-le dans un message.')) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    toast(t('Copie impossible : sélectionnez le lien puis copiez-le.'), 'error');
  }
}

const canShareSheet = () => typeof (navigator as Navigator & { share?: unknown }).share === 'function';

/** Feuille de partage du système (WhatsApp, SMS, e-mail…) quand elle existe, sinon copie du lien. */
export async function sendLink(url: string, title: string, text: string) {
  if (canShareSheet()) {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
    }
  }
  await copyText(url);
}

/** Lien à transmettre : QR code, adresse, Copier, Envoyer… */
export function LinkCard({ url, title, text, children }: { url: string; title: string; text: string; children?: ReactNode }) {
  return (
    <div className="nb-linkcard">
      <QrCode text={url} />
      <div className="nb-linkcard-body">
        {children}
        <input className="nb-input nb-linkcard-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label={t('Lien')} />
        <div className="nb-row nb-gap nb-wrap">
          <button type="button" className="nb-btn nb-btn--primary" onClick={() => void copyText(url)}>
            <Icon name="copy" size={15} /> {t('Copier le lien')}
          </button>
          {canShareSheet() ? (
            <button type="button" className="nb-btn" onClick={() => void sendLink(url, title, text)}>
              <Icon name="share" size={15} /> {t('Envoyer…')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function useCountdown(expiresAt: number | null): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  return expiresAt ? Math.max(0, Math.round((expiresAt - now) / 1000)) : 0;
}

/**
 * Relier un autre appareil de la même personne : un code valable 10 minutes, présenté en QR code (appareil photo du
 * téléphone), en lien et en chiffres (application Ostal).
 */
export function DevicesPanel({ onJoin }: { onJoin: () => void }) {
  const settings = useSettings();
  const [pairing, setPairing] = useState<{ code: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const left = useCountdown(pairing?.expiresAt ?? null);
  const server = serverBase();

  if (!canShareLinks() || !server) {
    return (
      <div className="nb-devices">
        <p className="nb-muted">
          {isDesktopLocal() ? t('Ostal fonctionne seul sur cet ordinateur.') : t('Ostal fonctionne seul sur cet appareil.')}{' '}
          {t(
            'Pour le retrouver sur votre téléphone, synchroniser plusieurs appareils ou partager des pages, rejoignez un serveur Ostal : le vôtre, ou celui d’une personne qui vous invite.',
          )}
        </p>
        <div>
          <button type="button" className="nb-btn nb-btn--primary" onClick={onJoin}>
            <Icon name="link" size={15} /> {t('Rejoindre un serveur (lien ou code)')}
          </button>
        </div>
      </div>
    );
  }

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      setPairing(await api.pairStart());
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Code indisponible.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="nb-devices">
      {settings.guest && settings.hostName ? (
        <p className="nb-muted">
          <Icon name="cloud" size={14} />{' '}
          {tx('Votre espace est sur le serveur Ostal de <b>{host}</b>.', { b: (s) => <b>{s}</b> }, { host: settings.hostName })}
        </p>
      ) : null}
      {pairing && left > 0 ? (
        <LinkCard
          url={pairLink(server, pairing.code)}
          title={t('Relier un appareil à Ostal')}
          text={t('Ouvrez ce lien pour retrouver mon espace Ostal sur cet appareil :')}
        >
          <p className="nb-linkcard-help">
            {tx(
              '<b>Téléphone :</b> scannez ce QR code avec l’appareil photo. <b>Application Ostal :</b> « J’ai une invitation ou un code », puis collez le lien (ou l’adresse <s>{server}</s> et le code <c>{code}</c>).',
              { b: (s) => <b>{s}</b>, s: (s) => <span className="nb-mono">{s}</span>, c: (s) => <b className="nb-mono">{s}</b> },
              { server, code: formatPairingCode(pairing.code) },
            )}
          </p>
          <p className="nb-muted nb-small">
            {t('Valable encore {min} min {sec} s, une seule fois : ne l’envoyez qu’à vous-même.', {
              min: Math.floor(left / 60),
              sec: String(left % 60).padStart(2, '0'),
            })}
          </p>
        </LinkCard>
      ) : (
        <div className="nb-pair">
          <p className="nb-muted">
            {t('Retrouvez les mêmes pages, le même accueil et les mêmes réglages sur votre téléphone ou un autre ordinateur.')}
          </p>
          <div>
            <button type="button" className="nb-btn nb-btn--primary" onClick={() => void create()} disabled={busy}>
              <Icon name="smartphone" size={15} /> {pairing ? t('Afficher un nouveau code') : t('Relier un autre appareil')}
            </button>
          </div>
          {pairing ? <span className="nb-muted nb-small">{t('Le code précédent a expiré.')}</span> : null}
        </div>
      )}
      {error ? <div className="nb-error">{error}</div> : null}
      <div className="nb-devices-join">
        <span className="nb-muted">{t('Cet appareil n’affiche pas vos pages ?')}</span>
        <button type="button" className="nb-btn nb-btn--sm" onClick={onJoin}>
          {t('Saisir un lien ou un code')}
        </button>
      </div>
    </div>
  );
}

const DATE = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long' });

/** Inviter une personne : un lien (7 jours, une seule personne) qui lui donne son propre espace sur ce serveur. */
export function InvitePanel() {
  const settings = useSettings();
  const [name, setName] = useState(isDefaultUserName(settings.userName) ? '' : settings.userName);
  const [list, setList] = useState<{ invites: InviteInfo[]; guests: GuestInfo[] } | null>(null);
  const [fresh, setFresh] = useState<InviteInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      setList(await api.listInvites());
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Invitations indisponibles.'));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const inv = await api.createInvite(name.trim());
      if (name.trim() && isDefaultUserName(getSettings().userName)) updateSettings({ userName: name.trim() });
      setFresh(inv);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Invitation impossible.'));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (token: string) => {
    await api.deleteInvite(token).catch((err: Error) => setError(err.message));
    if (fresh?.token === token) setFresh(null);
    await load();
  };

  const remove = async (guest: GuestInfo) => {
    const who = guest.name || t('cette personne');
    if (
      !confirm(t('Retirer {who} ? Son espace (pages, fichiers) sera supprimé de votre serveur ; ses appareils ne se synchroniseront plus.', { who }))
    )
      return;
    await api.removeGuest(guest.wsId).catch((err: Error) => setError(err.message));
    toast(guest.name ? t('{name} n’a plus accès à votre serveur.', { name: guest.name }) : t('La personne n’a plus accès à votre serveur.'));
    await load();
  };

  const pending = (list?.invites ?? []).filter((i) => i.token !== fresh?.token);
  return (
    <div className="nb-invite">
      <p className="nb-muted">
        {t(
          'Donnez à un proche son propre espace Ostal sur votre serveur : ses pages restent à lui, il les retrouve sur tous ses appareils, et vous pouvez vous partager des pages. Il n’a pas accès à votre maison, vos caméras ni votre homelab.',
        )}
      </p>
      {fresh ? (
        <LinkCard
          url={fresh.url}
          title={t('Invitation à Ostal')}
          text={fresh.name ? t('{name} t’invite à utiliser Ostal :', { name: fresh.name }) : t('Je t’invite à utiliser Ostal :')}
        >
          <p className="nb-linkcard-help">
            {t(
              'Envoyez ce lien à la personne invitée (message, e-mail), ou faites-lui scanner le QR code : elle crée son espace en un clic. Valable 7 jours, pour une seule personne.',
            )}
          </p>
        </LinkCard>
      ) : (
        <div className="nb-invite-new">
          <label className="nb-field">
            <span>{t('Votre prénom, affiché dans l’invitation')}</span>
            <input className="nb-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={t('Ex. : Camille')} />
          </label>
          <div>
            <button type="button" className="nb-btn nb-btn--primary" onClick={() => void create()} disabled={busy}>
              <Icon name="users" size={15} /> {t('Créer une invitation')}
            </button>
          </div>
        </div>
      )}
      {fresh ? (
        <div>
          <button type="button" className="nb-btn nb-btn--sm" onClick={() => setFresh(null)}>
            {t('Inviter une autre personne')}
          </button>
        </div>
      ) : null}
      {error ? <div className="nb-error">{error}</div> : null}
      {pending.length ? (
        <div className="nb-invite-list">
          <h4>{t('Invitations en attente')}</h4>
          {pending.map((i) => (
            <div key={i.token} className="nb-invite-row">
              <Icon name="mail" size={15} />
              <span>
                {t('Créée le {created}, valable jusqu’au {expires}', { created: DATE.format(i.createdAt), expires: DATE.format(i.expiresAt) })}
              </span>
              <button type="button" className="nb-btn nb-btn--sm" onClick={() => void copyText(i.url)}>
                {t('Copier')}
              </button>
              <button type="button" className="nb-btn nb-btn--sm" onClick={() => void cancel(i.token)}>
                {t('Annuler')}
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {list?.guests.length ? (
        <div className="nb-invite-list">
          <h4>{t('Personnes invitées')}</h4>
          {list.guests.map((g) => (
            <div key={g.wsId} className="nb-invite-row">
              <Icon name="user" size={15} />
              <span>
                {g.name || t('Sans nom')} <span className="nb-muted">{t('· depuis le {date}', { date: DATE.format(g.createdAt) })}</span>
              </span>
              <button type="button" className="nb-btn nb-btn--sm nb-btn--danger" onClick={() => void remove(g)}>
                {t('Retirer')}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Serveur sur lequel un code seul s'applique : celui de la page (navigateur), sinon aucun. */
function codeServer(): string | null {
  return isStandaloneWeb() && !isDesktopLocal() ? normalizeServerUrl(location.origin + location.pathname) : null;
}

/** Adresse (#/…) à ouvrir sur le serveur du lien pour qu'il s'en occupe : invitation, liaison, ou page d'accueil. */
function serverRoute(link: OstalLink, code: string): string {
  if (link.kind === 'invite') return `#/invite/${link.token}`;
  if (link.kind === 'pair') return `#/pair/${link.code}`;
  if (link.kind === 'join') return `#/join/${link.wsId}/${link.key}`;
  return code.length === 6 ? `#/pair/${code}` : '';
}

/**
 * Formulaire unique pour rejoindre un espace : lien d'invitation ou de liaison collé, adresse d'un serveur (et code),
 * ou code seul (navigateur). Écran de bienvenue et réglages.
 */
export function JoinForm({
  onCancel,
  cancelLabel = t('Annuler'),
  autoFocus = true,
  initialInput = '',
}: {
  onCancel?: () => void;
  cancelLabel?: string;
  autoFocus?: boolean;
  /** Adresse proposée d'avance (serveur déjà connu, ou serveur par défaut de l'application Android). */
  initialInput?: string;
}) {
  const settings = useSettings();
  const [input, setInput] = useState(initialInput);
  const [code, setCode] = useState('');
  const [name, setName] = useState(isDefaultUserName(settings.userName) ? '' : settings.userName);
  const [invite, setInvite] = useState<{ token: string; host: string } | { token: string; error: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const here = codeServer();
  const onlyCode = asPairingCode(input);
  const link = parseOstalLink(input);
  const server = link?.server ?? (onlyCode ? here : null);
  const pairCode = link?.kind === 'pair' ? link.code : (onlyCode ?? code);
  // Lien d'un autre serveur que celui de la page : ouvert tel quel (navigateur) ou dans la fenêtre (ordinateur), qui s'en
  // occupe. L'application Android, elle, se relie directement à n'importe quel serveur.
  const elsewhere = Boolean(link && link.kind !== 'share' && link.server !== here && (here || desktop()));

  // Lien d'invitation : nom de la personne qui invite (et invitation encore valable ?).
  const inviteToken = link?.kind === 'invite' && !elsewhere ? link.token : null;
  useEffect(() => {
    if (!inviteToken || !link) return;
    let alive = true;
    inviteInfo(link.server, inviteToken).then(
      (info) => alive && setInvite({ token: inviteToken, host: info.name }),
      (err: Error) => alive && setInvite({ token: inviteToken, error: err.message }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteToken]);
  const inviteState = invite && inviteToken === invite.token ? invite : null;
  const inviteHost = inviteState && 'host' in inviteState ? inviteState : null;

  let hint = '';
  let action = '';
  if (onlyCode && !server) hint = t('Collez plutôt le lien complet, ou saisissez l’adresse du serveur avant le code.');
  else if (onlyCode) action = t('Relier cet appareil');
  else if (link?.kind === 'invite') {
    if (elsewhere) action = t('Ouvrir l’invitation');
    else if (inviteState && 'error' in inviteState) hint = inviteState.error;
    else if (inviteHost) action = t('Créer mon espace');
  } else if (link?.kind === 'pair' || link?.kind === 'join') action = t('Relier cet appareil');
  else if (link?.kind === 'share') action = t('Ouvrir la page partagée');
  else if (link?.kind === 'server') action = code.length === 6 ? t('Relier cet appareil') : t('Se connecter');
  else if (input.trim()) hint = t('Lien ou adresse non reconnus. Exemple : https://melo.mondomaine.fr');

  const submit = async () => {
    if (!action || busy || !server) return;
    setBusy(true);
    setError('');
    try {
      if (link?.kind === 'share') {
        if (link.server === here) location.href = link.url;
        else window.open(link.url, '_blank', 'noopener');
        setBusy(false);
        return;
      }
      if (link && elsewhere) {
        const route = serverRoute(link, code);
        const app = desktop();
        if (app) await app.useServer(link.server, route);
        else location.href = `${link.server}/${route}`;
        return;
      }
      if (link?.kind === 'invite') await acceptInvite(link.server, link.token, name, inviteHost?.host ?? '');
      else if (link?.kind === 'join') await joinWithKey(link.server, link.wsId, link.key);
      else if (pairCode.length === 6) await linkWithCode(server, pairCode);
      else await claimServer(server);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Connexion impossible.'));
      setBusy(false);
    }
  };

  return (
    <div className="nb-join">
      <label className="nb-field">
        <span>{t('Lien reçu, adresse du serveur ou code')}</span>
        <input
          className="nb-input nb-input--lg"
          placeholder={t('https://… ou 123 456')}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError('');
          }}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
        />
      </label>
      {!input.trim() ? (
        <p className="nb-muted nb-small">
          {tx(
            'Collez le lien d’invitation ou de liaison que l’on vous a envoyé. Pour relier un de vos appareils : sur un appareil déjà relié, <b>Réglages → Relier un autre appareil</b>.',
            { b: (s) => <b>{s}</b> },
          )}
        </p>
      ) : null}
      {link?.kind === 'server' ? (
        <div className="nb-field">
          <span>
            {t('Code à 6 chiffres (Réglages d’un appareil déjà relié → Relier un autre appareil). Premier appareil sur ce serveur : laissez vide.')}
          </span>
          <PairingCodeInput value={code} onChange={setCode} onEnter={() => void submit()} />
        </div>
      ) : null}
      {inviteHost ? (
        <div className="nb-join-invite">
          <p>
            <Icon name="sparkles" size={15} /> {inviteHost.host ? <b>{inviteHost.host}</b> : t('Quelqu’un')}{' '}
            {t('vous invite : vous aurez votre propre espace Ostal, privé, sur son serveur.')}
          </p>
          <label className="nb-field">
            <span>{t('Votre prénom (affiché quand vous modifiez une page à plusieurs)')}</span>
            <input className="nb-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={t('Ex. : Camille')} />
          </label>
        </div>
      ) : null}
      {!elsewhere && (link?.kind === 'pair' || link?.kind === 'join' || (link?.kind === 'server' && code.length === 6) || (onlyCode && server)) ? (
        <p className="nb-muted nb-small">
          {t('Cet appareil affichera l’espace de l’appareil qui a donné ce code. Les pages créées ici avant ne seront plus affichées.')}
        </p>
      ) : null}
      {link?.kind === 'share' ? (
        <p className="nb-muted nb-small">{t('C’est le lien d’une page partagée : elle s’ouvre directement, sans créer d’espace.')}</p>
      ) : null}
      {hint ? <div className="nb-muted nb-small nb-join-hint">{hint}</div> : null}
      {error ? <div className="nb-error">{error}</div> : null}
      <div className="nb-row nb-gap nb-end">
        {onCancel ? (
          <button type="button" className="nb-btn" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
        ) : null}
        <button type="button" className="nb-btn nb-btn--primary" onClick={() => void submit()} disabled={busy || !action}>
          {busy ? t('Un instant…') : action || t('Continuer')}
        </button>
      </div>
    </div>
  );
}

/** `server` : adresse déjà connue (saisie dans les réglages) ; à défaut, celle de l'application Android. */
export function JoinDialog({ onClose, server }: { onClose: () => void; server?: string | null }) {
  const initial = server ?? (isNative() ? getSettings().serverUrl : null) ?? '';
  return (
    <Modal title={t('Rejoindre un espace')} onClose={onClose} width={500}>
      <JoinForm onCancel={onClose} initialInput={initial} />
    </Modal>
  );
}

/** Adresse #/pair/<code> ouverte dans un navigateur : relier cet appareil à l'espace qui a affiché le code. */
export function PairView({ code }: { code: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const server = normalizeServerUrl(location.origin + location.pathname) ?? location.origin;
  const link = async () => {
    setBusy(true);
    setError('');
    try {
      await linkWithCode(server, code);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Liaison impossible.'));
      setBusy(false);
    }
  };
  return (
    <div className="nb-center">
      <div className="nb-card">
        <OstalLogo size={48} className="nb-logo" />
        <h1>{t('Relier cet appareil')}</h1>
        <p className="nb-muted">
          {tx(
            'Cet appareil va afficher les mêmes pages, le même accueil et les mêmes réglages que l’appareil qui a donné ce lien (code <c>{code}</c>). Les pages créées ici avant ne seront plus affichées.',
            { c: (s) => <b className="nb-mono">{s}</b> },
            { code: formatPairingCode(code) },
          )}
        </p>
        {error ? <div className="nb-error">{error}</div> : null}
        <div className="nb-row nb-gap nb-end">
          <button type="button" className="nb-btn" onClick={() => navigate('#/')} disabled={busy}>
            {t('Annuler')}
          </button>
          <button type="button" className="nb-btn nb-btn--primary" onClick={() => void link()} disabled={busy}>
            {busy ? t('Liaison…') : t('Relier cet appareil')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Adresse #/invite/<jeton> ouverte dans un navigateur : créer son propre espace sur ce serveur. */
export function InviteView({ token }: { token: string }) {
  const settings = useSettings();
  const server = normalizeServerUrl(location.origin + location.pathname) ?? location.origin;
  const [info, setInfo] = useState<{ name: string } | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState(isDefaultUserName(settings.userName) ? '' : settings.userName);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    inviteInfo(server, token).then(setInfo, (err: Error) => setError(err.message));
  }, [server, token]);

  const accept = async () => {
    setBusy(true);
    setError('');
    try {
      await acceptInvite(server, token, name, info?.name ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Création impossible.'));
      setBusy(false);
    }
  };

  return (
    <div className="nb-center nb-onboarding">
      <div className="nb-card">
        <OstalLogo size={48} className="nb-logo" />
        <h1>{t('Bienvenue dans Ostal')}</h1>
        {!info && !error ? <p className="nb-muted">{t('Vérification de l’invitation…')}</p> : null}
        {info ? (
          <>
            <p className="nb-lead">
              {info.name ? <b>{info.name}</b> : t('Quelqu’un')}{' '}
              {t('vous invite à utiliser Ostal : votre accueil, vos notes, votre agenda et des outils pour vos PDF, sur tous vos appareils.')}
            </p>
            <p className="nb-muted">
              {t('Vous aurez votre propre espace, privé, sur le serveur de {name} : vous pourrez vous partager des pages quand vous le voudrez.', {
                name: info.name || t('cette personne'),
              })}
            </p>
            <label className="nb-field">
              <span>{t('Votre prénom (affiché quand vous modifiez une page à plusieurs)')}</span>
              <input
                className="nb-input nb-input--lg"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void accept()}
                maxLength={40}
                placeholder={t('Ex. : Camille')}
                autoFocus
              />
            </label>
          </>
        ) : null}
        {error ? <div className="nb-error">{error}</div> : null}
        <div className="nb-row nb-gap nb-end">
          {error && !info ? (
            <button type="button" className="nb-btn nb-btn--primary" onClick={() => navigate('#/')}>
              {t('Ouvrir Ostal')}
            </button>
          ) : (
            <button type="button" className="nb-btn nb-btn--primary" onClick={() => void accept()} disabled={busy || !info}>
              {busy ? t('Création…') : t('Créer mon espace')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
