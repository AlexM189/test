"""Rebuild the August sample as an xlsx fixture.

Same five case numbers, timestamps, agents and households as the real export, with
the sentences that actually drive classification kept verbatim, so the report's
numbers can be checked against the ones established for that file.
"""
import openpyxl, datetime as dt
wb = openpyxl.Workbook()
hidden = wb.active; hidden.title = 'hiddenSheet'        # mimics the CRM's helper sheet
hidden['A1'] = 'annotation:xxxx'; hidden['A2'] = 'Inbound Phone'
ws = wb.create_sheet('Sheet2')
ws.append(['Description','Created By','Created On','Case Number (Regarding) (Case)',
           'Case Origin (Regarding) (Case)','Household (Regarding) (Case)'])

D = lambda s: dt.datetime.strptime(s, '%Y-%m-%d %H:%M:%S')
rows = [
 # case 11997868 — 9 notes, "Closing case." at note 7, more notes after it
 ("Member contacted support reporting that their router was no longer functioning.\nTroubleshooting was completed during the call, beginning with a power cycle.\nBased on the troubleshooting results, a router replacement was initiated.\nFollow-up call scheduled for tomorrow to assist the member.\nCase remains owned pending follow-up.", 'Agent 1', '2026-08-13 13:15:56', '11997868'),
 ("BS QC done. Please create a new RO since someone from FF canceled it.", 'Agent 2', '2026-08-13 19:13:21', '11997868'),
 ("Verified and confirmed the member's shipping address during the phone call", 'Agent 1', '2026-08-14 07:21:20', '11997868'),
 ("Created a new RO for the member's request.\nSent a follow-up email containing the necessary instructions.\nAdvised the member to contact support if additional assistance is required.", 'Agent 1', '2026-08-17 15:24:56', '11997868'),
 ("The PM has called in stating the light on the new router is a blue green, flashing light, but after checking the PMC I've noticed it is inactive.\nAdvised her to call us back whenever her son is available to help us troubleshoot.", 'Agent 3', '2026-08-24 06:35:16', '11997868'),
 ("The PM called stating that her son tried to install the router but was unable to complete the installation process, and the router remains inactive.\nI informed the PM that a technician will call her within 48 hours to schedule the installation.\n\nFF: 3615177", 'Agent 1', '2026-08-27 08:57:59', '11997868'),
 ("Closing case.", 'Agent 4', '2026-08-27 09:00:10', '11997868'),
 ("PM reported not receiving a callback from the installation team regarding router setup.\nProvided the installation team phone number and hours of operation.\nResponse sent.", 'Agent 5', '2026-08-31 11:55:56', '11997868'),
 ("PM replied thanking us and stated that they will follow the instructions provided.\n\nI sent a reply thanking the PM for their response.", 'Agent 6', '2026-08-31 15:14:38', '11997868'),
 # case 12011542 — single note, mentions a restriction and a pending request
 ("The member called us because he couldn't claim his points.\nExplained the safety hold on the profile after a recent profile update.\nMember stated that they would contact support again once home to proceed with the household request.\n\nScreenwise Router\nLast heartbeat: 2026-08-13T17:16:36.717Z\nStatus: ACTIVE", 'Agent 1', '2026-08-13 10:08:49', '12011542'),
 # case 12071037 — 2 notes, resolved next day ("became active on PMC")
 ("Member contacted support reporting issues with the router and expressed the belief that a replacement device may be needed.\nMember agreed to contact support again once home so that troubleshooting can be completed.\nNo replacement was processed at this time pending completion of troubleshooting.\n\nScreenwise Routers\nStatus: INACTIVE", 'Agent 1', '2026-08-13 11:53:17', '12071037'),
 ("The PM called back, as advised by us.\nShe turned on the router, it booted up with no issues and became active on PMC as well.\nThe PM took a picture of the password and will connect her devices to the Nokia Wi-Fi network too.", 'Agent 12', '2026-08-14 07:32:24', '12071037'),
 # case 12079315 — single note
 ("PM called because he didn't get the points for the Mobile app from his phone and asked what happened. I told him to reinstall the App and disregard the safari prompt.\nScreenwise Router:\n- Last Heartbeat: 2026-08-21T15:10:17.453Z\nTV Devices:\n- State: Active", 'Agent 10', '2026-08-21 08:16:28', '12079315'),
 # case 12169934 — 2 notes, resolved same day ("managed to connect")
 ("PM called and said that he can't connect to Nokia's network and his TVMs aren't working either.\nPM said he will contact Spectrum and check to see if there are any issues on their end and then will call back.\n\nTV Devices: NXKL3AA00132807C557600\n- State: PAUSED", 'Agent 10', '2026-08-06 09:43:26', '12169934'),
 ("PM called in as he checked with Spectrum and they said that there are no issues.\nI simply advised the PM to try to connect his phone to the router while using the password from the label and managed to connect.\nAfter a short period of time, all devices including the TVMs started to connect back to the SW router.\nPM thanked and the call ended.", 'Agent 11', '2026-08-06 11:50:04', '12169934'),
]
hh = {'11997868':'820790-SOW2','12011542':'970640-SOW2','12071037':'1030132-SOW2',
      '12079315':'899235-SOW2','12169934':'821422-SOW2'}
