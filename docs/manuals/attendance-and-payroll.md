# Attendance and payroll

An easy manual for attendance staff and HR.

Checked against the application source on 20 October 2026. Use this with the same version of Titan ERP. All example names and numbers are fictional.

## The whole job

**Device report → Upload and preview → Import punches → Fix attendance → Decide leave and overtime → Save draft payslips → Payroll administrator and finance.**

A punch is one recorded arrival or departure. Uploading a report does not pay anyone. Saving a draft payslip does not pay anyone either.

## Who does what?

| Person | Job |
| --- | --- |
| Attendance staff | Keep the device records and give the original report to HR. Report missing or wrong punches. |
| HR | Check employee details, import the report, correct attendance and prepare draft payslips. |
| Authorized approver | Decide leave and overtime requests. |
| Payroll administrator and finance | Check the full payroll, arrange approval and record the actual payment through the available authorized process. |

The administrator gives each person the access they need. HR management access is required for the device import.

## 1. Check employee details before the first upload

Open **HR & Payroll → Employees**. Add a missing employee or open the existing employee's edit form.

Check these details against the HR record:

| Detail | What to check |
| --- | --- |
| Employee Code | It belongs to this employee. Keep any leading zeros. |
| Joining Date | It is the real joining date. Report dates before this date can be blocked. |
| Shift Schedule | The start and end times are correct, including any split or night shifts. |
| Standard duty hours | The expected working hours are correct. |
| Weekly Rest Days | The correct days are selected for this employee. |
| Basic Salary and allowances | They match the approved salary agreement. |
| Employee status | It reflects whether the employee is active. |

Ask the payroll manager to check salary and deduction settings. Do not change a shift, rest day, joining date or salary just to make a warning disappear.

The device's **Person ID** and Titan's **Employee Code** are different fields. Titan can match an identical code automatically. If they differ, HR can link the Person ID during the import.

## 2. Get the attendance file

Attendance staff should export the device's **Total Punches** report for the required dates and give it to HR.

Keep an unchanged copy of the original export. Use the device to record attendance as instructed by your factory. If a punch is missing or wrong, tell HR the employee code, work date and actual time.

The old Titan scanner page has been retired. Attendance now comes through the device report. Do not expect the old scanner page to record a punch.

### File rules

The device importer accepts `.csv` and `.xlsx`, up to 10 MB. It does not accept an old `.xls` file by changing its filename. A report can contain up to 20,000 data rows.

Use the original Total Punches export where possible. The seven column headings must be exactly these, in this order:

| Column | Example only | Meaning |
| --- | --- | --- |
| Person ID | DEMO001 | ID used by the device |
| Person Name | Example Worker | Name on the device |
| Department | Packing | Department on the device |
| Date | 2026-10-05 | Year-month-day |
| Weekday | Monday | Day shown in the report |
| No. of Punch(s) | 4 | Number of punches in this row |
| Punch Records | 08:00,12:00,13:00,17:00 | Punch times, earliest first |

Device report times are read as Pakistan local time. Times use the 24-hour clock. `17:00` means 5 pm. CSV text must use UTF-8 encoding. Do not add formulas to the report.

Here is how one correctly quoted CSV row looks. This is an explanation, not a file to upload into live attendance:

```csv
Person ID,Person Name,Department,Date,Weekday,No. of Punch(s),Punch Records
DEMO001,Example Worker,Packing,2026-10-05,Monday,4,"08:00,12:00,13:00,17:00"
```

Keep all the punch times inside the last cell. In a CSV, the quotation marks keep the commas inside that cell.

For Excel, use a clear **Total Punches** worksheet. Keep Person IDs as text so Excel does not remove leading zeros.

## 3. Upload and check the preview

1. Open **HR & Payroll → Attendance → Daily Attendance**.
2. Click **Import device report**.
3. Under **Device report**, choose the original `.csv` or `.xlsx` file.
4. Click **Upload and preview**.
5. Check the filename and the displayed date range.
6. Check the employee attached to every Person ID. Do not rely on the name alone.
7. Under **Match device Person IDs**, choose the correct employee for each unknown ID.
8. Click **Refresh preview** after changing a match.
9. Read the result and message for each row. Use **Next rows** to check the remaining pages.

