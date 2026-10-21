import { Link } from 'react-router';
import { RefreshCw } from 'lucide-react';
import type { Redelivery } from '../../data/csr';

export const SECTION_VIEW = '/review/csr-11.4.1-02?step=draft';

export function RedeliveryBanner({ items, onShow }: { items: Redelivery[]; onShow: (section: string) => void }) {
  if (items.length === 0) return null;
  const first = items[0];
  return (
    <div role="status" className="flex items-center gap-3 border-b border-attention/30 bg-attention-soft px-4 py-2 text-sm text-ink">
      <RefreshCw className="size-4 shrink-0 text-attention" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">Table 14.2.1 was re-delivered (v3 to v4).</span>{' '}
        {items.length} {items.length === 1 ? 'sentence' : 'sentences'} in this draft {items.length === 1 ? 'cites a cell' : 'cite cells'} that changed.
      </p>
      <button type="button" onClick={() => onShow(first.section)} className="shrink-0 font-medium text-cited underline underline-offset-4">
        Show the sentences
      </button>
      <Link to={SECTION_VIEW} className="shrink-0 font-medium text-cited underline underline-offset-4">
        Open the section view
      </Link>
    </div>
  );
}
