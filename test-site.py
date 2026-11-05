"""Offline static smoke checks for Crypto Bridge. Run: python test-site.py"""
from html.parser import HTMLParser
from pathlib import Path
import re, subprocess, sys
ROOT = Path(__file__).resolve().parent
failures, passed = [], []
def check(name, ok, detail=''):
    (passed if ok else failures).append((name, detail))
class SiteParser(HTMLParser):
    def __init__(self):
        super().__init__(); self.ids=[]; self.assets=[]; self.errors=[]; self.tags=[]
    def handle_starttag(self, tag, attrs):
        attrs=dict(attrs); self.tags.append(tag)
        if attrs.get('id'):
            if attrs['id'] in self.ids: self.errors.append('duplicate id: '+attrs['id'])
            self.ids.append(attrs['id'])
        if tag=='script' and attrs.get('src'): self.assets.append(attrs['src'])
        if tag=='link' and attrs.get('rel')=='stylesheet': self.assets.append(attrs.get('href',''))
html=(ROOT/'index.html').read_text(encoding='utf-8')
js=(ROOT/'app.js').read_text(encoding='utf-8')
css=(ROOT/'style.css').read_text(encoding='utf-8')
admin=(ROOT/'admin.html').read_text(encoding='utf-8')
admin_js=(ROOT/'admin.js').read_text(encoding='utf-8')
p=SiteParser(); p.feed(html); p.close()
check('HTML parses', bool(p.tags))
check('No duplicate HTML IDs', not p.errors, ', '.join(p.errors))
local_assets=[a.lstrip('/') for a in p.assets if a.startswith('/')]
check('Linked local assets exist', all((ROOT/a).is_file() for a in local_assets), ', '.join(a for a in local_assets if not (ROOT/a).is_file()))
check('Viewport metadata exists', 'name="viewport"' in html)
check('Accessible main navigation exists', 'aria-label="Main navigation"' in html)
check('Simulated winner content is clearly disclosed', 'DEMO / SIMULATED' in js and 'not actual user earnings' in js)
check('No external script dependency', not re.search(r'<script[^>]+src=["\']https?://', html, re.I))
check('Public app pages have render handlers', all(f"page === '{x}'" in js or f"page === '{x}'" in js for x in ['Home','Quotes','Assets','Recharge','Withdrawal','Team','Invite','Bonus','Games','Service','Guide']))
check('Language preference persists', 'cryptoBridgeLanguage' in js and 'localStorage.setItem' in js)
check('Language observer avoids unchanged text writes', 'if(node.nodeValue !== nextValue)' in js)
check('Language observer covers the full app shell', 'const target=document.body' in js and 'applyLanguage(document.body || main)' in js)
check('Assets menu contains a language selector', 'id="wlLanguageSelect"' in js and "wlLang.onchange=()=>setLanguage" in js)
check('Panel-wise support buttons are rendered', 'supportButtonsHtml()' in js and 'supportButtons' in admin_js)
check('Chart has zoom and latest controls', 'data-zoom="in"' in js and 'data-chart-home' in js)
check('Chart supports pointer drag and momentum', "addEventListener('pointermove'" in js and 'dragVelocity' in js and 'requestAnimationFrame(animate)' in js)
check('Admin page and script are linked', '/admin.js' in admin and (ROOT/'admin.js').is_file())
check('Responsive CSS exists', '@media(max-width:650px)' in css or '@media(max-width: 650px)' in css or '@media(max-width:600px)' in css)
check('Core server files exist', all((ROOT/x).is_file() for x in ['server.js','index.html','style.css','app.js','admin.html','admin.js']))
for name,detail in passed: print('PASS:',name)
for name,detail in failures: print('FAIL:',name,detail)
print(f'\nRESULT: {len(passed)} passed, {len(failures)} failed')
if failures: sys.exit(1)
