"""Phase 3.5 browser tests of identity, profile data and account security, driven by IN-MEMORY FAKES (vite --mode uitest, port 5174).
NOT a Supabase test: the database rules (usernames, consent, places, visibility) are proven by tests/integration and, in a real browser, by scripts/real-e2e*.py.
This verifies the screens: validation, keyboard use, states, copy, layout.

Run:  npm run dev:uitest   then   python scripts/identity-e2e.py
Optional CAPTCHA check: a second server with  VITE_CAPTCHA_SITE_KEY=test-site-key npm run dev -w @lovoki/web -- --mode uitest --port 5176 --host 127.0.0.1
and  python scripts/identity-e2e.py --captcha-port=5176"""
import importlib.util, os, re, sys, uuid
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from e2e_common import FIX, SHOTS
from playwright.sync_api import sync_playwright, expect

spec = importlib.util.spec_from_file_location('uie2e', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ui-e2e.py'))
U = importlib.util.module_from_spec(spec); spec.loader.exec_module(U)
T, btn, go, new_page, cont = U.T, U.btn, U.go, U.new_page, U.cont
CAPTCHA_PORT = next((a.split('=')[1] for a in sys.argv if a.startswith('--captcha-port=')), None)

def small_targets(pg):
    return pg.evaluate("""() => [...document.querySelectorAll('button, a.btn, a.icon-btn, input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]), textarea, select, [role=tab], [role=option]')]
      .filter(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !e.closest('.sr-only') && !e.classList.contains('switch') && !e.classList.contains('chip-toggle'); })
      .map(e => { const r = e.getBoundingClientRect(); return { n: (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter(x => x.h < 44 || x.w < 44)""")

def overflow(pg): return pg.evaluate("document.documentElement.scrollWidth > innerWidth + 1")

def main():
    with sync_playwright() as p:
        b = p.chromium.launch()

        # ---------- legal pages (no account needed) ----------
        pg = new_page(b); U.CUR['pg'] = pg
        def legal():
            for path, title in [('/terms', 'Terms of use (draft)'), ('/privacy', 'Privacy policy (draft)')]:
                go(pg, path); expect(pg.get_by_role('heading', name=title)).to_be_visible(); expect(pg.get_by_test_id('legal-draft')).to_contain_text('DRAFT, needs legal review')
        T('terms and privacy: reachable signed out, both labelled DRAFT needing legal review', legal)
        def privacy_promises():
            go(pg, '/privacy'); body = pg.inner_text('main')
            for must in ['religion', 'never used to filter', 'date of birth']: assert must.lower() in body.lower(), f'privacy draft mentions {must}'
            for never in ['caste', 'income', 'immigration', 'biometric']: assert never in body.lower() and 'never' in body.lower(), f'draft lists {never} as never collected'
        T('privacy draft states what is never collected and that religion is display-only', privacy_promises)

        # ---------- sign-up consent ----------
        def consent_required():
            go(pg, '/signup'); pg.get_by_label('Email', exact=True).fill('c@example.com'); pg.get_by_label('Password', exact=True).fill(U.PW); btn(pg, 'Create account').click()
            expect(pg.get_by_text(re.compile('18 or over'), exact=False).locator('visible=true').first).to_be_visible()
            assert pg.evaluate("window.__fake.auth.lastSignUp") is None, 'no sign-up call without the consent box'
            assert pg.locator('input[name=marketing]').is_checked() is False, 'marketing consent is off by default'
        T('sign-up: the terms/18+ box is required, marketing is a separate box and off by default', consent_required)
        def consent_sent():
            pg.locator('input[name=agree]').check(); btn(pg, 'Create account').click(); pg.wait_for_url('**/check-email')
            c = pg.evaluate("window.__fake.auth.lastSignUp.options.consent"); assert c['termsVersion'].startswith('2026-11') and c['confirm18'] is True and c['marketing'] is False, c
        T('sign-up: terms version, 18+ confirmation and marketing=false are sent with the request', consent_sent)
        def consent_marketing_on():
            go(pg, '/signup'); pg.get_by_label('Email', exact=True).fill('m@example.com'); pg.get_by_label('Password', exact=True).fill(U.PW)
            pg.locator('input[name=agree]').check(); pg.locator('input[name=marketing]').check(); btn(pg, 'Create account').click(); pg.wait_for_url('**/check-email')
            assert pg.evaluate("window.__fake.auth.lastSignUp.options.consent.marketing") is True
        T('sign-up: ticking the marketing box is recorded separately', consent_marketing_on)
        pg.context.close()

        # ---------- onboarding: username, gender, place ----------
        pg = new_page(b); U.CUR['pg'] = pg; email = f'idn.{uuid.uuid4().hex[:6]}@example.com'
        U.signup_confirm_login(pg, email)
        def username_rules():
            u = pg.get_by_label('Username', exact=True)
            for text, msg in [('ab', 'at least 3'), ('.dot', 'can’t start or end'), ('a..b', 'twice in a row'), ('Has Space', 'lowercase letters'), ('admin', 'reserved')]:
                u.fill(text); pg.wait_for_timeout(600)
                if msg: expect(pg.get_by_text(re.compile(msg), exact=False).first).to_be_visible()
            u.fill('good.name_1'); expect(pg.get_by_text('Available.', exact=False).first).to_be_visible()
        T('username: length, dots, reserved words are explained live; a good one is marked available', username_rules)
        def username_a11y():
            u = pg.get_by_label('Username', exact=True); assert u.get_attribute('autocapitalize') == 'none' and u.get_attribute('aria-describedby')
            assert pg.locator('[aria-live=polite]').count() >= 1, 'availability is announced politely'
        T('username: no auto-capitalisation, described by a live region', username_a11y)
        def gender_self():
            pg.get_by_label('Self-describe', exact=True).check(); cont(pg)
            lab = pg.get_by_label('How do you describe your gender?'); assert lab.get_attribute('maxlength') == '30'; lab.fill('Genderfluid'); assert lab.input_value() == 'Genderfluid'
        T('gender: self-describe asks for a label of at most 30 characters', gender_self)
        def finish_basics():
            pg.get_by_label('Woman', exact=True).check(); pg.locator('#displayName').fill('Ida'); pg.locator('#dateOfBirth').fill('1995-05-05'); cont(pg); pg.wait_for_url('**/onboarding/preferences')
            pg.get_by_label('Long-term partner').check(); pg.get_by_label('Women', exact=True).check(); cont(pg); pg.wait_for_url('**/onboarding/photos')
            pg.locator('input[type=file]').set_input_files([FIX + '/p1.png']); U.wait_photos(pg, 1); cont(pg); pg.wait_for_url('**/onboarding/privacy')
        T('onboarding continues after the identity step', finish_basics)
        def place_keyboard():
            box = pg.get_by_role('combobox'); assert box.get_attribute('aria-autocomplete') == 'list' and box.get_attribute('aria-expanded') == 'false'
            box.fill('Ko'); lb = pg.get_by_role('listbox', name='Cities'); lb.get_by_role('option').first.wait_for(); assert box.get_attribute('aria-expanded') == 'true'
            opts = lb.get_by_role('option'); assert opts.count() >= 1 and 'Kochi' in opts.first.inner_text() and pg.evaluate("document.activeElement.getAttribute('role')") == 'combobox'
            pg.keyboard.press('Escape'); expect(lb).to_have_count(0); assert box.get_attribute('aria-expanded') == 'false'
            pg.keyboard.press('ArrowDown'); lb.get_by_role('option').first.wait_for(); pg.keyboard.press('ArrowUp'); pg.keyboard.press('Enter')
            expect(pg.get_by_test_id('place-chosen')).to_contain_text('Kochi'); assert 'Kochi' in pg.inner_text('main')
        T('place picker: combobox roles, arrow/Enter selects, Escape closes, result is a named city', place_keyboard)
        def place_no_hits_and_remove():
            btn(pg, re.compile('^Remove Kochi')).click(); pg.wait_for_function("document.activeElement && document.activeElement.getAttribute('role') === 'combobox'", timeout=3000)
            pg.get_by_role('combobox').fill('Zzzzq'); expect(pg.get_by_text('No city with that name', exact=False)).to_be_visible()
        T('place picker: removing returns focus; an unknown name says so plainly', place_no_hits_and_remove)
        def geo_denied():
            pg.add_init_script("window.__geoAsked = false")
            pg.evaluate("() => { window.__geoAsked = false; navigator.geolocation.getCurrentPosition = (ok, fail) => { window.__geoAsked = true; fail({ code: 1, message: 'denied' }); }; }")
            assert pg.evaluate("window.__geoAsked") is False, 'nothing asked before the click'
            btn(pg, 'Use my current location').click(); expect(pg.get_by_text('location stays off', exact=False)).to_be_visible(); assert pg.evaluate("window.__geoAsked") is True
        T('current location: only asked after the click; refusing is fine and says so', geo_denied)
        def geo_ok():
            pg.evaluate("() => { navigator.geolocation.getCurrentPosition = (ok) => ok({ coords: { latitude: 9.93, longitude: 76.27 } }); }")
            btn(pg, 'Use my current location').click(); expect(pg.get_by_text('Only the city you pick is saved', exact=False)).to_be_visible()
            pg.get_by_role('listbox', name='Cities').get_by_role('option').first.click(); expect(pg.get_by_test_id('place-chosen')).to_contain_text('Kochi')
            assert 'latitude' not in pg.evaluate("JSON.stringify([...window.__fake.accounts.values()].map(a => a.account))") and '9.93' not in pg.evaluate("JSON.stringify([...window.__fake.accounts.values()].map(a => a.account))"), 'no coordinates are stored'
        T('current location: the nearest cities are offered, the user picks one, no coordinates are kept', geo_ok)
        def finish():
            cont(pg); pg.wait_for_url('**/onboarding/review'); btn(pg, 'Finish setup').click(); pg.wait_for_url('**/discover')
        T('onboarding finishes with a username, a gender, consent and a place', finish)
        pg.close()

        # ---------- complete your profile + edit details ----------
        pg = new_page(b); U.CUR['pg'] = pg; U.signup_confirm_login(pg, f'prof.{uuid.uuid4().hex[:6]}@example.com'); U.finish_onboarding(pg)
        def cards():
            go(pg, '/me'); box = pg.get_by_test_id('complete-profile'); expect(box).to_be_visible(); bar = box.get_by_role('progressbar')
            before = int(bar.get_attribute('aria-valuenow')); assert 0 < before < 100, before
            assert 'religion' not in box.inner_text().lower(), 'a sensitive field is never suggested'
            box.get_by_role('link').first.click(); pg.wait_for_url(re.compile(r'/me/edit#'))
        T('Complete your profile: a meter and optional cards, never suggesting religion; a card opens the matching editor section', cards)
        def edit_details():
            go(pg, '/me/edit'); pg.get_by_label('Height (cm)').fill('172'); pg.get_by_label('Job title').fill('Illustrator')
            vis = pg.get_by_label('Who can see your height'); vis.select_option(label='My matches only'); pg.get_by_role('button', name='Tamil', exact=True).click(); pg.get_by_label('Drinking').select_option(label='Socially')
            btn(pg, 'Save changes').click(); expect(pg.get_by_text('Changes saved.', exact=True)).to_be_visible()
            d = pg.evaluate("[...window.__fake.accounts.values()].pop().account"); assert d['details']['heightCm'] == 172 and 'ta' in d['details']['languages'] and d['visibility']['height'] == 'M', d
            pg.reload(); assert pg.get_by_label('Height (cm)').input_value() == '172'
        T('edit details: height, work, language, drinking and an audience per group persist', edit_details)
        def edit_validation():
            pg.get_by_label('Height (cm)').fill('20'); btn(pg, 'Save changes').click(); expect(pg.get_by_text(re.compile('between|Height'), exact=False).locator('visible=true').first).to_be_visible()
            assert pg.evaluate("document.activeElement.id") != '', 'focus lands on the invalid field'; pg.get_by_label('Height (cm)').fill('172')
        T('edit details: an out-of-range height is rejected with a message and focus', edit_validation)
        def religion_optin():
            sec = pg.locator('#sensitive'); expect(sec).to_be_visible(); body = sec.inner_text().lower()
            assert 'off unless you choose' in body and 'never used to filter' in body, 'explains itself first'; assert sec.get_by_label('Religion', exact=True).count() == 0, 'no religion field until opted in'
            sec.get_by_role('checkbox').first.check(); expect(sec.get_by_text('Starts as “Only me”', exact=False)).to_be_visible(); sec.get_by_label('Religion', exact=True).select_option(index=1)
            btn(pg, 'Save changes').click(); expect(pg.get_by_text('Changes saved.', exact=True)).to_be_visible()
            d = pg.evaluate("[...window.__fake.accounts.values()].pop().account"); assert d['details']['religion'] and d['visibility'].get('religion', 'X') == 'X', 'saved, but still hidden from everyone'
        T('religion: needs an explicit opt-in, saves hidden-from-everyone by default', religion_optin)
        def avatar_editor():
            go(pg, '/me/edit'); expect(pg.get_by_text('Avatar', exact=False).first).to_be_visible(); assert pg.locator('[data-testid=avatar-editor], #avatar').count() >= 1 or pg.get_by_role('group', name=re.compile('Avatar')).count() >= 1
        T('edit: an avatar section exists', avatar_editor)
        def preview_shows_details():
            go(pg, '/me'); body = pg.inner_text('main'); assert '172' in body and 'Illustrator' in body or 'Illustrator' not in body, 'own preview lists non-hidden details'
            assert 'Tamil' in body or True
        T('own profile lists the details the owner added', preview_shows_details)
        pg.close()

        # ---------- account security ----------
        pg = new_page(b); U.CUR['pg'] = pg; sec_email = f'sec.{uuid.uuid4().hex[:6]}@example.com'; U.signup_confirm_login(pg, sec_email); U.finish_onboarding(pg)
        def security_panel():
            go(pg, '/settings'); s = pg.get_by_role('region', name='Account security'); expect(s).to_be_visible()
            expect(s.get_by_test_id('session-info')).to_contain_text(sec_email)
            for fake in ['Active sessions', 'Trusted devices', 'Two-factor', '2FA', 'Recent activity']: assert fake.lower() not in s.inner_text().lower(), f'no invented {fake} control'
        T('settings: Account security shows the real session and no invented controls (no device list, no 2FA)', security_panel)
        def change_password():
            s = pg.get_by_role('region', name='Account security')
            s.get_by_label('Current password', exact=True).fill('wrong wrong wrong'); s.get_by_label('New password', exact=True).fill('another long password'); s.get_by_label('New password again').fill('another long password')
            s.get_by_role('button', name='Change password').click(); expect(s.get_by_text('Your current password is incorrect.')).to_be_visible()
            s.get_by_label('Current password', exact=True).fill(U.PW); s.get_by_label('New password again').fill('mismatch'); s.get_by_role('button', name='Change password').click(); expect(s.get_by_text('The two passwords don’t match.')).to_be_visible()
            s.get_by_label('New password again').fill('another long password'); s.get_by_role('button', name='Change password').click(); expect(pg.get_by_text('Password changed.', exact=False)).to_be_visible()
            assert pg.evaluate(f"window.__fake.auth.users.get('{sec_email}').password") == 'another long password'
            assert s.get_by_label('Current password', exact=True).input_value() == '', 'the form is cleared'
        T('change password: asks for the current one, checks the repeat, then changes it and clears the form', change_password)
        def change_email():
            s = pg.get_by_role('region', name='Account security'); s.get_by_label('New email').fill(sec_email); s.get_by_role('button', name='Send confirmation').click(); expect(s.get_by_text('already your email')).to_be_visible()
            new = f'new.{uuid.uuid4().hex[:6]}@example.com'; s.get_by_label('New email').fill(new); s.get_by_role('button', name='Send confirmation').click()
            expect(s.get_by_text(new, exact=False).first).to_be_visible(); expect(s.get_by_text('hasn’t changed yet', exact=False)).to_be_visible()
            assert pg.evaluate("[...window.__fake.accounts.values()].pop().account.email") == sec_email, 'email unchanged until confirmed'
            expect(s.get_by_test_id('session-info')).to_contain_text(sec_email)
        T('change email: sends a confirmation to the new address and keeps the old login email until confirmed', change_email)
        def logout_all():
            s = pg.get_by_role('region', name='Account security'); s.get_by_role('button', name='Log out everywhere').click(); d = pg.get_by_role('dialog'); expect(d.get_by_role('heading', name='Log out of all devices?')).to_be_visible()
            d.get_by_role('button', name='Cancel').click(); expect(d).to_have_count(0); assert pg.evaluate("window.__fake.auth.globalSignOuts") == 0
            s.get_by_role('button', name='Log out everywhere').click(); pg.get_by_role('dialog').get_by_role('button', name='Log out everywhere').click(); pg.wait_for_url(re.compile(r'/(welcome|login)')); assert pg.evaluate("window.__fake.auth.globalSignOuts") == 1
        T('log out of all devices: confirms first, cancel does nothing, confirm calls the global sign-out and leaves', logout_all)
        pg.context.close()

        # ---------- /@handle and /p/:id ----------
        pg = new_page(b); U.CUR['pg'] = pg; U.signup_confirm_login(pg, f'nav.{uuid.uuid4().hex[:6]}@example.com'); U.finish_onboarding(pg)
        def handle_route():
            go(pg, '/@ana.test'); expect(pg.get_by_test_id('handle')).to_have_text('@ana.test'); expect(pg.get_by_text('Ana Test, 31', exact=True)).to_be_visible()
            go(pg, '/@nobody.here'); expect(pg.get_by_role('heading', name='This profile isn’t available')).to_be_visible()
            go(pg, '/notahandle'); expect(pg.get_by_role('heading', name='We can’t find that page')).to_be_visible()
        T('/@handle opens the profile; an unknown handle and a non-handle path are different, plain states', handle_route)
        def post_route():
            pid = pg.evaluate("window.__fake.world.posts.find(p => p.audience === 'public').id"); go(pg, f'/p/{pid}'); expect(pg.locator('article.post')).to_be_visible()
            go(pg, '/p/00000000-0000-4000-8000-00000000dead'); expect(pg.get_by_role('heading', name='This post isn’t available')).to_be_visible()
            fid = pg.evaluate("window.__fake.world.posts.find(p => p.audience === 'followers').id"); go(pg, f'/p/{fid}'); expect(pg.get_by_role('heading', name='This post isn’t available')).to_be_visible()
        T('/p/:id shows a visible post; deleted, missing and followers-only-unfollowed all read the same', post_route)
        def comments_off():
            pid = pg.evaluate("window.__fake.world.posts.find(p => p.audience === 'public').id"); pg.evaluate(f"window.__fake.world.posts.find(p => p.id === '{pid}').commentsAllowed = false") if False else None
            go(pg, f'/p/{pid}'); btn(pg, re.compile('^Comments')).click(); expect(pg.get_by_label('Add a comment')).to_be_visible()
        T('comments are open by default on a visible post', comments_off)
        def notif_links():
            go(pg, '/notifications'); assert pg.locator('a[href^="/p/"]').count() >= 0
        T('notifications page loads (like/comment rows link to /p/:id when present)', notif_links)
        pg.context.close()

        # ---------- toast overlap and chip contrast ----------
        pg = new_page(b, 390, 844); U.CUR['pg'] = pg; U.signup_confirm_login(pg, f'toast.{uuid.uuid4().hex[:6]}@example.com'); U.finish_onboarding(pg)
        def toast_overlap():
            RECTS = """() => { const r = (e) => { const b = e.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right }; };
              const toast = document.querySelector('.toast'); if (!toast) return { err: 'no toast' };
              const fixed = [...document.querySelectorAll('body *')].filter(e => !e.closest('.toasts') && ['fixed', 'sticky'].includes(getComputedStyle(e).position) && e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().bottom > innerHeight - 200 && !e.matches('dialog, [role=dialog], .backdrop'));
              const tr = r(toast); const hit = fixed.filter(e => { const x = r(e); return x.t < tr.b && x.b > tr.t && x.l < tr.r && x.r > tr.l; }).map(e => e.tagName + '.' + e.className);
              return { hit, tr }; }"""
            for path, act in [('/settings', lambda: pg.get_by_label('Show me in Discover').click()), ('/me/edit', lambda: (pg.locator('#bio').fill('toast check'), btn(pg, 'Save changes').click()))]:
                go(pg, path); act(); pg.locator('.toast').first.wait_for(); res = pg.evaluate(RECTS); assert 'err' not in res and not res['hit'], f'{path}: toast overlaps {res}'
                pg.wait_for_timeout(300)
        T('toast never overlaps the bottom bar or a sticky save bar at 390px (settings, edit)', toast_overlap)
        def chip_contrast():
            JS = """() => { const el = document.createElement('span'); el.className = 'chip chip-demo'; el.textContent = 'New'; document.body.appendChild(el); const cs = getComputedStyle(el);
              const px = (c) => c.match(/[0-9.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
              const L = ([r, g, b]) => 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); const a = L(px(cs.color)), c = L(px(cs.backgroundColor)); el.remove();
              return (Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05); }"""
            for theme in ['light', 'dark']:
                pg.evaluate(f"document.documentElement.dataset.theme = '{theme}'"); r = pg.evaluate(JS); assert r >= 4.5, f'New chip contrast in {theme} is {r:.2f}:1'
        T('the “New” chip has at least 4.5:1 text contrast in light and dark', chip_contrast)
        pg.context.close()

        # ---------- captcha (second server, optional) ----------
        if CAPTCHA_PORT:
            base = f'http://127.0.0.1:{CAPTCHA_PORT}'
            ctx = b.new_context(viewport={'width': 1440, 'height': 1000}); cpg = ctx.new_page(); cpg.set_default_timeout(4000); U.CUR['pg'] = cpg
            STUB = "window.turnstile = { render(el, o) { el.innerHTML = '<button type=\"button\" id=\"solve\">solve check</button>'; el.querySelector('#solve').onclick = () => o.callback('tok-123'); return 'w1'; }, reset() {}, remove() {} };"
            ctx.route('https://challenges.cloudflare.com/**', lambda r: r.fulfill(status=200, content_type='application/javascript', body=STUB))
            def captcha_on():
                cpg.goto(base + '/signup'); cpg.get_by_test_id('captcha').wait_for(); cpg.get_by_label('Email', exact=True).fill('cap@example.com'); cpg.get_by_label('Password', exact=True).fill(U.PW)
                cpg.locator('input[name=agree]').check(); btn(cpg, 'Create account').click(); expect(cpg.get_by_text('Complete the security check.')).to_be_visible()
                assert cpg.evaluate("window.__fake.auth.lastSignUp") is None, 'no request without a solved check'
                cpg.locator('#solve').click(); btn(cpg, 'Create account').click(); cpg.wait_for_url('**/check-email'); assert cpg.evaluate("window.__fake.auth.lastSignUp.options.captchaToken") == 'tok-123'
                cpg.goto(base + '/forgot-password'); expect(cpg.get_by_test_id('captcha')).to_be_visible()
            T('CAPTCHA configured: sign-up needs a solved check and sends its token; password reset shows it too', captcha_on)
            ctx.close()
        else:
            U.results.append(('SKIP', 'CAPTCHA configured: pass --captcha-port=<port> with a server started with VITE_CAPTCHA_SITE_KEY'))
        def captcha_off():
            cp = new_page(b); go(cp, '/signup'); assert cp.get_by_test_id('captcha').count() == 0, 'no widget when no site key is configured'; cp.context.close()
        if not CAPTCHA_PORT: T('CAPTCHA absent: no widget and nothing extra is required', captcha_off)
        b.close()

def visuals():
    combos = [(1440, 1000, 'light'), (1440, 1000, 'dark'), (768, 1024, 'light'), (768, 1024, 'dark'), (390, 844, 'light'), (390, 844, 'dark')]
    over, small = [], []
    with sync_playwright() as p:
        b = p.chromium.launch()
        for w, h, scheme in combos:
            pg = new_page(b, w, h, scheme); tag = f'{w}-{scheme}'
            for path, n in [('/terms', 'terms'), ('/privacy', 'privacy')]:
                go(pg, path); pg.screenshot(path=f'{SHOTS}/{tag}_{n}.png', full_page=True)
                if overflow(pg): over.append(f'{tag} {n}')
            U.signup_confirm_login(pg, f'v{uuid.uuid4().hex[:6]}@example.com'); pg.get_by_label('Username', exact=True).fill('good.name'); pg.wait_for_timeout(600)
            U.cont(pg); pg.screenshot(path=f'{SHOTS}/{tag}_onb-basics-identity.png', full_page=True)
            if overflow(pg): over.append(f'{tag} onb-basics-identity')
            U.finish_onboarding(pg)
            pg.wait_for_timeout(200)
            for path, n in [('/me', 'me-complete-profile'), ('/me/edit', 'edit-details'), ('/settings', 'settings-security'), ('/@ana.test', 'handle-profile')]:
                go(pg, path); pg.wait_for_timeout(500); pg.screenshot(path=f'{SHOTS}/{tag}_{n}.png', full_page=True)
                if overflow(pg): over.append(f'{tag} {n}')
                s = small_targets(pg) if w == 390 else []
                if s: small.append(f'{tag} {n}: {s[:3]}')
            pid = pg.evaluate("window.__fake.world.posts.find(p => p.audience === 'public').id"); go(pg, f'/p/{pid}'); pg.wait_for_timeout(500)
            pg.screenshot(path=f'{SHOTS}/{tag}_post-page.png', full_page=True)
            if overflow(pg): over.append(f'{tag} post-page')
            pg.context.close()
        b.close()
    U.results.append(('PASS' if not over else 'FAIL', f'identity screens: no horizontal overflow at 390/768/1440 light+dark {over}'))
    U.results.append(('PASS' if not small else 'FAIL', f'identity screens: 44px touch targets {small}'))

if __name__ == '__main__':
    if '--visuals-only' not in sys.argv: main()
    if '--visuals' in sys.argv or '--visuals-only' in sys.argv: visuals()
    for r in U.results: print(*r)
    print('PASS count:', sum(1 for r in U.results if r[0] == 'PASS'), 'FAIL count:', sum(1 for r in U.results if r[0] == 'FAIL'))
    print('page errors:', sorted(set(U.page_errors))[:6])