**At this point, the punches have not yet been imported.**

A Person ID link can be reused on later imports. A wrong match can put another person's hours into payroll. If an ID is already linked to the wrong employee, stop and ask the administrator to investigate.

### What do the results mean?

| Result | What HR should do |
| --- | --- |
| Ready | Check the employee, date and times before importing. |
| Already recorded | These punches already exist. They do not need importing again. |
| Needs review | Read the message. Valid new punches may still import, but HR must resolve the day before payroll. |
| Blocked | This row stays unchanged. Fix the cause shown in the message or ask the administrator for help. |
| Imported | The punches were saved. Check the resulting attendance day. |

**Report rows** counts report entries. **New punches** counts individual new times. These are different counts.

## 4. Import the punches

1. Finish checking the employee matches and preview messages.
2. Click **Import N new punches**. The number changes with the report.
3. Wait for **Import saved**.
4. Read how many punches were imported.
5. Check the refreshed preview for remaining work.
6. Keep a record of the filename, dates, import result and any unresolved rows.

**Import completed does not mean attendance is ready for payroll.** Rows with missing checkouts may have imported. Blocked rows have not been fixed.

If the button is disabled, check whether **New punches** is zero or the preview needs refreshing. A repeated unchanged upload normally has no new punches. Do not invent extra punches to enable the button.

You can reopen an upload under **Recent uploads → Review import** or **Open preview**.

## 5. Fix flagged days

In the import, click **Review day** beside a row. If it shows more than one review date, check each date. You can also select the date in Daily Attendance and use the employee's pencil button, **Edit Attendance**.

Check the employee code and work date before changing anything.

### When a worker was present but a punch is missing

1. Confirm the actual time with the supervisor or an attendance record.
2. In the punch section, enter **Manual punch time**.
3. For a night-shift checkout, choose the actual next-day date and time.
4. Add a note explaining the correction.
5. Click **Add punch**.
6. Check **First In**, **Last Out**, **Duty** and **Open Punches**.

Titan determines IN and OUT from the punch sequence. Do not force a different direction to hide a wrong time.

### When an imported punch has the wrong time

1. Use the pencil beside that punch.
2. Enter the confirmed date and time.
3. Enter the **Device import correction reason**. Imported punch corrections require at least five characters. Write a useful reason, such as `Supervisor confirmed checkout at 17:00`.
4. Click **Save** beside the punch.
5. Check the recalculated duty hours and remaining punches.

Delete a punch only when you have confirmed it should not exist. An imported punch deletion requires a reason. If deletion is blocked, ask HR to review the sequence before removing related punches.

**Punch additions, edits and deletions save immediately. Closing the attendance form does not undo them.** The separate **Save Attendance Record** button saves notes, overtime and other attendance decisions.

### When the worker was absent or on leave

1. Confirm the correct decision with HR or the supervisor.
2. Select **Absent**, **On Leave** or **Holiday**, as appropriate.
3. For leave, choose the correct leave type and enter the required details.
4. Add an explanation in the notes.
5. Click **Save Attendance Record**.
6. Send any pending leave decision to the authorized approver.

Do not add made-up arrival and departure times to represent absence or leave.

### Check the whole pay period

The report covers only the employees and dates included in the export. A blank row, zero punches or a missing date does not prove someone was absent.

HR must check all expected working dates, including dates outside a partial export. Resolve missing working days from the actual records. Check each employee's own weekly rest days before marking attendance.

If you use **Bulk Mark**, check the employee selection and date range carefully. It can select all active employees by default. Review the preview and conflict choice before applying it. Use it only when the same verified decision applies to the selected people and dates.

## 6. Decide leave and overtime

Open **HR & Payroll → Approval Center**.

### Leave

1. Open **Leave Requests**.
2. Check the employee, date, leave type, reason and available entitlement.
3. The authorized approver chooses the correct decision.
4. Check the saved result before preparing the salary.

### Overtime

