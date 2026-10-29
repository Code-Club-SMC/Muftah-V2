# Super Admin Curl Requests

This document describes the curl requests supported by the internal bootstrap admin endpoint.

Endpoint:

`/api/internal/bootstrap-admin`

Authentication:

All requests require the `x-bootstrap-secret` header. If the secret is missing or invalid, the route intentionally responds with `404` to avoid leaking whether the endpoint exists.

## Common Headers

```bash
-H "Content-Type: application/json"
-H "x-bootstrap-secret: $BOOTSTRAP_SECRET"
```

On Windows, use `curl.exe` explicitly in PowerShell and CMD. In PowerShell, `curl` is usually an alias for `Invoke-WebRequest`, so `curl.exe` avoids ambiguity.

## Check Status

Method: `GET`

Purpose: Check whether a super admin has already been bootstrapped.

Request:

```bash
curl -sS \
  -X GET "${BASE_URL}/api/internal/bootstrap-admin" \
  -H "x-bootstrap-secret: ${BOOTSTRAP_SECRET}"
```

PowerShell / CMD:

```powershell
curl.exe -sS `
  -X GET "$env:BASE_URL/api/internal/bootstrap-admin" `
  -H "x-bootstrap-secret: $env:BOOTSTRAP_SECRET"
```

Successful response:

```json
{
  "bootstrapped": true,
  "superAdminCount": 1,
  "superAdmins": [
    {
      "userId": "ckx123...",
      "email": "abdul@example.com",
      "name": "Abdul Hassan"
    }
  ]
}
```

The `superAdmins` list contains only safe operator metadata. Password hashes,
credential account data, sessions, and tokens are never returned.

Common responses:

- `200` when the secret is valid.
- `404` when the secret is invalid or the route is intentionally hidden.

## Create Super Admin

Method: `POST`

Purpose: Create the first super admin account, or promote an existing user with the same email.

Request body:

```json
{
  "name": "Abdul Hassan",
  "email": "abdul@example.com",
  "password": "StrongPass123"
}
```

Request:

```bash
curl -sS \
  -X POST "${BASE_URL}/api/internal/bootstrap-admin" \
  -H "Content-Type: application/json" \
  -H "x-bootstrap-secret: ${BOOTSTRAP_SECRET}" \
  --data '{
    "name": "Abdul Hassan",
    "email": "abdul@example.com",
    "password": "StrongPass123"
  }'
```

PowerShell:

```powershell
$body = @'
{
  "name": "Abdul Hassan",
  "email": "abdul@example.com",
  "password": "StrongPass123"
}
'@

curl.exe -sS `
  -X POST "$env:BASE_URL/api/internal/bootstrap-admin" `
  -H "Content-Type: application/json" `
  -H "x-bootstrap-secret: $env:BOOTSTRAP_SECRET" `
  --data-binary $body
```

CMD:

```bat
curl.exe -sS ^
  -X POST "%BASE_URL%/api/internal/bootstrap-admin" ^
  -H "Content-Type: application/json" ^
  -H "x-bootstrap-secret: %BOOTSTRAP_SECRET%" ^
  --data "{\"name\":\"Abdul Hassan\",\"email\":\"abdul@example.com\",\"password\":\"StrongPass123\"}"
```

Successful response examples:

```json
{
  "success": true,
  "mode": "created-new-user",
  "userId": "ckx123...",
  "email": "abdul@example.com"
}
```

or

```json
{
  "success": true,
  "mode": "promoted-existing-user",
  "userId": "ckx123...",
  "email": "abdul@example.com"
}
```

Common responses:

- `400` for validation errors such as missing name, invalid email, or short password.
- `404` when the secret is invalid or the route is intentionally hidden.
- `409` when a super admin already exists and the request would create a second one.
- `500` if bootstrap account creation fails internally.

## Update Super Admin

Method: `PATCH`

Purpose: Update the existing super admin's name, email, password, or any combination of those fields.

Target selection order:

1. `userId`
2. `currentEmail`
3. Automatic selection if exactly one super admin exists

Request body examples:

```json
{
  "userId": "ckx123...",
  "name": "New Name"
}
```

```json
{
  "currentEmail": "abdul@example.com",
  "email": "new@example.com",
  "password": "NewSecurePass456"
}
```

Request:

```bash
curl -sS \
  -X PATCH "${BASE_URL}/api/internal/bootstrap-admin" \
  -H "Content-Type: application/json" \
  -H "x-bootstrap-secret: ${BOOTSTRAP_SECRET}" \
  --data '{
    "currentEmail": "abdul@example.com",
    "email": "new@example.com",
    "password": "NewSecurePass456"
  }'
```

PowerShell:

```powershell
$body = @'
{
  "currentEmail": "abdul@example.com",
  "email": "new@example.com",
  "password": "NewSecurePass456"
}
'@

curl.exe -sS `
  -X PATCH "$env:BASE_URL/api/internal/bootstrap-admin" `
  -H "Content-Type: application/json" `
  -H "x-bootstrap-secret: $env:BOOTSTRAP_SECRET" `
  --data-binary $body
```

CMD:

```bat
curl.exe -sS ^
  -X PATCH "%BASE_URL%/api/internal/bootstrap-admin" ^
  -H "Content-Type: application/json" ^
  -H "x-bootstrap-secret: %BOOTSTRAP_SECRET%" ^
  --data "{\"currentEmail\":\"abdul@example.com\",\"email\":\"new@example.com\",\"password\":\"NewSecurePass456\"}"
```

Successful response:

```json
{
  "success": true,
  "userId": "ckx123..."
}
```

Common responses:

- `400` when the target is ambiguous or the payload is invalid.
- `400` when no update fields are provided.
- `404` when no super admin exists yet or the secret is invalid.
- `500` if the update fails internally.

## Delete Super Admin

There is no delete operation implemented on `/api/internal/bootstrap-admin` right now.

The route only exposes `GET`, `POST`, and `PATCH`. If a delete endpoint is needed later, it will need to be added in the server route first; there is no supported curl request for deletion at present.
