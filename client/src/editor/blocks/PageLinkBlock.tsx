import { createReactBlockSpec } from '@blocknote/react';
import { useAppCtx } from '../context';

function PageLinkView({ pageId }: { pageId: string }) {
  const ctx = useAppCtx();
  const page = ctx.getPage(pageId);
  const missing = !page;
  return (
    <div
      className={`nb-pagelink${missing ? ' nb-pagelink--missing' : ''}`}
      role="link"
      tabIndex={0}
      contentEditable={false}
      onClick={() => !missing && ctx.openPage(pageId)}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !missing) {
          e.preventDefault();
          ctx.openPage(pageId);
        }
      }}
      title={missing ? 'Cette page n’existe plus' : 'Ouvrir la page'}
    >
      <span className="nb-pagelink-icon">{page?.icon || '📄'}</span>
      <span className="nb-pagelink-title">{missing ? 'Page introuvable' : page.title || 'Sans titre'}</span>
    </div>
  );
}

export const PageLinkBlock = createReactBlockSpec(
  {
    type: 'pageLink',
    propSchema: { pageId: { default: '' } },
    content: 'none',
  },
  {
    render: ({ block }) => <PageLinkView pageId={block.props.pageId} />,
    toExternalHTML: ({ block }) => <a href={`#/p/${block.props.pageId}`}>Page {block.props.pageId}</a>,
  },
);
