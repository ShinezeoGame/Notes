import { useEffect, useRef, useState } from 'react';
import { Editor } from '../editor/Editor';
import type { PageRef } from '../editor/context';
import type { DocHandle } from '../lib/yjs';
import { IconPicker } from './IconPicker';
import { Icon } from '../icons/Icon';
import { PageIcon } from '../icons/pageIcon';

type Props = {
  handle: DocHandle | null;
  ready: boolean;
  title: string;
  icon: string;
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
  const titleRef = useRef<HTMLTextAreaElement>(null);

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
    <div className="nb-page">
      <div className="nb-page-head">
        <div className={`nb-page-icon-wrap${icon ? '' : ' nb-page-icon-wrap--empty'}`}>
          {icon ? (
            <button
              type="button"
              className="nb-page-icon"
              onClick={() => editable && setPickerOpen((v) => !v)}
              title={editable ? 'Changer l’icône' : undefined}
              disabled={!editable}
            >
              <PageIcon icon={icon} size={64} />
            </button>
          ) : editable ? (
            <button type="button" className="nb-page-icon-add" onClick={() => setPickerOpen((v) => !v)}>
              <Icon name="smile" size={16} /> Ajouter une icône
            </button>
          ) : null}
          {pickerOpen ? (
            <IconPicker
              value={icon}
              onSelect={(e) => {
                props.onIconChange(e);
                setPickerOpen(false);
              }}
              onClose={() => setPickerOpen(false)}
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
  );
}
