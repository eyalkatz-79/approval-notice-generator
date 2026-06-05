const { PDFDocument, PDFName, PDFString, PDFHexString } = require('pdf-lib');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

// ─── Config ────────────────────────────────────────────────────────────────
const SHARED_DRIVE_ID = '0AElszDHPeMugUk9PVA';
const FOLDER_PATH = ['Applicants', 'Prospects']; // nested folder path

// ─── Google Auth ────────────────────────────────────────────────────────────
function getAuthClient() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return auth;
}

// ─── Find or create folder in Shared Drive ──────────────────────────────────
async function findOrCreateFolder(drive, folderName, parentId) {
  // Search for existing folder
  const res = await drive.files.list({
    q: `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and '${parentId}' in parents and trashed = false`,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    driveId: SHARED_DRIVE_ID,
    corpora: 'drive',
    fields: 'files(id, name)',
  });

  if (res.data.files && res.data.files.length > 0) {
    return res.data.files[0].id;
  }

  // Create folder
  const folder = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    supportsAllDrives: true,
    fields: 'id',
  });

  return folder.data.id;
}

async function getOrCreateFolderPath(drive, folderNames) {
  let parentId = SHARED_DRIVE_ID;
  for (const name of folderNames) {
    parentId = await findOrCreateFolder(drive, name, parentId);
  }
  return parentId;
}

// ─── Upload PDF to Drive ─────────────────────────────────────────────────────
async function uploadToDrive(drive, pdfBytes, filename, folderId) {
  const stream = Readable.from(Buffer.from(pdfBytes));

  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [folderId],
      mimeType: 'application/pdf',
    },
    media: {
      mimeType: 'application/pdf',
      body: stream,
    },
    supportsAllDrives: true,
    fields: 'id, webViewLink, name',
  });

  return res.data;
}

// ─── Fill PDF ────────────────────────────────────────────────────────────────
async function fillPDF(data) {
  // Load template from bundled base64 file
  const b64Path = path.join(__dirname, 'pdf_template.b64');
  const b64 = fs.readFileSync(b64Path, 'utf8');
  const pdfBytes = Buffer.from(b64, 'base64');

  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();

  const textFields = {
    date: data.date || '',
    applicants: data.applicants || '',
    property_address: data.property_address || '',
    move_in_date: data.move_in_date || '',
    good_faith_deposit: data.good_faith_deposit || '',
    deposit_deadline: data.deposit_deadline || '',
    lease_property: data.lease_property || '',
    monthly_rent: data.monthly_rent || '',
    security_deposit: data.security_deposit || '',
    parking: data.parking || '',
    storage: data.storage || '',
    lease_start: data.lease_start || '',
    lease_term: data.lease_term || '',
    utilities: data.utilities || '',
    additional_terms_1: data.additional_terms_1 || '',
    additional_terms_2: data.additional_terms_2 || '',
    additional_terms_3: data.additional_terms_3 || '',
    additional_terms_4: data.additional_terms_4 || '',
  };

  const checkboxFields = {
    pay_cashiers_check: !!data.pay_cashiers_check,
    pay_electronic: !!data.pay_electronic,
    req_1: !!data.req_1,
    req_2: !!data.req_2,
    req_3: !!data.req_3,
    req_4: !!data.req_4,
    req_5: !!data.req_5,
    req_6: !!data.req_6,
    req_7: !!data.req_7,
    req_8: !!data.req_8,
  };

  // Iterate over all pages and their annotations
  for (const page of pages) {
    const annotsRef = page.node.get(PDFName.of('Annots'));
    if (!annotsRef) continue;

    const annots = pdfDoc.context.lookup(annotsRef);
    if (!annots || !annots.array) continue;

    for (const annotRef of annots.array) {
      const annot = pdfDoc.context.lookup(annotRef);
      if (!annot || !annot.get) continue;

      const tEntry = annot.get(PDFName.of('T'));
      if (!tEntry) continue;

      const fieldName = tEntry.decodeText ? tEntry.decodeText() : tEntry.value;
      if (!fieldName) continue;

      if (fieldName in textFields) {
        // Set text value
        annot.set(PDFName.of('V'), PDFString.of(textFields[fieldName]));
        // Remove appearance stream so viewer regenerates it
        annot.delete(PDFName.of('AP'));

      } else if (fieldName in checkboxFields) {
        const checked = checkboxFields[fieldName];
        const val = checked ? PDFName.of('Yes') : PDFName.of('Off');
        annot.set(PDFName.of('V'), val);
        annot.set(PDFName.of('AS'), val);
      }
    }
  }

  // Set NeedAppearances so PDF viewers regenerate field appearances
  const acroFormRef = pdfDoc.catalog.get(PDFName.of('AcroForm'));
  if (acroFormRef) {
    const acroForm = pdfDoc.context.lookup(acroFormRef);
    if (acroForm && acroForm.set) {
      acroForm.set(PDFName.of('NeedAppearances'), pdfDoc.context.obj(true));
    }
  } else {
    // Create a minimal AcroForm with NeedAppearances
    const acroForm = pdfDoc.context.obj({ NeedAppearances: true });
    const acroFormRef2 = pdfDoc.context.register(acroForm);
    pdfDoc.catalog.set(PDFName.of('AcroForm'), acroFormRef2);
  }

  return await pdfDoc.save();
}

// ─── Handler ─────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  try {
    // 1. Fill the PDF
    const pdfBytes = await fillPDF(data);

    // 2. Build filename
    const applicantSlug = (data.applicants || 'Applicant')
      .replace(/[^a-zA-Z0-9 &]/g, '')
      .trim()
      .replace(/\s+/g, '-');
    const dateSlug = (data.date || new Date().toLocaleDateString('en-US'))
      .replace(/[^a-zA-Z0-9]/g, '-');
    const filename = `Approval-Notice-${applicantSlug}-${dateSlug}.pdf`;

    // 3. Upload to Google Drive
    const auth = getAuthClient();
    const drive = google.drive({ version: 'v3', auth });

    const folderId = await getOrCreateFolderPath(drive, FOLDER_PATH);
    const fileInfo = await uploadToDrive(drive, pdfBytes, filename, folderId);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        filename: fileInfo.name,
        driveUrl: fileInfo.webViewLink,
        fileId: fileInfo.id,
      }),
    };

  } catch (err) {
    console.error('generate error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
