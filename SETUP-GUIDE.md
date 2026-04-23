# GymBot Pro — Complete Setup Guide
## From Zero to Live WhatsApp Automation in ~3 Hours

---

## WHAT YOU'LL HAVE WHEN DONE
- Members text your gym's WhatsApp number
- Bot answers instantly, 24/7, in Hindi/English
- New members auto-get intake form → auto-onboarded
- Auto payment reminders with Razorpay links
- Daily morning messages + workout plans
- Weekly diet plan delivery
- Birthday & milestone celebrations
- Win-back campaigns for lapsed members
- Full dashboard at your domain

---

## STEP 1 — Create Accounts (30 min)

### A. Meta Business / WhatsApp Business API
1. Go to **business.facebook.com**
2. Create a Business Account with your gym's details
3. Go to: **WhatsApp Manager → Getting Started**
4. Add a phone number (must be a fresh SIM — can't use existing WhatsApp number)
5. Verify the number via OTP
6. Go to **API Setup** → copy:
   - `Phone Number ID` → paste in .env as WHATSAPP_PHONE_ID
   - `WhatsApp Business Account ID` → paste as WHATSAPP_BUSINESS_ID
7. Generate a **Permanent Token**:
   - Go to business.facebook.com → Business Settings → System Users
   - Create a System User → Add Assets → WhatsApp Account
   - Generate Token → Select: whatsapp_business_messaging, whatsapp_business_management
   - Copy token → paste as WHATSAPP_TOKEN

### B. Supabase (Database)
1. Go to **supabase.com** → Create New Project
2. Choose region: **South Asia (Mumbai)**
3. Note your project URL and Service Role key (Project Settings → API)
4. Go to **SQL Editor** → run the entire contents of `database/schema.sql`
5. Your database is ready!

### C. Razorpay (Payments)
1. Go to **dashboard.razorpay.com** → Sign Up
2. Complete KYC with your gym's business documents
3. Go to Settings → API Keys → Generate Live Keys
4. Copy Key ID and Secret → paste in .env
5. Settings → Webhooks → Add webhook URL: `https://yourdomain.com/webhook/payment`
6. Select events: `payment.captured`

---

## STEP 2 — Deploy the Server (20 min)

### Option A: Railway (Recommended — easiest)
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# In your gymbot folder:
railway init
railway up

# Set environment variables in Railway dashboard
# Or: railway variables set KEY=VALUE
```
Railway gives you a free HTTPS URL like `https://gymbot-pro.up.railway.app`

### Option B: Render.com (Also free)
1. Push code to GitHub
2. Go to render.com → New → Web Service
3. Connect GitHub repo
4. Build command: `npm install`
5. Start command: `npm start`
6. Add environment variables in Render dashboard

### Option C: VPS (DigitalOcean/AWS/Azure)
```bash
# On your server:
git clone your-repo
cd gymbot
npm install
cp .env.example .env
nano .env   # Fill in all values

# Install PM2 for process management
npm install -g pm2
pm2 start backend/server.js --name gymbot
pm2 save
pm2 startup

# Set up Nginx reverse proxy for your domain
# Point domain → localhost:3000
```

---

## STEP 3 — Configure WhatsApp Webhook (10 min)

1. Go to **developers.facebook.com → Your App → WhatsApp → Configuration**
2. Under **Webhook**, click Edit
3. Callback URL: `https://yourdomain.com/webhook/whatsapp`
4. Verify Token: (whatever you set as WHATSAPP_VERIFY_TOKEN in .env)
5. Click **Verify and Save** — Meta will call `GET /webhook/whatsapp` on your server; if it fails, check `SERVER_URL`, HTTPS, and that `WHATSAPP_VERIFY_TOKEN` matches exactly (Render **Variables** + redeploy if you changed it).
6. Under the same Webhook section, open **Manage** (or field list) and subscribe to **`messages`** (required for incoming chats). Save if there is a separate Save.
7. **Test:** From a phone number allowed in dev/test settings, send **"hi"** to your WhatsApp Business number → the bot should reply (see `backend` logs for `POST /webhook/whatsapp`).

Next: **STEP 4** — submit **Message Templates** in WhatsApp Manager if you need outbound template messages (welcome, payment link, etc.); those need Meta approval.

---

## STEP 4 — Submit WhatsApp Templates (24–48 hr wait)

1. Go to **business.facebook.com → WhatsApp Manager → Message Templates**
2. Create each template from `whatsapp-templates/all-templates.txt`
3. Submit all 9 templates
4. Wait for Meta approval (usually next business day)

While waiting, your bot can still respond to messages people send first (free-form messages work immediately — only outbound templates need approval).

---

## STEP 5 — Set Up Google Form (15 min)

1. Go to **forms.google.com** → Create New Form
2. Add fields:
   - Full Name (Short answer)
   - WhatsApp Number (Short answer)
   - Date of Birth (Date)
   - Age (Short answer)
   - Weight in kg (Short answer)
   - Height in cm (Short answer)
   - Fitness Goal (Multiple choice: Weight Loss / Build Muscle / General Fitness / Endurance)
   - Any Health Issues/Injuries (Paragraph)
   - Emergency Contact Name & Number (Short answer)
   - How did you hear about us? (Multiple choice)

3. Go to **Form Settings → Responses → Link to Sheets**
4. In Google Sheets → Extensions → Apps Script:
   ```javascript
   function onFormSubmit(e) {
     const data = e.namedValues;
     const url = 'https://yourdomain.com/webhook/form';
     UrlFetchApp.fetch(url, {
       method: 'POST',
       contentType: 'application/json',
       payload: JSON.stringify({
         name: data['Full Name'][0],
         phone: data['WhatsApp Number'][0],
         goal: data['Fitness Goal'][0].toLowerCase().replace(' ', ''),
         age: data['Age'][0],
         weight: data['Weight in kg'][0],
         height: data['Height in cm'][0],
         healthIssues: data['Any Health Issues/Injuries'][0],
       })
     });
   }
   ```
5. Save → Run → Authorize → Set trigger: On form submit
6. Copy the Form URL → paste as INTAKE_FORM_URL in .env

---

## STEP 6 — Upload Diet Plan PDFs (10 min)

1. Go to **Supabase → Storage → Create bucket**: `gymbot` (make it public)
2. Upload your diet plan PDFs:
   - `weightloss-week.pdf`
   - `muscle-week.pdf`
   - `general-week.pdf`
3. Note the public URL format: `https://yourproject.supabase.co/storage/v1/object/public/gymbot/`
4. Set CDN_URL in .env to this base URL

---

## STEP 7 — Add First Member & Test (20 min)

### Test the full flow:
```bash
# Test API: Add a member
curl -X POST https://yourdomain.com/api/members \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Member",
    "phone": "9876543210",
    "plan": "monthly",
    "batchTime": "7:00 AM"
  }'
```

This should:
1. ✅ Create member in database
2. ✅ Send WhatsApp welcome + form link

### Test payment reminder:
```bash
curl -X POST https://yourdomain.com/api/trigger/payment-reminder/MEMBER_ID
```

---

## ONGOING OPERATIONS

### Dashboard Access
Your dashboard frontend (gymbot-dashboard.html) runs at your domain.

### Adding Members Manually
Use the dashboard or API:
```
POST /api/members
```

### Bulk Import Existing Members
Create a CSV with: name, phone, plan, join_date, expiry_date
Run the import script:
```bash
node backend/scripts/import-members.js members.csv
```

### Check Logs
```bash
# Railway
railway logs

# PM2
pm2 logs gymbot
```

---

## COSTS (Monthly Estimate)

| Service | Plan | Cost |
|---------|------|------|
| Railway (server hosting) | Starter | ₹0–500/mo |
| Supabase (database) | Free | ₹0 |
| WhatsApp API — Utility msgs | Per message | ~₹0.35–0.50 |
| WhatsApp API — Marketing msgs | Per message | ~₹0.50–0.80 |
| Razorpay | 2% per transaction | From payments |

**For 500 members with daily messages: ~₹5,000–8,000/month**
**Razorpay collects itself from member payments**

---

## SUPPORT

If anything breaks, check:
1. Server logs first (Railway dashboard → Logs)
2. WhatsApp webhook delivery status (developers.facebook.com)
3. Supabase table viewer — see what data exists
4. Razorpay → Payments tab — see payment status

Common issues:
- **Bot not replying**: Webhook URL wrong or token mismatch
- **Templates failing**: Check Meta approval status
- **Payment link broken**: Check Razorpay key ID/secret
