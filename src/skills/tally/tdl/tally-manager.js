/**
 * Tally Manager — discover companies, check status, restart Tally.
 * Works on Windows only (TallyPrime).
 *
 * Tally data files (Company.1800 etc.) are proprietary encrypted binary —
 * company names can ONLY be read via TDL when Tally is running.
 * We maintain a local JSON cache so names are available offline too.
 */
const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');
const { escapeXml, postTally, formatTallyDate } = require('./helpers');
const { SEP } = require('./formatters');

// ── Constants ──

const TALLY_SEARCH_PATHS = [
  'C:\\Program Files\\TallyPrime',
  'C:\\Program Files (x86)\\TallyPrime',
  'C:\\TallyPrime',
  'C:\\Tally.ERP9',
];

/** Cache file lives next to the data folder */
const CACHE_FILENAME = '.tathastu-companies.json';

// ── tally.ini parsing ──

function parseTallyIni(customInstallPath) {
  let installPath = customInstallPath || null;
  if (!installPath) {
    for (const p of TALLY_SEARCH_PATHS) {
      if (fs.existsSync(path.join(p, 'tally.ini'))) { installPath = p; break; }
    }
  }

  const result = { installPath, dataPath: null, exePath: null, port: 9000, loadCompanies: [] };
  if (!installPath) return result;

  const iniPath = path.join(installPath, 'tally.ini');
  if (!fs.existsSync(iniPath)) return result;

  const exePath = path.join(installPath, 'tally.exe');
  if (fs.existsSync(exePath)) result.exePath = exePath;

  const content = fs.readFileSync(iniPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith(';;') || trimmed.startsWith(';')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim().toLowerCase();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key === 'data' && val) result.dataPath = val;
    if (key === 'serverport' && val) result.port = parseInt(val, 10) || 9000;
    if (key === 'load' && val) result.loadCompanies.push(val);
  }
  return result;
}

// ── Company name cache ──
// Tally data files are encrypted binary — names only come from TDL.
// We cache folder-ID → name mappings in a JSON file so they survive restarts.

function getCachePath(dataPath) {
  if (!dataPath) return null;
  return path.join(dataPath, CACHE_FILENAME);
}

function loadCache(dataPath) {
  const cachePath = getCachePath(dataPath);
  if (!cachePath || !fs.existsSync(cachePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch { return {}; }
}

function saveCache(dataPath, cache) {
  const cachePath = getCachePath(dataPath);
  if (!cachePath) return;
  try {
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf8');
  } catch { /* ignore write errors */ }
}

// ── Company discovery from data folder ──

/**
 * Extract company name from Tally's binary Company.1800 / Company.900 file.
 * The file is read as UTF-16LE; the first readable ASCII string (>=4 chars,
 * starting with a letter) is the company name.
 */
function extractCompanyName(companyFilePath) {
  try {
    const buf = fs.readFileSync(companyFilePath);
    const limit = Math.min(buf.length, 4000);
    // Decode as UTF-16LE
    const text = buf.toString('utf16le', 0, limit);
    // Replace non-printable chars with pipe, then find first readable name
    const clean = text.replace(/[^\x20-\x7E]/g, '|');
    const match = clean.match(/[A-Za-z][A-Za-z0-9 \-\.]{3,}/);
    return match ? match[0].trim() : null;
  } catch {
    return null;
  }
}

/**
 * Scan Tally data folder for company directories.
 * Reads company names directly from binary data files (UTF-16LE).
 * Falls back to cache if binary extraction fails.
 */
function scanDataFolder(dataPath) {
  if (!dataPath || !fs.existsSync(dataPath)) return [];

  const cache = loadCache(dataPath);
  let cacheUpdated = false;
  const entries = fs.readdirSync(dataPath, { withFileTypes: true });
  const companies = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!/^\d+$/.test(entry.name)) continue;

    const folderPath = path.join(dataPath, entry.name);
    const companyFile = fs.existsSync(path.join(folderPath, 'Company.1800'))
      ? 'Company.1800'
      : fs.existsSync(path.join(folderPath, 'Company.900'))
        ? 'Company.900'
        : null;

    if (!companyFile) continue;

    // Gather folder metadata
    const compStat = fs.statSync(path.join(folderPath, companyFile));
    const allFiles = fs.readdirSync(folderPath);
    let totalSize = 0;
    let latestMtime = compStat.mtime;
    for (const f of allFiles) {
      try {
        const s = fs.statSync(path.join(folderPath, f));
        if (s.isFile()) {
          totalSize += s.size;
          if (s.mtime > latestMtime) latestMtime = s.mtime;
        }
      } catch { /* skip */ }
    }

    const cached = cache[entry.name];
    // Try extracting name from binary file first, then fall back to cache
    const extractedName = extractCompanyName(path.join(folderPath, companyFile));
    const companyName = extractedName || cached?.name || null;

    // Update cache if we extracted a name that wasn't cached
    if (extractedName && (!cached || cached.name !== extractedName)) {
      cache[entry.name] = { ...cached, name: extractedName, updatedAt: new Date().toISOString() };
      cacheUpdated = true;
    }

    companies.push({
      id: entry.name,
      folderPath,
      name: companyName,
      startingFrom: cached?.startingFrom || null,
      tallyVersion: companyFile === 'Company.1800' ? 'TallyPrime' : 'Tally.ERP9',
      totalSizeMB: Math.round(totalSize / 1024 / 1024 * 10) / 10,
      lastModified: latestMtime.toISOString().slice(0, 10),
      fileCount: allFiles.length,
    });
  }

  // Save cache if we discovered new names from binary files
  if (cacheUpdated) saveCache(dataPath, cache);

  // Sort: largest (most active) first
  companies.sort((a, b) => b.totalSizeMB - a.totalSizeMB);
  return companies;
}

