"""Phase 4.5 browser tests of the Instagram-style profile screens, driven by IN-MEMORY FAKES (vite --mode uitest, port 5174).
NOT a Supabase test: who can see what in the database is proven by tests/integration/privacy45.int.test.ts and, in a real browser, by
scripts/real-e2e-profiles.py. This verifies the screens: header, grid, lock panel, viewer, search, suggestions, settings, samples, layout.

Run:  npm run dev:uitest   then   python scripts/profiles-e2e.py [--visuals]
Optional developer-tools check: a second server with  VITE_SHOW_DEV_TOOLS=true npm run dev -w @lovoki/web -- --mode uitest --port 5178 --host 127.0.0.1
and  python scripts/profiles-e2e.py --devtools-port=5178"""
import importlib.util, os, re, sys, uuid
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from e2e_common import SHOTS
from playwright.sync_api import sync_playwright, expect

spec = importlib.util.spec_from_file_location('uie2e', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ui-e2e.py'))
U = importlib.util.module_from_spec(spec); spec.loader.exec_module(U)
T, btn, new_page = U.T, U.btn, U.new_page

def go(pg, path):
    """U.go, but a navigation that races a dialog still closing (history back) is retried instead of failing the test."""
    for i in range(3):
        try: U.go(pg, path); return
        except Exception as e:  # noqa: BLE001
            if 'ERR_ABORTED' not in str(e) or i == 2: raise
            pg.wait_for_load_state('domcontentloaded')
DEV_PORT = next((a.split('=')[1] for a in sys.argv if a.startswith('--devtools-port=')), None)
SEED = {'ana': '00000000-0000-4000-8000-0000000000a1', 'ben': '00000000-0000-4000-8000-0000000000b2', 'maya': '00000000-0000-4000-8000-0000000000e1', 'zoya': '00000000-0000-4000-8000-0000000000e3'}

def world(pg, js):
    body = js if js.lstrip().startswith('{') else f'return ({js});'
    return pg.evaluate(f"(() => {{ const w = window.__fake.world; const me = [...window.__fake.socials.values()][0].me; {body} }})()")
def small_targets(pg):
    return pg.evaluate("""() => [...document.querySelectorAll('button, a.btn, a.icon-btn, input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]), textarea, select, [role=tab], [role=option], .pgrid-tile, .count-btn')]
      .filter(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !e.closest('[hidden]') && !e.closest('.sr-only') && !e.classList.contains('switch') && !e.closest('dialog:not([open])'); })
      .map(e => { const r = e.getBoundingClientRect(); return { n: (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter(x => x.h < 44 || x.w < 44)""")
def overflow(pg): return pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
def my_handle(pg): return pg.evaluate("[...window.__fake.accounts.values()][0].account.username")
def signed_in(b, w=1440, h=1000, scheme='light', samples=True, reduced=False):
    pg = new_page(b, w, h, scheme, reduced); U.CUR['pg'] = pg
    go(pg, '/welcome')
    pg.wait_for_function('window.__fake && typeof window.__fake.addSamples === "function"', timeout=30000)  # a cold dev server compiles on first load
    if samples: pg.evaluate('window.__fake.addSamples()')
    U.signup_confirm_login(pg, f'p45.{uuid.uuid4().hex[:6]}@example.com'); U.finish_onboarding(pg); pg.set_default_timeout(5000)
    return pg
def tiles(pg): return pg.locator('a.pgrid-tile')

def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = signed_in(b)

        # ---------- own profile ----------
        def own():
            world(pg, "{ for (let i = 1; i <= 4; i++) w.addPost(me, 'My own post ' + i, 'public', i % 2 === 0); }")
            go(pg, f'/@{my_handle(pg)}'); expect(pg.get_by_test_id('handle')).to_have_text(f'@{my_handle(pg)}')
            m = pg.locator('main'); expect(m.get_by_role('link', name='Edit profile')).to_be_visible(); expect(m.get_by_role('button', name='Share profile')).to_be_visible(); expect(m.get_by_role('link', name='Settings')).to_be_visible()
            expect(pg.get_by_role('tab')).to_have_count(3); expect(pg.get_by_role('tab', name='Saved')).to_be_visible(); expect(tiles(pg)).to_have_count(4)
            expect(pg.get_by_test_id('counts')).to_contain_text('4'); expect(pg.get_by_test_id('counts')).to_contain_text('posts')
            assert pg.get_by_role('button', name='Follow', exact=True).count() == 0, 'no follow button on your own profile'
            pg.get_by_role('tab', name='About').click(); expect(pg.get_by_role('tabpanel')).to_be_visible()
        T('own profile: handle, Edit/Share/Settings, three tabs including Saved, grid and counts', own)
        def share_copies():
            pg.context.grant_permissions(['clipboard-read', 'clipboard-write']); go(pg, f'/@{my_handle(pg)}'); btn(pg, 'Share profile').click(); expect(pg.get_by_text('Link copied.')).to_be_visible()
            assert pg.evaluate('navigator.clipboard.readText()').endswith(f'/@{my_handle(pg)}'), 'the copied link is the profile URL'
        T('share profile copies the /@handle link', share_copies)
        def me_links():
            go(pg, '/me'); pg.get_by_test_id('view-public-profile').click(); pg.wait_for_url(f'**/@{my_handle(pg)}')
        T('/me links to the public profile', me_links)

        # ---------- someone else, public ----------
        def public_profile():
            go(pg, '/@ana.test'); expect(pg.get_by_text('Ana Test, 31', exact=True)).to_be_visible(); expect(pg.get_by_role('button', name='Follow', exact=True)).to_be_visible()
            expect(tiles(pg)).to_have_count(15); btn(pg, 'Load more').click(); expect(tiles(pg)).to_have_count(18)
            ratios = pg.evaluate("[...document.querySelectorAll('a.pgrid-tile')].map(e => { const r = e.getBoundingClientRect(); return Math.round(r.width) === Math.round(r.height); })"); assert all(ratios), 'every tile is square'
            html = pg.content().lower(); assert 'date_of_birth' not in html and 'dateofbirth' not in html and 'discoverab' not in html, 'no private fields in the DOM'
            assert pg.get_by_role('link', name=re.compile('Ana followers-only post')).count() == 0, 'a followers-only post is not in a stranger\'s grid'
        T('public profile: header, 3-column square grid with Load more, no private fields', public_profile)
        def counts_buttons():
            go(pg, '/@ana.test'); pg.get_by_role('button', name=re.compile('followers?$')).click(); dlg = pg.get_by_role('dialog'); expect(dlg.get_by_role('heading', name='Followers')).to_be_visible()
            pg.keyboard.press('Escape'); expect(dlg).to_have_count(0)
        T('counts open the followers dialog, Escape closes it', counts_buttons)
        def follow_unfollow():
            go(pg, '/@cleo.test'); btn(pg, 'Follow', True).click(); expect(pg.get_by_role('button', name='Following', exact=True)).to_be_visible()
            pg.get_by_role('button', name='Following', exact=True).click(); dlg = pg.get_by_role('dialog'); expect(dlg.get_by_role('heading', name='Unfollow @cleo.test?')).to_be_visible()
            dlg.get_by_role('button', name='Unfollow').click(); expect(pg.get_by_role('button', name='Follow', exact=True)).to_be_visible()
        T('Follow, then Following asks before unfollowing', follow_unfollow)

        # ---------- post viewer ----------
        def modal():
            go(pg, '/@ana.test'); first = tiles(pg).first; first.click(); dlg = pg.get_by_role('dialog'); expect(dlg).to_be_visible(); pg.wait_for_url(re.compile(r'/p/[0-9a-f-]{36}$'))
            expect(pg.get_by_test_id('handle')).to_have_text('@ana.test')  # the profile stays underneath
            url1 = pg.url; expect(dlg.get_by_text('1 of 15')).to_be_visible(); expect(dlg.get_by_role('button', name='Previous post')).to_be_disabled()
            pg.keyboard.press('ArrowRight'); expect(dlg.get_by_text('2 of 15')).to_be_visible(); assert pg.url != url1, 'next post has its own URL'
            pg.keyboard.press('ArrowLeft'); expect(dlg.get_by_text('1 of 15')).to_be_visible(); assert pg.url == url1
            dlg.get_by_role('button', name='Next post').click(); expect(dlg.get_by_text('2 of 15')).to_be_visible()
            pg.keyboard.press('Escape'); expect(dlg).to_have_count(0); pg.wait_for_url('**/@ana.test'); expect(tiles(pg)).to_have_count(15)
        T('desktop: a tile opens the post in a dialog with its own URL, arrows and buttons move, Escape returns to the grid', modal)
        def modal_actions():
            go(pg, '/@ana.test'); tiles(pg).first.click(); dlg = pg.get_by_role('dialog'); expect(dlg).to_be_visible()
            dlg.get_by_role('button', name='Like post').click(); expect(dlg.get_by_role('button', name='Unlike post')).to_be_visible()
            dlg.get_by_role('button', name='Save post').click(); expect(dlg.get_by_role('button', name='Remove from saved')).to_be_visible()
            dlg.get_by_role('button', name=re.compile('^Comments')).click(); dlg.get_by_label('Add a comment').fill('Lovely light'); dlg.get_by_role('button', name='Post comment').click(); expect(dlg.get_by_text('Lovely light')).to_be_visible()
            dlg.get_by_role('button', name='Post options').click(); pg.get_by_role('menuitem', name='Report post').click(); expect(pg.get_by_role('heading', name='Report post')).to_be_visible(); pg.keyboard.press('Escape')
        T('post viewer: like, save, comment and report are all there', modal_actions)
        def direct_link():
            go(pg, '/@ana.test'); href = tiles(pg).first.get_attribute('href'); go(pg, href); expect(pg.get_by_role('dialog')).to_have_count(0); expect(pg.get_by_test_id('post-viewer')).to_be_visible(); expect(pg.locator('a.back')).to_contain_text('Notifications')
        T('a direct /p/:id link is a full page, not a dialog', direct_link)
        def keyboard_open():
            go(pg, '/@ana.test'); t = tiles(pg).first; t.focus(); pg.keyboard.press('Enter'); expect(pg.get_by_role('dialog')).to_be_visible(); pg.keyboard.press('Escape'); expect(pg.get_by_role('dialog')).to_have_count(0); pg.wait_for_url('**/@ana.test')
        T('keyboard: a focused tile opens with Enter', keyboard_open)

        # ---------- private account ----------
        def private_profile():
            go(pg, '/@ben.test'); expect(pg.get_by_test_id('handle')).to_have_text('@ben.test'); expect(pg.get_by_role('heading', name='This account is private')).to_be_visible()
            expect(pg.get_by_text('Follow to see their photos and videos.')).to_be_visible(); expect(pg.get_by_test_id('bio')).to_contain_text('Test profile: Ben Test')
            expect(pg.locator('.avatar[data-blurred=true]').first).to_be_visible(); expect(tiles(pg)).to_have_count(0); expect(pg.get_by_role('tablist')).to_have_count(0)
            expect(pg.get_by_test_id('counts')).to_contain_text('post'); expect(pg.get_by_test_id('counts').get_by_role('button')).to_have_count(0)
            assert 'Ben post' not in pg.inner_text('main'), 'no post text for a stranger'
            lock = pg.get_by_test_id('lock-panel'); lock.get_by_role('button', name='Request to follow').click(); expect(lock.get_by_role('button', name='Requested')).to_be_visible(); expect(pg.get_by_role('heading', name='Request sent')).to_be_visible()
            pg.reload(); expect(pg.get_by_role('button', name='Requested')).to_be_visible()
        T('private account: handle, name, bio, counts and a blurred avatar; lock panel instead of grid, tabs or lists; request persists', private_profile)
        def accepted_sees_grid():
            world(pg, "{ w.follows.set(me + '>' + '" + SEED['ben'] + "', 'accepted'); }"); go(pg, '/@ben.test'); expect(tiles(pg).first).to_be_visible(); expect(pg.get_by_test_id('lock-panel')).to_have_count(0)
            expect(pg.get_by_role('button', name='Following', exact=True)).to_be_visible()
        T('once accepted, the grid and tabs appear', accepted_sees_grid)

        # ---------- samples ----------
        def sample_public():
            go(pg, '/@maya.sample'); expect(pg.get_by_text('Sample', exact=True).first).to_be_visible(); expect(pg.get_by_text(re.compile('sample\\W+profile: a fictional person', re.I)).first).to_be_visible()
            btn(pg, 'Follow', True).click(); expect(pg.get_by_role('button', name='Following', exact=True)).to_be_visible()
            n = world(pg, "w.notes.filter(n => n.recipient === '" + SEED['maya'] + "').length"); assert n == 0, 'nothing is delivered to a sample'
            tiles(pg).first.click(); expect(pg.get_by_role('dialog').get_by_text('Sample', exact=True).first).to_be_visible(); pg.keyboard.press('Escape')
        T('sample public profile: badge and notice, follow is instant, no notification reaches it, posts carry the badge', sample_public)
        def sample_private():
            go(pg, '/@zoya.sample'); expect(pg.get_by_role('heading', name='This account is private')).to_be_visible(); expect(pg.get_by_text('never accept follow requests', exact=False)).to_be_visible()
            pg.get_by_test_id('lock-panel').get_by_role('button', name='Request to follow').click(); expect(pg.get_by_role('button', name='Requested')).to_be_visible(); pg.reload(); expect(pg.get_by_role('button', name='Requested')).to_be_visible(); expect(tiles(pg)).to_have_count(0)
        T('sample private profile: request stays pending, the UI says samples never accept', sample_private)
        def sample_report():
            go(pg, '/@maya.sample'); pg.get_by_role('button', name='Profile options').click(); pg.get_by_role('menuitem', name='Report profile').click(); dlg = pg.get_by_role('dialog')
            dlg.get_by_label('Spam or ads').check(); dlg.get_by_role('button', name='Save report').click(); expect(dlg.get_by_text('This is sample content, so there is nobody to report.')).to_be_visible()
        T('reporting a sample is refused with a clear message', sample_report)
        def feed_badges():
            go(pg, '/feed'); pg.get_by_role('tab', name='Explore').click()
            pg.wait_for_selector('article.post'); expect(pg.locator('article.post', has_text='sample post').first.get_by_text('Sample', exact=True)).to_be_visible()
        T('Explore: sample posts carry the Sample badge', feed_badges)
        def discover_sample():
            go(pg, '/settings'); pg.get_by_label('Show me in Discover').click(); expect(pg.get_by_text('Privacy settings saved.')).to_be_visible()
            go(pg, '/discover'); card = pg.get_by_test_id('dating-card'); expect(card).to_be_visible()
            for _ in range(30):
                if card.get_by_text('Sample', exact=True).count(): break
                btn(pg, re.compile('^Pass on')).click(); card = pg.get_by_test_id('dating-card'); expect(card).to_be_visible()
            expect(card.get_by_test_id('sample-note')).to_contain_text('can never become a match'); btn(pg, re.compile('^Like ')).click(); expect(pg.get_by_role('dialog')).to_have_count(0)
        T('Discover: a sample person has the badge and a note, and liking one never makes a match', discover_sample)

        # ---------- search ----------
        def search():
            go(pg, '/search'); box = pg.get_by_role('combobox', name='Search people'); expect(box).to_be_visible(); expect(pg.get_by_test_id('search-idle')).to_be_visible()
            box.fill('m'); expect(pg.get_by_test_id('search-idle')).to_contain_text('at least 2')
            box.fill('ma'); lb = pg.get_by_role('listbox', name='Search results'); expect(lb.get_by_role('option').first).to_be_visible(); expect(lb.get_by_role('option', name=re.compile('maya.sample'))).to_be_visible()
            expect(lb.get_by_role('option', name=re.compile('maya.sample')).get_by_text('Sample', exact=True)).to_be_visible(); expect(box).to_have_attribute('aria-expanded', 'true')
            box.press('ArrowDown'); expect(lb.get_by_role('option').first).to_have_attribute('aria-selected', 'true'); box.press('Enter'); pg.wait_for_url(re.compile(r'/@'))
        T('search: combobox with a listbox, minimum characters, keyboard selection, sample badge', search)
        def search_private_and_empty():
            go(pg, '/search'); box = pg.get_by_role('combobox', name='Search people'); box.fill('ben'); opt = pg.get_by_role('listbox', name='Search results').get_by_role('option', name=re.compile('ben.test')); expect(opt).to_be_visible()
            assert opt.locator('.lock-mark').count() == 1, 'private accounts show a lock'; expect(opt.get_by_text('Private account')).to_be_attached()
            box.fill('zzzzqq'); expect(pg.get_by_role('heading', name='No one found')).to_be_visible()
            box.press('Escape'); assert box.input_value() == '', 'Escape clears when nothing is open'
        T('search: private accounts show a lock; no results has its own state', search_private_and_empty)
        def search_errors():
            go(pg, '/search'); pg.evaluate("[...window.__fake.socials.values()][0].failNext('network', 1, 'search')"); pg.get_by_role('combobox', name='Search people').fill('ana')
            expect(btn(pg, 'Try again')).to_be_visible(); btn(pg, 'Try again').click(); expect(pg.get_by_role('listbox', name='Search results').get_by_role('option').first).to_be_visible()
        T('search: a failed request shows an error and Try again recovers', search_errors)
        pg.context.close()

        # ---------- a brand-new account ----------
        pg2 = signed_in(b)
        def suggested():
            go(pg2, '/feed'); box = pg2.get_by_test_id('suggested'); expect(box).to_be_visible(); expect(box.get_by_text('Not personalised', exact=False)).to_be_visible()
            expect(box.get_by_role('listitem').first).to_be_visible(); assert box.get_by_text('ben.test').count() == 0, 'private accounts are not suggested'; expect(box.get_by_text('Sample', exact=True).first).to_be_visible()
            fb = box.get_by_role('button', name=re.compile('^Follow Ana')); fb.click(); expect(box.get_by_role('button', name=re.compile('^Following Ana'))).to_be_visible()
        T('brand-new account: a Suggested row of public accounts, labelled as not personalised, follow works', suggested)

        # ---------- settings ----------
        def settings():
            go(pg2, '/settings'); ov = pg2.get_by_test_id('privacy-overview'); expect(ov.get_by_role('heading', name='Privacy overview')).to_be_visible()
            for s in ['Your posts, photos and videos', 'Your profile picture', 'Your followers and following lists', 'Does not hide you in Discover', 'Nobody. Dating is paused']: expect(ov).to_contain_text(s)
            pg2.get_by_role('group', name='Social visibility').get_by_role('button', name='Private').click(); expect(pg2.get_by_text('Your account is private.')).to_be_visible()
            expect(pg2.get_by_test_id('private-explainer')).to_contain_text('Followers you already have stay'); expect(ov).to_contain_text('Only people you accept as followers'); expect(ov).to_contain_text('Blurred for everyone except your followers')
            pg2.get_by_label('Show my profile picture to everyone').click(); expect(ov).to_contain_text('Everyone on LOVOKI'); assert pg2.evaluate("[...window.__fake.accounts.values()][0].account.showAvatarToEveryone") is True
            pg2.get_by_label('Show follower and following counts').click(); expect(ov).to_contain_text('Only you'); pg2.get_by_label('Let people find me by @username or name').click(); expect(ov).to_contain_text('Hidden from search')
            pg2.reload(); expect(pg2.get_by_role('group', name='Social visibility').get_by_role('button', name='Private')).to_have_attribute('aria-pressed', 'true')
        T('settings: private switch explains itself, toggles change the Privacy overview, everything persists', settings)
        def own_profile_when_private():
            go(pg2, f'/@{my_handle(pg2)}'); expect(pg2.get_by_test_id('handle')).to_be_visible(); expect(pg2.get_by_role('tab', name='Saved')).to_be_visible(); expect(pg2.get_by_test_id('lock-panel')).to_have_count(0)
        T('a private account still sees its own full profile', own_profile_when_private)
        def not_searchable():
            h = my_handle(pg2); go(pg2, '/search'); pg2.get_by_role('combobox', name='Search people').fill(h[:5])
            expect(pg2.get_by_role('heading', name='No one found')).to_be_visible()
        T('search never returns yourself', not_searchable)
        pg2.context.close()

        # ---------- phone: full page, layout, targets ----------
        phone = signed_in(b, 390, 844)
        def mobile_post():
            go(phone, '/@ana.test'); tiles(phone).first.click(); phone.wait_for_url(re.compile(r'/p/[0-9a-f-]{36}$')); expect(phone.get_by_role('dialog')).to_have_count(0); expect(phone.get_by_test_id('post-viewer')).to_be_visible()
            expect(phone.get_by_role('button', name='Back')).to_be_visible(); phone.keyboard.press('ArrowRight'); expect(phone.get_by_text('2 of 15')).to_be_visible(); phone.get_by_role('button', name='Back').click(); phone.wait_for_url('**/@ana.test')
        T('phone: a tile opens a full page with Back and Next, not a dialog', mobile_post)
        phone.context.close()

        # ---------- reduced motion ----------
        rm = signed_in(b, 1440, 900, 'light', True, True)
        def reduced():
            go(rm, '/@ana.test'); tiles(rm).first.click(); rm.get_by_role('dialog').locator('.photo img.fade-in').first.wait_for(state='attached')
            d = rm.evaluate("getComputedStyle(document.querySelector('dialog .photo img.fade-in')).transitionDuration"); assert float(d.split(',')[0].strip().rstrip('ms').rstrip('s')) < 0.001 or d.endswith('ms') and float(d.split(',')[0].rstrip('ms')) < 1, f'no fade with reduced motion (got {d})'
        T('reduced motion: images do not fade in', reduced)
        rm.context.close()

        # ---------- developer tools (optional second server) ----------
        if DEV_PORT:
            old = U.BASE; U.BASE = f'http://127.0.0.1:{DEV_PORT}'
            dv = signed_in(b)
            def dev_tools():
                go(dv, '/settings'); expect(dv.get_by_test_id('dev-tools')).to_be_visible(); go(dv, '/@maya.sample'); expect(dv.get_by_test_id('handle')).to_be_visible()
                go(dv, '/settings'); dv.get_by_label('Hide sample content').check(); go(dv, '/search'); dv.get_by_role('combobox', name='Search people').fill('maya'); expect(dv.get_by_role('heading', name='No one found')).to_be_visible()
                go(dv, '/feed'); expect(dv.get_by_test_id('suggested').get_by_text('Sample', exact=True)).to_have_count(0)
            T('developer tools: only with VITE_SHOW_DEV_TOOLS, and "Hide sample content" hides samples from search and suggestions', dev_tools)
            dv.context.close(); U.BASE = old
        else:
            pg4 = signed_in(b, samples=False)
            def no_dev_tools():
                go(pg4, '/settings'); expect(pg4.get_by_role('heading', name='Privacy overview')).to_be_visible(); assert pg4.get_by_test_id('dev-tools').count() == 0, 'no developer tools in a normal build'
                assert 'Hide sample content' not in pg4.inner_text('main')
            T('developer tools are absent without VITE_SHOW_DEV_TOOLS', no_dev_tools)
            pg4.context.close()

        # ---------- layout matrix ----------
        if '--visuals' in sys.argv or '--visuals-only' in sys.argv:
            over = []
            for w_, h_, scheme in [(390, 844, 'light'), (390, 844, 'dark'), (768, 1024, 'light'), (768, 1024, 'dark'), (1440, 900, 'light'), (1440, 900, 'dark')]:
                tag = f'{w_}-{scheme}'; lp = signed_in(b, w_, h_, scheme); h = my_handle(lp)
                go(lp, '/feed'); lp.wait_for_selector('[data-testid=suggested]', timeout=6000)
                def layout_suggested():
                    o = overflow(lp); assert o <= 0, f'{tag} feed-suggested: horizontal overflow {o}px'
                    if w_ == 390:
                        small = [t for t in small_targets(lp) if not t['n'].startswith('Skip')]; assert not small, f'{tag} feed-suggested: touch targets under 44px: {small[:5]}'
                    lp.screenshot(path=os.path.join(SHOTS, f'p45_{tag}_feed-suggested.jpg'), type='jpeg', quality=70)
                T(f'layout {tag}: feed-suggested has no overflow' + (' and 44px touch targets' if w_ == 390 else ''), layout_suggested)
                world(lp, "{ for (let i = 1; i <= 5; i++) w.addPost(me, i === 3 ? 'A very long unbroken caption ' + 'x'.repeat(160) : 'My post ' + i, 'public', i % 2 === 1); }")
                pages = [('own', f'/@{h}', 'a.pgrid-tile'), ('public', '/@ana.test', 'a.pgrid-tile'), ('private', '/@ben.test', '[data-testid=lock-panel]'), ('sample', '/@maya.sample', 'a.pgrid-tile'),
                         ('sample-private', '/@zoya.sample', '[data-testid=lock-panel]'), ('search', '/search?q=ma', '[role=option]'), ('settings', '/settings', '[data-testid=privacy-overview]')]
                for name, path_, ready in pages:
                    def layout(name=name, path_=path_, ready=ready):
                        go(lp, path_); lp.wait_for_selector(ready, timeout=6000); o = overflow(lp); assert o <= 0, f'{tag} {name}: horizontal overflow {o}px'
                        if w_ == 390:
                            small = [t for t in small_targets(lp) if not t['n'].startswith('Skip')]; assert not small, f'{tag} {name}: touch targets under 44px: {small[:5]}'
                        lp.screenshot(path=os.path.join(SHOTS, f'p45_{tag}_{name}.jpg'), type='jpeg', quality=70)
                    T(f'layout {tag}: {name} has no overflow' + (' and 44px touch targets' if w_ == 390 else ''), layout)
                def dialog_layout():
                    go(lp, '/@ana.test'); tiles(lp).first.click()
                    if w_ >= 768: expect(lp.get_by_role('dialog')).to_be_visible()
                    lp.wait_for_selector('article.post'); assert overflow(lp) <= 0, f'{tag} post viewer overflow'; lp.screenshot(path=os.path.join(SHOTS, f'p45_{tag}_post.jpg'), type='jpeg', quality=70)
                T(f'layout {tag}: post viewer has no overflow', dialog_layout)
                lp.context.close()
            print('overflow findings:', over)
        b.close()
    fails = [r for r in U.results if r[0] == 'FAIL']
    print('\n'.join(f'{s} {n}' for s, n in [r for r in U.results][-0:] if False))
    print(f'PASS count: {len([r for r in U.results if r[0] == "PASS"])} FAIL count: {len(fails)}'); print('page errors:', sorted(set(U.page_errors))[:6])
    sys.exit(1 if fails else 0)

if __name__ == '__main__': main()
