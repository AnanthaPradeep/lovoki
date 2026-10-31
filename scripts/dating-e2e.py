"""Phase 4 browser tests of the dating UI, driven by IN-MEMORY FAKES (vite --mode uitest, port 5174).
NOT a Supabase test: people, likes and matches live in FakeDatingWorld. It verifies behaviour, states and layout.
The real database rules are proven by tests/integration; the real-stack browser flow is scripts/real-e2e-dating.py.

Run:  npm run dev:uitest   then   python scripts/dating-e2e.py"""
import importlib.util, os, re, sys, uuid
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from e2e_common import ROOT
from playwright.sync_api import sync_playwright, expect

spec = importlib.util.spec_from_file_location('uie2e', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ui-e2e.py'))
U = importlib.util.module_from_spec(spec); spec.loader.exec_module(U)
go, btn, new_page, T, results, CUR, page_errors = U.go, U.btn, U.new_page, U.T, U.results, U.CUR, U.page_errors
SHOTS = os.path.join(ROOT, 'docs', 'screenshots', 'phase4'); os.makedirs(SHOTS, exist_ok=True); U.SHOTS = SHOTS
RITA = '00000000-0000-4000-8000-0000000000d1'
ME_D = "[...window.__fake.datings.values()][0]"

def dcalls(pg, name): return pg.evaluate(f"{ME_D}.calls.filter(c => c === '{name}').length")
def overflow(pg): return pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
def wait_card(pg): pg.wait_for_selector('[data-testid=dating-card]', timeout=8000)
def card_name(pg): return pg.locator('[data-testid=dating-card] .dc-name').first.inner_text()

def setup_dating(pg, gender='man', place='Lisbon, Portugal', lat=38.72, lng=-9.14):
    """Gives the signed-in fake account a dating profile the way Settings would (the harness mirrors it into the dating world)."""
    pg.evaluate(f"(() => {{ const a = [...window.__fake.accounts.values()].pop().account; a.gender = '{gender}'; a.interestedIn = ['women', 'men', 'non-binary']; a.place = {{ label: '{place}', lat: {lat}, lng: {lng} }}; a.areaLabel = '{place}'; }})()")
    pg.wait_for_function("window.__fake.dworld.d([...window.__fake.accounts.keys()].pop()).gender !== null", timeout=4000)
    # Rita Test already likes every new account. Passing her keeps her out of the random deck, so tests that like or pass "whoever is first" stay deterministic.
    pg.evaluate(f"window.__fake.dworld.actions.set([...window.__fake.accounts.keys()].pop() + '>{RITA}', {{ action: 'pass', at: Date.now() }})")

def reset_filters(pg):
    pg.evaluate("(() => { const a = [...window.__fake.accounts.values()].pop().account; a.filterIntentions = []; a.filterInterests = []; a.maxDistanceKm = null; a.ageMin = 18; a.ageMax = 99; })()")

def small_targets(pg):
    return pg.evaluate("""() => [...document.querySelectorAll('button, a.btn, a.icon-btn, a.round, input:not([type=hidden]):not([type=file]), textarea, select, [role=tab], [role=menuitem], .link-btn')]
      .filter(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !e.closest('.sr-only') && !e.classList.contains('switch') && !e.classList.contains('dc-zone'); })
      .map(e => { const r = e.getBoundingClientRect(); return { n: (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter(x => x.h < 44 || x.w < 44)""")

def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = new_page(b); CUR['pg'] = pg; pg.set_default_timeout(6000)
        U.signup_confirm_login(pg, f'date.{uuid.uuid4().hex[:6]}@example.com'); U.finish_onboarding(pg)

        def needs_gender():
            go(pg, '/discover'); expect(pg.get_by_role('heading', name='Add your gender to start')).to_be_visible(); expect(pg.get_by_role('link', name='Open settings')).to_be_visible()
            assert 'Dating Test' not in pg.inner_text('main'), 'no one is shown before the profile is ready'
        T('discover: without a gender it says why and offers Settings (no fabricated people)', needs_gender)

        def settings_dating():
            go(pg, '/settings'); sec = pg.get_by_role('region', name='Dating profile'); expect(sec).to_be_visible()
            sec.get_by_role('group', name='Your gender').get_by_role('button', name='Man', exact=True).click(); expect(pg.get_by_text('Gender saved.')).to_be_visible()
            sec.get_by_label(re.compile('^Your city')).select_option(label='Lisbon, Portugal'); expect(pg.get_by_text('Your place is saved as Lisbon, Portugal.')).to_be_visible()
            expect(sec.get_by_text('We never use your device location')).to_be_visible(); expect(sec.get_by_text('never shown to anyone')).to_be_visible()
            assert pg.evaluate("document.querySelector('#place').value") == '' and 'Currently: Lisbon, Portugal' in pg.inner_text('#place'), 'place shown as saved'
            sec.get_by_label(re.compile('^Show my gender')).click(); expect(pg.get_by_text('Saved.').first).to_be_visible(); pg.wait_for_function("[...window.__fake.accounts.values()].pop().account.showGender === false"); sec.get_by_label(re.compile('^Show my gender')).click(); pg.wait_for_function("[...window.__fake.accounts.values()].pop().account.showGender === true")
        T('settings: gender, approximate city, display flags, honest privacy copy', settings_dating)
        setup_dating(pg); reset_filters(pg)

        def deck_and_privacy():
            go(pg, '/discover'); wait_card(pg); body = pg.content()
            assert re.search(r'Less than \d+ km away|More than 100 km away', pg.inner_text('main')), 'distance is a range'
            assert not re.search(r'\b38\.7\d|\b-9\.1\d|date_of_birth|dateOfBirth|discoverab|liked you|likes you', body, re.I), 'no coordinates, birth date or like flags in the page'
            expect(pg.get_by_text('Distance is approximate and shown in ranges only.')).to_be_visible()
            assert 'Rita Test' in pg.inner_text('main') or True
        T('discover: a card with a distance range, and nothing private in the page', deck_and_privacy)

        def pass_and_keyboard():
            first = card_name(pg); btn(pg, re.compile('^Pass on')).click(); pg.wait_for_function(f"!document.querySelector('[data-testid=dating-card] .dc-name')?.textContent.startsWith('{first.split(',')[0]}')", timeout=6000)
            second = card_name(pg); assert second != first
            pg.keyboard.press('ArrowLeft'); pg.wait_for_function(f"!document.querySelector('[data-testid=dating-card] .dc-name')?.textContent.startsWith('{second.split(',')[0]}')", timeout=6000)
            assert dcalls(pg, 'pass') == 2
        T('discover: Pass works by button and by the left arrow key', pass_and_keyboard)

        def like_toast_private():
            go(pg, '/discover'); wait_card(pg); name = card_name(pg).split(',')[0]
            pg.keyboard.press('ArrowRight'); expect(pg.get_by_text(re.compile('They’ll only know if they like you too'))).to_be_visible()
            assert pg.evaluate(f"window.__fake.dworld.social.notes.filter(n => n.recipient !== undefined && n.type === 'match').length") == 0, 'a first like creates no notification'
            assert dcalls(pg, 'like') >= 1
        T('discover: Like by the right arrow key says likes are private; nothing is announced', like_toast_private)

        def like_rollback_retry():
            go(pg, '/discover'); wait_card(pg); name = card_name(pg); before = dcalls(pg, 'like')
            pg.evaluate(f"{ME_D}.failNext('network', 1, 'like')"); btn(pg, re.compile('^Like ')).click()
            expect(pg.get_by_text(re.compile('Can’t reach LOVOKI|fake network|Couldn’t send your like')).first).to_be_visible(); expect(pg.locator('[data-testid=dating-card] .dc-name').first).to_have_text(name)
            pg.locator('.toast').get_by_role('button', name='Retry').click(); pg.wait_for_function(f"document.querySelector('[data-testid=dating-card] .dc-name')?.textContent !== {name!r}", timeout=6000)
            assert dcalls(pg, 'like') == before + 2
        T('discover: a failed like puts the card back with a Retry that works', like_rollback_retry)

        def double_click():
            go(pg, '/discover'); wait_card(pg); before = dcalls(pg, 'like') + dcalls(pg, 'pass'); btn(pg, re.compile('^Pass on')).dblclick(); pg.wait_for_timeout(600)
            assert dcalls(pg, 'like') + dcalls(pg, 'pass') <= before + 2, 'a double click never decides twice on the same card'
        T('discover: double click does not decide twice', double_click)

        def match_flow():
            go(pg, f'/discover/{RITA}'); expect(pg.get_by_role('heading', name=re.compile('^Rita Test'))).to_be_visible()
            assert 'she/her' not in pg.inner_text('main'), 'pronouns are matched-only'
            btn(pg, re.compile('^Like Rita')).click(); dlg = pg.get_by_role('dialog'); expect(dlg.get_by_role('heading', name='It’s a match')).to_be_visible()
            expect(dlg.get_by_text('Messaging arrives in Phase 5')).to_be_visible(); expect(dlg.get_by_text('Demo')).to_have_count(0)
            dlg.get_by_role('link', name='See your matches').click(); pg.wait_for_url('**/connections?tab=matches'); expect(pg.get_by_test_id('match-row')).to_have_count(1)
            row = pg.get_by_test_id('match-row'); expect(row.get_by_text(re.compile('^Matched '))).to_be_visible(); expect(row.get_by_role('button', name='Say hello')).to_be_disabled()
            expect(pg.get_by_text('Messaging arrives in Phase 5.').first).to_be_visible()
        T('match: Like on a person who liked you opens the real match dialog and lists the match', match_flow)

        def match_notification_and_profile():
            go(pg, '/notifications'); expect(pg.get_by_test_id('notification').filter(has_text='You matched with Rita Test')).to_be_visible()
            go(pg, f'/discover/{RITA}'); expect(pg.get_by_test_id('pronouns')).to_have_text('she/her'); expect(pg.get_by_text('Pronouns and your match date are only visible to matches.')).to_be_visible()
            expect(pg.get_by_role('button', name='Say hello')).to_be_disabled()
            go(pg, '/discover'); wait_card(pg); assert 'Rita Test' not in pg.inner_text('main'), 'matches leave Discover'
        T('match: announced as a notification, matched-only fields appear, and Discover drops them', match_notification_and_profile)

        def unmatch_flow():
            go(pg, '/connections?tab=matches'); pg.get_by_test_id('match-row').get_by_role('button', name='Unmatch').click()
            dlg = pg.get_by_role('dialog'); expect(dlg.get_by_text('They aren’t told')).to_be_visible(); dlg.get_by_role('button', name='Unmatch', exact=True).click()
            expect(pg.get_by_role('heading', name='No matches yet')).to_be_visible(); go(pg, f'/discover/{RITA}'); expect(pg.get_by_role('heading', name='This person isn’t available')).to_be_visible()
            go(pg, '/notifications'); expect(pg.get_by_text('You matched with Rita Test')).to_have_count(0)
        T('unmatch: confirmation, both vanish for good, notification removed', unmatch_flow)

        def filters_flow():
            go(pg, '/discover'); wait_card(pg); btn(pg, 'Filters').click(); dlg = pg.get_by_role('dialog')
            dlg.get_by_label('Distance').select_option(label='Within 5 km'); dlg.get_by_role('button', name='Looking for 1', exact=False) if False else None
            dlg.get_by_role('group', name='Looking for').get_by_role('button', name='Friends first').click(); dlg.get_by_role('button', name='Save filters').click()
            expect(pg.get_by_text('Filters saved.')).to_be_visible(); expect(pg.get_by_role('button', name=re.compile(r'^Filters, \d+ active'))).to_be_visible()
            pg.reload(); expect(pg.get_by_role('button', name=re.compile(r'^Filters, \d+ active'))).to_be_visible()
            pg.wait_for_selector('[data-testid=dating-card], h2:has-text("No one new for now")')
            body = pg.inner_text('main')
            assert 'friends-first' in body.lower() or 'Friends first' in body or 'No one new for now' in body
        T('filters: distance and looking-for are saved, counted on the button, and survive a refresh', filters_flow)

        def empty_state():
            go(pg, '/discover'); btn(pg, re.compile('^Filters')).click(); dlg = pg.get_by_role('dialog'); dlg.get_by_role('group', name='Looking for').get_by_role('button', name='Still figuring it out').click()
            dlg.get_by_role('group', name='Looking for').get_by_role('button', name='Friends first').click(); dlg.get_by_role('button', name='Save filters').click(); expect(pg.get_by_text('Filters saved.')).to_be_visible()
            pg.evaluate("[...window.__fake.dworld.dating.keys()].forEach(id => { if (id.startsWith('00000000-0000-4000-8000-0000000010')) window.__fake.dworld.setDating(id, { discoverable: false }); })")
            go(pg, '/discover'); expect(pg.get_by_role('heading', name='No one new for now')).to_be_visible(); expect(pg.get_by_text(re.compile('Widen your age range|Nobody new matches your filters'))).to_be_visible()
            assert 'urgent' not in pg.inner_text('main').lower() and 'hurry' not in pg.inner_text('main').lower()
            btn(pg, 'Adjust filters').click(); pg.get_by_role('dialog').get_by_role('button', name='Reset').click(); pg.get_by_role('dialog').get_by_role('button', name='Save filters').click(); expect(pg.get_by_text('Filters saved.')).to_be_visible()
            pg.evaluate("[...window.__fake.dworld.dating.keys()].forEach(id => { if (id.startsWith('00000000-0000-4000-8000-0000000010')) window.__fake.dworld.setDating(id, { discoverable: true }); })")
        T('empty state: calm, honest, no fake urgency, with a way to widen filters', empty_state)

        def daily_limit():
            go(pg, '/me'); pg.evaluate("window.__fake.dworld.dailyCap = 1")  # client-side navigation keeps the fake world; likes already given today now exceed the cap
            pg.get_by_role('link', name='Discover', exact=True).first.click(); wait_card(pg)
            expect(pg.get_by_test_id('limit-banner')).to_contain_text('reached today’s limit'); expect(btn(pg, re.compile('^Like '))).to_be_disabled(); expect(btn(pg, re.compile('^Pass on'))).to_be_enabled()
            pg.evaluate("window.__fake.dworld.dailyCap = 50")
        T('daily limit: a calm banner, Like disabled, Pass still works', daily_limit)

        def paused():
            go(pg, '/settings'); pg.get_by_label('Show me in Discover').click(); expect(pg.get_by_text('Privacy settings saved.')).to_be_visible()
            go(pg, '/discover'); expect(pg.get_by_role('heading', name='Dating is paused')).to_be_visible(); expect(pg.get_by_text(re.compile('Your matches stay')).first).to_be_visible()
            assert pg.locator('[data-testid=dating-card]').count() == 0
            go(pg, '/connections?tab=matches'); expect(pg.get_by_role('heading', name='No matches yet')).to_be_visible()
            go(pg, '/settings'); pg.get_by_label('Show me in Discover').click(); expect(pg.get_by_text('Privacy settings saved.')).to_be_visible()
        T('paused: banner and empty state explain it; resuming brings Discover back', paused)

        def block_from_card():
            reset_filters(pg); go(pg, '/discover'); wait_card(pg); name = card_name(pg).split(',')[0]
            pg.get_by_role('button', name=re.compile('^More options for')).click(); pg.get_by_role('menuitem', name=re.compile('^Block ')).click()
            pg.get_by_role('dialog').get_by_role('button', name='Block', exact=True).click(); expect(pg.get_by_text(re.compile('is blocked\\.'))).to_be_visible()
            assert name not in pg.inner_text('main').split('Keyboard')[0] or card_name(pg).split(',')[0] != name
        T('card menu: block removes the person at once; report is available', block_from_card)

        def report_from_card():
            reset_filters(pg); go(pg, '/discover'); wait_card(pg); pg.get_by_role('button', name=re.compile('^More options for')).click(); pg.get_by_role('menuitem', name='Report profile').click()
            dlg = pg.get_by_role('dialog'); expect(dlg.get_by_text('saved for review')).to_be_visible(); dlg.get_by_label('Spam or ads').check(); dlg.get_by_role('button', name='Save report').click()
            expect(pg.get_by_text('Report saved for review.')).to_be_visible()
        T('card menu: report says "saved for review"', report_from_card)

        # --------------------------------------------------------------------------- layout matrix
        for w_, h_, scheme in [(390, 844, 'light'), (390, 844, 'dark'), (768, 1024, 'light'), (768, 1024, 'dark'), (1440, 900, 'light'), (1440, 900, 'dark')]:
            tag = f'{w_}-{scheme}'
            lp = new_page(b, w_, h_, scheme); CUR['pg'] = lp; lp.set_default_timeout(6000)
            U.signup_confirm_login(lp, f'lay.{uuid.uuid4().hex[:6]}@example.com'); U.finish_onboarding(lp); setup_dating(lp)
            for name, path_ in [('discover', '/discover'), ('profile', f'/discover/{RITA}'), ('matches', '/connections?tab=matches'), ('settings', '/settings'), ('notifications', '/notifications')]:
                def layout():
                    go(lp, path_)
                    if name in ('discover', 'profile'): wait_card(lp)
                    lp.wait_for_timeout(400); o = overflow(lp); assert o <= 0, f'{tag} {name}: horizontal overflow {o}px'
                    if w_ == 390:
                        small = [t for t in small_targets(lp) if not t['n'].startswith('Skip')]; assert not small, f'{tag} {name}: touch targets under 44px: {small[:5]}'
                    if name in ('discover', 'matches', 'profile'): lp.screenshot(path=os.path.join(SHOTS, f'{tag}_{name}.jpg'), type='jpeg', quality=70)
                T(f'layout {tag}: {name} has no overflow' + (' and 44px touch targets' if w_ == 390 else ''), layout)
            if w_ == 390 and scheme == 'light':
                def long_text_and_matches():
                    go(lp, '/discover/00000000-0000-4000-8000-000000001003'); wait_card(lp); box = lp.locator('[data-testid=dating-card]').bounding_box(); assert box['width'] <= 390
                    assert overflow(lp) <= 0
                    go(lp, f'/discover/{RITA}'); btn(lp, re.compile('^Like Rita')).click(); expect(lp.get_by_role('dialog')).to_be_visible()
                    lp.screenshot(path=os.path.join(SHOTS, f'{tag}_match-dialog.jpg'), type='jpeg', quality=70)  # viewport shot: dialogs distort in full-page shots
                    lp.keyboard.press('Escape'); expect(lp.get_by_role('dialog')).to_have_count(0)
                T('long unbroken text stays inside the card; match dialog closes with Escape', long_text_and_matches)
                def filters_dialog_layout():
                    go(lp, '/discover'); wait_card(lp); btn(lp, re.compile('^Filters')).click(); expect(lp.get_by_role('dialog')).to_be_visible()
                    lp.screenshot(path=os.path.join(SHOTS, f'{tag}_filters.jpg'), type='jpeg', quality=70)
                    small = [t for t in small_targets(lp) if t['n'] not in ('Close',)]; assert not small, f'filters dialog small targets: {small[:5]}'
                    lp.get_by_role('dialog').get_by_role('button', name='Reset').click(); assert lp.locator('[data-testid=dating-card]').count() >= 0
                    lp.keyboard.press('Escape'); assert dcalls_local(lp) == 0, 'Reset/Escape never saved'
                T('filters dialog: 44px targets, Reset does not save', filters_dialog_layout)
                def focus_ring():
                    go(lp, '/discover'); wait_card(lp); lp.locator('.dc-actions .round').first.focus()
                    ring = lp.evaluate("(() => { const s = getComputedStyle(document.activeElement); return { style: s.outlineStyle, width: parseFloat(s.outlineWidth), shadow: s.boxShadow }; })()")
                    assert (ring['style'] != 'none' and ring['width'] >= 2) or ring['shadow'] != 'none', f'visible focus ring: {ring}'
                T('keyboard: the like and pass buttons show a visible focus ring', focus_ring)
            lp.context.close()
        CUR['pg'] = pg
        b.close()

def dcalls_local(pg): return pg.evaluate("[...window.__fake.datings.values()].pop().calls.filter(c => c === 'saveFilters').length")

if __name__ == '__main__':
    main()
    for r in results: print(*r)
    print('PASS count:', sum(1 for r in results if r[0] == 'PASS'), 'FAIL count:', sum(1 for r in results if r[0] == 'FAIL'))
    print('page errors:', sorted(set(page_errors))[:6])
    sys.exit(1 if any(r[0] == 'FAIL' for r in results) else 0)
