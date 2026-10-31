import { Link } from 'react-router-dom';
import { Hourglass } from 'lucide-react';
import { EmptyState } from '../../ui';
import { useTitle } from '../../ui/useTitle';

/** Honest placeholder for features that don’t have a real backend yet. Never shows sample people as real ones. */
export function Unavailable({ title, body, phase }: { title: string; body: string; phase: string }) {
  useTitle(title);
  return (
    <div className="page">
      <EmptyState icon={<Hourglass size={28} />} title={title}
        body={<>{body} <span className="subtle">Planned for {phase}. To explore the finished screens with sample people, run the app in demo mode (see the README).</span></>}
        action={<div className="row" style={{ flexWrap: 'wrap', justifyContent: 'center' }}><Link to="/me" className="btn btn-primary">View your profile</Link><Link to="/me/edit" className="btn btn-secondary">Edit profile</Link></div>} />
    </div>
  );
}
