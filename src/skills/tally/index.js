const tdlClient = require('./tdl-client');

const MAX_SUGGESTIONS = 5;

/**
 * Try exact match first. If no result, do a fuzzy CONTAINS search.
 * Returns: { match: 'exact'|'single'|'multiple'|'none', name?, suggestions? }
 */
async function resolvePartyName(partyName, baseUrl, companyName) {
  // 1) Exact match — try the name as-is
  const exactXml = tdlClient.buildSearchLedgersTdlXml(partyName, companyName);
  const exactResp = await tdlClient.postTally(baseUrl, exactXml);
  const exactParsed = tdlClient.parseSearchLedgersResponse(exactResp);

  // Check if any result matches exactly (case-insensitive)
  const exactHit = (exactParsed.data || []).find(
    (l) => l.name.toLowerCase() === partyName.toLowerCase()
  );
  if (exactHit) {
    return { match: 'exact', name: exactHit.name };
  }

  // 2) The CONTAINS search already ran — check results
  const results = exactParsed.data || [];

  if (results.length === 1) {
    return { match: 'single', name: results[0].name };
  }

  if (results.length > 1) {
    // Score and sort by relevance: prefer names starting with the search term
    const lower = partyName.toLowerCase();
    const scored = results.map((r) => {
      const n = r.name.toLowerCase();
      let score = 0;
      if (n.startsWith(lower)) score += 10;
      // Bonus for each word in search term found in name
      const words = lower.split(/\s+/);
      for (const w of words) {
        if (n.includes(w)) score += 2;
      }
      return { ...r, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return { match: 'multiple', suggestions: scored.slice(0, MAX_SUGGESTIONS) };
  }

  // 3) No results from CONTAINS — try splitting into words and search each
  const words = partyName.split(/\s+/).filter((w) => w.length >= 3);
  if (words.length > 1) {
    // Search with the longest word
    const longest = words.sort((a, b) => b.length - a.length)[0];
    const fallbackXml = tdlClient.buildSearchLedgersTdlXml(longest, companyName);
    const fallbackResp = await tdlClient.postTally(baseUrl, fallbackXml);
    const fallbackParsed = tdlClient.parseSearchLedgersResponse(fallbackResp);
    const fallbackResults = fallbackParsed.data || [];

    if (fallbackResults.length === 1) {
      return { match: 'single', name: fallbackResults[0].name };
    }
    if (fallbackResults.length > 1) {
      return { match: 'multiple', suggestions: fallbackResults.slice(0, MAX_SUGGESTIONS) };
    }
  }

  return { match: 'none' };
}

/**
 * Format suggestions as a numbered list for WhatsApp.
 */
function formatSuggestions(suggestions, originalQuery) {
  const lines = [`No exact match for "${originalQuery}". Did you mean:`];
  suggestions.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.name} (${s.parent || 'N/A'})`);
  });
  lines.push('\nReply with the exact name to proceed.');
  return lines.join('\n');
}

function tallyError(err, port) {
  if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') {
    return { success: false, message: 'Tally is not reachable. Please open TallyPrime and enable HTTP server on port ' + port + '.' };
  }
  return { success: false, message: err.message || String(err) };
}

/**
 * Tally skill: execute(skillId, action, params, skillConfig) => Promise<{ success, message?, data? }>
 * skillConfig: { port, companyName }
 */
async function execute(skillId, action, params = {}, skillConfig = {}) {
  const port = skillConfig.port ?? 9000;
  const companyName = skillConfig.companyName || null;
  const baseUrl = `http://localhost:${port}`;

  if (action === 'get_ledger') {
    const partyName = params.party_name;
    if (!partyName || typeof partyName !== 'string') {
      return { success: false, message: 'Please specify a party name. Example: "Ledger for Meril" or "Statement of Atul Singh"' };
    }
    try {
      const resolved = await resolvePartyName(partyName, baseUrl, companyName);
      if (resolved.match === 'none') {
        // No match at all — try listing some ledgers as suggestions
        try {
          const listXml = tdlClient.buildListLedgersTdlXml(null, companyName);
          const listResp = await tdlClient.postTally(baseUrl, listXml);
          const listParsed = tdlClient.parseListLedgersTdlResponse(listResp);
          if (listParsed.data && listParsed.data.length > 0) {
            const sample = listParsed.data.slice(0, 10).map((l, i) => `${i + 1}. ${l.name}`).join('\n');
            return { success: false, message: `Party "${partyName}" not found. Here are some ledgers:\n${sample}\n\nReply with the exact name.` };
          }
        } catch (e) { /* ignore */ }
        return { success: false, message: `Party "${partyName}" not found in Tally.` };
      }
      if (resolved.match === 'multiple') {
        return { success: true, message: formatSuggestions(resolved.suggestions, partyName), data: { suggestions: resolved.suggestions } };
      }
      const dateFrom = params.date_from || null;
      const dateTo = params.date_to || null;
      const xml = tdlClient.buildLedgerStatementTdlXml(resolved.name, companyName, dateFrom, dateTo);
      const responseXml = await tdlClient.postTally(baseUrl, xml);
      const parsed = tdlClient.parseLedgerStatementTdlResponse(responseXml, resolved.name, 20);
      if (!parsed.success) return { success: false, message: parsed.message || 'Ledger not found.' };
      return { success: true, message: parsed.message, data: parsed.data };
    } catch (err) {
      return tallyError(err, port);
    }
  }

  if (action === 'get_vouchers' || action === 'get_daybook') {
    const dateFrom = params.date_from ? tdlClient.toTallyDate(params.date_from) : null;
    const dateTo = params.date_to ? tdlClient.toTallyDate(params.date_to) : null;
    const voucherType = params.voucher_type || null;
    const limit = typeof params.limit === 'number' ? params.limit : (params.limit ? parseInt(String(params.limit), 10) : 50);
    // Compute actual date range here so we can pass to both builder and parser
    let actualFrom = dateFrom, actualTo = dateTo;
    if (!dateFrom && !dateTo) {
      const now = new Date();
      const today = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
      actualFrom = today;
      actualTo = today;
    } else {
      actualTo = actualTo || actualFrom;
    }
    try {
      const xml = tdlClient.buildVouchersTdlXml(companyName, dateFrom, dateTo, voucherType);
      const responseXml = await tdlClient.postTally(baseUrl, xml);
      const parsed = tdlClient.parseVouchersTdlResponse(responseXml, limit, actualFrom, actualTo);
      if (!parsed.success) return { success: false, message: parsed.message || 'Could not fetch vouchers.' };
      return { success: true, message: parsed.message, data: parsed.data };
    } catch (err) {
      return tallyError(err, port);
    }
  }

  if (action === 'list_ledgers') {
    const groupFilter = params.group_filter || null;
    try {
      const xml = tdlClient.buildListLedgersTdlXml(groupFilter, companyName);
      const responseXml = await tdlClient.postTally(baseUrl, xml);
      const parsed = tdlClient.parseListLedgersTdlResponse(responseXml);
      if (!parsed.success) return { success: false, message: parsed.message || 'Could not list ledgers.' };
      return { success: true, message: parsed.message, data: parsed.data };
    } catch (err) {
      return tallyError(err, port);
    }
  }

  if (action === 'get_party_gstin') {
    const partyName = params.party_name;
    if (!partyName || typeof partyName !== 'string') {
      return { success: false, message: 'Please specify a party name. Example: "What is the GSTIN for ABC Company?"' };
    }
    try {
      const resolved = await resolvePartyName(partyName, baseUrl, companyName);
      if (resolved.match === 'none') {
        return { success: false, message: `Party "${partyName}" not found in Tally.` };
      }
      if (resolved.match === 'multiple') {
        return { success: true, message: formatSuggestions(resolved.suggestions, partyName), data: { suggestions: resolved.suggestions } };
      }
      // exact or single match
      const xml = tdlClient.buildLedgerMasterTdlXml(resolved.name, companyName);
      const responseXml = await tdlClient.postTally(baseUrl, xml);
      const parsed = tdlClient.parseLedgerMasterTdlResponse(responseXml);
      if (!parsed.success) return { success: false, message: parsed.message || 'Could not fetch party.' };
      return { success: true, message: parsed.message, data: parsed.data };
    } catch (err) {
      return tallyError(err, port);
    }
  }

  if (action === 'get_party_balance') {
    const partyName = params.party_name;
    if (!partyName || typeof partyName !== 'string') {
      return { success: false, message: 'Please specify a party name.' };
    }
    try {
      const resolved = await resolvePartyName(partyName, baseUrl, companyName);
      if (resolved.match === 'none') {
        return { success: false, message: `Party "${partyName}" not found in Tally.` };
      }
      if (resolved.match === 'multiple') {
        return { success: true, message: formatSuggestions(resolved.suggestions, partyName), data: { suggestions: resolved.suggestions } };
      }
      // exact or single match
      const xml = tdlClient.buildLedgerBalanceTdlXml(resolved.name, companyName);
      const responseXml = await tdlClient.postTally(baseUrl, xml);
      const parsed = tdlClient.parseLedgerBalanceTdlResponse(responseXml);
      if (!parsed.success) return { success: false, message: parsed.message || 'Could not fetch balance.' };
      return { success: true, message: parsed.message, data: parsed.data };
    } catch (err) {
      return tallyError(err, port);
    }
  }

  if (action === 'get_sales_report' || action === 'get_purchase_report') {
    const reportType = action === 'get_purchase_report' ? 'purchase'
      : (params.type && params.type.toLowerCase().includes('purchase')) ? 'purchase' : 'sales';
    const dateFrom = params.date_from ? tdlClient.toTallyDate(params.date_from) : null;
    const dateTo = params.date_to ? tdlClient.toTallyDate(params.date_to) : null;
    // Compute actual date range for JS-side filtering
    let actualFrom = dateFrom, actualTo = dateTo;
    if (!dateFrom && !dateTo) {
      const now = new Date();
      actualFrom = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}01`;
      actualTo = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    } else {
      actualTo = actualTo || actualFrom;
    }
    try {
      const xml = tdlClient.buildSalesPurchaseReportTdlXml(companyName, reportType, dateFrom, dateTo);
      const responseXml = await tdlClient.postTally(baseUrl, xml);
      const parsed = tdlClient.parseSalesPurchaseReportTdlResponse(responseXml, reportType, actualFrom, actualTo);
      if (!parsed.success) return { success: false, message: parsed.message || 'Could not fetch report.' };
      return { success: true, message: parsed.message, data: parsed.data };
    } catch (err) {
      return tallyError(err, port);
    }
  }

  if (action === 'get_outstanding') {
    const type = (params.type || 'payable').toLowerCase();
    let groupName;
    if (type.includes('receiv') || type.includes('debtor')) {
      groupName = 'Sundry Debtors';
    } else {
      groupName = 'Sundry Creditors';
    }
    try {
      const xml = tdlClient.buildOutstandingTdlXml(groupName, companyName);
      const responseXml = await tdlClient.postTally(baseUrl, xml);
      const parsed = tdlClient.parseOutstandingTdlResponse(responseXml, groupName);
      if (!parsed.success) return { success: false, message: parsed.message || 'Could not fetch outstanding.' };
      return { success: true, message: parsed.message, data: parsed.data };
    } catch (err) {
      return tallyError(err, port);
    }
  }

  return { success: false, message: 'Unknown Tally action: ' + action };
}

module.exports = { execute };
