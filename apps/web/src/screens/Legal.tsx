import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, TriangleAlert } from 'lucide-react';
import { TERMS_VERSION } from '@lovoki/core';
import { useTitle } from '../ui/useTitle';

function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  useTitle(title);
  return (
    <main id="main" className="page stack" style={{ gap: 20, padding: '24px 16px 64px' }} tabIndex={-1}>
      <button type="button" className="back" onClick={() => { if (window.history.length > 1) window.history.back(); else window.location.assign('/'); }}><ArrowLeft size={18} aria-hidden />Back</button>
      <div className="notice notice-warning" role="note" data-testid="legal-draft"><TriangleAlert size={18} aria-hidden /><div className="grow"><b>DRAFT, needs legal review.</b> This text was written by the development team as a placeholder. It is not legal advice and has not been reviewed by a lawyer. Version <code>{TERMS_VERSION}</code>.</div></div>
      <h1>{title}</h1>
      {children}
    </main>
  );
}

export function Terms() {
  return (
    <LegalPage title="Terms of use (draft)">
      <section className="stack" style={{ gap: 8 }}><h2>Who can use LOVOKI</h2><p>You must be 18 or over. Age is self-declared and not verified. One person, one account, and the details you give must be about you.</p></section>
      <section className="stack" style={{ gap: 8 }}><h2>How to behave</h2><p>No harassment, hate, scams, impersonation, sexual content involving anyone under 18, or content you don’t have the right to share. You can block and report anyone. Reports are saved for review; nothing is removed automatically.</p></section>
      <section className="stack" style={{ gap: 8 }}><h2>Your content</h2><p>Photos, posts and comments are yours. By posting you let LOVOKI store and show them as your settings say. You can delete them at any time.</p></section>
      <section className="stack" style={{ gap: 8 }}><h2>No guarantees</h2><p>This is a development build. It can change, break or be reset. Don’t rely on it for anything important.</p></section>
      <section className="stack" style={{ gap: 8 }}><h2>Ending your account</h2><p>You can stop using LOVOKI at any time. Account deletion is not built yet; until it is, contact the team to have your data removed.</p></section>
      <p className="muted">See also the <Link to="/privacy">Privacy Policy (draft)</Link>.</p>
    </LegalPage>
  );
}

export function Privacy() {
  return (
    <LegalPage title="Privacy policy (draft)">
      <section className="stack" style={{ gap: 8 }}><h2>What we collect, and why</h2>
        <ul className="stack" style={{ gap: 6 }}>
          <li><b>Needed to run your account:</b> email, password (stored hashed by our login provider), username, display name, date of birth (never shown, only your age), gender, who you want to meet, your city, and at least one photo.</li>
          <li><b>Optional, only if you add it:</b> bio, interests, prompts, height, job, education, languages, lifestyle, kids, relationship style, Instagram handle. You choose who sees each group.</li>
          <li><b>Sensitive, only if you opt in:</b> religion. It starts hidden, is display-only, and is never used to filter, rank or advertise.</li>
          <li><b>Activity:</b> your posts, likes, comments, follows, blocks, reports, and your likes and passes in Discover. Likes are private until you both like each other.</li>
        </ul></section>
      <section className="stack" style={{ gap: 8 }}><h2>What we never collect</h2><p>Caste, income or net worth, exact address, GPS history, government ID numbers or documents, health conditions, sexual history, immigration status, or biometrics.</p></section>
      <section className="stack" style={{ gap: 8 }}><h2>Location</h2><p>We don’t track your device. You pick a city. If you choose “Use my current location”, your browser sends one point to find the nearest cities; we don’t store it, only the city you pick, rounded to about 5 km. Other people only ever see a distance range, never coordinates.</p></section>
      <section className="stack" style={{ gap: 8 }}><h2>Who sees what</h2><p>Photos are private files shown only to people your settings and the matching rules allow. Nothing here is sold or used for advertising.</p></section>
      <section className="stack" style={{ gap: 8 }}><h2>Email</h2><p>We email you to confirm your address and reset passwords. Product news is off unless you turn it on, and you can switch it off in Settings.</p></section>
      <p className="muted">See also the <Link to="/terms">Terms (draft)</Link>.</p>
    </LegalPage>
  );
}
