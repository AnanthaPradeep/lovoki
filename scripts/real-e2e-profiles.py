"""REAL-MODE Phase 4.5 browser suite against the LOCAL Supabase stack. No fakes: real GoTrue, PostgREST/RLS, Postgres, Storage signed URLs,
a real browser, THREE real people (a private owner, a follower, a stranger) plus the seeded sample accounts.
Same prerequisites as scripts/real-e2e.py (read its header). The sample accounts are seeded at the start and removed at the end.

Run:  python scripts/real-e2e-profiles.py [--visuals]"""
import importlib.util, json, os, re, subprocess, sys, uuid
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from e2e_common import FIX
from playwright.sync_api import sync_playwright, expect

spec = importlib.util.spec_from_file_location('r2e', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'real-e2e.py'))
R = importlib.util.module_from_spec(spec); spec.loader.exec_module(R)
helper, T, goto, btn, new_ctx, results, page_errors, CUR = R.helper, R.T, R.goto, R.btn, R.new_ctx, R.results, R.page_errors, R.CUR
SHOTS = os.path.join(R.ROOT, 'docs', 'screenshots', 'phase45'); os.makedirs(SHOTS, exist_ok=True); R.SHOTS = SHOTS
FORBIDDEN = re.compile(r'"(lat|lng|latitude|longitude|coordinates?|date_of_birth|dob|dating_discoverable|discoverable|interested_in|email|password)"', re.I)

def node(script, *args, env=None):
    r = subprocess.run(['node', os.path.join(R.ROOT, 'scripts', script), *args], cwd=R.ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=300, env={**os.environ, **(env or {})})
    return r.returncode, (r.stdout + r.stderr)

def overflow(pg): return pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
def small_targets(pg):
    return pg.evaluate("""() => [...document.querySelectorAll('button, a.btn, a.icon-btn, input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]), textarea, select, [role=tab], [role=option], a.pgrid-tile, .count-btn')]
      .filter(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !e.closest('[hidden]') && !e.closest('.sr-only') && !e.classList.contains('switch') && !e.closest('dialog:not([open])'); })
      .map(e => { const r = e.getBoundingClientRect(); return { n: (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter(x => x.h < 44 || x.w < 44)""")
def tiles(pg): return pg.locator('a.pgrid-tile')
def wait_db(read, want, what, timeout=12):
    """Polls a database read until it equals `want` (readiness, not a delay)."""
    import time
    end = time.time() + timeout; got = None
    while time.time() < end:
        got = read()
        if got == want: return
        time.sleep(0.25)
    raise AssertionError(f'{what}: wanted {want!r}, database says {got!r}')
def set_account_type(pg, user_id, label):
    goto(pg, '/settings'); expect(pg.get_by_role('heading', name='Privacy overview')).to_be_visible()
    g = pg.get_by_role('group', name='Social visibility'); g.get_by_role('button', name=label, exact=True).click()
    expect(g.get_by_role('button', name=label, exact=True)).to_have_attribute('aria-pressed', 'true')
    wait_db(lambda: helper('query', 'profiles', 'user_id', user_id)[0]['social_visibility'], 'public' if label == 'Public' else 'followers', f'account type {label}')
def grid_loaded(pg, n):
    expect(tiles(pg)).to_have_count(n)
    pg.wait_for_function("[...document.querySelectorAll('a.pgrid-tile img')].length > 0 && [...document.querySelectorAll('a.pgrid-tile img')].every(i => i.complete && i.naturalWidth > 0)", timeout=15000)

