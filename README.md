# Approval Notice Generator — Netlify Deployment

## One-time setup

### 1. Push to GitHub
Create a new GitHub repo and push this folder to it.

### 2. Connect to Netlify
- Go to netlify.com → Add new site → Import from Git
- Select your repo
- Build settings are auto-detected from netlify.toml (no changes needed)
- Click Deploy

### 3. Add the environment variable
In Netlify → Site Settings → Environment Variables, add:

| Key | Value |
|-----|-------|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | The full JSON content of your service account key file (the same one used by Bricks) |

### 4. Redeploy
After adding the env var, trigger a redeploy from the Netlify dashboard.

---

## How it works

- `public/index.html` — the form your agents use
- `netlify/functions/generate.js` — serverless function that fills the PDF and uploads to Drive
- `netlify/functions/pdf_template.b64` — the blank template PDF (base64 encoded, bundled with the function)

Filled PDFs are saved to: **Applicants/Prospects** inside your Shared Drive.
Each file is named: `Approval-Notice-[Applicant Name]-[Date].pdf`

---

## Notes

- No login required — anyone with the URL can use the form
- The PDF template is already bundled; no need to upload it separately
- To update the template PDF in the future, re-encode it:
  `python3 -c "import base64; open('netlify/functions/pdf_template.b64','w').write(base64.b64encode(open('new_template.pdf','rb').read()).decode())"`
  Then commit and redeploy.
