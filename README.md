# EventraX CME Attendance Portal

Lets delegates apply for TNMC CME credit hours from their own phone (QR → apply). Includes a help-desk link for doctors without a smartphone, an admin panel, and the TNMC Excel reports.

- **No database, no `npm install`.** It needs only Node.js 18 or newer.
- All data is saved in the `data/` folder: `db.json` plus `files/` (signatures and payment screenshots). **Back this folder up.**

## Run

```
# Linux / Mac
ADMIN_PASSWORD=YourStrongPass PORT=3000 node server.js

# Windows (or double-click start.bat after editing the password in it)
set ADMIN_PASSWORD=YourStrongPass
set PORT=3000
node server.js
```

| Link | Who | Notes |
|---|---|---|
| `https://your-domain/apply` | Delegates (QR standee) | One application per mobile number and per phone |
| `https://your-domain/desk?k=XXXX` | Tech team only | Multiple entries from one phone; search by name, mobile or MCI number |
| `https://your-domain/admin` | Organiser | Password is the `ADMIN_PASSWORD` value |

The help-desk link with its key is printed in the console when the server starts, and is also shown under Admin → Links & QR. Resetting the link there makes the old link stop working.

## ⚠️ HTTPS is mandatory

Phones only share GPS location with **https://** sites. Without HTTPS, the location check fails for every delegate.

### Option A — Linux VPS (fastest, about 10 minutes)
```
# install node 20, then:
npm i -g pm2
ADMIN_PASSWORD=YourStrongPass PORT=3000 pm2 start server.js --name cme
# install Caddy (auto HTTPS via Let's Encrypt). /etc/caddy/Caddyfile:
cme.yourdomain.com {
    reverse_proxy localhost:3000
}
sudo systemctl reload caddy
```
Point the DNS A-record for `cme.yourdomain.com` to the server first.

### Option B — Windows server with IIS (your current stack)
1. Install Node.js 20 LTS, plus the IIS modules **URL Rewrite** and **Application Request Routing (ARR)**. In ARR, enable *Server Proxy Settings → Enable proxy*.
2. Run the app as a service, using either NSSM (`nssm install CMEPortal "C:\Program Files\nodejs\node.exe" server.js`, set the env vars and the start folder) or pm2.
3. Create an IIS site for `cme.yourdomain.com` and put `web.config.example` in its folder, renamed to `web.config`. It forwards all traffic to `localhost:3000`.
4. Bind an HTTPS certificate. win-acme gives a free Let's Encrypt certificate.
5. Under IIS → Request Filtering, raise *Maximum allowed content length* to 20 MB (for payment screenshots).

## Event-day checklist
1. **Settings:**
   - Organisation, workshop name, date and credit hours. These print as the title rows of the reports.
   - **Venue location:** open Admin on a phone *inside the hall* and tap **Use my current location**, then Save.
   - Radius: 200 m is recommended. 100 m can fail in big hotels because indoor GPS drifts.
   - Fee: on or off, with the UPI ID.
2. **Attendees:** upload the Excel file. Your TNMC format file works as it is:
   - The header row is detected automatically.
   - Role is read from a `Role` column if there is one, otherwise from the sheet name (`workshop_delegate`, `workshop_faculty`).
   - Choose **Replace list**.
3. **Links & QR:** print the delegate QR. Send the help-desk link to the tech team.
4. **Test it yourself** with one registered number, then delete that test application from the Applications tab.
5. **After the CME:**
   - Paid CME: approve pending applications once the screenshots are checked.
   - Go to Reports and download **Attendance_Signature.xlsx** and **CME_Bulk_Upload.xlsx**.
   - Turn off *Accept applications*.

## Validations
- Mobile must be in the uploaded attendee list. A help-desk entry can attach a mobile to a list entry that has none.
- One application per attendee and per mobile number.
- One application per phone on the delegate link (a device ID is stored in the browser). The help-desk link skips this rule.
- GPS must be within the radius, and accuracy must be better than the set limit. Distance is calculated **on the server**.
- MCI/TNMC number and signature are required.
- Paid CME also needs a 12-digit UTR (each UTR can be used only once) and a screenshot. These applications stay *pending* until you approve them.
- Every rejected attempt is logged under Dashboard → Blocked attempts.
- Deleting an application lets that person apply again. Use this if someone made a mistake.
