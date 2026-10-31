"""REAL-MODE browser suite against the LOCAL Supabase stack (Docker + Supabase CLI). No fakes anywhere:
real GoTrue (sign-up email via Mailpit), real PostgREST/RLS, real Storage signed URLs, real browser.

Prereqs: Docker running, `npx supabase start` (see docs/PHASE_3_SETUP.md), `pip install playwright pillow && playwright install chromium`,
and port 5173 free (the local auth redirect allow-list in supabase/config.toml names http://127.0.0.1:5173).
Run:  python scripts/real-e2e.py
This script starts its own Vite dev server in real mode with the LOCAL URL and anon key. The service key is used only by
scripts/real-e2e-helper.mjs to seed and inspect, never by the app."""
import json, os, re, subprocess, sys, time, urllib.parse, urllib.request, uuid
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from e2e_common import FIX, ROOT
from playwright.sync_api import sync_playwright, expect

BASE = 'http://127.0.0.1:5173'
SHOTS = os.path.join(ROOT, 'docs', 'screenshots', 'phase3'); os.makedirs(SHOTS, exist_ok=True)
PW = 'correct horse battery 9'
results, page_errors, leaked = [], [], []
CUR = {'pg': None}
NPX = 'npx.cmd' if os.name == 'nt' else 'npx'

HELPER_ENV = {}
def helper(*args):
    r = subprocess.run(['node', os.path.join(ROOT, 'scripts', 'real-e2e-helper.mjs'), *args], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=90, env={**os.environ, **HELPER_ENV})
    if r.returncode != 0: raise RuntimeError(f'helper {args[0]} failed: {(r.stderr or "").strip()[:900]}')
    return json.loads(r.stdout.strip().splitlines()[-1])

def T(name, fn):
    try: fn(); results.append(('PASS', name))
    except Exception as e:
        msg = (str(e).splitlines() or [repr(e)])[0][:260]; results.append(('FAIL', f'{name}: {msg}'))
        try: CUR['pg'].screenshot(path=os.path.join(SHOTS, 'FAIL-real-' + re.sub(r'[^a-z0-9]+', '-', name.lower())[:50] + '.png'))
        except Exception: pass
    print(*results[-1], flush=True)

