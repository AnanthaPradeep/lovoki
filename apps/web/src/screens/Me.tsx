import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Pencil, Settings, MapPin, Briefcase, ArrowLeft, Plus, Trash2, ShieldCheck } from 'lucide-react';
import {
  ALL_INTERESTS, ALL_INTENTIONS, INTENTION_LABEL, LIMITS, postsBy, profileCompleteness, validateProfile,
  type Intention, type ProfileDraft,
} from '@lovoki/core';
import { store, useAppState } from '../store';
import { Counter, FieldError, Notice, Photo, useToast } from '../ui';
import { PostGrid } from './Feed';

export function Me() {
  const s = useAppState();
  const me = s.me;
  const posts = useMemo(() => postsBy(s, 'me'), [s]);
  const done = profileCompleteness(me);
  return (
    <div className="page stack" style={{ gap: 24 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <h1>Your profile</h1>
        <div className="row"><Link to="/settings" className="btn btn-ghost"><Settings size={18} aria-hidden />Settings</Link><Link to="/me/edit" className="btn btn-primary"><Pencil size={18} aria-hidden />Edit profile</Link></div>
      </div>
      <div className="card card-pad stack" style={{ gap: 10 }}>
        <div className="row"><b className="grow">Profile {done.percent}% complete</b><span className="subtle">Complete profiles get more thoughtful conversations</span></div>
        <div className="meter" role="progressbar" aria-valuenow={done.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Profile completeness"><div style={{ width: `${done.percent}%` }} /></div>
        {done.missing.length > 0 && <ul className="muted" style={{ margin: 0, paddingLeft: 20 }}>{done.missing.map((m) => <li key={m}>{m}</li>)}</ul>}
      </div>
      <div className="row" style={{ gap: 20, alignItems: 'flex-start' }}>
        <div style={{ width: 128, flex: 'none', borderRadius: 16, overflow: 'hidden' }}><Photo photo={me.photos[0]} className="ratio-45" /></div>
        <div className="stack grow" style={{ gap: 10, minWidth: 0 }}>
          <h2 className="profile-name">{me.name}<span className="muted" style={{ fontWeight: 400 }}>, {me.age}</span></h2>
          <div className="dc-meta"><span><MapPin size={16} aria-hidden />{me.area}</span>{me.work && <span><Briefcase size={16} aria-hidden />{me.work}</span>}{me.pronouns && <span>{me.pronouns}</span>}</div>
          <div className="stats"><span><b>{posts.length}</b>posts</span><span><b>{s.followers.filter((f) => !s.blocked.includes(f)).length}</b>followers</span><span><b>{s.following.length}</b>following</span></div>
        </div>
      </div>
      <p className="break">{me.bio || <span className="muted">No bio yet.</span>}</p>
      <div className="chips"><span className="chip chip-dating">{INTENTION_LABEL[me.intention]}</span>{me.interests.map((i) => <span key={i} className="chip">{i}</span>)}</div>
      {me.prompts.map((p) => <div className="prompt-card" key={p.question}><div className="q">{p.question}</div><p>{p.answer}</p></div>)}
      <div className="facts">
        <div className="fact"><ShieldCheck size={18} aria-hidden /><span className="grow">Not verified</span><span className="source">Verification arrives in a later phase</span></div>
      </div>
      <Notice>Your likes and matches are private. People only see what’s on this profile and the posts you share.</Notice>
      <section><h2 className="section-title">Your posts</h2><PostGrid posts={posts} /></section>
    </div>
  );
}

const PROMPT_OPTIONS = ['A perfect Sunday', 'I geek out on', 'Together, we could', 'My simple pleasures', 'The way to win me over', 'Green flags I look for', 'Unpopular opinion', 'Dating me is like'];

export function EditProfile() {
  const me = useAppState().me;
  const nav = useNavigate();
  const toast = useToast();
  const [d, setD] = useState<ProfileDraft>({
    name: me.name, age: String(me.age), area: me.area, work: me.work ?? '', pronouns: me.pronouns ?? '', bio: me.bio,
    intention: me.intention, interests: [...me.interests], prompts: me.prompts.map((p) => ({ ...p })),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tried, setTried] = useState(false);
  const set = <K extends keyof ProfileDraft>(k: K, v: ProfileDraft[K]) => {
    const next = { ...d, [k]: v }; setD(next);
    if (tried) setErrors(validateProfile(next) as Record<string, string>);
  };
  const save = (e: React.FormEvent) => {
    e.preventDefault(); setTried(true);
    const errs = validateProfile(d) as Record<string, string>;
    setErrors(errs);
    if (Object.keys(errs).length) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    store.updateProfile({ name: d.name.trim(), age: Number(d.age), area: d.area.trim(), work: d.work.trim(), pronouns: d.pronouns.trim(),
      bio: d.bio.trim(), intention: d.intention as Intention, interests: d.interests, prompts: d.prompts.map((p) => ({ question: p.question, answer: p.answer.trim() })) });
    toast({ text: 'Profile saved.' });
    nav('/me');
  };
  const errCount = Object.keys(errors).length;
  const field = (k: keyof ProfileDraft, label: string, opts: { hint?: string; type?: string; inputMode?: 'numeric' } = {}) => (
    <div className="field" data-invalid={!!errors[k]}>
      <label htmlFor={`f-${k}`}>{label}</label>
      <input id={`f-${k}`} className="input" type={opts.type ?? 'text'} inputMode={opts.inputMode} value={d[k] as string}
        aria-invalid={!!errors[k]} aria-describedby={errors[k] ? `e-${k}` : opts.hint ? `h-${k}` : undefined} onChange={(e) => set(k, e.target.value as never)} />
      {opts.hint && !errors[k] && <span className="hint" id={`h-${k}`}>{opts.hint}</span>}
      <FieldError id={`e-${k}`}>{errors[k]}</FieldError>
    </div>
  );

  return (
    <form className="page stack" style={{ gap: 24 }} onSubmit={save} noValidate>
      <div><Link to="/me" className="back"><ArrowLeft size={18} aria-hidden />Your profile</Link><h1 style={{ fontSize: 'var(--fs-heading)' }}>Edit profile</h1></div>
      {tried && errCount > 0 && <Notice tone="error">Fix {errCount} {errCount === 1 ? 'field' : 'fields'} before saving.</Notice>}
      <div className="card card-pad stack">
        <h2>Photos</h2>
        <div className="post-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>{me.photos.map((p) => <Photo key={p.id} photo={p} />)}</div>
        <p className="subtle">Adding and reordering profile photos comes with accounts in Phase 2.</p>
      </div>
      <div className="card card-pad stack">
        <h2>Basics</h2>
        {field('name', 'Name')}
        <div className="range-row">{field('age', 'Age', { inputMode: 'numeric', hint: '18 or over' })}{field('pronouns', 'Pronouns', { hint: 'Optional' })}</div>
        {field('area', 'Area', { hint: 'A neighbourhood or city. Never an exact address.' })}
        {field('work', 'Work', { hint: 'Optional' })}
        <div className="field" data-invalid={!!errors.bio}>
          <label htmlFor="f-bio">Bio</label>
          <textarea id="f-bio" className="textarea" value={d.bio} aria-invalid={!!errors.bio} aria-describedby="e-bio" onChange={(e) => set('bio', e.target.value)} />
          <div className="row"><span className="grow"><FieldError id="e-bio">{errors.bio}</FieldError></span><Counter value={d.bio.length} max={LIMITS.bio} /></div>
        </div>
      </div>
      <div className="card card-pad stack">
        <h2>What you’re looking for</h2>
        <div className="field"><label htmlFor="f-intent">Relationship intention</label>
          <select id="f-intent" className="select" value={d.intention} onChange={(e) => set('intention', e.target.value)}>
            {ALL_INTENTIONS.map((i) => <option key={i} value={i}>{INTENTION_LABEL[i]}</option>)}</select></div>
        <div className="field" data-invalid={!!errors.interests}>
          <span className="label">Interests <span className="subtle">({d.interests.length}/{LIMITS.interestsMax})</span></span>
          <div className="chips" role="group" aria-label="Interests" aria-invalid={!!errors.interests} tabIndex={errors.interests ? -1 : undefined}>
            {ALL_INTERESTS.map((i) => <button type="button" key={i} className="chip chip-toggle" aria-pressed={d.interests.includes(i)}
              onClick={() => set('interests', d.interests.includes(i) ? d.interests.filter((x) => x !== i) : [...d.interests, i])}>{i}</button>)}
          </div>
          <FieldError id="e-interests">{errors.interests}</FieldError>
        </div>
      </div>
      <div className="card card-pad stack">
        <h2>Prompts</h2>
        {d.prompts.map((p, i) => (
          <div className="field" key={i} data-invalid={!!errors[`prompt${i}`]}>
            <div className="row">
              <label className="sr-only" htmlFor={`pq-${i}`}>Prompt {i + 1}</label>
              <select id={`pq-${i}`} className="select grow" value={p.question} onChange={(e) => set('prompts', d.prompts.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))}>
                {PROMPT_OPTIONS.map((q) => <option key={q} disabled={q !== p.question && d.prompts.some((x) => x.question === q)}>{q}</option>)}
              </select>
              <button type="button" className="icon-btn" aria-label={`Remove prompt ${i + 1}`} onClick={() => set('prompts', d.prompts.filter((_, j) => j !== i))}><Trash2 size={18} /></button>
            </div>
            <label className="sr-only" htmlFor={`pa-${i}`}>Answer</label>
            <textarea id={`pa-${i}`} className="textarea" style={{ minHeight: 72 }} value={p.answer} aria-invalid={!!errors[`prompt${i}`]}
              onChange={(e) => set('prompts', d.prompts.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))} />
            <div className="row"><span className="grow"><FieldError id={`e-p${i}`}>{errors[`prompt${i}`]}</FieldError></span><Counter value={p.answer.length} max={LIMITS.answer} /></div>
          </div>
        ))}
        {d.prompts.length < 3 && <button type="button" className="btn btn-secondary" style={{ justifySelf: 'start' }}
          onClick={() => set('prompts', [...d.prompts, { question: PROMPT_OPTIONS.find((q) => !d.prompts.some((x) => x.question === q))!, answer: '' }])}><Plus size={18} aria-hidden />Add a prompt</button>}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}><Link to="/me" className="btn btn-secondary">Cancel</Link><button className="btn btn-primary">Save changes</button></div>
    </form>
  );
}