/**
 * Update cache by querying running Tally for company names,
 * then matching them to folder IDs via the Load= entries in tally.ini.
 */
async function refreshCompanyCache(baseUrl, dataPath, loadCompanies) {
  const cache = loadCache(dataPath);
  try {
    const xml = buildListCompaniesTdlXml();
    const resp = await postTally(baseUrl, xml);
    const tdlCompanies = parseListCompaniesTdlResponse(resp);

    // If there's exactly one loaded company and one Load= entry, map directly
    if (tdlCompanies.length === 1 && loadCompanies.length >= 1) {
      const folderId = loadCompanies[0];
      cache[folderId] = {
        name: tdlCompanies[0].name,
        startingFrom: tdlCompanies[0].startingFrom,
        booksFrom: tdlCompanies[0].booksFrom,
        updatedAt: new Date().toISOString(),
      };
    } else if (tdlCompanies.length > 0 && loadCompanies.length === tdlCompanies.length) {
      // Multiple companies loaded — map by order (Load= lines match TDL order)
      tdlCompanies.forEach((c, i) => {
        if (loadCompanies[i]) {
          cache[loadCompanies[i]] = {
            name: c.name,
            startingFrom: c.startingFrom,
            booksFrom: c.booksFrom,
            updatedAt: new Date().toISOString(),
          };
        }
      });
    }

    saveCache(dataPath, cache);
    return { success: true, cached: Object.keys(cache).length };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── TDL: List companies from running Tally ──

function buildListCompaniesTdlXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>CompanyList</ID></HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="CompanyList" ISMODIFY="No">
          <TYPE>Company</TYPE>
          <FETCH>Name, StartingFrom, BooksFrom</FETCH>
        </COLLECTION>
      </TDLMESSAGE></TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function parseListCompaniesTdlResponse(xmlString) {
  const companies = [];
  const regex = /<COMPANY\s+NAME="([^"]*)"[^>]*>[\s\S]*?<\/COMPANY>/gi;
  let m;
  while ((m = regex.exec(xmlString)) !== null) {
    const block = m[0];
    const name = m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    const startMatch = block.match(/<STARTINGFROM[^>]*>([^<]*)<\/STARTINGFROM>/i);
    const booksMatch = block.match(/<BOOKSFROM[^>]*>([^<]*)<\/BOOKSFROM>/i);
    companies.push({
      name,
      startingFrom: startMatch ? startMatch[1].trim() : null,
      booksFrom: booksMatch ? booksMatch[1].trim() : null,
    });
  }
  return companies;
}

// ── Tally process management ──