1. Open **Overtime** and review the pending items.
2. Check the employee, date, duty hours, standard hours and requested overtime.
3. Compare the request with the supervisor's approval.
4. Approve valid overtime or reject it with the correct decision. Confirm the action when asked.
5. Recheck any **Needs Recheck** item after correcting punches or the overtime request.

Only approved overtime contributes overtime pay. A suggestion is not payment approval. Work on a configured rest day can also create a pending overtime item.

Use conversion to compensatory time off only when the payroll manager has authorized that treatment.

### Take care with early leave

In the attendance form, **Early Leave Review → Approved** means the early-departure deduction policy applies. It does not mean the short time is paid without deduction.

**Rejected** or **Pending Review** can still leave a normal short-hours deduction. Ask the payroll manager to review the calculation if this affects pay. Do not choose a status based only on the word "Approved".

## 7. Choose the correct payroll month

Open **HR & Payroll → Payroll**.

The month selector is the **payout month**. The attendance cycle runs from the 16th of the previous month to the 15th of the selected month. The scheduled payout date is the 25th.

| Payroll month selected | Attendance dates | Scheduled payout |
| --- | --- | --- |
| October 2026 | 16 September to 15 October 2026 | 25 October 2026 |
| November 2026 | 16 October to 15 November 2026 | 25 November 2026 |

Example: an export for 1 to 14 October does not cover the full October payroll cycle. HR must also check 16 to 30 September and 15 October, subject to the employee's joining date and working schedule.

For normal monthly payroll, prepare the slip after the full cycle is recorded. **Process Early** prepares a calculation through an earlier cutoff. Use it only for an authorized early payment and check the shorter period carefully.

## 8. Review and save each draft payslip

1. Select the correct payout month.
2. Find the employee and click **Process**. Use **Revise** if a draft already exists.
3. Wait for the **Salary Calculation** to load.
4. Check the period, employee and joining-date treatment.
5. Review the items below against the approved records.
6. Enter a useful **Payslip Remarks** note if needed.
7. Click **Save Draft Slip**.
8. Repeat for every eligible employee.

| Check | What to compare |
| --- | --- |
| Basic Salary and allowances | Approved salary details and applicable policy |
| Present, absent and leave days | Reviewed attendance for the complete cycle |
| Unmarked Days | Investigate missing working days before saving |
| Undertime and attendance deductions | Correct punches and the approved deduction rules |
| Overtime Pay | Approved hours and the approved rate or multiplier |
| Salary Advance Recovery | The real advance balance and approved recovery |
| Tax, bonus, incentives, commission and other adjustments | Approved supporting records, where applicable |
| Arrears | Amounts genuinely unpaid for earlier cycles, without double counting |
| Net Pay | Gross pay less the displayed total deductions |

Do not assume a single salary deduction formula applies to everyone. Company settings, employee overrides, allowances, leave entitlement and the reason for the short day can affect the result.

Do not enter `0` in an automatic advance recovery field merely to clear it. An explicit zero can override automatic recovery. Change calculated amounts or waivers only with payroll approval and an explanation.

If **Missing Attendance Data** appears, choose **Cancel** and resolve the missing dates. **Proceed Anyway** bypasses a missing-data check. It does not repair attendance. An unresolved imported punch day can also prevent saving even when a preview is visible.

**Save Draft Slip creates or updates a draft. No payment wallet is debited by this action.** Labels such as "Generated", "finalized" or "Net Paid & Generated" on summary screens are not proof of salary payment.

## 9. Reopen, print and check

1. In Payroll, use the employee's **View Payroll History** button, shown with an eye icon.
2. Find the saved month.
3. Click the arrow button on that payslip row to open the slip.
4. Check the saved employee, period, deductions and **Net Pay**.
5. Click **Print / Save PDF** on the payslip. You can choose your browser's Save as PDF option.
6. Check that the printed Net Pay matches the saved slip.

If attendance or an approval changes after a draft was saved, reopen the calculation and revise the affected drafts. The change can make a saved payroll out of date. For a full payroll regeneration requirement, hand it to the payroll administrator. Do not pay from an older printout.

## 10. Hand over for payroll approval and payment

The screens checked for this manual do not expose final payroll approval or **Mark as paid** controls. HR should finish the draft work and hand the following to the payroll administrator and finance:

