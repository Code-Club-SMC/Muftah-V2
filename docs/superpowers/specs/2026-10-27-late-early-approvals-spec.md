# Late Arrival and Early Departure Approvals — Spec

Date: 2026-10-27
Status: Approved decisions, ready for planning

## Why

The client asked for an approval step for late arrivals, early departures and time spent out on company work. The rule they want: **no salary or attendance cut happens unless someone authorised has decided it should.**

Today the system cuts pay automatically:

- **Early departure.** The system marks the day "early leave, pending". A manager can set it to approved or rejected, but payroll ignores that choice and cuts the short hours either way.
  *Example:* Ali leaves at 3:00 instead of 5:00 to deposit company cash at the bank. His manager approves it. Payroll still cuts 2 hours.
- **Late arrival.** No approval step at all. A late day is cut automatically.
  *Example:* The boss sends Sara to a supplier first thing, so she reaches the office at 10:30 instead of 9:00. Payroll cuts 1.5 hours and nobody can excuse that one day.
- **Company work.** There is no way to record "out on official work". The only leave types are sick, annual, special and compensatory.
- **Grace period.** A 15-minute grace setting exists, but all it does is stop the day being *labelled* late. The minutes are still cut as short hours.
  *Example:* Bilal arrives 10 minutes late. He is not marked late, yet payroll still cuts 10 minutes.
- **Only workaround.** At payslip time HR can waive *all* short-hours cuts for the month. That covers every day, can't be limited to one day, and doesn't record who excused what or why.

## Decisions taken

| Question | Decision |
|---|---|
| Monthly cap on approvals? | **No cap.** A manager can approve any number of late or early days. |
| Who can approve? | **HR or super admin only.** HR means staff holding the same HR permission that approves overtime and leave today. Department heads cannot approve. No new role. |
| Grace period | Applies to **both** late arrival and early departure. Minutes inside grace are **not cut**, and the day shows "10 min late — grace applied" or "5 min early — grace applied". |
| Pending at payroll time | **No cut.** An item nobody decided is treated as excused, and the payslip shows "Not reviewed — no deduction". |

## 1. The rule

Every late or early minute outside grace becomes an **item** with one of these statuses:

| Status | Meaning | Pay cut? |
|---|---|---|
| Pending | Nobody has decided yet | No. If still pending when payroll is finalised, it stays uncut and is marked "Not reviewed" |
| Approved — company work | Employee was out on official business | No. The hours count as worked |
| Approved — excused | Personal reason, manager forgave it | No |
| Rejected | Not excused | Yes, the normal cut |

A day can have two items, one for coming late and one for leaving early. Each is decided on its own.

*Example:* Ali comes 30 min late (traffic) and leaves 2 hours early (bank, for the company). The manager rejects the 30 min and approves the 2 hours as company work. Payroll cuts 30 minutes only.

## 2. Grace period

- The existing grace setting (default 15 minutes) now **forgives** the minutes as well as hiding the late label.
- The same grace minutes apply separately to arrival and to departure.
- Lateness or early leaving inside grace creates no approval item and no cut. The attendance row and payslip show "Late 10 min — grace applied" or "Early 5 min — grace applied".
- Past grace, the item covers the **full** time, not the time minus grace.
  *Example:* With 15-minute grace, Bilal is 25 minutes late. The item is for 25 minutes, not 10.
- Grace is counted per side, not shared.
  *Example:* Bilal comes 10 min late and leaves 10 min early. Both are inside grace, so neither is cut, and the day shows both grace notes.

## 3. Approvals screen

A new **Late / Early** tab on the HR Approvals page, next to Overtime and Leave, with the same look and a count badge. Only HR approvers and super admins see the tab and its actions. Server checks enforce the same rule.

Each row shows: employee, date, type (late or early), expected time, actual punch time, and minutes. The rupee effect shows on the payslip, not in this list.

Actions on each row:
- **Company work** (approve)
- **Excuse** (approve)
- **Reject**
- Optional note. A note is required when choosing Company work, e.g. "Bank deposit".

Bulk actions: select several rows and approve or reject them together, with one shared note.

Filters: pending / decided / all, date range, department, employee.

A decision can be changed until that month's payroll is finalised. After that it is locked, the same as other attendance changes.

## 4. Where else it shows

- **Employee attendance log.** A small badge on the day: "Late 40 min · Pending", "Early 2h · Company work", "Late 10 min · Grace".
- **Edit attendance sheet.** The same choice (Company work / Excuse / Reject) is available inline for HR fixing a single day.
- **Payslip explanation.** Each item is listed with its outcome and who decided:
  - "15 Oct — Early departure 2h — Approved (company work) by Usman — no deduction"
  - "16 Oct — Late arrival 30 min — Rejected by Usman — Rs 260"
  - "17 Oct — Late arrival 10 min — Grace applied — no deduction"
  - "14 Oct — Early departure 2h — Not reviewed — no deduction"
- **Payroll run.** Before payroll is finalised, a warning lists any pending items: "12 late/early items still pending for 5 employees. They will not be deducted.", with a link to the Approvals tab. The warning does not block payroll.

## 5. Record keeping

Every decision stores who decided, when, the outcome and the note. Changing a decision keeps the earlier one in history; nothing is overwritten silently.

## 6. Things that stay the same

- Absent days, leave types and overtime approval work as they do now.
- The month-level "waive all short hours" switch on the payslip stays as an emergency override.
- Allowance rules about which allowances drop for late or early still decide *what* is cut once an item is rejected.

## 7. Edge cases

- **Missing check-out punch.** That is a missing punch, not an early departure. It goes to the existing punch-fixing flow and does not create an early-leave item.
- **Fixing punches later.** If HR corrects a punch and the lateness changes, an existing decision stays on the item but the minutes update. If lateness drops inside grace, the item disappears.
  *Example:* Sara's 10:30 punch was a device error and the real time was 9:05. The 1.5-hour item disappears and the day shows "Late 5 min — grace applied".
- **Multi-shift days.** Each shift's late and early time is a separate item.
- **Past months already finalised.** Untouched. The new rules apply from the first payroll month generated after release.

## Open questions

None. All decisions above were confirmed on 2026-10-27.