def new_ctx(b, w=1440, h=1000, scheme='light'):
    ctx = b.new_context(viewport={'width': w, 'height': h}, color_scheme=scheme); ctx.set_default_timeout(8000)
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: page_errors.append(str(e)))
    pg.on('console', lambda m: page_errors.append('console: ' + m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    def watch(res):  # nothing private may ever cross the wire to another person's screen
        if re.search(r'/rest/v1/rpc/(social_profile|feed_page|profile_posts_page|comments_page|notifications_page|list_follows)', res.url):
            try: txt = res.text()
            except Exception: return
            if re.search(r'date_of_birth|dating_|discoverab|interested_in', txt): leaked.append(res.url)
    pg.on('response', watch)
    return pg

def goto(pg, path):
    pg.goto(BASE + path, wait_until='domcontentloaded')
    pg.wait_for_selector('main#main, .auth-shell, h1', timeout=15000)

def btn(pg, name, exact=False): return pg.get_by_role('button', name=name, exact=exact)
def posts(pg): return pg.locator('article.post')
def post(pg, text): return pg.locator('article.post', has_text=text).first
def wait_posts(pg, n=1): pg.wait_for_function(f"document.querySelectorAll('article.post').length >= {n}", timeout=15000)
def images_loaded(a): return a.evaluate("el => [...el.querySelectorAll('img')].filter(i => !i.closest('.avatar')).every(i => i.complete && i.naturalWidth > 0)")

def mail_link(mail, to, timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        with urllib.request.urlopen(f'{mail}/api/v1/search?query=' + urllib.parse.quote(f'to:{to}')) as r: data = json.load(r)
        if data.get('messages'):
            with urllib.request.urlopen(f"{mail}/api/v1/message/{data['messages'][0]['ID']}") as r: msg = json.load(r)
            m = re.search(r'href="(http[^"]+/auth/v1/verify[^"]+)"', msg.get('HTML', '')) or re.search(r'(http\S+/auth/v1/verify\S+)', msg.get('Text', ''))
            if m: return m.group(1).replace('&amp;', '&')
        time.sleep(0.5)
    raise RuntimeError(f'no confirmation email for {to}')

def login(pg, email, password):
    goto(pg, '/login'); pg.get_by_label('Email', exact=True).fill(email); pg.get_by_label('Password', exact=True).fill(password); btn(pg, 'Log in').click()
    pg.wait_for_url(re.compile(r'/(discover|feed|me|onboarding)'), timeout=15000)

def start_server(env):
    log = open(os.path.join(os.environ.get('TEMP', '/tmp'), 'lovoki-real-vite.log'), 'w')
    e = {**os.environ, **{k: v for k, v in env.items() if k.startswith('VITE_')}}
    proc = subprocess.Popen([NPX, 'vite', '--port', '5173', '--strictPort', '--host', '127.0.0.1'], cwd=os.path.join(ROOT, 'apps', 'web'), env=e, stdout=log, stderr=log, shell=(os.name == 'nt'))
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + '/', timeout=1); return proc
        except Exception: time.sleep(0.5)
    proc.kill(); raise RuntimeError('vite did not start on 5173 (is the port in use?)')

def stop_server(proc):
    if os.name == 'nt': subprocess.run(['taskkill', '/T', '/F', '/PID', str(proc.pid)], capture_output=True)
    else: proc.kill()

def onboard_via_ui(pg, name):
    pg.wait_for_url('**/onboarding/basics'); pg.locator('#displayName').fill(name); pg.locator('#dateOfBirth').fill('1996-04-18'); btn(pg, 'Continue').click()
    pg.wait_for_url('**/onboarding/about'); btn(pg, 'Cooking', True).click(); pg.locator('#bio').fill('Real browser test account.'); btn(pg, 'Continue').click()
    pg.wait_for_url('**/onboarding/preferences'); pg.get_by_label('Long-term partner').check(); pg.get_by_label('Women', exact=True).check(); btn(pg, 'Continue').click()
    pg.wait_for_url('**/onboarding/photos'); pg.locator('input[type=file]').set_input_files([FIX + '/p1.png', FIX + '/p2.jpg'])
    pg.wait_for_function("document.querySelectorAll('.photo-tile').length >= 2 && !document.querySelector('.photo-tile[data-busy=\"true\"]')", timeout=30000)
    btn(pg, 'Continue').click(); pg.wait_for_url('**/onboarding/privacy'); pg.locator('#areaLabel').fill('Lisbon'); btn(pg, 'Continue').click()
    pg.wait_for_url('**/onboarding/review'); btn(pg, 'Finish setup').click(); pg.wait_for_url('**/discover', timeout=15000)

def main():
    env = helper('env'); mail = env['MAIL']
    HELPER_ENV.update({'LOVOKI_HELPER_API_URL': env['VITE_SUPABASE_URL'], 'LOVOKI_HELPER_ANON': env['VITE_SUPABASE_ANON_KEY'], 'LOVOKI_HELPER_SERVICE': env.pop('_service'), 'LOVOKI_HELPER_MAIL': mail})  # in memory only
    try: urllib.request.urlopen(BASE + '/', timeout=1); raise SystemExit('Port 5173 is already serving something. Stop it first (the local auth redirect allow-list needs this exact origin).')
    except SystemExit: raise
    except Exception: pass
    seed = helper('seed'); B, G = seed['open'], seed['gate']; P = seed['posts']
    server = start_server(env)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            pg = new_ctx(b); CUR['pg'] = pg
            email = f'alice.{uuid.uuid4().hex[:6]}@lovoki-e2e.test'; state = {}

            def signup_and_confirm():
                goto(pg, '/signup'); pg.get_by_label('Email', exact=True).fill(email); pg.get_by_label('Password', exact=True).fill(PW); btn(pg, 'Create account').click()
                pg.wait_for_url('**/check-email'); link = mail_link(mail, email); pg.goto(link, wait_until='domcontentloaded')
                pg.wait_for_url('**/onboarding/basics', timeout=20000)
            T('REAL email: sign-up sends a confirmation mail, the link signs the user in and opens onboarding', signup_and_confirm)
            T('REAL onboarding through the UI with real photo uploads, finishing at the app', lambda: onboard_via_ui(pg, 'Alice Real'))
            state['me'] = None

            def my_id():
                goto(pg, '/me'); expect(pg.get_by_role('heading', name=re.compile('^Alice Real'))).to_be_visible()
                state['me'] = pg.evaluate("JSON.parse(localStorage.getItem('lovoki.auth')).user.id"); assert helper('query', 'profiles', 'user_id', state['me']), 'profile row exists'
            T('REAL profile persisted and shown', my_id)
            pg.evaluate("localStorage.setItem('lovoki.theme', 'light')")

            def explore():
                goto(pg, '/feed'); pg.get_by_role('tab', name='Explore').click(); wait_posts(pg, 1)
                a = post(pg, 'Beatrice public post with a picture'); expect(a).to_be_visible()
                pg.wait_for_function("document.querySelector('article.post img:not(.avatar img)')?.complete", timeout=15000); assert images_loaded(a), 'signed URL image really loaded'
                body = pg.inner_text('main'); assert 'Beatrice followers-only post' not in body and 'Gideon post behind a request' not in body, 'followers-only content is not in Explore'
            T('REAL Explore: public post with a real signed-URL image; followers-only content absent', explore)

            def like_persist():
                a = post(pg, 'Beatrice public post with a picture'); a.get_by_role('button', name='Like post').click(); expect(a.get_by_role('button', name='Unlike post')).to_be_visible()
                pg.wait_for_function("document.querySelector('article.post .count')?.textContent === '1'")
                assert len(helper('query', 'post_likes', 'post_id', P['p1'])) == 1, 'like stored in Postgres'
                pg.reload(); pg.get_by_role('tab', name='Explore').click(); wait_posts(pg, 1)
                a = post(pg, 'Beatrice public post with a picture'); expect(a.get_by_role('button', name='Unlike post')).to_have_attribute('aria-pressed', 'true')
            T('REAL like persists in Postgres and after a reload', like_persist)

            def comment_save():
                a = post(pg, 'Beatrice public post with a picture'); a.get_by_role('button', name=re.compile('^Comments')).click()
                a.get_by_label('Add a comment').fill('Lovely light!'); a.get_by_role('button', name='Post comment').click(); expect(a.locator('.comment', has_text='Lovely light!')).to_be_visible()
                a.get_by_role('button', name='Save post').click(); expect(a.get_by_role('button', name='Remove from saved')).to_be_visible()
                assert len(helper('query', 'post_comments', 'post_id', P['p1'])) == 1 and len(helper('query', 'post_saves', 'post_id', P['p1'])) == 1
                goto(pg, '/me'); pg.get_by_role('tab', name='Saved').click(); expect(post(pg, 'Beatrice public post')).to_be_visible()
            T('REAL comment and private save persist; Saved tab lists it', comment_save)

            def follow_public():
                goto(pg, f"/u/{B['id']}"); expect(pg.get_by_role('heading', name=re.compile('^Beatrice Open'))).to_be_visible()
                html = pg.content().lower(); assert 'date_of_birth' not in html
                btn(pg, 'Follow', True).click(); expect(pg.get_by_role('button', name='Following')).to_have_attribute('aria-pressed', 'true')
                assert helper('query', 'follows', 'follower_id', state['me'])[0]['status'] == 'accepted'
                goto(pg, '/feed'); wait_posts(pg, 2); expect(post(pg, 'Beatrice followers-only post')).to_be_visible()
            T('REAL follow of a public profile is accepted at once and unlocks their followers-only post in Following', follow_public)

            def follow_request():
                goto(pg, f"/u/{G['id']}"); expect(pg.get_by_text('This profile is followers-only')).to_be_visible(); assert 'Real e2e profile of Gideon' not in pg.inner_text('main')
                btn(pg, 'Request to follow').click(); expect(pg.get_by_role('button', name='Requested')).to_be_visible()
                goto(pg, '/feed'); wait_posts(pg, 2); assert 'Gideon post behind a request' not in pg.inner_text('main'), 'pending request shows nothing'
                helper('accept', G['email'], state['me'])
                pg.reload(); wait_posts(pg, 3); a = post(pg, 'Gideon post behind a request'); expect(a).to_be_visible()
                pg.wait_for_function("[...document.querySelectorAll('article.post')].find(a => a.textContent.includes('Gideon post'))?.querySelector('img:not(.avatar img)')?.complete", timeout=15000)
                assert images_loaded(a), 'followers-only image served after acceptance'
            T('REAL follow request stays pending (nothing visible), then acceptance unlocks posts and images', follow_request)

            def compose_with_image():
                goto(pg, '/feed'); btn(pg, 'New post').click(); dlg = pg.get_by_role('dialog')
                dlg.get_by_test_id('post-file').set_input_files(FIX + '/p1.png'); expect(dlg.get_by_alt_text('Preview of your photo')).to_be_visible()
                dlg.get_by_label('Caption').fill('Alice posts from a real browser'); dlg.get_by_role('radio', name=re.compile('Followers')).check()
                dlg.get_by_role('button', name='Post', exact=True).click(); expect(pg.get_by_text('Posted for your followers.')).to_be_visible()
                a = post(pg, 'Alice posts from a real browser'); expect(a).to_be_visible(); expect(a.get_by_text('Followers only')).to_be_visible()
                rows = helper('query', 'posts', 'author_id', state['me']); assert len(rows) == 1 and rows[0]['audience'] == 'followers'; state['post'] = rows[0]['id']
                assert len(helper('query', 'post_media', 'post_id', state['post'])) == 1, 'image registered'
                pg.reload(); wait_posts(pg, 1); a = post(pg, 'Alice posts from a real browser')
                pg.wait_for_function("[...document.querySelectorAll('article.post')].find(a => a.textContent.includes('Alice posts'))?.querySelector('img:not(.avatar img)')?.complete", timeout=15000); assert images_loaded(a)
            T('REAL composer: image post is stored, registered, and survives a reload', compose_with_image)

            # ---- another person's browser: notifications and visibility
            pb = new_ctx(b); CUR['pg'] = pb
            def other_person():
                login(pb, B['email'], B['password']); goto(pb, '/feed')
                expect(pb.get_by_role('link', name=re.compile('Notifications, \\d+ unread')).first).to_be_visible(timeout=15000)
                goto(pb, '/notifications'); expect(pb.get_by_test_id('notification').filter(has_text='Alice Real started following you')).to_be_visible()
                expect(pb.get_by_test_id('notification').filter(has_text='Alice Real liked your post')).to_be_visible(); expect(pb.get_by_test_id('notification').filter(has_text='Alice Real commented on your post')).to_be_visible()
                pb.wait_for_function("true"); rows = helper('query', 'notifications', 'recipient_id', B['id']); deadline = time.time() + 8
                while any(r['read_at'] is None for r in rows) and time.time() < deadline: time.sleep(0.4); rows = helper('query', 'notifications', 'recipient_id', B['id'])
                assert rows and all(r['read_at'] is not None for r in rows), 'opening the screen marked them read in Postgres'
                goto(pb, '/feed'); expect(pb.get_by_role('link', name='Notifications', exact=True).first).to_be_visible()
            T('REAL notifications for another person: follow, like and comment arrive, badge, read state persists', other_person)

            def audience_isolation():
                pb.get_by_role('tab', name='Explore').click(); wait_posts(pb, 1); assert 'Alice posts from a real browser' not in pb.inner_text('main'), 'Alice followers-only post is not visible to Beatrice (not a follower)'
                goto(pb, f"/u/{state['me']}"); expect(pb.get_by_text('This profile is followers-only').or_(pb.get_by_text('No posts yet'))).to_be_visible()
                assert 'Alice posts from a real browser' not in pb.inner_text('main')
            T('REAL isolation: a non-follower cannot see a followers-only post', audience_isolation)

            def like_notification_live():
                helper('like-as', B['email'], state['post']) if False else None
                pg.bring_to_front(); goto(pg, '/feed'); pg.evaluate("window.dispatchEvent(new Event('focus'))")
            # Beatrice likes Alice's post only after she follows: she needs access first
            def accept_then_like():
                goto(pb, f"/u/{state['me']}"); btn(pb, re.compile('Request to follow|Follow', re.I)).first.click()
                expect(pb.get_by_role('button', name='Requested').or_(pb.get_by_role('button', name='Following'))).to_be_visible()
                goto(pg, '/notifications'); expect(pg.get_by_test_id('notification').filter(has_text='asked to follow you').or_(pg.get_by_test_id('notification').filter(has_text='started following you'))).to_be_visible()
            T('REAL follow request arrives as a notification for the profile owner', accept_then_like)

            def report_and_block():
                pg.bring_to_front(); CUR['pg'] = pg; goto(pg, '/feed'); wait_posts(pg, 2)
                a = post(pg, 'Beatrice public post with a picture'); a.get_by_role('button', name='Post options').click(); pg.get_by_role('menuitem', name='Report post').click()
                dlg = pg.get_by_role('dialog'); dlg.get_by_label('Spam or ads').check(); dlg.get_by_role('button', name='Save report').click(); expect(pg.get_by_text('Report saved for review.')).to_be_visible()
                rep = helper('query', 'content_reports', 'reporter_id', state['me']); assert len(rep) == 1 and rep[0]['status'] == 'open' and rep[0]['target_id'] == P['p1']
                a = post(pg, 'Beatrice public post with a picture'); a.get_by_role('button', name='Post options').click(); pg.get_by_role('menuitem', name='Block Beatrice Open').click()
                pg.get_by_role('dialog').get_by_role('button', name='Block', exact=True).click(); expect(pg.get_by_text('Beatrice Open is blocked.')).to_be_visible()
                expect(pg.locator('article.post', has_text='Beatrice')).to_have_count(0)
                assert helper('query', 'blocks', 'blocker_id', state['me']), 'block stored'; assert not [f for f in helper('query', 'follows', 'follower_id', state['me']) if f['followee_id'] == B['id']], 'follow removed'
            T('REAL report is saved for review; block removes their posts and the follow', report_and_block)

            def blocked_both_ways():
                CUR['pg'] = pb; goto(pb, f"/u/{state['me']}"); expect(pb.get_by_role('heading', name='This profile isn’t available')).to_be_visible()
                goto(pb, '/feed'); wait_posts(pb, 1); assert 'Alice' not in pb.inner_text('main').replace('Alice Real started', ''), 'blocker invisible to the blocked person'
                CUR['pg'] = pg; goto(pg, f"/u/{B['id']}"); expect(pg.get_by_role('heading', name='This profile isn’t available')).to_be_visible()
                goto(pg, '/settings'); expect(pg.get_by_role('list', name='Blocked accounts').get_by_text('Beatrice Open')).to_be_visible()
                pg.get_by_role('list', name='Blocked accounts').get_by_role('button', name='Unblock').click(); expect(pg.get_by_text('You haven’t blocked anyone.')).to_be_visible()
                goto(pg, f"/u/{B['id']}"); expect(pg.get_by_role('heading', name=re.compile('^Beatrice Open'))).to_be_visible()
            T('REAL block hides both people from each other; Settings lists and unblocks', blocked_both_ways)

            def delete_post():
                goto(pg, '/me'); a = post(pg, 'Alice posts from a real browser'); a.get_by_role('button', name='Post options').click(); pg.get_by_role('menuitem', name='Delete post').click()
                pg.get_by_role('dialog').get_by_role('button', name='Delete', exact=True).click(); expect(pg.locator('article.post', has_text='Alice posts from a real browser')).to_have_count(0)
                assert not helper('query', 'posts', 'id', state['post']) and not helper('query', 'post_media', 'post_id', state['post']), 'post and media rows are gone'
            T('REAL delete removes the post and its media rows', delete_post)

            def overflow_real():
                m = new_ctx(b, 390, 844); goto(m, '/login'); m.get_by_label('Email', exact=True).fill(email); m.get_by_label('Password', exact=True).fill(PW); btn(m, 'Log in').click(); m.wait_for_url(re.compile(r'/(discover|feed|me)'))
                for path_ in ['/feed', '/connections', '/notifications', f"/u/{G['id']}", '/me', '/settings']:
                    goto(m, path_); m.wait_for_timeout(400); o = m.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth'); assert o <= 0, f'{path_} overflows by {o}px at 390'
                goto(m, '/feed'); m.get_by_role('tab', name='Explore').click(); wait_posts(m, 1); m.screenshot(path=os.path.join(SHOTS, 'real-390-light_explore.jpg'), type='jpeg', quality=70); m.context.close()
            T('REAL layout: no horizontal overflow at 390px on every social screen with real data', overflow_real)

            def logout_clears():
                CUR['pg'] = pg; goto(pg, '/settings'); pg.get_by_role('button', name='Log out').last.click(); pg.wait_for_url('**/welcome')
                assert pg.evaluate("Object.keys(localStorage).filter(k => k.startsWith('lovoki.user.')).length") == 0
                for r in ['/feed', '/connections', '/notifications', '/me']: goto(pg, r); pg.wait_for_url(re.compile('/login'), timeout=8000)
            T('REAL logout protects every social route', logout_clears)
            T('REAL privacy on the wire: no date of birth or dating fields in any social response seen by the browser', lambda: (_ for _ in ()).throw(AssertionError(f'leaked via {leaked[:2]}')) if leaked else None)
            b.close()
    finally:
        stop_server(server)

if __name__ == '__main__':
    main()
    for r in results: print(*r)
    print('PASS count:', sum(1 for r in results if r[0] == 'PASS'), 'FAIL count:', sum(1 for r in results if r[0] == 'FAIL'))
    print('page errors:', sorted(set(page_errors))[:6])
    sys.exit(1 if any(r[0] == 'FAIL' for r in results) else 0)
