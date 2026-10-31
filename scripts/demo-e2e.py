"""Phase 1 demo-mode browser checks (sample data, no Supabase). Run against: vite --port 5175 (default demo mode)."""
import os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from e2e_common import FIX, SHOTS
from playwright.sync_api import sync_playwright, expect
from playwright.sync_api import Page
_goto = Page.goto
def _goto_ready(self, url, **kw):
    """The demo root is lazy-loaded: wait until a screen has rendered instead of assuming a fixed delay."""
    r = _goto(self, url, **kw)
    self.wait_for_selector('main#main :is(h1, h2, .chat)', timeout=8000); self.wait_for_timeout(300)
    return r
Page.goto = _goto_ready

B='http://127.0.0.1:5175'; results=[]; errs=[]
def ok(name, cond): results.append(('PASS' if cond else 'FAIL', name))
with sync_playwright() as p:
    b=p.chromium.launch(); c=b.new_context(viewport={'width':1440,'height':1000}); c.set_default_timeout(4000); pg=c.new_page()
    pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.goto(B+'/discover'); pg.wait_for_timeout(400)
    # filters actually change results
    pg.get_by_role('button',name=re.compile(r'^Filters')).click()
    pg.get_by_role('dialog').get_by_role('button',name='Ceramics').click()
    pg.get_by_role('button',name='Show 1 person').click(); pg.wait_for_timeout(200)
    ok('filter Ceramics -> 1 person', pg.get_by_text('1 person to meet').is_visible())
    pg.get_by_role('button',name=re.compile(r'^Filters')).click(); pg.get_by_role('button',name='Reset filters').first.click()
    pg.get_by_role('button',name='Show 11 people').click(); pg.wait_for_timeout(200)
    ok('reset filters -> 11', pg.get_by_text('11 people to meet').is_visible())
    # empty-by-filter state
    pg.get_by_role('button',name=re.compile(r'^Filters')).click(); pg.get_by_role('dialog').get_by_role('button',name='Diving').click(); pg.get_by_role('dialog').get_by_role('button',name='Still figuring it out').click()
    pg.get_by_role('dialog').get_by_role('button',name='Show 0 people').click(); pg.wait_for_timeout(200)
    ok('filtered empty state', pg.get_by_text('No one matches these filters').is_visible())
    pg.screenshot(path=SHOTS + '/state-empty-filter.png')
    pg.get_by_role('button',name='Reset filters').first.click(); pg.wait_for_timeout(200)
    # mutual match with Maya (first card)
    pg.get_by_role('button',name='Like Maya').click(); pg.wait_for_timeout(900)
    ok('mutual match dialog', pg.get_by_role('heading',name='It’s mutual').is_visible())
    pg.screenshot(path=SHOTS + '/state-match.png')
    pg.get_by_role('button',name='Send a message').click(); pg.wait_for_timeout(300)
    ok('chat with Maya opens with starter', pg.get_by_text('You and Maya matched').is_visible())
    pg.get_by_role('textbox',name='Message Maya').fill('Hi Maya, ash glazes please.'); pg.keyboard.press('Enter'); pg.wait_for_timeout(900)
    ok('message delivered', pg.get_by_text('Delivered').is_visible() and pg.get_by_text('Hi Maya, ash glazes please.').is_visible())
    # failure + retry
    pg.goto(B+'/settings'); pg.get_by_text('Simulate failed network actions').click()
    pg.goto(B+'/messages/maya'); pg.get_by_role('textbox',name='Message Maya').fill('This one fails'); pg.keyboard.press('Enter'); pg.wait_for_timeout(900)
    ok('failed message shows retry', pg.get_by_text('Not sent').is_visible())
    pg.screenshot(path=SHOTS + '/state-failed.png')
    pg.goto(B+'/settings'); pg.get_by_text('Simulate failed network actions').click()
    pg.goto(B+'/messages/maya'); pg.get_by_role('button',name='Retry').click(); pg.wait_for_timeout(900)
    ok('retry delivers', pg.locator('.bubble-meta.err').count()==0)
    # non-match like (Arjun) doesn't match; follow doesn't unlock messages
    pg.goto(B+'/u/arjun'); pg.get_by_role('button',name='Follow posts').click(); pg.wait_for_timeout(100)
    pg.goto(B+'/messages/arjun'); pg.wait_for_timeout(200)
    ok('follow does not unlock messages', pg.get_by_text('This conversation isn’t available').is_visible())
    # feed like/save/comment
    pg.goto(B+'/feed'); first=pg.locator('article.post').first
    before=first.locator('.count').first.inner_text(); first.get_by_role('button',name='Like post').click()
    ok('feed like toggles count', int(first.locator('.count').first.inner_text())==int(before)+1)
    first.get_by_role('button',name='Save post').click(); ok('save toggles', first.get_by_role('button',name='Remove from saved').is_visible())
    first.get_by_role('button',name='Comments').click(); first.get_by_label('Add a comment').fill('Beautiful work'); first.get_by_role('button',name='Post',exact=True).click()
    ok('comment added', first.get_by_text('Beautiful work').is_visible())
    # composer with local image
    pg.get_by_role('button',name='New post').click()
    pg.locator('input[type=file]').set_input_files(FIX + '/upload.png'); pg.wait_for_timeout(300)
    ok('image preview shown', pg.get_by_role('dialog').locator('img[alt="Your photo"]').is_visible())
    pg.get_by_label('Caption',exact=True).fill('Testing the composer'); pg.get_by_role('radio',name='Followers').check()
    pg.screenshot(path=SHOTS + '/state-composer.png')
    pg.get_by_role('button',name='Publish').click(); pg.wait_for_timeout(900)
    ok('post published to feed', pg.locator('article.post').first.get_by_text('Testing the composer').is_visible() and pg.locator('article.post').first.get_by_text('Followers only').is_visible())
    # edit profile validation + save
    pg.goto(B+'/me/edit'); pg.get_by_label('Age',exact=True).fill('17'); pg.get_by_label('Name',exact=True).fill(''); pg.get_by_role('button',name='Save changes').click()
    ok('validation errors shown', pg.get_by_text('LOVOKI is for adults 18 and over.').is_visible() and pg.get_by_text('Fix 2 fields before saving.').is_visible())
    pg.screenshot(path=SHOTS + '/state-validation.png', full_page=True)
    pg.get_by_label('Age',exact=True).fill('31'); pg.get_by_label('Name',exact=True).fill('Pradi N'); pg.get_by_label('Pronouns',exact=True).fill('he/him'); pg.get_by_role('button',name='Save changes').click(); pg.wait_for_timeout(300)
    ok('profile change appears', pg.get_by_role('heading',name='Pradi N, 31').is_visible() and pg.get_by_text('he/him').is_visible())
    # block Kofi from feed -> removed everywhere
    pg.goto(B+'/u/kofi'); pg.get_by_role('button',name='More options for Kofi').click(); pg.get_by_role('menuitem',name='Block Kofi').click()
    pg.get_by_role('dialog').get_by_role('button',name='Block').click(); pg.wait_for_timeout(300)
    pg.goto(B+'/feed'); pg.get_by_role('tab',name='Explore').click()
    ok('blocked user gone from feed', pg.locator('article.post', has_text='Kofi').count()==0)
    pg.goto(B+'/connections'); pg.get_by_role('tab',name='Following').click()
    ok('blocked user gone from following', pg.locator('.list-row', has_text='Kofi').count()==0)
    pg.goto(B+'/settings'); ok('blocked list shows Kofi', pg.locator('.list-row', has_text='Kofi').count()==1)
    # report flow
    pg.goto(B+'/messages/theo'); pg.get_by_role('button',name='Conversation options').click(); pg.get_by_role('menuitem',name='Report').click()
    pg.get_by_role('button',name='Submit report').click(); ok('report requires reason', pg.get_by_text('Choose a reason').is_visible())
    pg.get_by_role('radio',name='Scam or spam').check(); pg.get_by_role('button',name='Submit report').click(); pg.wait_for_timeout(900)
    ok('report saved toast', pg.get_by_text('Report saved on this device').is_visible())
    # unmatch with confirm
    pg.get_by_role('button',name='Conversation options').click(); pg.get_by_role('menuitem',name='Unmatch').click()
    pg.get_by_role('dialog').get_by_role('button',name='Unmatch').click(); pg.wait_for_timeout(300)
    ok('unmatch removes conversation', pg.locator('.list-row', has_text='Theo').count()==0)
    # unread
    ok('unread badge in nav', pg.locator('.sidebar .badge').first.inner_text()=='2')
    # theme + persistence
    pg.goto(B+'/settings'); pg.get_by_role('button',name='Dark').click()
    ok('dark theme applied', pg.evaluate("document.documentElement.dataset.theme")=='dark')
    pg.reload(); pg.wait_for_timeout(400)
    ok('state persists across reload', pg.evaluate("document.documentElement.dataset.theme")=='dark' and pg.locator('.list-row', has_text='Kofi').count()==1)
    pg.get_by_role('button',name='Reset demo').click(); pg.get_by_role('dialog').get_by_role('button',name='Reset demo').click(); pg.wait_for_timeout(400)
    ok('reset demo restores', pg.locator('.list-row', has_text='Kofi').count()==0 and pg.evaluate("document.documentElement.dataset.theme") is None)
    # broken image fallback: Hiro
    pg.route('**/invalid.lovoki.example/**', lambda r: r.abort())  # deterministic: do not depend on how this network resolves DNS
    pg.goto(B+'/u/hiro')
    try: pg.get_by_text('Photo unavailable').first.wait_for(state='visible', timeout=8000)
    except Exception: pass
    ok('broken image fallback', pg.get_by_text('Photo unavailable').first.is_visible())
    pg.screenshot(path=SHOTS + '/state-broken-image.png')
    # keyboard: pass via arrow key
    pg.goto(B+'/discover'); pg.wait_for_timeout(300); pg.keyboard.press('ArrowLeft'); pg.wait_for_timeout(400)
    ok('arrow-left passes', pg.get_by_role('heading',name='Arjun, 32').is_visible())
    # tab focus visibility
    pg.keyboard.press('Tab'); pg.keyboard.press('Tab')
    ok('focus outline visible', pg.evaluate("getComputedStyle(document.activeElement).outlineStyle")=='solid')
    pg.screenshot(path=SHOTS + '/state-focus.png')
    # horizontal overflow check at 390
    m=b.new_context(viewport={'width':390,'height':844}).new_page()
    over=[]
    for r in ['/discover','/feed','/connections','/messages','/messages/sofia','/u/mateo','/me','/me/edit','/settings']:
        m.goto(B+r); m.wait_for_timeout(300)
        if m.evaluate("document.documentElement.scrollWidth > innerWidth+1"): over.append(r)
    ok(f'no horizontal overflow at 390px {over}', not over)
    m.goto(B+'/discover'); m.wait_for_timeout(300)
    ok('like button above fold on 390x844', m.get_by_role('button',name='Like Maya').bounding_box()['y']+64 <= 844-56)
    b.close()
for r in results: print(*r)
print('page errors:', errs)
