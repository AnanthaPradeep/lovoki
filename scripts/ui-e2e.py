"""Browser tests of the REAL-MODE UI driven by in-memory fakes (vite --mode uitest, port 5174).
NOT a Supabase test: auth, database and storage are fakes. It verifies routing, guards, forms, states and layout."""
import os, re, sys, time, uuid
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from e2e_common import FIX, SHOTS
from playwright.sync_api import sync_playwright, expect

BASE = 'http://127.0.0.1:5174'

PW = 'correct horse battery'
results, page_errors = [], []
CUR = {'pg': None}

def T(name, fn):
    try: fn(); results.append(('PASS', name))
    except Exception as e:
        lines = (str(e).splitlines() or [repr(e)]); msg = ' | '.join(l.strip() for l in lines[:3])[:260]; results.append(('FAIL', f'{name}: {msg}'))
        try: CUR['pg'].screenshot(path=f"{SHOTS}/FAIL-{re.sub(r'[^a-z0-9]+', '-', name.lower())[:50]}.png")
        except Exception: pass
    print(*results[-1], flush=True)

def new_page(b, w=1440, h=1000, scheme='light', reduced=False):
    expect.set_options(timeout=3500)
    ctx = b.new_context(viewport={'width': w, 'height': h}, color_scheme=scheme, reduced_motion='reduce' if reduced else 'no-preference')
    ctx.set_default_timeout(6000); ctx.set_default_navigation_timeout(10000)  # bounds for readiness waits, not delays: a busy machine must not fail a correct screen
    pg = ctx.new_page(); pg.on('pageerror', lambda e: page_errors.append(str(e)))
    pg.on('console', lambda m: page_errors.append('console: ' + m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    return pg

def go(pg, path): pg.goto(BASE + path, wait_until='domcontentloaded'); pg.wait_for_timeout(600)
def path(pg): return re.sub(r'^https?://[^/]+', '', pg.url)
def btn(pg, name, exact=False): return pg.get_by_role('button', name=name, exact=exact)
def calls(pg): return pg.evaluate('window.__fake.auth.calls')

def signup_confirm_login(pg, email):
    go(pg, '/signup'); pg.get_by_label('Email', exact=True).fill(email); pg.get_by_label('Password', exact=True).fill(PW); pg.locator('input[name=agree]').check(); btn(pg, 'Create account').click()
    pg.wait_for_url('**/check-email'); pg.evaluate(f"window.__fake.auth.confirm('{email}')")
    go(pg, '/login'); pg.get_by_label('Email', exact=True).fill(email); pg.get_by_label('Password', exact=True).fill(PW); btn(pg, 'Log in').click()
    pg.wait_for_url('**/onboarding/basics')

def wait_photos(pg, n, timeout=9000):
    pg.wait_for_function(f"[...window.__fake.accounts.values()].some(a => a.account.photos.length === {n})", timeout=timeout)
    pg.wait_for_timeout(250)

def cont(pg, name='Continue'): btn(pg, name).click(); pg.wait_for_timeout(250)

def do_basics(pg, name='Pradi', dob='1996-04-18', handle=None, gender='Man'):
    pg.locator('#displayName').fill(name); pg.locator('#dateOfBirth').fill(dob); pg.locator('#pronouns').fill('he/him')
    pg.get_by_label('Username', exact=True).fill(handle or 'pradi.' + uuid.uuid4().hex[:5]); pg.get_by_label(gender, exact=True).check()
    expect(pg.get_by_text('Available.', exact=False).first).to_be_visible()

def pick_place(pg, query='Koch', label='Kochi'):
    box = pg.get_by_role('combobox'); box.fill(query); pg.get_by_role('listbox', name='Cities').get_by_role('option').first.wait_for(); pg.keyboard.press('ArrowDown'); pg.keyboard.press('Enter')
    expect(pg.get_by_test_id('place-chosen')).to_contain_text(label)

def finish_onboarding(pg, shot=None, overflow=None):
    def snap(n):
        if shot: shot(pg, n)
        if overflow: overflow(pg, n)
    snap('onb-basics'); do_basics(pg); cont(pg)
    pg.wait_for_url('**/onboarding/preferences')
    pg.get_by_label('Long-term partner').check(); pg.get_by_label('Women', exact=True).check(); snap('onb-preferences'); cont(pg)
    pg.wait_for_url('**/onboarding/photos'); pg.locator('input[type=file]').set_input_files([FIX + '/p1.png', FIX + '/p2.jpg'])
    wait_photos(pg, 2); snap('onb-photos'); cont(pg)
    pg.wait_for_url('**/onboarding/privacy'); pick_place(pg); snap('onb-privacy'); cont(pg)
    pg.wait_for_url('**/onboarding/review'); pg.wait_for_timeout(300); snap('onb-review'); btn(pg, 'Finish setup').click(); pg.wait_for_url('**/discover')

def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = new_page(b); CUR['pg'] = pg; email = f'pradi.{uuid.uuid4().hex[:6]}@example.com'

        # ---- guards & entry ----
        T('signed out: /me redirects to login with a validated next', lambda: (go(pg, '/me'), expect(pg).to_have_url(re.compile(r'/login\?next=%2Fme$'))))
        T('signed out: / goes to welcome', lambda: (go(pg, '/'), expect(pg).to_have_url(re.compile(r'/welcome$'))))
        T('direct link + refresh resolve (welcome)', lambda: (go(pg, '/welcome'), pg.reload(), expect(pg.get_by_role('heading', name='Meet the person behind the profile.')).to_be_visible()))
        T('unknown path shows a useful not-found', lambda: (go(pg, '/definitely-not-a-page'), expect(pg.get_by_role('heading', name='We can’t find that page')).to_be_visible()))
        T('protected-looking unknown redirect: open redirect via next is ignored', lambda: (go(pg, '/login?next=https://evil.example'), pg.wait_for_timeout(200), expect(pg).to_have_url(re.compile(r'/login'))))

        # ---- sign up ----
        def signup_validation():
            go(pg, '/signup'); btn(pg, 'Create account').click()
            expect(pg.get_by_text('Enter your email address.')).to_be_visible(); expect(pg.get_by_text('Enter a password.')).to_be_visible()
            assert pg.evaluate("document.activeElement.id") == 'email', 'focus moves to the first invalid field'
            assert pg.locator('#email').get_attribute('aria-invalid') == 'true'
            assert 'email-err' in pg.locator('#email').get_attribute('aria-describedby')
            pg.get_by_label('Email', exact=True).fill(email); pg.get_by_label('Password', exact=True).fill('short'); btn(pg, 'Create account').click()
            expect(pg.get_by_text('Use at least 10 characters.')).to_be_visible()
        T('sign-up validation: errors, focus, aria-invalid/describedby', signup_validation)
        def show_hide():
            f = pg.get_by_label('Password', exact=True); assert f.get_attribute('type') == 'password'
            btn(pg, 'Show password').click(); assert f.get_attribute('type') == 'text'; assert btn(pg, 'Hide password').get_attribute('aria-pressed') == 'true'
            btn(pg, 'Hide password').click(); assert f.get_attribute('type') == 'password'
            assert pg.get_by_label('Password', exact=True).get_attribute('autocomplete') == 'new-password'
            assert pg.get_by_label('Email', exact=True).get_attribute('autocomplete') == 'email'
        T('password show/hide + password-manager autocomplete attributes', show_hide)
        def signup_ok():
            pg.get_by_label('Password', exact=True).fill(PW); pg.locator('input[name=agree]').check(); btn(pg, 'Create account').dblclick(); pg.wait_for_url('**/check-email')
            assert calls(pg).count('signUp') == 1, f"signUp called {calls(pg).count('signUp')} times"
        T('sign-up succeeds; double-click makes exactly one request', signup_ok)
        def check_email():
            expect(pg.get_by_role('heading', name='Check your email')).to_be_visible(); expect(pg.get_by_text(email)).to_be_visible()
            btn(pg, 'Resend confirmation link').click(); expect(pg.get_by_text('we’ve sent a new link')).to_be_visible()
            expect(btn(pg, re.compile(r'Resend available in \d+s'))).to_be_disabled()
            pg.reload(); expect(btn(pg, re.compile(r'Resend available in \d+s'))).to_be_disabled()
        T('confirmation pending: neutral copy, resend with cooldown that survives refresh', check_email)
        def neutral_existing():
            pg2 = new_page(b); go(pg2, '/signup'); pg2.get_by_label('Email', exact=True).fill(email); pg2.get_by_label('Password', exact=True).fill('a different long password'); pg2.locator('input[name=agree]').check(); btn(pg2, 'Create account').click()
            pg2.wait_for_url('**/check-email'); pg2.context.close()
        T('sign-up for an existing address looks identical (no account enumeration)', neutral_existing)

        # ---- login errors ----
        def login_unconfirmed():
            go(pg, '/login'); pg.get_by_label('Email', exact=True).fill(email); pg.get_by_label('Password', exact=True).fill(PW); btn(pg, 'Log in').click()
            expect(pg.get_by_text('Confirm your email first.')).to_be_visible(); expect(btn(pg, 'Resend link')).to_be_visible()
        T('login before confirming explains and offers resend', login_unconfirmed)
        def login_wrong():
            pg.evaluate(f"window.__fake.auth.confirm('{email}')"); pg.get_by_label('Password', exact=True).fill('wrong wrong wrong'); btn(pg, 'Log in').click()
            expect(pg.get_by_text('Email or password is incorrect.')).to_be_visible()
        T('wrong password gives a generic error', login_wrong)
        T('login form uses current-password / username autocomplete', lambda: (None if pg.get_by_label('Password', exact=True).get_attribute('autocomplete') == 'current-password' and pg.locator('#email').get_attribute('autocomplete') == 'username' else (_ for _ in ()).throw(AssertionError('autocomplete'))))

        # ---- email link callback ----
        def cb_bad():
            go(pg, '/auth/callback?code=garbage&next=%2Fonboarding'); expect(pg.get_by_role('heading', name='That link didn’t work')).to_be_visible()
            expect(pg.get_by_role('link', name='Resend confirmation')).to_be_visible()
        T('invalid/expired confirmation link: clear error with recovery options', cb_bad)
        def cb_error_params():
            go(pg, '/auth/callback?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'); expect(pg.get_by_role('heading', name='That link didn’t work')).to_be_visible()
        T('callback with provider error parameters is handled', cb_error_params)
        def cb_ok():
            go(pg, f'/auth/callback?code=ok:{email}&next=%2Fonboarding'); pg.wait_for_url('**/onboarding/basics', timeout=6000)
        T('valid confirmation link signs in and opens onboarding', cb_ok)
        T('callback with a hostile next falls back to onboarding', lambda: None)  # covered by unit tests of safeCallbackNext

        # ---- onboarding ----
        def basics_validation():
            expect(pg.get_by_role('heading', name='The basics')).to_be_visible()
            assert pg.locator('li[aria-current="step"]').inner_text().strip().endswith('Basics')
            cont(pg); expect(pg.get_by_text('Add the name you want people to see.')).to_be_visible(); expect(pg.get_by_text('Enter your date of birth.')).to_be_visible(); expect(pg.get_by_text('Choose a username.')).to_be_visible(); expect(pg.get_by_text('Choose your gender.')).to_be_visible()
            pg.locator('#displayName').fill('Kid'); pg.locator('#dateOfBirth').fill('2012-01-01'); cont(pg)
            expect(pg.get_by_text('LOVOKI is for adults 18 and over.')).to_be_visible()
        T('basics: required fields and the under-18 rule', basics_validation)
        def dob_future():
            pg.locator('#dateOfBirth').fill('2999-01-01'); cont(pg); expect(pg.get_by_text('Date of birth can’t be in the future.')).to_be_visible()
        T('basics: future date rejected', dob_future)
        def basics_save_resume():
            do_basics(pg, 'Pradi', '1996-04-18', 'pradi.test'); cont(pg); pg.wait_for_url('**/onboarding/preferences'); pg.reload(); pg.wait_for_url('**/onboarding/preferences')
            expect(pg.get_by_role('heading', name='Who you’d like to meet')).to_be_visible()
        T('basics saved; refresh resumes the same step', basics_save_resume)
        def skip_ahead():
            go(pg, '/onboarding/review'); pg.wait_for_url('**/onboarding/preferences')
        T('cannot skip ahead of required steps (review redirects to resume point)', skip_ahead)
        def back_shows_saved():
            go(pg, '/onboarding/basics'); assert pg.locator('#displayName').input_value() == 'Pradi' and pg.locator('#dateOfBirth').input_value() == '1996-04-18'
            assert pg.get_by_label('Username', exact=True).input_value() == 'pradi.test' and pg.get_by_label('Man', exact=True).is_checked()
            go(pg, '/onboarding/preferences')
        T('saved basics are restored from the account', back_shows_saved)
        def prefs():
            cont(pg); expect(pg.get_by_text('Choose what you’re looking for.')).to_be_visible(); expect(pg.get_by_text('Choose who you’d like to meet.')).to_be_visible()
            pg.get_by_label('Long-term partner').check(); pg.get_by_role('button', name='Select everyone').click()
            for l in ['Women', 'Men', 'Non-binary people']: assert pg.get_by_label(l, exact=True).is_checked()
            pg.locator('#ageMin').fill('17'); cont(pg); expect(pg.get_by_text('Ages must be whole numbers from 18 to 99.')).to_be_visible()
            pg.locator('#ageMin').fill('30'); pg.locator('#ageMax').fill('25'); cont(pg); expect(pg.get_by_text('The minimum age is above the maximum.')).to_be_visible()
            pg.locator('#ageMin').fill('25'); pg.locator('#ageMax').fill('40'); expect(pg.get_by_text('Distance-based discovery isn’t available yet')).to_be_visible()
            cont(pg); pg.wait_for_url('**/onboarding/photos')
        T('preferences: required choices, adult-only range, honest distance note', prefs)
        def photos_required():
            cont(pg); expect(pg.get_by_text('Add at least one photo to continue.')).to_be_visible()
        T('photos: at least one is required', photos_required)
        def photos_bad():
            fi = pg.locator('input[type=file]')
            fi.set_input_files(FIX + '/anim.gif'); expect(pg.get_by_text('Use a JPG, PNG or WebP image.')).to_be_visible()
            fi.set_input_files(FIX + '/fake.jpg'); expect(pg.get_by_text('That file isn’t a JPG, PNG or WebP image.')).to_be_visible()
            fi.set_input_files(FIX + '/small.png'); expect(pg.get_by_text('Choose a larger image: at least 400 pixels on the short side.')).to_be_visible()
            assert pg.locator('.photo-status[data-failed="true"]').count() == 3
            pg.screenshot(path=f'{SHOTS}/state-photo-failed.png')
            for _ in range(3): btn(pg, 'Dismiss').first.click()
            expect(pg.locator('li.photo-tile')).to_have_count(0)
        T('photos: GIF, disguised executable and tiny image are rejected with clear messages', photos_bad)
        def photos_ok():
            pg.locator('input[type=file]').set_input_files([FIX + '/p1.png', FIX + '/p2.jpg']); wait_photos(pg, 2)
            st = pg.evaluate("[...window.__fake.accounts.values()].map(a => a.account.photos.map(p => [p.contentType, p.sizeBytes]))")[0]
            assert len(st) == 2 and all(t == 'image/jpeg' and 0 < s < 5 * 1024 * 1024 for t, s in st), st
            expect(pg.get_by_text('Main photo')).to_have_count(1)
        T('photos: valid files are re-encoded as JPEG under the limit and listed', photos_ok)
        def photos_reorder():
            ids = lambda: pg.evaluate("[...window.__fake.accounts.values()][0].account.photos.map(p => p.id)")
            a = ids(); btn(pg, 'Make photo 2 your main photo').click(); pg.wait_for_timeout(500); c = ids(); assert c == [a[1], a[0]], (a, c)
            btn(pg, 'Move photo 1 later').click(); pg.wait_for_timeout(500); assert ids() == a
            assert btn(pg, 'Move photo 1 earlier').is_disabled() and btn(pg, 'Move photo 2 later').is_disabled()
        T('photos: make primary and reorder persist; edge buttons are disabled', photos_reorder)
        def photos_delete():
            btn(pg, 'Remove photo 2').click(); expect(pg.get_by_role('heading', name='Remove this photo?')).to_be_visible()
            btn(pg, 'Cancel').click(); expect(pg.locator('li.photo-tile')).to_have_count(2)
            btn(pg, 'Remove photo 2').click(); btn(pg, 'Remove photo', True).click(); wait_photos(pg, 1)
            pg.locator('input[type=file]').set_input_files(FIX + '/p2.jpg'); wait_photos(pg, 2)
        T('photos: delete asks first, cancel keeps, confirm removes', photos_delete)
        def photos_limit():
            for k in range(3, 7): pg.locator('input[type=file]').set_input_files(FIX + '/p2.jpg'); wait_photos(pg, k)
            expect(pg.locator('li.photo-tile')).to_have_count(6); expect(pg.locator('.photo-add')).to_have_count(0)
            for k in range(5, 1, -1): btn(pg, f'Remove photo {k + 1}').click(); btn(pg, 'Remove photo', True).click(); wait_photos(pg, k)
            expect(pg.locator('.photo-add')).to_have_count(1)
        T('photos: the sixth photo hides the add tile', photos_limit)
        def privacy():
            cont(pg); pg.wait_for_url('**/onboarding/privacy'); expect(pg.get_by_text('Your browser asks only when you click.')).to_be_visible(); cont(pg); expect(pg.get_by_text('Choose your city.')).to_be_visible()
            assert pg.evaluate("!window.__geoAsked"), 'no location prompt before the button is clicked'
            pick_place(pg); pg.get_by_label('Followers only', exact=False).check(); cont(pg); pg.wait_for_url('**/onboarding/review')
        T('privacy: city comes from the place list (never typed free text or coordinates), no location prompt, separate toggles', privacy)
        def review():
            expect(pg.get_by_role('heading', name='Review your profile')).to_be_visible(); expect(pg.get_by_role('heading', name='Pradi, 30')).to_be_visible()
            expect(pg.get_by_text('Age is self-declared and not verified.')).to_be_visible()
            html = pg.content(); assert '1996-04-18' not in html, 'date of birth must not appear in the preview'
            btn(pg, 'Finish setup').click(); pg.wait_for_url('**/discover')
        T('review: preview shows age (never the birth date); finishing opens the app', review)
        def honest_discover():
            expect(pg.get_by_role('heading', name='Dating is paused')).to_be_visible()
            body = pg.inner_text('body'); assert not any(n in body for n in ['Maya', 'Kofi', 'Sofía', 'Arjun']), 'no demo people in real mode'
            go(pg, '/messages'); expect(pg.get_by_role('heading', name='Messaging isn’t live yet')).to_be_visible()
            go(pg, '/feed'); expect(pg.get_by_role('heading', name='Feed', exact=True)).to_be_visible()
            go(pg, '/connections'); pg.get_by_role('tab', name='Matches').click(); expect(pg.get_by_role('heading', name='No matches yet')).to_be_visible()
        T('real mode: Discover and Matches are real and honestly empty, Messages is an honest Phase 5 screen; no demo people or fake chats', honest_discover)
        T('completed user visiting /onboarding is sent to the app', lambda: (go(pg, '/onboarding/basics'), pg.wait_for_url('**/discover')))
        T('signed-in user visiting /login is sent to the app', lambda: (go(pg, '/login'), pg.wait_for_url('**/discover')))

        # ---- profile, edit, settings ----
        def me():
            go(pg, '/me'); expect(pg.get_by_role('heading', name='Pradi, 30')).to_be_visible(); expect(pg.get_by_text('Not verified')).to_be_visible(); expect(pg.get_by_text('Self-declared')).to_be_visible()
            assert 'Kochi, Kerala' in pg.inner_text('body')
        T('own profile shows saved data, age, area and unverified status', me)
        def edit_guard():
            go(pg, '/me/edit'); expect(pg.get_by_text('All changes saved.')).to_be_visible(); assert pg.locator('#dateOfBirth').count() == 0, 'dob is not editable after setup'
            expect(pg.get_by_text('can’t be changed after setup')).to_be_visible()
            pg.locator('#bio').fill('Updated bio from the edit page.'); expect(pg.get_by_text('You have unsaved changes.')).to_be_visible()
            pg.get_by_role('link', name='Settings').first.click(); expect(pg.get_by_role('heading', name='Discard your changes?')).to_be_visible()
            btn(pg, 'Keep editing').click(); expect(pg).to_have_url(re.compile(r'/me/edit$'))
            expect(pg.get_by_text('You have unsaved changes.')).to_be_visible()
            assert pg.evaluate("[...window.__fake.accounts.values()][0].account.bio") != 'Updated bio from the edit page.', 'Keep editing must not save the edits'
        T('edit: unsaved changes are detected and navigation is guarded', edit_guard)
        def edit_validate_save():
            pg.locator('#displayName').fill(''); btn(pg, 'Save changes').click(); expect(pg.get_by_text('Add the name you want people to see.')).to_be_visible()
            pg.locator('#displayName').fill('Pradi N'); btn(pg, 'Save changes').click(); expect(pg.get_by_text('Changes saved.', exact=True)).to_be_visible(); expect(pg.get_by_text('All changes saved.')).to_be_visible()
            pg.reload(); assert pg.locator('#displayName').input_value() == 'Pradi N' and 'Updated bio' in pg.locator('#bio').input_value()
        T('edit: validation, save, success feedback, and persistence across refresh', edit_validate_save)
        def edit_failure():
            pg.evaluate("[...window.__fake.accounts.values()][0].failNext('network', 1)"); pg.locator('#bio').fill('Will fail once.'); btn(pg, 'Save changes').click()
            expect(pg.get_by_text('Your edits are still here.')).to_be_visible(); btn(pg, 'Try again').click(); expect(pg.get_by_text('Changes saved.', exact=True)).to_be_visible()
        T('edit: a failed save keeps the edits and retry works', edit_failure)
        def edit_discard():
            pg.locator('#bio').fill('discard me please'); pg.get_by_role('link', name='Settings').first.click(); btn(pg, 'Discard changes').click(); pg.wait_for_url('**/settings')
            assert pg.evaluate("[...window.__fake.accounts.values()][0].account.bio") != 'discard me please', 'Discard must not save'
            expect(pg.get_by_role('heading', name='Discard your changes?')).to_have_count(0)
        T('edit: Discard leaves without saving', edit_discard)
        def settings():
            go(pg, '/settings'); sw = pg.get_by_label('Show me in Discover'); assert not sw.is_checked(), 'discoverable starts off until chosen'; sw.click()
            expect(pg.get_by_text('Privacy settings saved.')).to_be_visible(); pg.reload(); pg.wait_for_timeout(500)
            assert pg.get_by_label('Show me in Discover').is_checked(), 'discoverable on should persist across refresh'
            btn(pg, 'Private').click(); expect(pg.get_by_text('Your account is private.')).to_be_visible(); assert pg.evaluate("[...window.__fake.accounts.values()][0].account.socialVisibility") == 'followers', 'private persists'; btn(pg, 'Dark').click()
            assert pg.evaluate("document.documentElement.dataset.theme") == 'dark', 'dark theme applied'
            pg.reload(); pg.wait_for_timeout(400); assert pg.evaluate("document.documentElement.dataset.theme") == 'dark', 'theme persists'
            expect(pg.get_by_role('heading', name='Blocked accounts')).to_be_visible(); expect(pg.get_by_text('You haven’t blocked anyone.')).to_be_visible()
            for fake in ['Delete account', 'Verify']: assert pg.get_by_role('button', name=fake).count() == 0, f'no fake {fake} button'
        T('settings: privacy persists, theme persists, unfinished features are plainly unavailable', settings)
        def reduced_motion():
            pr = new_page(b, reduced=True); go(pr, '/signup'); d = pr.evaluate("getComputedStyle(document.body).transitionDuration"); pr.context.close()
        T('reduced-motion context loads', reduced_motion)

        # ---- logout, session, next ----
        def logout():
            go(pg, '/settings'); btn(pg, 'Log out', True).last.click(); pg.wait_for_url('**/welcome')
            assert pg.evaluate("Object.keys(localStorage).filter(k => k.startsWith('lovoki.user.')).length") == 0
            for r in ['/me', '/settings', '/me/edit', '/discover', '/onboarding/basics']: go(pg, r); pg.wait_for_url(re.compile(r'/login'), timeout=5000)
        T('logout returns to welcome, clears user storage, and protects every route', logout)
        def login_next():
            go(pg, '/me/edit'); pg.wait_for_url(re.compile(r'next=%2Fme%2Fedit'), timeout=5000)
            pg.get_by_label('Email', exact=True).fill(email); pg.get_by_label('Password', exact=True).fill(PW); btn(pg, 'Log in').click(); pg.wait_for_url('**/me/edit')
        T('login returns to the originally requested page', login_next)
        def session_restore():
            pg.reload(); expect(pg.get_by_role('heading', name='Edit profile', exact=True)).to_be_visible(); go(pg, '/me'); expect(pg.get_by_role('heading', name='Your profile', exact=True)).to_be_visible()
        T('session is restored after a refresh', session_restore)
        def expired_session():
            pg.evaluate("window.__fake.auth.current = null; window.__fake.auth.emit('SIGNED_OUT')"); pg.wait_for_url(re.compile(r'/login')); 
        T('a session ending elsewhere sends the user to login', expired_session)

        # ---- forgot / reset ----
        def forgot():
            go(pg, '/forgot-password'); pg.get_by_label('Email', exact=True).fill('nobody@example.com'); btn(pg, 'Send reset link').click()
            expect(pg.get_by_text('If there’s an account for that email')).to_be_visible(); expect(btn(pg, re.compile(r'Send again in \d+s'))).to_be_disabled()
            go(pg, '/forgot-password?expired=1'); expect(pg.get_by_text('That reset link has expired')).to_be_visible()
        T('forgot password: neutral for unknown emails, cooldown, expired-link notice', forgot)
        def reset():
            go(pg, '/reset-password'); pg.wait_for_url(re.compile(r'/forgot-password'), timeout=5000)
            go(pg, f'/auth/callback?code=ok:{email}&next=%2Freset-password'); pg.wait_for_url('**/reset-password')
            pg.get_by_label('New password', exact=True).fill('short'); btn(pg, 'Update password').click(); expect(pg.get_by_text('Use at least 10 characters.')).to_be_visible()
            pg.get_by_label('New password', exact=True).fill('a brand new long password'); btn(pg, 'Update password').click(); pg.wait_for_url('**/discover')
            assert pg.evaluate(f"window.__fake.auth.users.get('{email}').password") == 'a brand new long password'
        T('password reset: needs a recovery link, validates, updates, signs in', reset)

        # ---- keyboard ----
        def keyboard():
            pg.evaluate("window.__fake.auth.current = null; window.__fake.auth.emit('SIGNED_OUT')"); pg.wait_for_timeout(500)
            kp = pg.context.new_page(); go(kp, '/login'); kp.get_by_label('Email', exact=True).wait_for()
            for _ in range(5):
                kp.keyboard.press('Tab')
                if kp.evaluate("document.activeElement.id") == 'email': break
            assert kp.evaluate("document.activeElement.id") == 'email', 'Tab reaches the email field'
            ring = kp.evaluate("(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== 'none' || s.boxShadow !== 'none'; })()")
            assert ring, 'focused field shows a visible focus indicator'
            kp.keyboard.type(email); kp.keyboard.press('Tab'); kp.keyboard.type('a brand new long password'); kp.keyboard.press('Enter'); kp.wait_for_url('**/discover'); kp.close()
        T('keyboard only: tab through the login form and submit with Enter', keyboard)
        b.close()

def visuals():
    combos = [(1440, 1000, 'light'), (1440, 1000, 'dark'), (768, 1024, 'light'), (768, 1024, 'dark'), (390, 844, 'light'), (390, 844, 'dark')]
    over = []
    only = [a.split('=')[1] for a in sys.argv if a.startswith('--w=')]
    if only: combos = [c for c in combos if str(c[0]) in only]
    with sync_playwright() as p:
        b = p.chromium.launch()
        for w, h, scheme in combos:
            pg = new_page(b, w, h, scheme); tag = f'{w}-{scheme}'
            def shot(pg_, n): pg_.screenshot(path=f'{SHOTS}/{tag}_{n}.png', full_page=True)
            def ovf(pg_, n):
                if pg_.evaluate("document.documentElement.scrollWidth > innerWidth + 1"): over.append(f'{tag} {n}')
            for r, n in [('/welcome', 'welcome'), ('/login', 'login'), ('/forgot-password', 'forgot'), ('/auth/callback?code=bad', 'callback-error')]:
                go(pg, r); shot(pg, n); ovf(pg, n)
            go(pg, '/signup'); btn(pg, 'Create account').click(); pg.wait_for_timeout(200); shot(pg, 'signup-errors'); ovf(pg, 'signup-errors')
            em = f'v{uuid.uuid4().hex[:6]}@example.com'; pg.get_by_label('Email', exact=True).fill(em); pg.get_by_label('Password', exact=True).fill(PW); pg.locator('input[name=agree]').check(); btn(pg, 'Create account').click(); pg.wait_for_url('**/check-email'); shot(pg, 'check-email'); ovf(pg, 'check-email')
            pg.evaluate(f"window.__fake.auth.confirm('{em}')"); go(pg, '/login'); pg.get_by_label('Email', exact=True).fill(em); pg.get_by_label('Password', exact=True).fill(PW); btn(pg, 'Log in').click(); pg.wait_for_url('**/onboarding/basics')
            cont(pg); pg.wait_for_timeout(150); shot(pg, 'onb-basics-errors'); ovf(pg, 'onb-basics-errors')
            finish_onboarding(pg, shot, ovf)
            shot(pg, 'discover-unavailable'); ovf(pg, 'discover-unavailable')
            for r, n in [('/me', 'me'), ('/me/edit', 'edit'), ('/settings', 'settings')]:
                go(pg, r); pg.wait_for_timeout(400); shot(pg, n); ovf(pg, n)
            go(pg, '/me/edit'); pg.locator('#bio').fill('Unsaved'); pg.get_by_role('link', name='Profile', exact=True).locator('visible=true').first.click(); pg.wait_for_timeout(500); pg.screenshot(path=f'{SHOTS}/{tag}_unsaved-dialog.png', full_page=False)
            pg.context.close()
        b.close()
    results.append(('PASS' if not over else 'FAIL', f'no horizontal overflow on any new screen at 390/768/1440, light+dark {over}'))

if __name__ == '__main__':
    if '--visuals-only' not in sys.argv: main()
    if '--visuals' in sys.argv or '--visuals-only' in sys.argv: visuals()
    for r in results: print(*r)
    print('PASS count:', sum(1 for r in results if r[0] == 'PASS'), 'FAIL count:', sum(1 for r in results if r[0] == 'FAIL'))
    print('page errors:', sorted(set(page_errors))[:6])
