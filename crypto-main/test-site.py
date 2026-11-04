"""Offline smoke tests for the Crypto Bridge static demo. Run: python test-site.py"""
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
p=SiteParser(); p.feed(html); p.close()
check('HTML parses', bool(p.tags))
check('No duplicate HTML IDs', not p.errors, ', '.join(p.errors))
check('Linked local assets exist', all((ROOT/a).is_file() for a in p.assets), ', '.join(a for a in p.assets if not (ROOT/a).is_file()))
check('Viewport metadata exists', 'name="viewport"' in html)
check('Accessible main navigation exists', 'aria-label="Main navigation"' in html)
check('Demo disclaimer exists', 'Prototype only' in html and 'No real accounts' in html)
check('No external script dependency', not re.search(r'<script[^>]+src=["\']https?://', html, re.I))
check('All expected pages have render handlers', all(f"page === '{x}'" in js for x in ['Home','Quotes','Assets','Team','Bonus','Recharge','Withdrawal','Signal','Service','Invite','Guide']))
check('Search controls are implemented', 'function renderAssetRows' in js and "addEventListener('input'" in js)
check('Demo forms explicitly do not transact', 'No payment integration' in js and 'No ${isRecharge?' in js)
check('Responsive CSS exists', '@media(max-width:650px)' in css)
check('Static deployment files in root', all((ROOT/x).is_file() for x in ['index.html','style.css','app.js','README.txt']))
res=subprocess.run(['node','--check',str(ROOT/'app.js')],capture_output=True,text=True)
check('JavaScript syntax check', res.returncode==0, res.stderr.strip())
for name,detail in passed: print('PASS:',name)
for name,detail in failures: print('FAIL:',name,detail)
print(f'\nRESULT: {len(passed)} passed, {len(failures)} failed')
if failures: sys.exit(1)
