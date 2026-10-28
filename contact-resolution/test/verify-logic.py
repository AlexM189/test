from playwright.sync_api import sync_playwright
FIX='/tmp/claude-0/-home-user-test/72b18ecb-7ec2-5f74-bf1a-8437761ab746/scratchpad/fixtures/'
FILE='file:///home/user/test/contact-resolution/index.html'
results=[]
def check(name, got, want):
    ok = got==want
    results.append(ok)
    print(('  PASS  ' if ok else '  FAIL  ')+name)
    if not ok: print(f'          got {got!r}  want {want!r}')

def snapshot(pg):
    """case number -> (status label, notes, days) straight from the rendered table"""
    out={}
    for tr in pg.query_selector_all('#case-tbody tr.case-row'):
        td=[t.inner_text().strip() for t in tr.query_selector_all('td')]
        out[td[1].replace(' ↻','').strip()] = (td[5].replace('\n',' ').strip(), td[4], td[7])
    return out

with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1243/chrome-linux64/chrome',args=['--no-sandbox'])
    pg=b.new_page(viewport={'width':1280,'height':950})
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**', lambda r: r.continue_() if r.request.url.startswith('file://') else r.abort())

    # ---------------- August sample ----------------
    pg.goto(FILE); pg.set_input_files('#file-input', FIX+'august-sample.xlsx'); pg.wait_for_timeout(900)
    print('\n== August sample (15 notes, 5 cases) ==')
    check('Target A rate', pg.inner_text('#kpi-first-value'), '40%')
    check('Target A detail', pg.inner_text('#kpi-first-sub'), '2 of 5 cases')
    check('Target B rate', pg.inner_text('#kpi-second-value'), '66.7%')
    check('Target B denominator is every re-opened case', pg.inner_text('#kpi-second-sub'), '2 of 3 remaining cases')
    snap=snapshot(pg)
    check('Rule 2 — single note closes on first contact (12011542)', snap['12011542'][0], 'First contact')
    check('Rule 2 — single note closes on first contact (12079315)', snap['12079315'][0], 'First contact')
    check('Rule 3 — 9-note case resolves at the first RESOLUTION note, not note 2', snap['11997868'][2], '14')
    check('Rule 3 — that case is > 2 days', snap['11997868'][0], 'Resolved > 2 days')
    check('Rule 4 — next-day resolution counts 1 calendar day (12071037)', snap['12071037'][2], '1')
    check('Rule 4 — same-day resolution counts 0 (12169934)', snap['12169934'][2], '0')
    # the matched phrase, straight from the expanded row
    pg.evaluate("document.querySelectorAll('#case-tbody tr.case-row')[3].querySelector('.expand-btn').click()")
    pg.wait_for_timeout(200)
    v=[x.inner_text() for x in pg.query_selector_all('.verdict-line')]
    check('Resolution phrase reported for 11997868', any('closing case' in t for t in v), True)
    check('Flagged count on the August sample', pg.inner_text('#flag-count'), '1')

    # ---------------- edge cases ----------------
    pg.goto(FILE); pg.set_input_files('#file-input', FIX+'edge-cases.xlsx'); pg.wait_for_timeout(900)
    print('\n== edge cases ==')
    snap=snapshot(pg)
    check('Rule 2 — "escalated / no response" single note still closes', snap['E-SINGLE'][0], 'First contact')
    check('Rule 3 — placeholder chain never resolves', snap['E-NEVER'][0], 'Unresolved')
    check('Rule 4 — 23:50 -> 00:10 next day is 1 calendar day', snap['E-MIDNIGHT'][2], '1')
    check('Rule 3 — scan skips placeholders and lands on the later resolution', snap['E-LATE'][2], '8')
    check('Telemetry "Status: ACTIVE" does not count as a resolution', snap['E-TELEMETRY'][0], 'Unresolved')
    check('Non-phone case excluded while the scope toggle is on', 'E-EMAIL' in snap, False)
    check('Text-formatted date parsed', snap.get('E-TEXTDATE',('missing',))[0], 'Resolved ≤ 2 days')
    check('Row with no case number dropped, and reported', 'row(s) skipped' in pg.inner_text('#file-name'), True)

    # unresolved handling: breach (default) vs excluded
    before = pg.inner_text('#kpi-second-sub')
    pg.evaluate("document.querySelector('details.settings').open=true")
    pg.select_option('#unresolved-mode','exclude'); pg.wait_for_timeout(400)
    after = pg.inner_text('#kpi-second-sub')
    # in scope: E-SINGLE (first contact) + 5 re-opened, of which 2 close inside the window
    # and 2 never resolve (E-NEVER, E-TELEMETRY)
    check('Rule 5 — never-resolved sits in the denominator by default', before, '2 of 5 remaining cases')
    check('Rule 5 — "excluded" drops them from the population', after, '2 of 3 remaining cases')
    pg.select_option('#unresolved-mode','breach'); pg.wait_for_timeout(300)

    # scope toggle brings the email case back
    pg.uncheck('#origin-filter'); pg.wait_for_timeout(400)
    check('Scope toggle off includes non-phone cases', 'E-EMAIL' in snapshot(pg), True)
    pg.check('#origin-filter'); pg.wait_for_timeout(300)

    # override beats the automatic read, and the automatic read survives in the export
    pg.evaluate("""const r=[...document.querySelectorAll('#flagged-list .override-row input[type=radio]')];
                   const reason=document.querySelector('#flagged-list .ov-reason');
                   if(reason) reason.value='checked in CRM';
                   if(r[1]) r[1].click();""")   # 'Resolved on first contact'
    pg.wait_for_timeout(500)
    snap=snapshot(pg)
    check('Override wins over the phrase match', snap['E-NEVER'][0].startswith('First contact'), True)
    with pg.expect_download() as dl: pg.click('#export-csv-btn')
    csv=open(dl.value.path(),encoding='utf-8-sig').read().splitlines()
    row=[l for l in csv if l.startswith('E-NEVER')][0]
    check('CSV keeps the automatic verdict beside the manual one', 'manual' in row and 'unresolved' in row, True)
    print('\n  csv row:', row[:170])

    print('\npage errors:', errs or 'none')
    print(f'\n==== {sum(results)}/{len(results)} checks passed ====')
    b.close()