function isTallyRunning() {
  try {
    const output = execSync('tasklist /FI "IMAGENAME eq tally.exe" /FO CSV /NH', {
      encoding: 'utf8', timeout: 5000, windowsHide: true,
    });
    const match = output.match(/"tally\.exe","(\d+)"/i);
    if (match) return { running: true, pid: parseInt(match[1], 10) };
    return { running: false, pid: null };
  } catch {
    return { running: false, pid: null };
  }
}

async function checkTallyStatus(baseUrl) {
  try {
    const xml = buildListCompaniesTdlXml();
    const resp = await postTally(baseUrl, xml);
    const companies = parseListCompaniesTdlResponse(resp);
    return {
      responding: true, companies,
      activeCompany: companies.length > 0 ? companies[0].name : null,
    };
  } catch (err) {
    return { responding: false, companies: [], activeCompany: null, error: err.message };
  }
}

function killTally() {
  return new Promise((resolve) => {
    exec('taskkill /IM tally.exe /F', { windowsHide: true, timeout: 10000 }, (err) => {
      resolve(!err);
    });
  });
}

function startTally(exePath) {
  return new Promise((resolve) => {
    if (!exePath || !fs.existsSync(exePath)) { resolve(false); return; }
    const child = exec(`"${exePath}"`, { windowsHide: false, timeout: 5000 }, () => {});
    child.unref();
    setTimeout(() => resolve(true), 2000);
  });
}

async function restartTally(exePath) {
  const status = isTallyRunning();
  if (status.running) {
    const killed = await killTally();
    if (!killed) return { success: false, message: 'Could not stop Tally. Please close it manually.' };
    await new Promise(r => setTimeout(r, 3000));
  }
  if (!exePath) { const ini = parseTallyIni(); exePath = ini.exePath; }
  if (!exePath) return { success: false, message: 'Could not find tally.exe. Please start Tally manually.' };

  const started = await startTally(exePath);
  if (!started) return { success: false, message: 'Could not start Tally. Please start it manually from: ' + exePath };

  const baseUrl = `http://localhost:${parseTallyIni().port}`;
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const check = await checkTallyStatus(baseUrl);
    if (check.responding) {
      return { success: true, message: `✅ Tally restarted. Active company: ${check.activeCompany || 'None'}` };
    }
  }
  return { success: true, message: 'Tally started but HTTP server not responding yet. It may take a moment to load.' };
}

// ── Formatted output for WhatsApp ──

/**
 * Get full Tally status: process, HTTP, companies from disk + cache + TDL.
 * Also auto-refreshes the cache if Tally is running.
 */
async function getFullStatus(baseUrl, customInstallPath) {
  const ini = parseTallyIni(customInstallPath);
  const proc = isTallyRunning();
  const http = await checkTallyStatus(baseUrl);

  // Auto-refresh cache when Tally is responding
  if (http.responding && ini.dataPath) {
    await refreshCompanyCache(baseUrl, ini.dataPath, ini.loadCompanies);
  }

  // Scan data folder (uses cache for names)
  const dataCompanies = scanDataFolder(ini.dataPath);

  const lines = ['🖥️ *Tally Status*', ''];

  // Process status
  lines.push(proc.running ? `✅ Tally is running (PID: ${proc.pid})` : '❌ Tally is not running');
  if (proc.running) {
    lines.push(http.responding ? '✅ HTTP server responding' : '⚠️ HTTP server not responding');
  }

  // Install info
  if (ini.installPath) lines.push(`📁 Install: ${ini.installPath}`);
  if (ini.dataPath) lines.push(`📁 Data: ${ini.dataPath}`);
  lines.push(`🔌 Port: ${ini.port}`);

  // Companies on disk
  if (dataCompanies.length > 0) {
    const loadedIds = new Set(ini.loadCompanies);
    lines.push('', `*Companies on disk:* (${dataCompanies.length})`);
    dataCompanies.forEach((dc, i) => {
      const loaded = loadedIds.has(dc.id) ? ' ✅ _active_' : '';
      const nameStr = dc.name ? `*${dc.name}*` : `_Unknown (${dc.id})_`;
      const fy = dc.startingFrom ? ` | FY: ${formatTallyDate(dc.startingFrom)}` : '';
      lines.push(`${i + 1}. ${nameStr}${loaded}`);
      lines.push(`   📂 ${dc.id} | ${dc.totalSizeMB} MB | ${dc.fileCount} files | Modified: ${dc.lastModified}${fy}`);
    });
  } else {
    lines.push('', 'No company data folders found.');
  }

  lines.push('', SEP);
  if (!proc.running) {
    lines.push('💡 Say "start tally" to launch TallyPrime');
  } else if (!http.responding) {
    lines.push('💡 Say "restart tally" to fix the connection');
  } else {
    const unnamed = dataCompanies.filter(c => !c.name).length;
    if (unnamed > 0) {
      lines.push(`💡 ${unnamed} company name(s) not yet cached. Load them in Tally to identify.`);
    }
  }

  return { success: true, message: lines.join('\n'), data: { process: proc, http, ini, dataCompanies } };
}

