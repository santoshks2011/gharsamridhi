// ============================================================
//  GharSamridhi — Google Apps Script Backend (FINAL v5)
//
//  SETUP STEPS:
//  1. Open Google Sheet → Extensions → Apps Script
//  2. Delete all code → Paste this entire file → Save
//  3. Click Deploy → Manage Deployments → Edit → New Version → Deploy
//
//  FOR AI SCAN (one time):
//  4. Click ⚙️ Project Settings → Script Properties → Add:
//     Name: CLAUDE_API_KEY   Value: sk-ant-xxxx (from console.anthropic.com)
//  5. Deploy new version again after adding key
// ============================================================

const SHEET_NAME   = "Expenses";
const BUDGET_SHEET = "Budgets";
const PROOF_FOLDER = "GharSamridhi_Proofs"; // Google Drive folder name

// ── Entry points ─────────────────────────────────────────────
function doGet(e) {
  try {
    if (!e || !e.parameter || !e.parameter.action) {
      return respond({ status: 'GharSamridhi API is live ✅', version: 'v5' });
    }
    return respond(route(e.parameter.action, e.parameter));
  } catch(err) {
    return respond({ error: err.message });
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return respond({ error: 'No data received' });
    }
    const body   = JSON.parse(e.postData.contents);
    const action = body.action;
    if (!action) return respond({ error: 'No action specified' });
    return respond(route(action, body));
  } catch(err) {
    return respond({ error: 'Server error: ' + err.message });
  }
}

function route(action, body) {
  switch(action) {
    case 'addExpense':    return addExpense(body);
    case 'getExpenses':   return getExpenses(body);
    case 'deleteExpense': return deleteExpense(body);
    case 'saveBudgets':   return saveBudgets(body);
    case 'getBudgets':    return getBudgets();
    case 'claudeVision':  return callClaudeVision(body);
    case 'ping':          return { status: 'ok', time: new Date().toISOString() };
    default:              return { error: 'Unknown action: ' + action };
  }
}

function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Get or create sheet ──────────────────────────────────────
function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (name === SHEET_NAME) {
      sheet.appendRow(["ID","Date","Month","Category","Amount","Note","AddedBy","ProofLink"]);
      sheet.getRange(1,1,1,8).setFontWeight("bold").setBackground("#2E7D52").setFontColor("#ffffff");
      sheet.setFrozenRows(1);
      sheet.setColumnWidth(1,150); sheet.setColumnWidth(2,100);
      sheet.setColumnWidth(3,80);  sheet.setColumnWidth(4,180);
      sheet.setColumnWidth(5,100); sheet.setColumnWidth(6,250);
      sheet.setColumnWidth(7,100); sheet.setColumnWidth(8,200);
    }
    if (name === BUDGET_SHEET) {
      sheet.appendRow(["CategoryID","Budget"]);
      sheet.getRange(1,1,1,2).setFontWeight("bold").setBackground("#81C784").setFontColor("#0D2B1A");
    }
  }
  return sheet;
}

// ── Get or create Google Drive proof folder ──────────────────
function getProofFolder() {
  const folders = DriveApp.getFoldersByName(PROOF_FOLDER);
  if (folders.hasNext()) return folders.next();
  const folder = DriveApp.createFolder(PROOF_FOLDER);
  // Make folder accessible to anyone with link
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return folder;
}

