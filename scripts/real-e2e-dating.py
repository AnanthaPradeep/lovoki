"""REAL-MODE dating browser suite against the LOCAL Supabase stack. No fakes: real GoTrue (sign-up mail via Mailpit), real PostgREST/RLS,
real Storage signed URLs, a real browser, several people. Same prerequisites as scripts/real-e2e.py (read its header).

Run:  python scripts/real-e2e-dating.py"""
import importlib.util, json, os, re, sys, uuid
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright, expect

spec = importlib.util.spec_from_file_location('r2e', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'real-e2e.py'))
R = importlib.util.module_from_spec(spec); spec.loader.exec_module(R)
helper, T, goto, btn, new_ctx, results, page_errors, CUR = R.helper, R.T, R.goto, R.btn, R.new_ctx, R.results, R.page_errors, R.CUR
SHOTS = os.path.join(R.ROOT, 'docs', 'screenshots', 'phase4'); os.makedirs(SHOTS, exist_ok=True); R.SHOTS = SHOTS
FORBIDDEN = re.compile(r'"(lat|lng|latitude|longitude|coordinates?|date_of_birth|dob|dating_discoverable|discoverable|liked_you|likes_you|liked_me|show_distance|distance_km)"', re.I)

def fresh_names(pg, action):
    """Runs `action` and returns the user ids in the discover_profiles response that action itself caused (never a stale one).
    The browser sometimes drops a response body when the navigation that caused it moves on, so a dropped body is retried."""
    last = None
    for _ in range(3):
        try:
            with pg.expect_response(lambda r: 'rpc/discover_profiles' in r.url and r.request.method == 'POST', timeout=20000) as info:
                action()
            return {r['user_id'] for r in info.value.json()}
        except Exception as e:  # noqa: BLE001
            last = e
    raise last

def dating_person(label, gender, wants, place):
    return helper('dating-user', label, gender, wants, place)

