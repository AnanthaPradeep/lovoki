import { Link } from 'react-router-dom';
import { SearchX } from 'lucide-react';
import { EmptyState } from '../ui';
import { useTitle } from '../ui/useTitle';

export function NotFound({ home = '/discover', homeLabel = 'Go to Discover' }: { home?: string; homeLabel?: string }) {
  useTitle('Page not found');
  return <div className="page"><EmptyState icon={<SearchX size={28} />} title="We can’t find that page" body="The link may be out of date or mistyped."
    action={<Link to={home} className="btn btn-primary">{homeLabel}</Link>} /></div>;
}