for desc, by, when, case in rows:
    ws.append([desc, by, D(when), case, 'Inbound Phone', hh[case]])
wb.save('/tmp/claude-0/-home-user-test/72b18ecb-7ec2-5f74-bf1a-8437761ab746/scratchpad/fixtures/august-sample.xlsx')
print('august-sample.xlsx:', len(rows), 'notes,', len(hh), 'cases')

# ---- edge-case fixture: placeholder chains, never-resolved, non-phone, text dates ----
wb2 = openpyxl.Workbook(); w2 = wb2.active; w2.title = 'Notes'
w2.append(['Description','Created By','Created On','Case Number','Case Origin','Household'])
edge = [
 ("Member called, router dead. Escalated to tier 2, member did not respond.", 'A', '2026-09-01 09:00:00', 'E-SINGLE', 'Inbound Phone'),
 ("Member called about missing points.", 'A', '2026-09-01 09:00:00', 'E-NEVER', 'Inbound Phone'),
 ("LMOM", 'A', '2026-09-02 09:00:00', 'E-NEVER', 'Inbound Phone'),
 ("Attempted contact again — no answer.", 'B', '2026-09-08 09:00:00', 'E-NEVER', 'Inbound Phone'),
 ("Member called: meter offline.", 'A', '2026-09-01 23:50:00', 'E-MIDNIGHT', 'Inbound Phone'),
 ("Swapped the cable, meter is up and running.", 'B', '2026-09-02 00:10:00', 'E-MIDNIGHT', 'Inbound Phone'),
 ("Member called about a replacement that never arrived.", 'A', '2026-09-01 10:00:00', 'E-LATE', 'Inbound Phone'),
 ("LMOM", 'A', '2026-09-02 10:00:00', 'E-LATE', 'Inbound Phone'),
 ("Replacement shipped, tracking sent to the member.", 'C', '2026-09-09 10:00:00', 'E-LATE', 'Inbound Phone'),
 ("Router telemetry only.\nStatus: ACTIVE\n- Last Heartbeat: 2026-09-03T10:00:00Z", 'A', '2026-09-03 10:00:00', 'E-TELEMETRY', 'Inbound Phone'),
 ("Member called back, nothing changed.\nStatus: ACTIVE\nState: Active", 'A', '2026-09-04 10:00:00', 'E-TELEMETRY', 'Inbound Phone'),
 ("Email from member about billing.", 'A', '2026-09-01 11:00:00', 'E-EMAIL', '4-Email'),
 ("Replied to the member, issue fixed.", 'A', '2026-09-02 11:00:00', 'E-EMAIL', '4-Email'),
]
for desc, by, when, case, origin in edge:
    w2.append([desc, by, D(when), case, origin, 'HH-'+case])
# one row with the timestamp written as text, one with no case number at all
w2.append(['Text-date note, resolved: issue fixed.', 'A', '2026-09-05 12:00:00', 'E-TEXTDATE', 'Inbound Phone', 'HH'])
w2.append(['Opening note for the text-date case.', 'A', '9/4/2026 8:30 AM', 'E-TEXTDATE', 'Inbound Phone', 'HH'])
w2.append(['Orphan row with no case number', 'A', D('2026-09-06 09:00:00'), None, 'Inbound Phone', 'HH'])
wb2.save('/tmp/claude-0/-home-user-test/72b18ecb-7ec2-5f74-bf1a-8437761ab746/scratchpad/fixtures/edge-cases.xlsx')
print('edge-cases.xlsx written')