- The payout month and exact attendance dates.
- The eligible employee list and all reviewed draft slips.
- Confirmation that attendance, leave and overtime issues are resolved.
- The sum of the latest saved Net Pay amounts.
- Any authorized adjustment notes and the proposed payment account.

The application has separate approval and payment functions. Approval requires a complete eligible payroll and current attendance. Recording payment requires an approved payroll and a valid wallet with enough balance. It records a wallet debit and ledger transaction. It does not itself send money to employees' bank accounts.

Finance must follow the organization's authorized disbursement process and match the real payments to the recorded payroll. Keep payment evidence. Do not describe a saved or printed draft as "paid".

Approved or paid payroll periods are locked against attendance changes. If a correction is needed, give the employee, date, evidence and required correction to the payroll administrator. The app's error message mentions a correction workflow, but no complete correction screen was verified here.

## If internet fails

The **Offline Excel** page is a separate fallback. It uses an issued workbook. It is not the device Total Punches importer.

Use this only if your administrator has enabled the fallback and issued the workbook for the responsible attendance operator.

1. Before an outage, authorized staff open **HR & Payroll → Attendance → Offline Excel**, choose the attendance operator, use **Issue workbook**, then **Download**.
2. During the outage, record the employee code, time and IN or OUT in that assigned workbook, following its columns and instructions. Keep its structure and identity information intact.
3. When service returns, choose that same `.xlsx` file on Offline Excel. Enter **Outage start**, **Outage end** and **Outage reason**.
4. Click **Upload workbook**.
5. A different authorized supervisor selects the upload in **Supervisor queue**, checks **Confirmed start**, **Confirmed end** and **Decision reason**, then uses **Confirm outage** if the outage is valid.
6. A final authorized reviewer, different from both the assigned operator and the supervisor, selects the upload in **Review queue** and checks each preview group.
7. The final reviewer uses **Import ready rows** for rows that pass review.
8. Resolve remaining review, invalid or blocked rows. Exclude a row only with a confirmed reason, and ensure genuine attendance is still recorded correctly.
9. Check Daily Attendance and revise any affected draft payroll.

## If something goes wrong

| What you see | What to do |
| --- | --- |
| Import button missing | Ask the administrator to check HR management access. |
| File rejected | Check the extension, size, exact headings, date format and original export. Do not just rename the extension. |
| Unknown Person ID | Verify the ID with attendance staff, select the correct employee and refresh the preview. |
| ID already linked to someone else | Stop. Ask the administrator to investigate the link. |
| Punch count mismatch or duplicate person/date row | Check the source export and obtain a corrected report. Keep the original copy. |
| Missing checkout or Open Punches above zero | Confirm the real departure time and correct the day's sequence. |
| Wrong duty hours | Check all IN/OUT pairs, breaks, work date and overnight checkout. Do not type a made-up total. |
| Same report shows zero new punches | It may already be recorded. Check Recent uploads and Daily Attendance. |
| Attendance belongs to approved or paid payroll | Hand the correction to the payroll administrator. |
| Salary preview looks right but save fails | Read the error. Check unresolved imported days, missing dates and locked payroll. |
| Import or save response is unclear | Reopen the record and check what was saved before repeating an action. |

## Daily checklist

- [ ] Original device export kept.
- [ ] Correct report dates and employee matches checked.
- [ ] Punch import confirmed and saved result checked.
- [ ] All pages and flagged days reviewed.
- [ ] Missing working dates investigated.
- [ ] Leave and overtime decisions sent to the approver.

## Payroll checklist

- [ ] Correct payout month and full 16th-to-15th cycle checked.
- [ ] Employee salary, shifts and rest days checked.
- [ ] Missing and unresolved attendance fixed.
- [ ] Leave and overtime decisions completed.
- [ ] Every eligible employee's latest draft reviewed and saved.
- [ ] Saved and printed Net Pay checked.
- [ ] Changes after saving recalculated and handed over where needed.
- [ ] Payroll handed to the administrator and finance for approval and actual payment.

Prepared by: ____________________  Period: ____________________

Checked by: ____________________  Date: ____________________