// ── Add Expense (with optional proof image) ──────────────────
function addExpense(data) {
  if (!data.date) return { error: 'Date is required' };
  if (!data.amt)  return { error: 'Amount is required' };

  const sheet = getSheet(SHEET_NAME);
  const id    = Date.now().toString();
  const month = String(data.date).slice(0, 7);

  // Handle proof upload to Google Drive
  let proofLink = '';
  if (data.proofData && data.proofName) {
    try {
      const folder    = getProofFolder();
      const mimeType  = data.proofMime || 'image/jpeg';
      const decoded   = Utilities.base64Decode(data.proofData);
      const blob      = Utilities.newBlob(decoded, mimeType, data.proofName);
      const file      = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      proofLink = file.getUrl();
    } catch(e) {
      proofLink = 'Upload failed: ' + e.message;
    }
  }

  sheet.appendRow([
    id,
    data.date,
    month,
    data.cat      || 'other',
    Number(data.amt),
    data.note     || '',
    data.addedBy  || 'Family',
    proofLink
  ]);

  const lastRow = sheet.getLastRow();
  sheet.getRange(lastRow, 5).setNumberFormat('₹#,##0.00');
  if (lastRow % 2 === 0) sheet.getRange(lastRow,1,1,8).setBackground('#F1FAF4');

  // If proof link exists, make it clickable in sheet
  if (proofLink && proofLink.startsWith('http')) {
    sheet.getRange(lastRow, 8).setFormula('=HYPERLINK("' + proofLink + '","📎 View Proof")');
  }

  return { success: true, id, proofLink };
}

// ── Get Expenses ─────────────────────────────────────────────
function getExpenses(data) {
  const sheet = getSheet(SHEET_NAME);
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) return { expenses: [] };

  const filterMonth = (data && data.month) ? data.month : '';
  const expenses    = [];

  for (let i = 1; i < rows.length; i++) {
    const [id, date, rowMonth, cat, amt, note, addedBy, proofLink] = rows[i];
    if (!id) continue;
    if (filterMonth && rowMonth !== filterMonth) continue;

    let dateStr = date;
    if (date instanceof Date) {
      const yyyy = date.getFullYear();
      const mm   = String(date.getMonth()+1).padStart(2,'0');
      const dd   = String(date.getDate()).padStart(2,'0');
      dateStr = yyyy + '-' + mm + '-' + dd;
    }

    expenses.push({
      id:        id.toString(),
      date:      dateStr,
      month:     rowMonth,
      cat:       cat,
      amt:       Number(amt),
      note:      note      || '',
      addedBy:   addedBy   || '',
      proofLink: proofLink || ''
    });
  }
  return { expenses };
}

// ── Delete Expense ───────────────────────────────────────────
function deleteExpense(data) {
  if (!data || !data.id) return { error: 'ID is required' };
  const sheet = getSheet(SHEET_NAME);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0].toString() === data.id.toString()) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { error: 'Entry not found' };
}

// ── Save Budgets ─────────────────────────────────────────────
function saveBudgets(data) {
  const sheet   = getSheet(BUDGET_SHEET);
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2,1,lastRow-1,2).clearContent();
  const budgets = (data && data.budgets) ? data.budgets : {};
  Object.keys(budgets).forEach(catId => {
    const val = Number(budgets[catId]);
    if (val > 0) sheet.appendRow([catId, val]);
  });
  return { success: true };
}

// ── Get Budgets ──────────────────────────────────────────────
function getBudgets() {
  const sheet   = getSheet(BUDGET_SHEET);
  const rows    = sheet.getDataRange().getValues();
  const budgets = {};
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0]) budgets[rows[i][0]] = Number(rows[i][1]);
  }
  return { budgets };
}

// ── Claude Vision Proxy (AI Receipt Scan) ────────────────────
function callClaudeVision(data) {
  try {
    const apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
    if (!apiKey) return { error: 'CLAUDE_API_KEY not set in Script Properties' };

    const payload = {
      model:      'claude-sonnet-4-20250514',
      max_tokens:  500,
      messages: [{
        role: 'user',
        content: [
          {
            type:   'image',
            source: {
              type:       'base64',
              media_type:  data.mimeType || 'image/jpeg',
              data:        data.imageData
            }
          },
          { type: 'text', text: data.prompt }
        ]
      }]
    };

    const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method:            'post',
      contentType:       'application/json',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01'
      },
      payload:            JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const result = JSON.parse(response.getContentText());
    if (result.error) return { error: result.error.message };
    const text = result.content && result.content[0] ? result.content[0].text : '';
    return { result: text };

  } catch(err) {
    return { error: 'Vision error: ' + err.message };
  }
}