def main():
    env = helper('env'); mail = env['MAIL']
    R.HELPER_ENV.update({'LOVOKI_HELPER_API_URL': env['VITE_SUPABASE_URL'], 'LOVOKI_HELPER_ANON': env['VITE_SUPABASE_PUBLISHABLE_KEY'], 'LOVOKI_HELPER_SERVICE': env.pop('_service'), 'LOVOKI_HELPER_MAIL': mail})
    purged = helper('purge-test-users')
    if purged['others']:
        raise SystemExit(f"{purged['others']} other account(s) exist on this local database (for example seed users). Remove them first so the deck is predictable: node scripts/seed-local-users.mjs --remove")
    bea = dating_person('Bea Real', 'woman', 'men', 'lisbon'); cat = dating_person('Cat Real', 'woman', 'men', 'madrid')
    dan = dating_person('Dan Real', 'man', 'women', 'lisbon'); eve = dating_person('Eve Real', 'woman', 'men', 'sintra')
    server = R.start_server(env)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(); pg = new_ctx(b); CUR['pg'] = pg; pg.set_default_timeout(10000)
            discover_bodies: list[str] = []; wire: list[str] = []
            def watch(res):
                if re.search(r'/rest/v1/rpc/(discover_profiles|dating_profile|list_matches|dating_status|notifications_page)', res.url):
                    try: txt = res.text()
                    except Exception: return
                    wire.append(txt)
                    if 'discover_profiles' in res.url: discover_bodies.append(txt)
            pg.on('response', watch)
            email = f'alice.{uuid.uuid4().hex[:6]}@lovoki-e2e.test'; st = {}

            def signup():
                goto(pg, '/signup'); pg.get_by_label('Email', exact=True).fill(email); pg.get_by_label('Password', exact=True).fill(R.PW); btn(pg, 'Create account').click()
                pg.wait_for_url('**/check-email'); pg.goto(R.mail_link(mail, email), wait_until='domcontentloaded'); pg.wait_for_url('**/onboarding/basics', timeout=20000)
                R.onboard_via_ui(pg, 'Alice Real'); st['me'] = pg.evaluate("JSON.parse(localStorage.getItem('lovoki.auth')).user.id")
            T('REAL: sign up by email, confirm, onboard through the UI', signup)

            def needs_gender():
                goto(pg, '/discover'); expect(pg.get_by_role('heading', name='Add your gender to start')).to_be_visible()
                assert 'Real' not in pg.inner_text('main').replace('Alice Real', ''), 'nobody is shown before the profile is ready'
            T('REAL: Discover without a gender explains why and shows no one', needs_gender)

            def set_profile():
                goto(pg, '/settings'); sec = pg.get_by_role('region', name='Dating profile')
                sec.get_by_role('group', name='Your gender').get_by_role('button', name='Man', exact=True).click(); expect(pg.get_by_text('Gender saved.')).to_be_visible()
                sec.get_by_label(re.compile('^Your city')).select_option(label='Lisbon, Portugal'); expect(pg.get_by_text('Your place is saved as Lisbon, Portugal.')).to_be_visible()
                row = R.helper('query', 'profiles', 'user_id', st['me'])[0]; assert row['gender'] == 'man' and row['dating_discoverable'] is False, 'dating starts off (opt-in)'
                goto(pg, '/discover'); expect(pg.get_by_role('heading', name='Dating is paused')).to_be_visible()
                goto(pg, '/settings'); pg.get_by_label('Show me in Discover').click(); expect(pg.get_by_text('Privacy settings saved.')).to_be_visible()
                assert R.helper('query', 'profiles', 'user_id', st['me'])[0]['dating_discoverable'] is True
                pl = R.helper('query', 'profile_places', 'user_id', st['me'])[0]; assert (float(pl['lat']), float(pl['lng'])) == (38.72, -9.14)
            T('REAL: gender and city saved through Settings (place stored rounded)', set_profile)

            def deck():
                goto(pg, '/discover'); R.wait_posts if False else None; pg.wait_for_selector('[data-testid=dating-card]', timeout=20000)
                names = set()
                for body in discover_bodies:
                    for r in json.loads(body): names.add(r['user_id'])
                assert {bea['id'], cat['id'], eve['id']} <= names, f'compatible people are offered: {names}'
                assert dan['id'] not in names, 'an incompatible person is never offered'
                pg.wait_for_function("(() => { const i = document.querySelector('[data-testid=dating-card] .photo img'); return i && i.complete && i.naturalWidth > 0; })()", timeout=20000)
            T('REAL: the deck offers exactly the compatible people, and the card photo loads through a signed URL', deck)

            def buckets():
                for who, want in [(bea, 'Less than 5 km away'), (eve, 'Less than 25 km away'), (cat, 'More than 100 km away')]:
                    goto(pg, f"/discover/{who['id']}"); pg.wait_for_selector('[data-testid=dating-card]'); assert want in pg.inner_text('main'), f"{who['email']}: {want}"
                    html = pg.content(); assert not re.search(r'38\.7\d|-9\.1\d|40\.42|date_of_birth', html)
                goto(pg, f"/discover/{dan['id']}"); expect(pg.get_by_role('heading', name='This person isn’t available')).to_be_visible()
            T('REAL: distance shows only as a range; an incompatible person’s page is unavailable', buckets)

            def first_like_is_private():
                goto(pg, f"/discover/{bea['id']}"); btn(pg, re.compile('^Like Bea')).click(); expect(pg.get_by_text(re.compile('They’ll only know if they like you too'))).to_be_visible()
                assert len(R.helper('query', 'dating_actions', 'actor_id', st['me'])) == 1
                assert not R.helper('query', 'notifications', 'recipient_id', bea['id']), 'Bea is told nothing'
            T('REAL: a first like is private and creates no notification', first_like_is_private)

            pb = new_ctx(b); pb.set_default_timeout(10000)
            def second_liker_matches():
                CUR['pg'] = pb; R.login(pb, bea['email'], bea['password']); goto(pb, '/discover'); pb.wait_for_selector('[data-testid=dating-card]', timeout=20000)
                assert 'liked' not in pb.inner_text('main').lower().replace('likes are private until you both like each other', ''), 'nothing says someone liked you'
                goto(pb, f"/discover/{st['me']}"); pb.wait_for_selector('[data-testid=dating-card]'); btn(pb, re.compile('^Like Alice')).click()
                dlg = pb.get_by_role('dialog'); expect(dlg.get_by_role('heading', name='It’s a match')).to_be_visible(); expect(dlg.get_by_text('Messaging arrives in Phase 5')).to_be_visible()
                pb.screenshot(path=os.path.join(SHOTS, 'real-1440-light_match-dialog.jpg'), type='jpeg', quality=70)
                assert len(R.helper('query', 'matches', 'user_a', min(st['me'], bea['id']))) == 1
            T('REAL: the second liker gets the match dialog', second_liker_matches)

            def first_liker_sees_match():
                CUR['pg'] = pg; goto(pg, '/feed'); pg.evaluate("window.dispatchEvent(new Event('focus'))")
                expect(pg.get_by_role('link', name=re.compile('Notifications, \\d+ unread')).first).to_be_visible(timeout=15000)
                goto(pg, '/notifications'); expect(pg.get_by_test_id('notification').filter(has_text='You matched with Bea Real')).to_be_visible()
                goto(pg, '/connections?tab=matches'); row = pg.get_by_test_id('match-row'); expect(row).to_have_count(1); expect(row.get_by_text(re.compile('^Matched '))).to_be_visible()
                expect(row.get_by_role('button', name='Say hello')).to_be_disabled(); expect(pg.get_by_text('Messaging arrives in Phase 5.').first).to_be_visible()
                pg.screenshot(path=os.path.join(SHOTS, 'real-1440-light_matches.jpg'), type='jpeg', quality=70)
            T('REAL: the first liker sees the match on focus: badge, notification, Matches tab, disabled "Say hello"', first_liker_sees_match)

            def match_leaves_discover():
                names = fresh_names(pg, lambda: goto(pg, '/discover')); assert bea['id'] not in names, f'a match leaves Discover: {names}'
                assert {cat['id'], eve['id']} <= names, names
            T('REAL: a matched person no longer appears in Discover', match_leaves_discover)

            def unmatch():
                goto(pg, '/connections?tab=matches'); pg.get_by_test_id('match-row').get_by_role('button', name='Unmatch').click()
                d = pg.get_by_role('dialog'); expect(d.get_by_text('They aren’t told')).to_be_visible(); d.get_by_role('button', name='Unmatch', exact=True).click()
                expect(pg.get_by_role('heading', name='No matches yet')).to_be_visible()
                CUR['pg'] = pb; goto(pb, '/connections?tab=matches'); expect(pb.get_by_role('heading', name='No matches yet')).to_be_visible()
                goto(pb, f"/discover/{st['me']}"); expect(pb.get_by_role('heading', name='This person isn’t available')).to_be_visible()
                m = R.helper('query', 'matches', 'user_a', min(st['me'], bea['id']))[0]; assert m['unmatched_at'] and m['unmatched_by'] == st['me']
                assert R.helper('query', 'dating_exclusions', 'user_a', min(st['me'], bea['id'])), 'excluded for good'
            T('REAL: unmatch with confirmation removes it for both and excludes them permanently', unmatch)

            def filters_persist():
                CUR['pg'] = pg; goto(pg, '/discover'); pg.wait_for_selector('[data-testid=dating-card]'); btn(pg, re.compile('^Filters')).click(); d = pg.get_by_role('dialog')
                d.get_by_label('Distance').select_option(label='Within 25 km'); d.get_by_role('button', name='Save filters').click(); expect(pg.get_by_text('Filters saved.')).to_be_visible()
                assert R.helper('query', 'dating_preferences', 'user_id', st['me'])[0]['max_distance_km'] == 25
                names = fresh_names(pg, lambda: pg.reload()); assert cat['id'] not in names and eve['id'] in names, f'Madrid is beyond 25 km: {names}'
                expect(pg.get_by_role('button', name=re.compile('^Filters, \\d+ active'))).to_be_visible()
                btn(pg, re.compile('^Filters')).click(); d = pg.get_by_role('dialog'); d.get_by_label('Distance').select_option(label='Any distance'); d.get_by_role('button', name='Save filters').click(); expect(pg.get_by_text('Filters saved.').first).to_be_visible()
                assert R.helper('query', 'dating_preferences', 'user_id', st['me'])[0]['max_distance_km'] is None, 'filter removed again'
            T('REAL: the distance filter is saved to preferences and applied by the database after a refresh', filters_persist)

            def pause_others_and_self():
                R.helper('pause-as', eve['email'], 'off')
                names = fresh_names(pg, lambda: goto(pg, '/discover')); assert eve['id'] not in names, f'a paused person vanishes from discovery at once: {names}'
                goto(pg, f"/discover/{eve['id']}"); expect(pg.get_by_role('heading', name='This person isn’t available')).to_be_visible()
                goto(pg, '/settings'); pg.get_by_label('Show me in Discover').click(); expect(pg.get_by_text('Privacy settings saved.')).to_be_visible()
                goto(pg, '/discover'); expect(pg.get_by_role('heading', name='Dating is paused')).to_be_visible(); assert pg.locator('[data-testid=dating-card]').count() == 0
                goto(pg, '/settings'); pg.get_by_label('Show me in Discover').click(); expect(pg.get_by_text('Privacy settings saved.')).to_be_visible()
                goto(pg, '/discover'); pg.wait_for_selector('[data-testid=dating-card]')
            T('REAL: pausing hides you at once, blocks your own discovery with an honest state, and resuming restores it', pause_others_and_self)

            def block_and_report():
                goto(pg, '/discover'); pg.wait_for_selector('[data-testid=dating-card]'); who = pg.locator('[data-testid=dating-card] .dc-name').first.inner_text().split(',')[0]
                pg.get_by_role('button', name=re.compile('^More options for')).click(); pg.get_by_role('menuitem', name='Report profile').click(); d = pg.get_by_role('dialog')
                d.get_by_label('Spam or ads').check(); d.get_by_role('button', name='Save report').click(); expect(pg.get_by_text('Report saved for review.')).to_be_visible()
                assert R.helper('query', 'content_reports', 'reporter_id', st['me'])[0]['status'] == 'open'
            T('REAL: report from the card is saved for review', block_and_report)

            def layout():
                m = new_ctx(b, 390, 844); m.set_default_timeout(10000); m.goto(R.BASE + '/login'); m.get_by_label('Email', exact=True).fill(email); m.get_by_label('Password', exact=True).fill(R.PW); btn(m, 'Log in').click(); m.wait_for_url(re.compile(r'/(discover|feed|me)'))
                for path_ in ['/discover', '/connections?tab=matches', '/settings', '/notifications']:
                    goto(m, path_); m.wait_for_timeout(500); o = m.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth'); assert o <= 0, f'{path_} overflows by {o}px at 390'
                goto(m, '/discover'); m.wait_for_selector('[data-testid=dating-card]'); m.screenshot(path=os.path.join(SHOTS, 'real-390-light_discover.jpg'), type='jpeg', quality=70); m.context.close()
            T('REAL layout: no horizontal overflow at 390px on the dating screens with real data', layout)

            def wire_privacy():
                bad = [t[:120] for t in wire if FORBIDDEN.search(t)]; assert not bad, f'forbidden keys on the wire: {bad[:2]}'
                assert wire, 'responses were captured'
            T('REAL privacy on the wire: no coordinates, birth date, discoverability or like flags in any dating response the browser received', wire_privacy)

            def logout():
                goto(pg, '/settings'); pg.get_by_role('button', name='Log out').last.click(); pg.wait_for_url('**/welcome')
                for r in ['/discover', '/connections', '/discover/' + bea['id']]: goto(pg, r); pg.wait_for_url(re.compile('/login'), timeout=8000)
            T('REAL logout protects the dating routes', logout)
            b.close()
    finally:
        R.stop_server(server)

if __name__ == '__main__':
    main()
    for r in results: print(*r)
    print('PASS count:', sum(1 for r in results if r[0] == 'PASS'), 'FAIL count:', sum(1 for r in results if r[0] == 'FAIL'))
    print('page errors:', sorted(set(page_errors))[:6])
    sys.exit(1 if any(r[0] == 'FAIL' for r in results) else 0)
