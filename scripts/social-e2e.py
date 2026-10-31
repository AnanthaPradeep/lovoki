"""Phase 3 browser tests of the social UI, driven by IN-MEMORY FAKES (vite --mode uitest, port 5174).
NOT a Supabase test: posts, follows, blocks and notifications live in FakeSocialWorld. It verifies behaviour, states and layout.
The real database rules are proven by tests/integration; the real-stack browser flow is scripts/real-e2e.py.

Run:  npm run dev:uitest   then   python scripts/social-e2e.py [--visuals-only]"""
import importlib.util, os, re, sys, uuid
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from e2e_common import FIX, ROOT
from playwright.sync_api import sync_playwright, expect

spec = importlib.util.spec_from_file_location('uie2e', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ui-e2e.py'))
U = importlib.util.module_from_spec(spec); spec.loader.exec_module(U)  # reuse the helpers; main() is guarded by __name__
go, btn, new_page, T, results, CUR, page_errors = U.go, U.btn, U.new_page, U.T, U.results, U.CUR, U.page_errors

SHOTS = os.path.join(ROOT, 'docs', 'screenshots', 'phase3'); os.makedirs(SHOTS, exist_ok=True); U.SHOTS = SHOTS
ME = "[...window.__fake.socials.values()][0]"
SEED = {'ana': '00000000-0000-4000-8000-0000000000a1', 'ben': '00000000-0000-4000-8000-0000000000b2', 'cleo': '00000000-0000-4000-8000-0000000000c3'}

def api_calls(pg, name): return pg.evaluate(f"{ME}.calls.filter(c => c === '{name}').length")
def world(pg, js):
    """Runs JS against the fake world. `js` is either an expression or a { ... } statement block (use `return` inside it to return a value)."""
    body = js if js.lstrip().startswith('{') else f'return ({js});'
    return pg.evaluate(f"(() => {{ const w = window.__fake.world; const me = {ME}.me; {body} }})()")
def post(pg, text): return pg.locator('article.post', has_text=text).first
def posts(pg): return pg.locator('article.post')
def wait_posts(pg, n=1): pg.wait_for_function(f"document.querySelectorAll('article.post').length >= {n}", timeout=6000)
def overflow(pg): return pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")

def small_targets(pg):
    """Interactive elements that are visible and smaller than 44px in either direction (inline body links are exempt)."""
    return pg.evaluate("""() => [...document.querySelectorAll('button, a.btn, a.icon-btn, input:not([type=hidden]):not([type=file]), textarea, select, [role=tab], [role=menuitem], .link-btn')]
      .filter(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !e.closest('[hidden]') && !e.closest('.sr-only') && !(e.classList.contains('switch')); })
      .map(e => { const r = e.getBoundingClientRect(); return { n: (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter(x => x.h < 44 || x.w < 44)""")

def main(visuals_only=False):
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = new_page(b); CUR['pg'] = pg
        email = f'social.{uuid.uuid4().hex[:6]}@example.com'
        U.signup_confirm_login(pg, email); U.finish_onboarding(pg)
        pg.set_default_timeout(5000)
        go(pg, '/feed')

        if not visuals_only:
            # ------------------------------------------------------------------ M3 feed
            def feed_tabs():
                expect(pg.get_by_role('heading', name='Feed', exact=True)).to_be_visible()
                expect(pg.get_by_role('tab', name='Following')).to_have_attribute('aria-selected', 'true')
                expect(pg.get_by_role('heading', name='Nothing here yet')).to_be_visible()
                assert posts(pg).count() == 0
            T('feed: Following starts empty with an honest empty state', feed_tabs)

            def explore_paging():
                pg.get_by_role('tab', name='Explore').click(); wait_posts(pg, 15)
                assert posts(pg).count() == 15, f'first page shows 15, got {posts(pg).count()}'
                body = pg.inner_text('main')
                assert 'followers-only post' not in body and 'Ben post' not in body, 'followers-only content must not appear in Explore'
                btn(pg, 'Load more').click(); pg.wait_for_function("document.querySelectorAll('article.post').length >= 19", timeout=6000)
                assert posts(pg).count() == 19, f'second page completes the list, got {posts(pg).count()}'
                ids = pg.evaluate("[...document.querySelectorAll('article.post')].map(a => a.dataset.postId)"); assert len(ids) == len(set(ids)), 'no duplicates'
                expect(btn(pg, 'Load more')).to_have_count(0)
            T('feed: Explore pages with Load more, no duplicates, no followers-only content', explore_paging)

            def load_more_error():
                pg.evaluate(f"{ME}.failNext('network', 1, 'feed')"); go(pg, '/feed'); pg.get_by_role('tab', name='Explore').click(); wait_posts(pg, 15)
                pg.evaluate(f"{ME}.failNext('network', 1, 'feed')"); btn(pg, 'Load more').click()
                expect(pg.get_by_text('Can’t reach LOVOKI').or_(pg.get_by_text('fake network')).first).to_be_visible()
                assert posts(pg).count() == 15, 'a failed page must not wipe the list'
                btn(pg, 'Try again').click(); pg.wait_for_function("document.querySelectorAll('article.post').length === 19", timeout=6000)
            T('feed: a failed "Load more" keeps the list and retries', load_more_error)

            def initial_error():
                go(pg, '/connections'); pg.evaluate(f"{ME}.failNext('network', 2, 'feed')"); pg.get_by_role('link', name='Feed', exact=True).first.click()  # client-side nav keeps the same api; 2 because React StrictMode runs the load effect twice in dev
                expect(pg.get_by_role('alert').or_(pg.locator('.notice-error')).first).to_be_visible()
                btn(pg, 'Try again').click(); expect(pg.get_by_role('heading', name='Nothing here yet')).to_be_visible()
            T('feed: initial load failure shows an error with a working retry', initial_error)

            def skeleton_state():
                pg.evaluate(f"{ME}.latencyMs = 1500"); pg.get_by_role('tab', name='Explore').click()
                expect(pg.locator('[aria-label="Loading posts"]')).to_be_visible(); pg.evaluate(f"{ME}.latencyMs = 120"); wait_posts(pg, 15)
            T('feed: a loading skeleton shows while posts load', skeleton_state)

            def like_optimistic():
                a = post(pg, 'Ana public post 18'); lk = a.get_by_role('button', name='Like post')
                pg.evaluate(f"{ME}.latencyMs = 700"); lk.click()
                expect(a.get_by_role('button', name='Unlike post')).to_have_attribute('aria-pressed', 'true', timeout=300)  # before the server answered
                expect(a.locator('.count').first).to_have_text('1', timeout=300)
                pg.evaluate(f"{ME}.latencyMs = 120"); pg.wait_for_timeout(900)
                expect(a.locator('.count').first).to_have_text('1')
            T('like: updates at once (optimistic) and settles on the server count', like_optimistic)

            def like_rollback_retry():
                a = post(pg, 'Ana public post 17'); before = api_calls(pg, 'like')
                pg.evaluate(f"{ME}.failNext('network', 1, 'like')"); a.get_by_role('button', name='Like post').click()
                expect(pg.get_by_text('Can’t reach LOVOKI').or_(pg.get_by_text('fake network')).first).to_be_visible()
                expect(a.get_by_role('button', name='Like post')).to_have_attribute('aria-pressed', 'false'); expect(a.locator('.count').first).to_have_text('0')
                pg.locator('.toast').get_by_role('button', name='Retry').click(); expect(a.get_by_role('button', name='Unlike post')).to_have_attribute('aria-pressed', 'true')
                assert api_calls(pg, 'like') == before + 2
            T('like: a failure rolls back with a Retry that works', like_rollback_retry)

            def like_double_click():
                a = post(pg, 'Ana public post 16'); before = api_calls(pg, 'like') + api_calls(pg, 'unlike'); lk = a.get_by_role('button', name='Like post')
                lk.dblclick(); pg.wait_for_timeout(700)
                assert api_calls(pg, 'like') + api_calls(pg, 'unlike') == before + 1, 'a double click sends one request'
            T('like: double click is a single request (duplicate-submit protection)', like_double_click)

            def save_private():
                a = post(pg, 'Ana public post 15'); a.get_by_role('button', name='Save post').click()
                expect(pg.get_by_text('Only you can see your saved posts')).to_be_visible(); expect(a.get_by_role('button', name='Remove from saved')).to_have_attribute('aria-pressed', 'true')
            T('save: toggles and says saves are private', save_private)

            def comments_flow():
                a = post(pg, 'Ana public post 14'); a.get_by_role('button', name=re.compile('^Comments')).click()
                expect(a.get_by_text('No comments yet')).to_be_visible()
                box = a.get_by_label('Add a comment'); box.fill('x' * 301)
                expect(a.get_by_role('button', name='Post comment')).to_be_disabled(); expect(a.locator('.counter[data-over="true"]')).to_be_visible()
                box.fill('First!'); a.get_by_role('button', name='Post comment').click()
                expect(a.locator('.comment', has_text='First!')).to_be_visible(); expect(a.get_by_role('button', name=re.compile('^Comments \\(1\\)'))).to_be_visible()
                a.get_by_role('button', name='Delete comment by You').click(); expect(a.locator('.comment', has_text='First!')).to_have_count(0)
                expect(a.get_by_role('button', name=re.compile('^Comments \\(0\\)'))).to_be_visible()
            T('comments: add, character limit, delete, counts', comments_flow)

            def comments_paging():
                pid = pg.evaluate("[...document.querySelectorAll('article.post')].find(a => a.textContent.includes('Ana public post 13')).dataset.postId")
                world(pg, f"{{ for (let i = 0; i < 20; i++) w.comments.push({{ id: crypto.randomUUID(), postId: '{pid}', authorId: '{SEED['cleo']}', body: 'c' + i, seq: w.next() }}); }}")
                go(pg, '/feed'); pg.get_by_role('tab', name='Explore').click(); wait_posts(pg, 15)
                a = post(pg, 'Ana public post 13'); a.get_by_role('button', name=re.compile('^View 20 comments')).click()
                expect(a.locator('.comment')).to_have_count(15); a.get_by_role('button', name='Load more').click(); expect(a.locator('.comment')).to_have_count(20)
            T('comments: inline thread is paginated with Load more', comments_paging)

            def report_flow():
                a = post(pg, 'Ana public post 12'); a.get_by_role('button', name='Post options').click(); pg.get_by_role('menuitem', name='Report post').click()
                dlg = pg.get_by_role('dialog'); expect(dlg.get_by_text('saved for review')).to_be_visible()
                assert 'action was taken' not in dlg.inner_text().lower() and 'has been removed' not in dlg.inner_text().lower()
                dlg.get_by_role('button', name='Save report').click(); expect(dlg.get_by_text('Choose a reason.')).to_be_visible()
                dlg.get_by_label('Spam or ads').check(); dlg.get_by_role('button', name='Save report').click()
                expect(pg.get_by_text('Report saved for review.')).to_be_visible(); assert world(pg, "w.reports.length") == 1
            T('report: asks for a reason, says "saved for review", never claims action was taken', report_flow)

            def block_flow():
                a = post(pg, 'Ana public post 11'); a.get_by_role('button', name='Post options').click(); pg.get_by_role('menuitem', name='Block Ana Test').click()
                dlg = pg.get_by_role('dialog'); expect(dlg.get_by_text('They aren’t told')).to_be_visible(); dlg.get_by_role('button', name='Block', exact=True).click()
                expect(pg.get_by_text('Ana Test is blocked.')).to_be_visible(); expect(pg.locator('article.post', has_text='Ana public post')).to_have_count(0)
                go(pg, f"/u/{SEED['ana']}"); expect(pg.get_by_role('heading', name='This profile isn’t available')).to_be_visible()
            T('block: removes their posts at once and their profile becomes unavailable', block_flow)

            def settings_blocked():
                go(pg, '/settings'); li = pg.get_by_role('list', name='Blocked accounts'); expect(li.get_by_text('Ana Test')).to_be_visible()
                li.get_by_role('button', name='Unblock').click(); expect(pg.get_by_text('You haven’t blocked anyone.')).to_be_visible()
                go(pg, f"/u/{SEED['ana']}"); expect(pg.get_by_test_id('handle')).to_have_text('@ana.test')
            T('settings: blocked accounts list with Unblock; unblocking restores the profile', settings_blocked)

            # ------------------------------------------------------------------ composer
            def composer():
                go(pg, '/feed'); btn(pg, 'New post').click(); dlg = pg.get_by_role('dialog')
                dlg.get_by_role('button', name='Post', exact=True).click(); expect(dlg.get_by_text('Write something or add a photo.')).to_be_visible()
                cap = dlg.get_by_label('Caption'); cap.fill('y' * 2201); expect(dlg.locator('.counter[data-over="true"]')).to_be_visible()
                dlg.get_by_role('button', name='Post', exact=True).click(); expect(dlg.get_by_text('Keep it to 2200 characters.')).to_be_visible()
                dlg.get_by_role('radio', name=re.compile('Followers')).check()
                expect(dlg.get_by_test_id('audience-copy')).to_contain_text('Only people you’ve accepted as followers'); expect(dlg.get_by_text('screenshot')).to_be_visible()
                dlg.get_by_role('radio', name=re.compile('Public')).check(); expect(dlg.get_by_test_id('audience-copy')).to_contain_text('appear in Explore')
                dlg.get_by_test_id('post-file').set_input_files(FIX + '/p1.png'); expect(dlg.get_by_alt_text('Preview of your photo')).to_be_visible()
                dlg.get_by_test_id('post-file').set_input_files(FIX + '/fake.jpg'); expect(dlg.get_by_text(re.compile('isn’t a JPG, PNG or WebP|Use a JPG'))).to_be_visible()
                cap.fill('Sunday market haul'); dlg.get_by_role('button', name='Post', exact=True).click()
                expect(pg.get_by_text('Posted. Anyone on LOVOKI can see it.')).to_be_visible(); expect(post(pg, 'Sunday market haul')).to_be_visible()
            T('composer: validation, honest audience copy, image preview, bad file refused, publish shows the post', composer)

            def composer_retry_dup():
                btn(pg, 'New post').click(); dlg = pg.get_by_role('dialog'); dlg.get_by_label('Caption').fill('Retry me')
                pg.evaluate(f"{ME}.failNext('network', 1, 'createPost')"); dlg.get_by_role('button', name='Post', exact=True).click()
                expect(dlg.get_by_text(re.compile('Can’t reach LOVOKI|fake network'))).to_be_visible(); assert dlg.get_by_label('Caption').input_value() == 'Retry me', 'text is kept'
                pg.evaluate(f"{ME}.latencyMs = 600"); before = api_calls(pg, 'createPost')
                dlg.get_by_role('button', name='Try again').dblclick()
                pg.wait_for_function("window.__fake.world.posts.some(p => p.caption === 'Retry me')", timeout=6000); expect(dlg).to_have_count(0)
                assert api_calls(pg, 'createPost') == before + 1, 'double click is a single request'
                n_posts = world(pg, "w.posts.filter(p => p.caption === 'Retry me').length"); assert n_posts == 1, f'exactly one post, found {n_posts}'
                pg.evaluate(f"{ME}.latencyMs = 120")
            T('composer: failure keeps the text, retry works, double click posts once', composer_retry_dup)

            def own_post_menu():
                go(pg, '/me'); a = post(pg, 'Retry me'); a.get_by_role('button', name='Post options').click(); pg.get_by_role('menuitem', name='Make followers-only').click()
                expect(a.get_by_text('Followers only')).to_be_visible()
                a.get_by_role('button', name='Post options').click(); pg.get_by_role('menuitem', name='Delete post').click()
                pg.get_by_role('dialog').get_by_role('button', name='Delete', exact=True).click(); expect(pg.locator('article.post', has_text='Retry me')).to_have_count(0)
            T('own post: change audience and delete with confirmation', own_post_menu)

            def me_saved():
                world(pg, f"{{ const p = w.posts.find(x => x.caption === 'Ana public post 1'); w.saves.add(p.id + '|' + me); }}"); go(pg, '/me')
                pg.get_by_role('tab', name='Saved').click(); expect(post(pg, 'Ana public post 1')).to_be_visible(); expect(pg.get_by_text('Only you can see what you’ve saved')).to_be_visible()
            T('profile: Your posts and Saved tabs', me_saved)

            # ------------------------------------------------------------------ M4 people
            def other_profile():
                go(pg, f"/u/{SEED['ana']}"); expect(pg.get_by_test_id('handle')).to_have_text('@ana.test'); expect(pg.get_by_text('Ana Test, 31', exact=True)).to_be_visible()
                html = pg.content().lower(); assert 'date_of_birth' not in html and 'dateofbirth' not in html and 'discoverab' not in html, 'no private fields in the DOM'
                expect(pg.get_by_test_id('counts')).to_contain_text('posts'); btn(pg, 'Follow', True).click()
                expect(pg.get_by_role('button', name='Following', exact=True)).to_be_visible(); expect(pg.get_by_role('link', name=re.compile('Ana public post 18'))).to_be_visible()
            T('profile of another person: social fields only, follow works, posts listed', other_profile)

            def restricted_profile():
                go(pg, f"/u/{SEED['ben']}"); expect(pg.get_by_test_id('handle')).to_have_text('@ben.test'); expect(pg.get_by_role('heading', name='This account is private')).to_be_visible()
                assert 'Test profile: Ben Test' in pg.inner_text('main'), 'D3: the bio of a private account stays visible'; expect(pg.get_by_text('Ben post')).to_have_count(0); expect(pg.locator('.pgrid-tile')).to_have_count(0)
                btn(pg, 'Request to follow').click(); expect(pg.get_by_role('button', name='Requested')).to_be_visible(); expect(pg.get_by_role('heading', name='Request sent')).to_be_visible()
            T('private profile: handle, name and bio, lock panel, request to follow, shows Requested', restricted_profile)

            def connections_lists():
                go(pg, '/connections'); expect(pg.get_by_role('heading', name='Connections')).to_be_visible()
                expect(pg.get_by_test_id('person-row')).to_have_count(2); expect(pg.get_by_text('Waiting for them to accept')).to_be_visible()
                pg.get_by_test_id('person-row').filter(has_text='Ben Test').get_by_role('button', name='Cancel request').click(); expect(pg.get_by_test_id('person-row')).to_have_count(1)
                pg.get_by_role('tab', name=re.compile('^Matches')).click(); expect(pg.get_by_role('heading', name='No matches yet')).to_be_visible()
                pg.get_by_role('tab', name=re.compile('^Following')).click()
                pg.get_by_test_id('person-row').get_by_role('button', name='Unfollow').click(); expect(pg.get_by_role('heading', name='You’re not following anyone')).to_be_visible()
            T('connections: Following with requested state, cancel, unfollow; Matches is honestly empty', connections_lists)

            def requests_flow():
                go(pg, '/settings'); pg.get_by_role('group', name='Social visibility').get_by_role('button', name='Private').click(); expect(pg.get_by_text('Your account is private.')).to_be_visible()
                world(pg, f"{{ w.follows.set('{SEED['cleo']}>' + me, 'pending'); w.notify(me, '{SEED['cleo']}', 'follow_request'); w.follows.set('{SEED['ben']}>' + me, 'pending'); w.notify(me, '{SEED['ben']}', 'follow_request'); }}")
                go(pg, '/connections'); pg.get_by_role('tab', name=re.compile('^Requests')).click(); expect(pg.get_by_test_id('person-row')).to_have_count(2)
                pg.get_by_test_id('person-row').filter(has_text='Cleo').get_by_role('button', name='Accept').click(); expect(pg.get_by_test_id('person-row')).to_have_count(1)
                pg.get_by_test_id('person-row').filter(has_text='Ben').get_by_role('button', name='Decline').click(); expect(pg.get_by_role('heading', name='No follow requests')).to_be_visible()
                assert world(pg, f"w.follows.get('{SEED['cleo']}>' + me)") == 'accepted' and world(pg, f"w.follows.get('{SEED['ben']}>' + me)") is None
                pg.get_by_role('tab', name=re.compile('^Followers')).click(); expect(pg.get_by_test_id('person-row')).to_have_count(1)
                pg.get_by_test_id('person-row').get_by_role('button', name='Remove').click(); pg.get_by_role('dialog').get_by_role('button', name='Remove').click()
                expect(pg.get_by_role('heading', name='No followers yet')).to_be_visible()
                go(pg, '/settings'); pg.get_by_role('group', name='Social visibility').get_by_role('button', name='Public').click(); expect(pg.get_by_text('Your account is public.')).to_be_visible()
            T('requests: accept, decline, remove follower, with counts', requests_flow)

            def notifications_flow():
                go(pg, '/me'); expect(pg.get_by_role('link', name='Notifications', exact=True).first).to_be_visible()
                pid = world(pg, f"{{ const id = w.addPost(me, 'Post that gets attention', 'public'); w.likes.add(id + '|{SEED['ana']}'); w.notify(me, '{SEED['ana']}', 'like', id); const c = {{ id: crypto.randomUUID(), postId: id, authorId: '{SEED['cleo']}', body: 'nice', seq: w.next() }}; w.comments.push(c); w.notify(me, '{SEED['cleo']}', 'comment', id, c.id); return id; }}")
                pg.evaluate("window.dispatchEvent(new Event('focus'))")
                expect(pg.get_by_role('link', name=re.compile('Notifications, \\d+ unread')).first).to_be_visible(); n = world(pg, "w.notes.filter(x => x.recipient === me && !x.read).length")
                expect(pg.get_by_role('link', name=f'Notifications, {n} unread').first).to_be_visible()
                pg.get_by_role('link', name=re.compile('Notifications, \\d+ unread')).first.click(); expect(pg.get_by_role('heading', name='Notifications', exact=True)).to_be_visible()
                expect(pg.get_by_test_id('notification').filter(has_text='Ana Test liked your post')).to_be_visible(); expect(pg.get_by_test_id('notification').filter(has_text='Cleo Test commented on your post')).to_be_visible()
                expect(pg.get_by_text('New').first).to_be_visible(); pg.wait_for_function("window.__fake.world.notes.every(n => n.read || n.recipient !== [...window.__fake.socials.values()][0].me)", timeout=5000)
                expect(pg.get_by_role('link', name='Notifications', exact=True).first).to_be_visible()
            T('notifications: badge refreshes on focus, screen lists them, opening marks them read', notifications_flow)

            def notification_request_actions():
                world(pg, f"{{ w.follows.set('{SEED['ben']}>' + me, 'pending'); w.notify(me, '{SEED['ben']}', 'follow_request'); }}"); go(pg, '/notifications')
                row = pg.get_by_test_id('notification').filter(has_text='asked to follow you'); row.get_by_role('button', name='Accept').click()
                expect(row.get_by_role('button', name='Accept')).to_have_count(0); assert world(pg, f"w.follows.get('{SEED['ben']}>' + me)") == 'accepted'
            T('notifications: follow requests can be accepted in place', notification_request_actions)

            def empty_notifications_and_posts():
                pg2 = new_page(b); email2 = f'empty.{uuid.uuid4().hex[:6]}@example.com'; U.signup_confirm_login(pg2, email2); U.finish_onboarding(pg2); go(pg2, '/notifications')
                expect(pg2.get_by_role('heading', name='Nothing yet')).to_be_visible(); go(pg2, '/me'); expect(pg2.get_by_role('heading', name='No posts yet')).to_be_visible()
                body = pg2.inner_text('body'); assert not any(n in body for n in ['Maya', 'Kofi', 'Sofía', 'Arjun']), 'real mode never shows demo people'; pg2.context.close()
            T('empty states for a brand-new account; no demo people', empty_notifications_and_posts)

            def demo_guard():
                go(pg, '/discover'); expect(pg.get_by_role('heading', name='Dating is paused')).to_be_visible()
                go(pg, '/messages'); expect(pg.get_by_role('heading', name='Messaging isn’t live yet')).to_be_visible()
            T('Discover starts honestly paused; Messages remains a Phase 5 screen', demo_guard)

            def reduced_motion_real():
                """Asserts what reduced motion DOES: animated elements stop animating. Compares against a no-preference context."""
                probe = "(() => { const d = document.createElement('div'); d.className = 'skeleton'; const s = document.createElement('span'); s.className = 'spinner'; document.body.append(d, s); " \
                        "const r = { shimmer: getComputedStyle(d, '::after').animationDuration, spin: getComputedStyle(s).animationDuration, trans: getComputedStyle(document.querySelector('.btn') || d).transitionDuration }; d.remove(); s.remove(); return r; })()"
                full = new_page(b); go(full, '/welcome'); a = full.evaluate(probe); full.context.close()
                red = new_page(b, reduced=True); go(red, '/welcome'); c = red.evaluate(probe); red.context.close()
                sec = lambda v: float(v.split(',')[0].replace('ms', '')) / (1000 if v.strip().endswith('ms') else 1) if 'ms' in v else float(v.split(',')[0].replace('s', ''))
                assert sec(a['shimmer']) >= 1.0 and sec(a['spin']) >= 0.5, f'normal motion animates: {a}'
                assert sec(c['shimmer']) <= 0.001 and sec(c['spin']) <= 0.001, f'reduced motion removes animation: {c}'
                assert sec(c['trans']) <= 0.001, f'transitions are effectively off: {c}'
            T('prefers-reduced-motion: animations and transitions really stop (compared with normal motion)', reduced_motion_real)

            def first_frame_skeleton():
                pg3 = new_page(b)
                pg3.route(re.compile(r'/src/RealApp\.tsx'), lambda r: (pg3.wait_for_timeout(1200), r.continue_()))
                pg3.goto(U.BASE + '/welcome', wait_until='commit'); expect(pg3.get_by_test_id('app-skeleton')).to_be_visible(timeout=2500)
                expect(pg3.get_by_role('heading', name='Meet the person behind the profile.')).to_be_visible(timeout=8000); pg3.context.close()
            T('lazy app root shows a skeleton instead of a blank first frame', first_frame_skeleton)

        # ---------------------------------------------------------------------- M5 layout matrix
        for w_, h_, scheme in [(390, 844, 'light'), (390, 844, 'dark'), (768, 1024, 'light'), (768, 1024, 'dark'), (1440, 900, 'light'), (1440, 900, 'dark')]:
            tag = f'{w_}-{scheme}'
            lp = new_page(b, w_, h_, scheme); CUR['pg'] = lp
            U.signup_confirm_login(lp, f'lay.{uuid.uuid4().hex[:6]}@example.com'); U.finish_onboarding(lp); lp.set_default_timeout(5000)
            for name, path_ in [('feed', '/feed'), ('explore', '/feed'), ('connections', '/connections'), ('notifications', '/notifications'), ('profile', f"/u/{SEED['ana']}"),
                                ('restricted', f"/u/{SEED['ben']}"), ('me', '/me'), ('settings', '/settings')]:
                def layout():
                    go(lp, path_)
                    if name == 'explore': lp.get_by_role('tab', name='Explore').click(); wait_posts(lp, 15)
                    if name == 'profile': lp.wait_for_selector('.pgrid-tile', timeout=6000)
                    lp.wait_for_timeout(350)
                    o = overflow(lp); assert o <= 0, f'{tag} {name}: horizontal overflow {o}px'
                    if w_ == 390:
                        small = [t for t in small_targets(lp) if not t['n'].startswith('Skip')]
                        assert not small, f'{tag} {name}: touch targets under 44px: {small[:5]}'
                    if name in ('explore', 'profile', 'connections'):
                        lp.screenshot(path=os.path.join(SHOTS, f'{tag}_{name}.jpg'), type='jpeg', quality=70)
                T(f'layout {tag}: {name} has no overflow' + (' and 44px touch targets' if w_ == 390 else ''), layout)
            if w_ == 390 and scheme == 'light':
                def long_text_and_images():
                    go(lp, '/feed'); lp.get_by_role('tab', name='Explore').click(); wait_posts(lp, 15); btn(lp, 'Load more').click(); lp.wait_for_function("document.querySelectorAll('article.post').length >= 19")
                    a = post(lp, 'Cleo says hello'); a.scroll_into_view_if_needed(); box = a.bounding_box(); assert box['width'] <= 390, 'long unbroken text stays inside the card'
                    ratios = lp.evaluate("[...document.querySelectorAll('article.post .photo')].map(e => { const r = e.getBoundingClientRect(); return Math.round((r.height / r.width) * 100) / 100; })")
                    assert ratios and all(abs(r - 1.25) < 0.02 for r in ratios), f'post images keep a stable 4:5 box: {set(ratios)}'
                T('long text wraps and post images keep a stable 4:5 box', long_text_and_images)
                def keyboard_focus():
                    go(lp, '/feed'); lp.get_by_role('tab', name='Explore').click(); wait_posts(lp, 1)
                    lp.locator('article.post .post-actions button').first.focus(); lp.keyboard.press('Tab'); lp.keyboard.press('Shift+Tab')
                    ring = lp.evaluate("(() => { const s = getComputedStyle(document.activeElement); return { style: s.outlineStyle, width: parseFloat(s.outlineWidth), shadow: s.boxShadow }; })()")
                    assert ring['style'] != 'none' and ring['width'] >= 2 or ring['shadow'] != 'none', f'visible focus ring: {ring}'
                    lp.keyboard.press('Enter'); lp.wait_for_timeout(300)
                    assert lp.locator('article.post .post-actions button[aria-pressed="true"]').count() >= 1, 'Enter activates the focused like button'
                T('keyboard: focus ring is visible and Enter activates the like button', keyboard_focus)
                def dialog_keyboard():
                    go(lp, '/feed'); btn(lp, 'New post').click(); dlg = lp.get_by_role('dialog'); expect(dlg).to_be_visible()
                    lp.screenshot(path=os.path.join(SHOTS, f'{tag}_composer.jpg'), type='jpeg', quality=70)
                    lp.keyboard.press('Escape'); expect(dlg).to_have_count(0)
                    btn(lp, 'New post').click(); lp.get_by_role('dialog').get_by_label('Caption').fill('Draft only'); lp.get_by_role('dialog').get_by_role('button', name='Cancel').click()
                    assert world(lp, "w.posts.filter(p => p.caption === 'Draft only').length") == 0, 'Cancel never publishes (dialog buttons are type=button)'
                T('dialogs: Escape closes, Cancel never submits', dialog_keyboard)
            lp.context.close()
        CUR['pg'] = pg
        b.close()

if __name__ == '__main__':
    main('--visuals-only' in sys.argv)
    for r in results: print(*r)
    print('PASS count:', sum(1 for r in results if r[0] == 'PASS'), 'FAIL count:', sum(1 for r in results if r[0] == 'FAIL'))
    print('page errors:', sorted(set(page_errors))[:6])
    sys.exit(1 if any(r[0] == 'FAIL' for r in results) else 0)