def main():
    env = helper('env'); mail = env['MAIL']
    R.HELPER_ENV.update({'LOVOKI_HELPER_API_URL': env['VITE_SUPABASE_URL'], 'LOVOKI_HELPER_ANON': env['VITE_SUPABASE_PUBLISHABLE_KEY'], 'LOVOKI_HELPER_SERVICE': env.pop('_service'), 'LOVOKI_HELPER_MAIL': mail})
    seed_env = {'LOVOKI_SEED_API_URL': R.HELPER_ENV['LOVOKI_HELPER_API_URL'], 'LOVOKI_SEED_SERVICE_KEY': R.HELPER_ENV['LOVOKI_HELPER_SERVICE']}
    node('seed-sample-content.mjs', '--remove', '--yes', env=seed_env)  # a known starting crowd
    purged = helper('purge-test-users')
    if purged['others']:
        raise SystemExit(f"{purged['others']} other account(s) exist on this local database. Remove them first so the crowd is predictable (for example: node scripts/seed-local-users.mjs --remove).")
    code, out = node('seed-sample-content.mjs', '--yes', env=seed_env)
    if code != 0: raise SystemExit('seeding the sample content failed:\n' + out[-1500:])
    owner = helper('profile-user', 'Prisha Owner', 'followers', '4'); foll = helper('profile-user', 'Faisal Follower', 'public', '0'); strg = helper('profile-user', 'Sana Stranger', 'public', '0')
    owner_sample = helper('query', 'profiles', 'is_sample', 'true')
    sample_by = {r['display_name']: r for r in owner_sample}
    meera, kavya = sample_by['Meera Velan'], sample_by['Kavya Pillai']  # a public sample (index 0) and a private one (index 2)
    server = R.start_server(env)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            def user_page(u, w=1440, h=1000, scheme='light'):
                pg = new_ctx(b, w, h, scheme); CUR['pg'] = pg; pg.set_default_timeout(12000); R.login(pg, u['email'], u['password']); return pg
            wire, signs, imgsrc = [], [], []
            sp = user_page(strg)
            def watch(res):
                if '/rest/v1/rpc/' in res.url:
                    try: wire.append((res.url, res.text()))
                    except Exception: pass
            sp.on('response', watch)
            sp.on('request', lambda r: signs.append(r.post_data or '') if '/object/sign/' in r.url and r.method == 'POST' else None)

            # ---------------- a stranger meets a private account ----------------
            def stranger_view():
                goto(sp, f"/@{owner['handle']}"); expect(sp.get_by_test_id('handle')).to_have_text(f"@{owner['handle']}"); expect(sp.get_by_role('heading', name='This account is private')).to_be_visible()
                expect(sp.get_by_test_id('bio')).to_contain_text('Real e2e profile of Prisha Owner'); expect(sp.locator('.avatar[data-blurred=true]').first).to_be_visible()
                expect(sp.get_by_test_id('counts')).to_contain_text('4'); expect(sp.get_by_test_id('counts')).to_contain_text('posts')
                expect(tiles(sp)).to_have_count(0); expect(sp.get_by_role('tablist')).to_have_count(0); expect(sp.get_by_test_id('counts').get_by_role('button')).to_have_count(0)
                assert owner['id'] not in ' '.join(signs), 'the stranger\'s browser never asked for a signed URL for the owner\'s files'
                assert sp.locator(f"img[src*='{owner['id']}']").count() == 0, 'no image of the owner is on the page'
                html = sp.content(); assert owner['posts'][0]['main'] not in html and owner['posts'][0]['thumb'] not in html, 'no media path in the DOM'
            T('REAL stranger of a private account: handle, name, bio, counts and a BLURRED avatar; lock panel, no grid, no lists, no signed URL ever requested', stranger_view)
            def direct_storage():
                a_ = sp.evaluate("JSON.parse(localStorage.getItem('lovoki.auth') || '{}')"); tok = a_.get('access_token') or (a_.get('session') or {}).get('access_token') or ''; assert tok, 'a session token'
                anon = env['VITE_SUPABASE_PUBLISHABLE_KEY']; base = env['VITE_SUPABASE_URL']
                for path in [owner['posts'][0]['thumb'], owner['posts'][0]['main']]:
                    r = sp.request.get(f"{base}/storage/v1/object/authenticated/post-media/{path}", headers={'apikey': anon, 'Authorization': f'Bearer {tok}'}); assert r.status >= 400, f'direct download {r.status}'
                    r = sp.request.post(f"{base}/storage/v1/object/sign/post-media/{path}", headers={'apikey': anon, 'Authorization': f'Bearer {tok}', 'Content-Type': 'application/json'}, data=json.dumps({'expiresIn': 60})); assert r.status >= 400, f'sign {r.status}'
                for t in ['posts', 'post_media']:
                    r = sp.request.get(f"{base}/rest/v1/{t}?select=*&limit=3", headers={'apikey': anon, 'Authorization': f'Bearer {tok}'}); assert r.status in (401, 403, 404) or r.json() == [], f'{t} must not be readable directly ({r.status})'
                r = sp.request.get(f"{base}/rest/v1/profiles?select=user_id,bio&user_id=eq.{owner['id']}", headers={'apikey': anon, 'Authorization': f'Bearer {tok}'}); assert r.status in (401, 403, 404) or r.json() == [], 'another persons profile row is not readable directly'
            T('REAL: a stranger\'s direct storage reads, signed-URL attempts and table reads are all refused or empty', direct_storage)
            def search_and_explore():
                goto(sp, '/search'); box = sp.get_by_role('combobox', name='Search people'); box.fill(owner['handle'][:8]); opt = sp.get_by_role('listbox', name='Search results').get_by_role('option', name=re.compile(owner['handle']))
                expect(opt).to_be_visible(); assert opt.locator('.lock-mark').count() == 1; box.fill('x'); expect(sp.get_by_test_id('search-idle')).to_be_visible()
                goto(sp, '/feed'); sp.get_by_role('tab', name='Explore').click(); R.wait_posts(sp, 5); assert R.posts(sp).filter(has_text='Prisha Owner post').count() == 0, 'private posts are not in Explore'
                expect(R.posts(sp).filter(has_text='Sample').first).to_be_visible()
            T('REAL: search shows the private account with a lock; Explore excludes it and shows labelled samples', search_and_explore)

            # ---------------- request, accept, grid ----------------
            fp = user_page(foll)
            def request_follow():
                goto(fp, f"/@{owner['handle']}"); fp.get_by_test_id('lock-panel').get_by_role('button', name='Request to follow').click(); expect(fp.get_by_role('button', name='Requested')).to_be_visible()
                st = helper('query', 'follows', 'follower_id', foll['id']); assert st and st[0]['status'] == 'pending', st
            T('REAL: a follower requests, and the request is pending in the database', request_follow)
            op = user_page(owner)
            def owner_accepts():
                goto(op, '/connections'); op.get_by_role('tab', name=re.compile('^Requests')).click(); row = op.get_by_test_id('person-row').filter(has_text='Faisal'); expect(row).to_be_visible(); row.get_by_role('button', name='Accept').click()
                expect(op.get_by_test_id('person-row')).to_have_count(0); assert helper('query', 'follows', 'follower_id', foll['id'])[0]['status'] == 'accepted'
            T('REAL: the owner accepts in Requests', owner_accepts)
            def follower_grid():
                signs.clear(); fsigns = []; fp.on('request', lambda r: fsigns.append(r.post_data or '') if '/object/sign/post-media' in r.url and r.method == 'POST' else None)
                goto(fp, f"/@{owner['handle']}"); grid_loaded(fp, 4); expect(fp.get_by_test_id('lock-panel')).to_have_count(0); expect(fp.get_by_role('tab', name='About')).to_be_visible()
                expect(fp.locator('.avatar img').first).to_be_visible()
                rows = helper('query', 'post_media', 'user_id', owner['id']); thumbs = {r['thumb_path'] for r in rows}; originals = {r['storage_path'] for r in rows}
                asked = set(re.findall(r'"([^"]+\.jpg)"', ' '.join(fsigns))); assert asked & thumbs, f'signed the thumbnails: {asked}'
                assert not (asked & originals), 'the grid asked for thumbnails only, never an original'
                ratios = fp.evaluate("[...document.querySelectorAll('a.pgrid-tile')].every(e => { const r = e.getBoundingClientRect(); return Math.abs(r.width - r.height) < 1.5; })"); assert ratios, 'tiles are square'
            T('REAL: once accepted the grid loads from THUMBNAILS only, in square tiles, and the avatar is the real picture', follower_grid)
            def viewer_modal():
                tiles(fp).first.click(); dlg = fp.get_by_role('dialog'); expect(dlg).to_be_visible(); fp.wait_for_url(re.compile(r'/p/[0-9a-f-]{36}$')); expect(dlg.get_by_text('1 of 4')).to_be_visible()
                dlg.locator('.photo img').first.wait_for(); fp.wait_for_function("document.querySelector('dialog .photo img').complete && document.querySelector('dialog .photo img').naturalWidth >= 1000", timeout=15000)
                fp.keyboard.press('ArrowRight'); expect(dlg.get_by_text('2 of 4')).to_be_visible(); dlg.get_by_role('button', name='Like post').click(); expect(dlg.get_by_role('button', name='Unlike post')).to_be_visible()
                fp.screenshot(path=os.path.join(SHOTS, 'post-modal-1440.png')); fp.keyboard.press('Escape'); expect(dlg).to_have_count(0); fp.wait_for_url(f"**/@{owner['handle']}")
                assert helper('query', 'notifications', 'recipient_id', owner['id']), 'the like reached the owner'
            T('REAL: a tile opens the full image in a dialog with its own URL, arrows move, like works, Escape returns', viewer_modal)
            def counts_and_lists():
                goto(fp, f"/@{owner['handle']}"); expect(fp.get_by_test_id('counts')).to_contain_text('1'); fp.get_by_role('button', name=re.compile('follower')).click(); dlg = fp.get_by_role('dialog'); expect(dlg.get_by_text('Faisal Follower')).to_be_visible(); fp.keyboard.press('Escape')
            T('REAL: the follower sees the followers list', counts_and_lists)

            # ---------------- transitions through the UI ----------------
            def stranger_pending_then_public():
                goto(sp, f"/@{owner['handle']}"); sp.get_by_test_id('lock-panel').get_by_role('button', name='Request to follow').click(); expect(sp.get_by_role('button', name='Requested')).to_be_visible()
                set_account_type(op, owner['id'], 'Public')
                row = [r for r in helper('query', 'follows', 'follower_id', strg['id'])][0]; assert row['status'] == 'pending', 'going public does NOT approve a pending request'
                goto(sp, f"/@{owner['handle']}"); grid_loaded(sp, 4); expect(sp.get_by_role('button', name='Requested')).to_be_visible()
                set_account_type(op, owner['id'], 'Private')
                goto(sp, f"/@{owner['handle']}"); expect(sp.get_by_role('heading', name='Request sent')).to_be_visible(); expect(tiles(sp)).to_have_count(0)  # they had asked, so the panel says so
            T('REAL: private to public keeps a pending request pending but opens the grid; back to private hides it again at once', stranger_pending_then_public)
            def owner_toggles():
                goto(op, '/settings'); op.get_by_label('Show my profile picture to everyone').click(); expect(op.get_by_text('Saved.')).to_be_visible()
                assert helper('query', 'profiles', 'user_id', owner['id'])[0]['show_avatar_to_everyone'] is True
                goto(sp, f"/@{owner['handle']}"); sp.wait_for_function("document.querySelector('.ph-avatar .avatar img') && !document.querySelector('.ph-avatar .avatar[data-blurred=true]')", timeout=15000)
                goto(op, '/settings'); op.get_by_label('Show my profile picture to everyone').click(); expect(op.get_by_text('Saved.').first).to_be_visible()
                op.get_by_label('Let people find me by @username or name').click(); expect(op.get_by_text('Saved.').first).to_be_visible()
                goto(sp, '/search'); sp.get_by_role('combobox', name='Search people').fill(owner['handle'][:8]); expect(sp.get_by_role('heading', name='No one found')).to_be_visible()
                goto(op, '/settings'); op.get_by_label('Let people find me by @username or name').click(); expect(op.get_by_text('Saved.').first).to_be_visible()
            T('REAL: "show my picture to everyone" reveals only the avatar; opting out of search removes the account from results', owner_toggles)
            def owner_removes_follower():
                goto(op, '/connections'); op.get_by_role('tab', name=re.compile('^Followers')).click(); row = op.get_by_test_id('person-row').filter(has_text='Faisal'); expect(row).to_be_visible()
                row.get_by_role('button', name='Remove').click(); op.get_by_role('dialog').get_by_role('button', name='Remove').click(); expect(row).to_have_count(0)
                goto(fp, f"/@{owner['handle']}"); expect(fp.get_by_role('heading', name='This account is private')).to_be_visible(); expect(tiles(fp)).to_have_count(0)
                assert not [r for r in helper('query', 'follows', 'follower_id', foll['id']) if r['followee_id'] == owner['id']]
            T('REAL: removing a follower puts the lock back for them straight away', owner_removes_follower)

            # ---------------- client pipeline in a real browser ----------------
            def composer_pipeline():
                goto(op, '/feed'); btn(op, 'New post').click(); op.locator('input[data-testid=post-file]').set_input_files(FIX + '/p1.png'); expect(op.get_by_alt_text('Preview of your photo')).to_be_visible()
                dlg = op.get_by_role('dialog'); dlg.get_by_label('Caption').fill('Posted from a real browser'); dlg.get_by_role('button', name='Post', exact=True).click(); expect(op.get_by_text('Posted for your followers.')).to_be_visible()
                row = [r for r in helper('query', 'post_media', 'user_id', owner['id']) if r['thumb_path'] and r['blurhash'] and r['id'] not in {x['id'] for x in rows0}][0]
                assert row['width'] >= 400 and row['height'] >= 400 and row['kind'] == 'image' and re.fullmatch(r'[0-9A-Za-z#$%*+,.:;=?@\[\]^_{|}~-]{6,120}', row['blurhash']), row
                assert row['thumb_path'] != row['storage_path']
            rows0 = []
            def snap_rows(): rows0.extend(helper('query', 'post_media', 'user_id', owner['id']))
            snap_rows()
            T('REAL: posting from the browser stores an original, a ~400 px thumbnail, its size and a blurhash', composer_pipeline)
            def avatar_blurhash():
                ava = helper('dating-user', 'Ava Avatar', 'woman', 'men', 'lisbon'); assert helper('query', 'profiles', 'user_id', ava['id'])[0]['avatar_blurhash'] is None, 'starts without a blurhash'
                gp = user_page(ava); goto(gp, '/me/edit'); expect(gp.get_by_label('Avatar photo')).to_be_visible(); gp.get_by_label('Zoom').fill('1.4'); btn(gp, 'Save avatar').click(); expect(gp.get_by_text('Avatar saved.')).to_be_visible()
                bh = helper('query', 'profiles', 'user_id', ava['id'])[0]['avatar_blurhash']; assert bh and re.fullmatch(r'[0-9A-Za-z#$%*+,.:;=?@\[\]^_{|}~-]{6,120}', bh), f'blurhash computed in the browser from the stored photo: {bh}'
                gp.context.close()
            T('REAL: saving an avatar computes its blurhash in the browser', avatar_blurhash)

            # ---------------- samples ----------------
            def sample_profiles():
                goto(sp, f"/@{meera['username']}"); expect(sp.get_by_text('Sample', exact=True).first).to_be_visible(); expect(sp.get_by_text('fictional person', exact=False).first).to_be_visible()
                sp.wait_for_selector('a.pgrid-tile', timeout=15000); btn(sp, 'Follow', True).click(); expect(sp.get_by_role('button', name='Following', exact=True)).to_be_visible()
                assert helper('query', 'notifications', 'recipient_id', meera['user_id']) == [], 'nothing reaches a sample'
                goto(sp, f"/@{kavya['username']}"); expect(sp.get_by_role('heading', name='This account is private')).to_be_visible(); expect(sp.get_by_text('never accept follow requests', exact=False)).to_be_visible(); expect(tiles(sp)).to_have_count(0)
                sp.get_by_test_id('lock-panel').get_by_role('button', name='Request to follow').click(); expect(sp.get_by_role('button', name='Requested')).to_be_visible(); sp.reload(); expect(sp.get_by_role('button', name='Requested')).to_be_visible()
                goto(sp, f"/@{meera['username']}"); sp.get_by_role('button', name='Profile options').click(); sp.get_by_role('menuitem', name='Report profile').click(); d = sp.get_by_role('dialog'); d.get_by_label('Spam or ads').check(); d.get_by_role('button', name='Save report').click()
                expect(d.get_by_text('This is sample content, so there is nobody to report.')).to_be_visible(); assert helper('query', 'content_reports', 'reporter_id', strg['id']) == []
            T('REAL samples: badge and notice, instant follow, private sample stays pending, nothing delivered, report refused with a clear message', sample_profiles)
            def following_feed_has_samples():
                goto(sp, '/feed'); R.wait_posts(sp, 3); mine = R.posts(sp).filter(has_text='Meera Velan'); assert mine.count() >= 3, 'the Following tab shows the public sample the stranger followed'
                expect(mine.first.get_by_text('Sample', exact=True)).to_be_visible(); assert R.posts(sp).filter(has_text='Kavya Pillai').count() == 0, 'a requested private sample shows nothing'
                sp.get_by_role('tab', name='Explore').click(); R.wait_posts(sp, 5); assert R.posts(sp).filter(has_text='Sample').count() >= 3
            T('REAL: Following shows the public sample you followed (never the private one you only asked), Explore is full of labelled samples', following_feed_has_samples)
            def sample_discover():
                goto(sp, '/settings'); sp.get_by_label('Show me in Discover').click(); expect(sp.get_by_text('Privacy settings saved.')).to_be_visible(); goto(sp, '/discover')
                card = sp.get_by_test_id('dating-card'); expect(card).to_be_visible(); seen = False
                for _ in range(40):
                    if card.get_by_text('Sample', exact=True).count(): seen = True; break
                    btn(sp, re.compile('^Pass on')).click(); card = sp.get_by_test_id('dating-card'); expect(card).to_be_visible()
                assert seen, 'a sample card appears in Discover'; expect(card.get_by_test_id('sample-note')).to_be_visible(); btn(sp, re.compile('^Like ')).click(); expect(sp.get_by_role('dialog')).to_have_count(0)
                assert helper('query', 'dating_actions', 'actor_id', strg['id']) == [], 'a like on a sample is not stored'; assert helper('query', 'matches', 'user_a', strg['id']) == []
            T('REAL samples in Discover: badge, honest note, a like stores nothing and never matches', sample_discover)
            def suggested_for_new():
                newbie = helper('profile-user', 'Nia Newcomer', 'public', '0'); np_ = user_page(newbie); goto(np_, '/feed'); box = np_.get_by_test_id('suggested'); expect(box).to_be_visible(); expect(box.get_by_text('Sample', exact=True).first).to_be_visible()
                names = box.inner_text(); assert 'kavya.pillai' not in names, 'private accounts are never suggested'; np_.context.close()
            T('REAL: a brand-new account sees a Suggested row of public accounts', suggested_for_new)

            # ---------------- nothing private on the wire ----------------
            def wire_scan():
                bad = [u for u, txt in wire if FORBIDDEN.search(txt)]; assert not bad, f'forbidden keys in: {bad[:3]}'
                assert not any(re.search(r'@lovoki-e2e\.test|@sample\.lovoki\.invalid', t) for _, t in wire), 'no email address in any response'
                assert len(wire) > 10
            T(f'REAL: no private key or email in any response the stranger received', wire_scan)

            # ---------------- layout and screenshots ----------------
            if '--visuals' in sys.argv:
                for w_, h_, scheme in [(390, 844, 'light'), (390, 844, 'dark'), (768, 1024, 'light'), (768, 1024, 'dark'), (1440, 900, 'light'), (1440, 900, 'dark')]:
                    tag = f'{w_}-{scheme}'
                    for who, user in [('stranger', strg)]:
                        lp = user_page(user, w_, h_, scheme)
                        for name, path_, ready in [('private-profile', f"/@{owner['handle']}", '[data-testid=lock-panel]'), ('sample', f"/@{meera['username']}", 'a.pgrid-tile'), ('search', '/search?q=mee', '[role=option]'), ('settings', '/settings', '[data-testid=privacy-overview]')]:
                            def layout(lp=lp, name=name, path_=path_, ready=ready):
                                goto(lp, path_); lp.wait_for_selector(ready, timeout=15000)
                                if lp.locator('a.pgrid-tile').count(): lp.wait_for_function("[...document.querySelectorAll('a.pgrid-tile img')].every(i => i.complete)", timeout=15000)
                                assert overflow(lp) <= 0, f'{tag} {who} {name}: overflow {overflow(lp)}px'
                                if w_ == 390: small = [t for t in small_targets(lp) if not t['n'].startswith('Skip')]; assert not small, f'{tag} {who} {name}: targets under 44px {small[:4]}'
                                lp.screenshot(path=os.path.join(SHOTS, f'{tag}_{who}_{name}.jpg'), type='jpeg', quality=70)
                            T(f'REAL layout {tag} {who}: {name}', layout)
                        lp.context.close()
            b.close()
    finally:
        R.stop_server(server)
        node('seed-sample-content.mjs', '--remove', '--yes', env=seed_env)
    bad = [r for r in results if r[0] == 'FAIL']
    print(f"PASS count: {sum(1 for r in results if r[0] == 'PASS')} FAIL count: {len(bad)}"); print('page errors:', sorted(set(page_errors))[:6]); print('leaked:', R.leaked[:3])
    sys.exit(1 if bad or page_errors or R.leaked else 0)

if __name__ == '__main__': main()
