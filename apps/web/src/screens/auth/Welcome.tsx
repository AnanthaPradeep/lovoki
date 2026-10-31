import { Link } from 'react-router-dom';
import { Photo } from '../../ui';
import { ModeBadge } from '../../components/ModeBadge';
import { useTitle } from '../../ui/useTitle';

export function Welcome() {
  useTitle('Welcome');
  return (
    <div className="auth-shell">
      <header className="auth-top"><span className="wordmark" style={{ padding: 0 }}>LOVOKI</span><ModeBadge mode="supabase" /></header>
      <main id="main" className="welcome">
        <section className="welcome-copy">
          <h1 className="welcome-title">Meet the person behind the profile.</h1>
          <p className="muted" style={{ fontSize: 'var(--fs-body-lg)', maxWidth: '44ch' }}>
            Share photos and posts, meet people who are looking for the same thing you are, and start talking once you both say yes.
          </p>
          <div className="row" style={{ flexWrap: 'wrap', marginTop: 8 }}>
            <Link to="/signup" className="btn btn-primary">Create account</Link>
            <Link to="/login" className="btn btn-secondary">Log in</Link>
          </div>
          <p className="subtle">For adults 18 and over. Your age is self-declared and isn’t verified.</p>
        </section>
        <aside className="welcome-card" aria-label="Example profile">
          <div className="dc-photo"><Photo photo={{ id: 'welcome', kind: 'generated', seed: 3, alt: 'Illustration of an example profile photo' }} /></div>
          <div className="dc-note"><div className="q">A perfect Sunday</div><blockquote>Kiln opening at nine, beach at noon, nobody asking me to be productive after four.</blockquote></div>
          <p className="subtle" style={{ textAlign: 'center', marginTop: 12 }}>Example profile. Fictional person, generated artwork.</p>
        </aside>
      </main>
    </div>
  );
}