/**
 * Open a specific company in Tally by updating tally.ini Load= line,
 * then restarting Tally. Matches by company name (fuzzy) or folder ID.
 * @param {string} companyQuery - Company name or folder ID
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function openCompany(companyQuery) {
  const ini = parseTallyIni();
  if (!ini.installPath || !ini.dataPath) {
    return { success: false, message: 'Could not find TallyPrime installation or data path.' };
  }

  const iniPath = path.join(ini.installPath, 'tally.ini');
  if (!fs.existsSync(iniPath)) {
    return { success: false, message: 'tally.ini not found at ' + iniPath };
  }

  // Scan companies on disk
  const companies = scanDataFolder(ini.dataPath);
  if (companies.length === 0) {
    return { success: false, message: 'No company data folders found in ' + ini.dataPath };
  }

  // Match by folder ID or name (case-insensitive, partial)
  const query = (companyQuery || '').trim().toLowerCase();
  let match = null;

  // Exact folder ID match
  match = companies.find(c => c.id === query);

  // Exact name match
  if (!match) {
    match = companies.find(c => c.name && c.name.toLowerCase() === query);
  }

  // Partial name match
  if (!match) {
    const partials = companies.filter(c => c.name && c.name.toLowerCase().includes(query));
    if (partials.length === 1) {
      match = partials[0];
    } else if (partials.length > 1) {
      const lines = [`Multiple companies match "${companyQuery}":`];
      partials.forEach((c, i) => lines.push(`${i + 1}. ${c.name} (${c.id})`));
      lines.push('\nPlease be more specific.');
      return { success: false, message: lines.join('\n') };
    }
  }

  // Number selection (1, 2, 3...)
  if (!match && /^\d+$/.test(query)) {
    const idx = parseInt(query, 10) - 1;
    if (idx >= 0 && idx < companies.length) {
      match = companies[idx];
    }
  }

  if (!match) {
    const lines = [`Company "${companyQuery}" not found. Available companies:`];
    companies.forEach((c, i) => lines.push(`${i + 1}. ${c.name || c.id}`));
    return { success: false, message: lines.join('\n') };
  }

  // Check if already the active company
  if (ini.loadCompanies.includes(match.id)) {
    const proc = isTallyRunning();
    if (proc.running) {
      return { success: true, message: `✅ *${match.name || match.id}* is already the active company.` };
    }
  }

  // Backup tally.ini (once)
  const backupPath = iniPath + '.bak';
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(iniPath, backupPath);
  }

  // Update tally.ini: set Load= to the selected company folder
  let iniContent = fs.readFileSync(iniPath, 'utf8');
  iniContent = iniContent.replace(/^Load=.*$/m, `Load=${match.id}`);
  fs.writeFileSync(iniPath, iniContent, 'utf8');

  // Restart Tally with the new company
  const result = await restartTally(ini.exePath);
  const companyLabel = match.name || match.id;

  if (result.success) {
    return { success: true, message: `✅ Opened *${companyLabel}* in TallyPrime.` };
  } else {
    return { success: false, message: `Updated tally.ini to load *${companyLabel}*, but Tally restart failed: ${result.message}` };
  }
}

module.exports = {
  parseTallyIni,
  extractCompanyName,
  scanDataFolder,
  loadCache,
  saveCache,
  refreshCompanyCache,
  buildListCompaniesTdlXml,
  parseListCompaniesTdlResponse,
  isTallyRunning,
  checkTallyStatus,
  killTally,
  startTally,
  restartTally,
  openCompany,
  getFullStatus,
};
