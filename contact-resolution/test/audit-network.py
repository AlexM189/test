import pathlib
from playwright.sync_api import sync_playwright
UP='/tmp/claude-0/-home-user-test/72b18ecb-7ec2-5f74-bf1a-8437761ab746/scratchpad/fixtures/august-sample.xlsx'
FILE='file:///home/user/test/contact-resolution/index.html'
requests=[]; errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1243/chrome-linux64/chrome',args=['--no-sandbox'])
    ctx=b.new_context(viewport={'width':1240,'height':950})
    pg=ctx.new_page()
    pg.on('request', lambda r: requests.append((r.method, r.url[:110])))
    pg.on('pageerror', lambda e: errs.append('PAGEERROR '+str(e)))
    pg.on('console', lambda m: errs.append('CONSOLE '+m.type+': '+m.text[:160]) if m.type in ('error','warning') else None)
    # hard block: anything that is not this file on disk fails loudly
    pg.route('**', lambda r: r.continue_() if r.request.url.startswith('file://') else r.abort())
    pg.goto(FILE)
    pg.set_input_files('#file-input', UP)
    pg.wait_for_timeout(1200)
    # exercise everything that could plausibly phone home
    pg.evaluate("document.querySelector('details.settings').open=true")
    pg.fill('#resolution-box', pg.input_value('#resolution-box')+'\nextra phrase')
    pg.wait_for_timeout(300)
    pg.click('th[data-sort="status"]')
    pg.evaluate("document.querySelectorAll('.expand-btn')[0].click()")
    pg.evaluate("const r=document.querySelectorAll('#flagged-list .override-row input[type=radio]'); if(r[3]) r[3].click()")
    pg.wait_for_timeout(400)
    with pg.expect_download() as dl:
        pg.click('#export-csv-btn')
    csv_ok = dl.value.path() is not None
    pg.wait_for_timeout(400)

    print('=== every request the page made ===')
    for m,u in requests: print('  ', m, u)
    print('\nnon-file requests:', [u for _,u in requests if not u.startswith('file://')] or 'NONE')
    print('CSV download worked under CSP:', csv_ok)
    print('\n=== storage after a full session ===')
    print(pg.evaluate("""()=>{
      const out={};
      try{ out.localStorage = localStorage.length; }catch(e){ out.localStorage='blocked:'+e.name; }
      try{ out.sessionStorage = sessionStorage.length; }catch(e){ out.sessionStorage='blocked:'+e.name; }
      out.cookies = document.cookie || '(empty)';
      out.serviceWorkers = (navigator.serviceWorker && navigator.serviceWorker.controller) ? 'yes':'none';
      return out; }"""))
    print('indexedDB databases:', pg.evaluate("indexedDB.databases ? indexedDB.databases().then(d=>d.map(x=>x.name)) : 'n/a'"))
    print('fonts loaded locally:', pg.evaluate("document.fonts.size + ' faces; sample ready=' + document.fonts.check('600 14px \"IBM Plex Mono\"')"))
    print('\nconsole/page errors:', errs or 'none')
    b.close()
