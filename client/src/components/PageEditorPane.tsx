import { useEffect, useRef, useState } from 'react';
import { Editor } from '../editor/Editor';
import { useAppCtx, type PageRef } from '../editor/context';
import type { DocHandle } from '../lib/yjs';
import { ICON_SIZE_RANGE, usePageMeta } from '../lib/hooks';
import { prepareImage } from '../lib/images';
import { IconPicker } from './IconPicker';
import { ImageCropDialog, renderCrop, type CropState } from './ImageCropDialog';
import { CoverPicker, PageCover, isValidCover } from './PageCover';
import { toast } from './Toast';
import { Icon } from '../icons/Icon';
import { PageIcon } from '../icons/pageIcon';

type Props = {
  handle: DocHandle | null;
  ready: boolean;
  title: string;
  icon: string;
  /** Colonne centrée (sinon pleine largeur). */
  narrow?: boolean;
  editable: boolean;
  onTitleChange: (title: string) => void;
  onIconChange: (icon: string) => void;
  subpages: PageRef[];
  onOpenPage: (id: string) => void;
  onCreateSubpage: (() => void) | null;
};

export function PageEditorPane(props: Props) {
  const { handle, ready, title, icon, editable, subpages } = props;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  // Bannière : enregistrée dans le document de la page (visible aussi des invités d'un lien de partage).
  const meta = usePageMeta(ready ? (handle?.doc ?? null) : null);
  const cover = isValidCover(meta.cover) ? meta.cover : '';
  const setCover = (value: string, y = 50) => {
    const doc = handle?.doc;
    if (!doc) return;
    doc.transact(() => {
      const m = doc.getMap('meta');
      m.set('cover', value);
      m.set('coverY', y);
    });
    setCoverPickerOpen(false);
  };

  // Taille de l'icône et hauteur de la bannière (0 = valeur par défaut), enregistrées dans le document de la page.
  const iconSize = meta.iconSize || ICON_SIZE_RANGE.default;
  const setMetaNumber = (key: 'iconSize' | 'coverHeight', value: number) => {
    const m = handle?.doc.getMap('meta');
    if (m && Number(m.get(key) ?? 0) !== value) m.set(key, value);
  };

  // Icône en image : recadrée avant utilisation ; l'image d'origine est gardée pour recadrer à nouveau.
  const app = useAppCtx();
  const [cropReq, setCropReq] = useState<{ src: string; file?: File; initial: CropState | null } | null>(null);
  const setIcon = (value: string) => {
    props.onIconChange(value);
    const m = handle?.doc.getMap('meta');
    if (m?.get('iconSource')) m.set('iconSource', '');
  };
  const requestCrop = ({ file, src }: { file?: File; src?: string }) => {
    setPickerOpen(false);
    if (file) {
      if (!file.type.startsWith('image/')) {
        toast('Ce fichier n’est pas une image (JPG, PNG, WebP, GIF…).', 'error');
        return;
      }
      setCropReq({ src: URL.createObjectURL(file), file, initial: null });
      return;
    }
    const source = parseIconSource(meta.iconSource);
    if (source) setCropReq({ src: source.src, initial: { cx: source.cx, cy: source.cy, zoom: source.zoom } });
    else if (src) setCropReq({ src, initial: null });
  };
  const closeCrop = () => {
    if (cropReq?.file) URL.revokeObjectURL(cropReq.src);
    setCropReq(null);
  };
  const finishCrop = async (img: HTMLImageElement, crop: CropState | null) => {
    if (!cropReq) return;
    let original = cropReq.src;
    if (cropReq.file) {
      // Image d'origine (réduite à 1024 px) : GIF et SVG tels quels, JPEG pour les photos, PNG sinon.
      original = await app.uploadFile(await prepareImage(cropReq.file, 1024, 1024, cropReq.file.type === 'image/jpeg'));
    }
    const iconUrl = crop ? await app.uploadFile(new File([await renderCrop(img, crop)], 'icone.png', { type: 'image/png' })) : original;
    props.onIconChange(iconUrl);
    handle?.doc.getMap('meta').set('iconSource', crop ? JSON.stringify({ src: original, ...crop }) : '');
    closeCrop();
  };

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  const focusEditor = () => {
    const pm = document.querySelector<HTMLElement>('.nb-editor .ProseMirror');
    pm?.focus();
  };

  return (
    <>
      {cover ? (
        <PageCover
          cover={cover}
          coverY={meta.coverY}
          height={meta.coverHeight}
          editable={editable}
          onChange={setCover}
          onHeightChange={(h) => setMetaNumber('coverHeight', h)}
        />
      ) : null}
      <div className={`nb-page${props.narrow ? ' nb-page--narrow' : ''}${cover ? ' nb-page--cover' : ''}`}>
        <div className="nb-page-head" style={{ '--nb-icon-size': `${iconSize}px` } as React.CSSProperties}>
          <div className={`nb-page-icon-wrap${icon ? '' : ' nb-page-icon-wrap--empty'}`}>
            {icon ? (
              <button
                type="button"
                className="nb-page-icon"
                onClick={() => editable && setPickerOpen((v) => !v)}
                title={editable ? 'Changer l’icône' : undefined}
                disabled={!editable}
              >
                <PageIcon icon={icon} size={iconSize} />
              </button>
            ) : null}
            {editable && (!icon || !cover) ? (
              <div className="nb-page-controls">
                {icon ? null : (
                  <button type="button" className="nb-page-icon-add" onClick={() => setPickerOpen((v) => !v)}>
                    <Icon name="smile" size={16} /> Ajouter une icône
                  </button>
                )}
                {cover ? null : (
                  <button type="button" className="nb-page-icon-add" onClick={() => setCoverPickerOpen((v) => !v)} disabled={!ready}>
                    <Icon name="image" size={16} /> Ajouter une bannière
                  </button>
                )}
              </div>
            ) : null}
            {coverPickerOpen && !cover ? <CoverPicker value="" onPick={(v) => setCover(v)} onClose={() => setCoverPickerOpen(false)} /> : null}
            {pickerOpen ? (
              <IconPicker
                value={icon}
                onSelect={(e) => {
                  setIcon(e);
                  setPickerOpen(false);
                }}
                onClose={() => setPickerOpen(false)}
                onCrop={ready ? requestCrop : undefined}
                size={iconSize}
                onSizeChange={ready ? (v) => setMetaNumber('iconSize', v === ICON_SIZE_RANGE.default ? 0 : v) : undefined}
              />
            ) : null}
            {cropReq ? (
              <ImageCropDialog
                src={cropReq.src}
                initial={cropReq.initial}
                animated={cropReq.file?.type === 'image/gif'}
                onCancel={closeCrop}
                onDone={finishCrop}
              />
            ) : null}
          </div>
          <textarea
            ref={titleRef}
            className="nb-page-title"
            placeholder="Sans titre"
            value={title}
            rows={1}
            readOnly={!editable}
            onChange={(e) => props.onTitleChange(e.target.value.replace(/\n/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'ArrowDown') {
                e.preventDefault();
                focusEditor();
              }
            }}
          />
        </div>

        <div className="nb-page-body">
          {handle && ready ? (
            <Editor key={handle.room} handle={handle} editable={editable} />
          ) : (
            <div className="nb-editor-skeleton">
              <div className="nb-skeleton-line" style={{ width: '70%' }} />
              <div className="nb-skeleton-line" style={{ width: '90%' }} />
              <div className="nb-skeleton-line" style={{ width: '55%' }} />
            </div>
          )}
        </div>

        <div className="nb-subpages">
          {subpages.length ? (
            <>
              <div className="nb-subpages-head">Sous-pages</div>
              {subpages.map((p) => (
                <button key={p.id} type="button" className="nb-subpage" onClick={() => props.onOpenPage(p.id)}>
                  <span className="nb-tree-icon">
                    <PageIcon icon={p.icon} size={16} />
                  </span>
                  <span>{p.title || 'Sans titre'}</span>
                </button>
              ))}
            </>
          ) : null}
          {props.onCreateSubpage && editable ? (
            <button type="button" className="nb-subpage nb-subpage--new" onClick={props.onCreateSubpage}>
              <Icon name="plus" size={16} /> Nouvelle sous-page
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}

/** Image d'origine et recadrage de l'icône, enregistrés dans le document de la page. */
function parseIconSource(raw: string): ({ src: string } & CropState) | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<{ src: string } & CropState>;
    if (typeof v.src !== 'string' || !/^(https?:\/\/|data:image\/)/.test(v.src)) return null;
    const num = (n: unknown, d: number) => (typeof n === 'number' && Number.isFinite(n) ? n : d);
    return { src: v.src, cx: num(v.cx, 0.5), cy: num(v.cy, 0.5), zoom: num(v.zoom, 1) };
  } catch {
    return null;
  }
}
