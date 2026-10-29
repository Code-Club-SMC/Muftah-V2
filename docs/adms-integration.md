# ADMS Attendance Integration: Context + Spec

Handoff for the coding agent. Read fully before writing code.

## 1. Goal

Get punches from our biometric attendance machine straight into the ERP. No PC in between. The machine sits on office LAN (wall power + LAN cable) and pushes each punch to our ERP server over HTTP.

## 2. What we have

| Item | Value |
|---|---|
| Device | ZKTeco **SenseFace T1** (face + fingerprint, 2.4" screen, physical keypad) |
| Serial number (SN) | `WEF5261400736` |
| Current software | ZKBio Zlink (ZKTeco cloud, BEST protocol). No public API, so we are leaving it |
| New mode | **ADMS** (a.k.a. iClock / Push SDK). Device calls our server |
| Timezone | Pakistan, UTC+5 |
| ERP stack | _TODO: fill in (framework, DB, ORM)_ |
| Server address / port | _TODO: fill in. Start with plain HTTP on port 80_ |

Device-side setup is already written as an operator guide (Menu → COMM. → Cloud Server Setting → Server Mode ADMS, address, port, HTTPS OFF). Not the agent's job.

## 3. How ADMS works

The device is the client. It calls us. We never call it.

| Method | Path | When | We reply (`text/plain`) |
|---|---|---|---|
| GET | `/iclock/cdata?SN=...&options=all` | Boot / handshake | Config block (below) |
| POST | `/iclock/cdata?SN=...&table=ATTLOG&Stamp=...` | New punches | `OK: <count>` |
| POST | `/iclock/cdata?SN=...&table=OPERLOG` (and others) | Admin/user logs | `OK` (ignore for now) |
| GET | `/iclock/getrequest?SN=...` | Heartbeat every few sec | `OK` (or a queued command later) |
| POST | `/iclock/devicecmd?SN=...` | Result of a command we sent | `OK` |

Handshake reply:
```
GET OPTION FROM: <SN>
ATTLOGStamp=None
OPERLOGStamp=9999
ErrorDelay=30
Delay=10
TransFlag=TransData AttLog
TimeZone=5
Realtime=1
```

ATTLOG body: one punch per line, **tab-separated**, not JSON, not key=value:
```
1001\t2026-10-24 09:01:33\t0\t15\t0\t0
```
Fields: `PIN, datetime (device local time), status, verify, workcode, reserved...`

- status: 0 check-in, 1 check-out, 2 break-out, 3 break-in, 4 OT-in, 5 OT-out
- verify: usually 1 fingerprint, 15 face, 0 password, 4 card. **Confirm against real payloads.**
- Some firmwares put the punch type in a different field. Do not trust the mapping until Phase 0 logs prove it.

Rules:
- Reply anything other than `OK...` and the device retries. That is our safety net.
- Device resends old logs after reconnects. **Inserts must be idempotent.**
- Endpoints must be public (no auth middleware, no CSRF, no JSON body parser). Device can't log in.

## 4. Data model

`attendance_devices`
- `serial_number` (unique), `name`, `location`, `is_active`, `last_seen_at`

`attendance_punches`
- `device_sn`, `device_pin`, `punched_at` (store as timestamptz, device time is UTC+5), `status`, `verify_type`, `raw_line`, `created_at`
- **Unique on (`device_sn`, `device_pin`, `punched_at`)**, insert with ON CONFLICT DO NOTHING

`employees`
- add `device_pin` (nullable, unique). Device only knows PIN like `1001`, ERP maps it to the employee

Raw punches stay raw. Daily attendance (first in, last out, late, OT) is computed from them separately.

## 5. Security (plain HTTP, public URL)

- Only accept requests where `SN` is in `attendance_devices` and `is_active`. Unknown SN: log it, reply `OK`, store nothing
- Rate limit `/iclock/*` per IP
- Log every raw request body during rollout
- HTTPS later, via reverse proxy, only after HTTP works

## 6. Phases

Do one phase, show me the result, wait for go-ahead.

**Phase 0: Audit (no code changes)**
- Read the ERP codebase. Report: framework, routing, DB/ORM, where employees live, how migrations work, any global middleware (auth, CSRF, body parsing) that would break `/iclock/*`
- Propose where the module goes. Stop here.

**Phase 1: Listener that only logs**
- All routes from section 3, replies correct, every raw request saved to a log table/file
- No parsing into punches yet
- Test with curl (section 7). Then I point the real device at it and we read actual payloads

**Phase 2: Parse + store**
- Migrations from section 4
- Parse ATTLOG lines, idempotent insert, update `last_seen_at` on every heartbeat
- SN allowlist from section 5

**Phase 3: ERP wiring**
- `device_pin` field on employee form
- Punches list page (filter by employee/date/device), unmapped PINs highlighted
- Device status: online if `last_seen_at` < 2 min ago

**Phase 4 (later, optional)**
- Daily attendance calculation
- Push users/commands to device through `getrequest` command queue
- HTTPS

## 7. Test without the device

```bash
# handshake
curl "http://localhost:PORT/iclock/cdata?SN=WEF5261400736&options=all"

# punch
curl -X POST "http://localhost:PORT/iclock/cdata?SN=WEF5261400736&table=ATTLOG&Stamp=9999" \
  -H "Content-Type: text/plain" \
  --data-binary $'1001\t2026-10-24 09:01:33\t0\t15\t0\t0\n1002\t2026-10-24 09:03:10\t0\t1\t0\t0'
# expect: OK: 2
# run it twice: still 2 rows in DB

# heartbeat
curl "http://localhost:PORT/iclock/getrequest?SN=WEF5261400736"
```

## 8. Open questions

- ERP stack and where it is hosted (needs a public IP/domain reachable from the office)
- Does Zlink history need importing? (Excel export from Zlink, one-time)
- More devices or branches later? Schema already supports it
