const tdlClient = require('./tdl');

const MAX_SUGGESTIONS = 5;
const PAGE_SIZE = 20;

/**
 * Paginate a list result for WhatsApp display.
 * Takes a parsed result with message + data array, re-renders the message
 * showing only the requested page, and adds navigation hints.
 *
 * @param {object} parsed - { success, message, data } from a parser
 * @param {Array} items - the full array of items to paginate
 * @param {number} page - 1-based page number
 * @param {function} renderLine - (item, index) => string for each line
 * @param {string} header - header line for the message
 * @returns {object} - { success, message, data } with paginated message
 */
function paginateResult(parsed, items, page, renderLine, header) {
  const totalPages = Math.ceil(items.length / PAGE_SIZE);
  const p = Math.max(1, Math.min(page || 1, totalPages));
  const start = (p - 1) * PAGE_SIZE;
  const slice = items.slice(start, start + PAGE_SIZE);

  const lines = [header, ''];
  slice.forEach((item, i) => {
    lines.push(renderLine(item, start + i));
  });

  if (totalPages > 1) {
    lines.push('', `📄 Page ${p}/${totalPages} (${items.length} total)`);
    if (p < totalPages) {
      lines.push(`Say "more" or "page ${p + 1}" to see next.`);
    }
  }

  return { success: true, message: lines.join('\n'), data: parsed.data };
}

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
    const proc = tdlClient.isTallyRunning();
    if (!proc.running) {
      return { success: false, message: '❌ Tally is not running. Say "start tally" to launch it, or open TallyPrime manually and enable HTTP server on port ' + port + '.' };
    }
    return { success: false, message: '⚠️ Tally is running but HTTP server not responding on port ' + port + '. Say "restart tally" to fix it.' };
  }
  if (err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT') {
    return { success: false, message: '⏳ Tally is taking too long to respond. It might be busy. Try again or say "restart tally".' };
  }
  return { success: false, message: err.message || String(err) };
}

/**
 * Tally skill: execute(skillId, action, params, skillConfig) => Promise<{ success, message?, data? }>
 * skillConfig: { port, companyName }
 */
// Cache the active company name so we don't query Tally on every request
let _cachedCompanyName = null;
let _cachedCompanyAt = 0;
const COMPANY_CACHE_MS = 60000; // refresh every 60s

async function execute(skillId, action, params = {}, skillConfig = {}) {
  const port = skillConfig.port ?? 9000;
  const baseUrl = `http://localhost:${port}`;

  // Auto-detect active company from Tally instead of relying on static config.
  // This ensures queries work after switching companies via open_company.
  let companyName = skillConfig.companyName || null;
  const offlineActions = ['list_companies', 'tally_status', 'start_tally', 'open_company'];
  if (!offlineActions.includes(action)) {
    const now = Date.now();
    if (!_cachedCompanyName || (now - _cachedCompanyAt) > COMPANY_CACHE_MS) {
      try {
        const status = await tdlClient.checkTallyStatus(baseUrl);
        if (status.responding && status.activeCompany) {
          _cachedCompanyName = status.activeCompany;
          _cachedCompanyAt = now;
        }
      } catch { /* use config fallback */ }
    }
    if (_cachedCompanyName) companyName = _cachedCompanyName;
  }

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
    const page = parseInt(params.page, 10) || 1;
    try {
      const xml = tdlClient.buildListLedgersTdlXml(groupFilter, companyName);
      const responseXml = await tdlClient.postTally(baseUrl, xml);
      const parsed = tdlClient.parseListLedgersTdlResponse(responseXml);
      if (!parsed.success) return { success: false, message: parsed.message || 'Could not list ledgers.' };
      if (!parsed.data || parsed.data.length === 0) return parsed;
      const items = parsed.data;
      const groupLabel = groupFilter ? ` (${groupFilter})` : '';
      return paginateResult(parsed, items, page,
        (l, i) => `${i + 1}. ${l.name}${l.parent ? ' _(' + l.parent + ')_' : ''}`,
        `📒 *Ledgers${groupLabel}* (${items.length})`
      );
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
    const page = parseInt(params.page, 10) || 1;
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
      const entries = parsed.data?.entries || [];
      if (entries.length === 0) return parsed;
      const isPayable = groupName.toLowerCase().includes('creditor');
      const label = isPayable ? 'Payable' : 'Receivable';
      const total = entries.reduce((s, e) => s + e.closingBalance, 0);
      return paginateResult(parsed, entries, page,
        (e, i) => `${i + 1}. ${e.name} — ₹${tdlClient.inr(e.closingBalance)}`,
        `📊 *${groupName} — ${label}* (${entries.length} parties, Total: ₹${tdlClient.inr(total)})`
      );
    } catch (err) {
      return tallyError(err, port);
    }
  }

  if (action === 'get_cash_bank_balance') {
    try {
      const xml = tdlClient.buildCashBankBalanceTdlXml(companyName);
      const responseXml = await tdlClient.postTally(baseUrl, xml);
      const parsed = tdlClient.parseCashBankBalanceTdlResponse(responseXml);
      if (!parsed.success) return { success: false, message: parsed.message || 'Could not fetch balances.' };
      return { success: true, message: parsed.message, data: parsed.data };
    } catch (err) {
      return tallyError(err, port);
    }
  }

  if (action === 'get_profit_loss') {
    let dateFrom = params.date_from ? tdlClient.toTallyDate(params.date_from) : null;
    let dateTo = params.date_to ? tdlClient.toTallyDate(params.date_to) : null;
    // Safety: if date_from > date_to (e.g. OpenAI guessed wrong FY), ignore both
    if (dateFrom && dateTo && dateFrom > dateTo) {
      dateFrom = null;
      dateTo = null;
    }
    try {
      const xml = tdlClient.buildProfitLossTdlXml(companyName, dateFrom, dateTo);
      const responseXml = await tdlClient.postTally(baseUrl, xml);
      const parsed = tdlClient.parseProfitLossTdlResponse(responseXml, dateFrom, dateTo);
      if (!parsed.success) return { success: false, message: parsed.message || 'Could not fetch P&L.' };
      return { success: true, message: parsed.message, data: parsed.data };
    } catch (err) {
      return tallyError(err, port);
    }
  }

  if (action === 'get_expense_report') {
    let dateFrom = params.date_from ? tdlClient.toTallyDate(params.date_from) : null;
    let dateTo = params.date_to ? tdlClient.toTallyDate(params.date_to) : null;
    if (dateFrom && dateTo && dateFrom > dateTo) { dateFrom = null; dateTo = null; }
    const page = parseInt(params.page, 10) || 1;
    try {
      const xml = tdlClient.buildExpenseReportTdlXml(companyName, dateFrom, dateTo);
      const responseXml = await tdlClient.postTally(baseUrl, xml);
      const parsed = tdlClient.parseExpenseReportTdlResponse(responseXml, dateFrom, dateTo);
      if (!parsed.success) return { success: false, message: parsed.message || 'Could not fetch expenses.' };
      const entries = parsed.data?.entries || [];
      if (entries.length === 0) return parsed;
      const total = parsed.data.total;
      const fromStr = dateFrom ? tdlClient.formatTallyDate(dateFrom) : '';
      const toStr = dateTo ? tdlClient.formatTallyDate(dateTo) : '';
      const dateRange = fromStr && toStr ? `${fromStr} to ${toStr}` : 'Current FY';
      return paginateResult(parsed, entries, page,
        (e, i) => `${i + 1}. ${e.name} — ₹${tdlClient.inr(e.amount)}${e.parent ? '\n   _' + e.parent + '_' : ''}`,
        `💸 *Expense Report: ${dateRange}* (${entries.length} heads, Total: ₹${tdlClient.inr(total)})`
      );
    } catch (err) {
      return tallyError(err, port);
    }
  }

  if (action === 'get_stock_summary') {
    const itemName = params.item_name || null;
    const page = parseInt(params.page, 10) || 1;
    try {
      const xml = tdlClient.buildStockSummaryTdlXml(companyName, itemName);
      const responseXml = await tdlClient.postTally(baseUrl, xml);
      const parsed = tdlClient.parseStockSummaryTdlResponse(responseXml);
      if (!parsed.success) return { success: false, message: parsed.message || 'Could not fetch stock.' };
      const items = parsed.data?.items || [];
      if (items.length === 0) return parsed;
      const totalValue = parsed.data.totalValue;
      return paginateResult(parsed, items, page,
        (item, i) => {
          const qtyStr = item.qty ? `${item.qty} ${item.unit}` : '';
          return `${i + 1}. *${item.name}*\n   ${qtyStr ? 'Qty: ' + qtyStr + ' | ' : ''}Value: ₹${tdlClient.inr(item.closingValue)}`;
        },
        `📦 *Stock Summary* (${items.length} items, Total: ₹${tdlClient.inr(totalValue)})`
      );
    } catch (err) {
      return tallyError(err, port);
    }
  }

  if (action === 'get_gst_summary') {
    let dateFrom = params.date_from ? tdlClient.toTallyDate(params.date_from) : null;
    let dateTo = params.date_to ? tdlClient.toTallyDate(params.date_to) : null;
    if (dateFrom && dateTo && dateFrom > dateTo) { dateFrom = null; dateTo = null; }
    try {
      const xml = tdlClient.buildGstSummaryTdlXml(companyName, dateFrom, dateTo);
      const responseXml = await tdlClient.postTally(baseUrl, xml);
      const parsed = tdlClient.parseGstSummaryTdlResponse(responseXml, dateFrom, dateTo);
      if (!parsed.success) return { success: false, message: parsed.message || 'Could not fetch GST summary.' };
      return { success: true, message: parsed.message, data: parsed.data };
    } catch (err) {
      return tallyError(err, port);
    }
  }

  if (action === 'get_party_invoices') {
    const partyName = params.party_name;
    if (!partyName || typeof partyName !== 'string') {
      return { success: false, message: 'Please specify a party name. Example: "Invoices for Meril" or "Bills of ABC Company"' };
    }
    let dateFrom = params.date_from ? tdlClient.toTallyDate(params.date_from) : null;
    let dateTo = params.date_to ? tdlClient.toTallyDate(params.date_to) : null;
    if (dateFrom && dateTo && dateFrom > dateTo) { dateFrom = null; dateTo = null; }
    const voucherType = params.voucher_type || 'Sales';
    const page = parseInt(params.page, 10) || 1;
    try {
      const resolved = await resolvePartyName(partyName, baseUrl, companyName);
      if (resolved.match === 'none') return { success: false, message: `Party "${partyName}" not found in Tally.` };
      if (resolved.match === 'multiple') return { success: true, message: formatSuggestions(resolved.suggestions, partyName), data: { suggestions: resolved.suggestions } };
      const xml = tdlClient.buildPartyInvoicesTdlXml(resolved.name, companyName, dateFrom, dateTo, voucherType);
      const responseXml = await tdlClient.postTally(baseUrl, xml);
      const parsed = tdlClient.parsePartyInvoicesTdlResponse(responseXml, resolved.name, dateFrom, dateTo);
      if (!parsed.success) return { success: false, message: parsed.message || 'Could not fetch invoices.' };
      const invoices = parsed.data?.invoices || [];
      if (invoices.length === 0) return parsed;
      return paginateResult(parsed, invoices, page,
        (inv, i) => {
          const dateStr = inv.date ? tdlClient.formatTallyDate(inv.date) : '';
          let line = `${i + 1}. *#${inv.number || 'N/A'}* — ${dateStr} — ₹${tdlClient.inr(Math.abs(inv.amount))}`;
          if (inv.narration) line += `\n   _${inv.narration.slice(0, 60)}_`;
          return line;
        },
        `🧾 *Invoices: ${resolved.name}* (${invoices.length} total, ₹${tdlClient.inr(parsed.data.total)})`
      );
    } catch (err) {
      return tallyError(err, port);
    }
  }

  if (action === 'get_invoice_pdf') {
    const invoiceNumber = params.invoice_number;
    if (!invoiceNumber || typeof invoiceNumber !== 'string') {
      return { success: false, message: 'Please specify an invoice number. Example: "Send invoice MB-25-26-001" or "PDF of invoice INV-100"' };
    }
    const voucherType = params.voucher_type || 'Sales';
    try {
      // 1. Fetch the voucher by number
      const vchXml = tdlClient.buildInvoiceDetailTdlXml(invoiceNumber, companyName, voucherType);
      const vchResp = await tdlClient.postTally(baseUrl, vchXml);
      const invoice = tdlClient.parseInvoiceDetailResponse(vchResp);
      if (!invoice) return { success: false, message: `Invoice "${invoiceNumber}" not found in Tally.` };

      // 2. Fetch company info
      const compXml = tdlClient.buildCompanyInfoTdlXml(companyName);
      const compResp = await tdlClient.postTally(baseUrl, compXml);
      const company = tdlClient.parseCompanyInfoResponse(compResp);

      // 3. Fetch party details
      const partyXml = tdlClient.buildPartyDetailTdlXml(invoice.party, companyName);
      const partyResp = await tdlClient.postTally(baseUrl, partyXml);
      const party = tdlClient.parsePartyDetailResponse(partyResp);

      // 4. Generate HTML and convert to PDF
      const html = tdlClient.generateInvoiceHtml(invoice, company, party);
      const pdfBuffer = await tdlClient.htmlToPdfBuffer(html);

      // Return PDF buffer and metadata — orchestrator will send as document
      return {
        success: true,
        message: `🧾 Invoice *#${invoice.number}* for *${invoice.party}* — ₹${tdlClient.inr(Math.abs(invoice.amount))}`,
        data: { invoice, company, party },
        attachment: {
          buffer: pdfBuffer,
          filename: `${invoice.number.replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`,
          caption: `Invoice #${invoice.number} — ${invoice.party} — ₹${tdlClient.inr(Math.abs(invoice.amount))}`,
        },
      };
    } catch (err) {
      return tallyError(err, port);
    }
  }

  if (action === 'get_bill_outstanding') {
    const partyName = params.party_name;
    if (!partyName || typeof partyName !== 'string') {
      return { success: false, message: 'Please specify a party name. Example: "Pending bills for Meril"' };
    }
    try {
      const resolved = await resolvePartyName(partyName, baseUrl, companyName);
      if (resolved.match === 'none') return { success: false, message: `Party "${partyName}" not found in Tally.` };
      if (resolved.match === 'multiple') return { success: true, message: formatSuggestions(resolved.suggestions, partyName), data: { suggestions: resolved.suggestions } };
      const xml = tdlClient.buildBillOutstandingTdlXml(resolved.name, companyName);
      const responseXml = await tdlClient.postTally(baseUrl, xml);
      const parsed = tdlClient.parseBillOutstandingTdlResponse(responseXml, resolved.name);
      if (!parsed.success) return { success: false, message: parsed.message || 'Could not fetch bills.' };
      return { success: true, message: parsed.message, data: parsed.data };
    } catch (err) {
      return tallyError(err, port);
    }
  }

  if (action === 'tally_status') {
    try {
      const result = await tdlClient.getFullStatus(baseUrl);
      return result;
    } catch (err) {
      return tallyError(err, port);
    }
  }

  if (action === 'list_companies') {
    // Scan from disk — works even when Tally is not running
    const ini = tdlClient.parseTallyIni();
    const companies = tdlClient.scanDataFolder(ini.dataPath);
    if (companies.length === 0) {
      return { success: true, message: 'No company data folders found.', data: { companies: [] } };
    }
    const loadedIds = new Set(ini.loadCompanies);
    const lines = ['📋 *Companies on this system:*', ''];
    companies.forEach((c, i) => {
      const active = loadedIds.has(c.id) ? ' ✅ _active_' : '';
      const nameStr = c.name || `Unknown (${c.id})`;
      const fy = c.startingFrom ? ` | FY: ${tdlClient.formatTallyDate(c.startingFrom)}` : '';
      lines.push(`${i + 1}. *${nameStr}*${active}`);
      lines.push(`   ${c.totalSizeMB} MB | ${c.fileCount} files | ${c.tallyVersion}${fy}`);
    });
    return { success: true, message: lines.join('\n'), data: { companies } };
  }

  if (action === 'restart_tally') {
    try {
      _cachedCompanyName = null; // clear cache so next query detects fresh company
      const ini = tdlClient.parseTallyIni();
      const result = await tdlClient.restartTally(ini.exePath);
      return result;
    } catch (err) {
      return { success: false, message: 'Failed to restart Tally: ' + (err.message || String(err)) };
    }
  }

  if (action === 'start_tally') {
    try {
      const proc = tdlClient.isTallyRunning();
      if (proc.running) {
        return { success: true, message: 'Tally is already running (PID: ' + proc.pid + ').' };
      }
      const ini = tdlClient.parseTallyIni();
      if (!ini.exePath) {
        return { success: false, message: 'Could not find tally.exe. Please start Tally manually.' };
      }
      const started = await tdlClient.startTally(ini.exePath);
      if (!started) {
        return { success: false, message: 'Could not start Tally. Please start it manually.' };
      }
      return { success: true, message: '✅ Tally is starting up. It may take a moment to load.' };
    } catch (err) {
      return { success: false, message: 'Failed to start Tally: ' + (err.message || String(err)) };
    }
  }

  if (action === 'open_company') {
    const companyQuery = params.company_name;
    if (!companyQuery || typeof companyQuery !== 'string') {
      // No name given — list available companies so user can pick
      const ini = tdlClient.parseTallyIni();
      const companies = tdlClient.scanDataFolder(ini.dataPath);
      if (companies.length === 0) {
        return { success: false, message: 'No company data folders found.' };
      }
      const lines = ['Which company do you want to open?', ''];
      companies.forEach((c, i) => {
        const active = ini.loadCompanies.includes(c.id) ? ' ✅' : '';
        lines.push(`${i + 1}. ${c.name || c.id}${active}`);
      });
      lines.push('', 'Reply with the company name or number.');
      return { success: true, message: lines.join('\n'), data: { companies } };
    }
    try {
      const result = await tdlClient.openCompany(companyQuery);
      if (result.success) _cachedCompanyName = null; // clear cache so next query detects new company
      return result;
    } catch (err) {
      return { success: false, message: 'Failed to open company: ' + (err.message || String(err)) };
    }
  }

  if (action === 'get_top_customers' || action === 'get_top_suppliers' || action === 'get_top_items') {
    const reportType = (action === 'get_top_suppliers' || (params.type && params.type.toLowerCase().includes('purchase'))) ? 'purchase' : 'sales';
    let dateFrom = params.date_from ? tdlClient.toTallyDate(params.date_from) : null;
    let dateTo = params.date_to ? tdlClient.toTallyDate(params.date_to) : null;
    if (dateFrom && dateTo && dateFrom > dateTo) { dateFrom = null; dateTo = null; }
    const limit = parseInt(params.limit, 10) || 10;
    // JS-side date filtering only when user provides explicit dates
    const actualFrom = dateFrom || null;
    const actualTo = dateTo || (dateFrom ? dateFrom : null);
    try {
      const xml = tdlClient.buildTopReportTdlXml(companyName, reportType, dateFrom, dateTo);
      const responseXml = await tdlClient.postTally(baseUrl, xml);
      if (action === 'get_top_items') {
        const parsed = tdlClient.parseTopItemsResponse(responseXml, reportType, limit, actualFrom, actualTo);
        return { success: parsed.success, message: parsed.message, data: parsed.data };
      } else {
        const parsed = tdlClient.parseTopPartiesResponse(responseXml, reportType, limit, actualFrom, actualTo);
        return { success: parsed.success, message: parsed.message, data: parsed.data };
      }
    } catch (err) {
      return tallyError(err, port);
    }
  }

  if (action === 'get_trial_balance') {
    let dateFrom = params.date_from ? tdlClient.toTallyDate(params.date_from) : null;
    let dateTo = params.date_to ? tdlClient.toTallyDate(params.date_to) : null;
    if (dateFrom && dateTo && dateFrom > dateTo) { dateFrom = null; dateTo = null; }
    try {
      const xml = tdlClient.buildTrialBalanceTdlXml(companyName, dateFrom, dateTo);
      const responseXml = await tdlClient.postTally(baseUrl, xml);
      const parsed = tdlClient.parseTrialBalanceTdlResponse(responseXml, dateFrom, dateTo);
      return { success: parsed.success, message: parsed.message, data: parsed.data };
    } catch (err) {
      return tallyError(err, port);
    }
  }

  if (action === 'get_balance_sheet') {
    let dateFrom = params.date_from ? tdlClient.toTallyDate(params.date_from) : null;
    let dateTo = params.date_to ? tdlClient.toTallyDate(params.date_to) : null;
    if (dateFrom && dateTo && dateFrom > dateTo) { dateFrom = null; dateTo = null; }
    try {
      const xml = tdlClient.buildBalanceSheetTdlXml(companyName, dateFrom, dateTo);
      const responseXml = await tdlClient.postTally(baseUrl, xml);
      const parsed = tdlClient.parseBalanceSheetTdlResponse(responseXml, dateFrom, dateTo);
      return { success: parsed.success, message: parsed.message, data: parsed.data };
    } catch (err) {
      return tallyError(err, port);
    }
  }

  if (action === 'get_ageing_analysis') {
    const type = (params.type || 'receivable').toLowerCase();
    let groupName;
    if (type.includes('payab') || type.includes('creditor')) {
      groupName = 'Sundry Creditors';
    } else {
      groupName = 'Sundry Debtors';
    }
    try {
      const xml = tdlClient.buildAgeingAnalysisTdlXml(groupName, companyName);
      const responseXml = await tdlClient.postTally(baseUrl, xml);
      const parsed = tdlClient.parseAgeingAnalysisTdlResponse(responseXml, groupName);
      return { success: parsed.success, message: parsed.message, data: parsed.data };
    } catch (err) {
      return tallyError(err, port);
    }
  }

  if (action === 'get_inactive_customers' || action === 'get_inactive_suppliers') {
    const reportType = action === 'get_inactive_suppliers' ? 'purchase' : 'sales';
    const inactiveDays = parseInt(params.days, 10) || 30;
    try {
      const xml = tdlClient.buildInactiveReportTdlXml(companyName, reportType);
      const responseXml = await tdlClient.postTally(baseUrl, xml);
      const parsed = tdlClient.parseInactivePartiesResponse(responseXml, reportType, inactiveDays);
      return { success: parsed.success, message: parsed.message, data: parsed.data };
    } catch (err) {
      return tallyError(err, port);
    }
  }

  if (action === 'get_inactive_items') {
    const reportType = (params.type && params.type.toLowerCase().includes('purchase')) ? 'purchase' : 'sales';
    const inactiveDays = parseInt(params.days, 10) || 30;
    try {
      const xml = tdlClient.buildInactiveReportTdlXml(companyName, reportType);
      const responseXml = await tdlClient.postTally(baseUrl, xml);
      const parsed = tdlClient.parseInactiveItemsResponse(responseXml, reportType, inactiveDays);
      return { success: parsed.success, message: parsed.message, data: parsed.data };
    } catch (err) {
      return tallyError(err, port);
    }
  }

  if (action === 'export_excel') {
    // Export the last report result as Excel. Requires lastReportData to be set.
    // The orchestrator will pass the last report data via params._reportData
    const reportData = params._reportData;
    const reportName = params.report_name || 'Report';
    if (!reportData) {
      return { success: false, message: 'No report data to export. First run a report (e.g. "outstanding receivable", "expenses this month"), then say "export excel" or "download excel".' };
    }
    try {
      const result = await tdlClient.reportToExcel(reportName, reportData);
      if (!result) {
        return { success: false, message: 'Could not convert this report to Excel. Try a different report.' };
      }
      return {
        success: true,
        message: `📊 Excel report ready: *${result.filename}*`,
        data: reportData,
        attachment: {
          buffer: result.buffer,
          filename: result.filename,
          caption: reportName,
        },
      };
    } catch (err) {
      return { success: false, message: 'Excel export failed: ' + (err.message || String(err)) };
    }
  }

  if (action === 'get_sales_orders' || action === 'get_purchase_orders') {
    const voucherType = params.voucher_type || null; // allow custom voucher type
    const orderType = voucherType
      ? voucherType
      : (action === 'get_purchase_orders' ? 'purchase' : 'sales');
    let dateFrom = params.date_from ? tdlClient.toTallyDate(params.date_from) : null;
    let dateTo = params.date_to ? tdlClient.toTallyDate(params.date_to) : null;
    if (dateFrom && dateTo && dateFrom > dateTo) { dateFrom = null; dateTo = null; }
    try {
      const xml = tdlClient.buildOrderTrackingTdlXml(companyName, orderType, dateFrom, dateTo);
      const responseXml = await tdlClient.postTally(baseUrl, xml);
      const parsed = tdlClient.parseOrderTrackingResponse(responseXml, orderType, dateFrom, dateTo);
      // If no results, show available voucher types so user can pick
      if (parsed.data.orders.length === 0) {
        const countsXml = tdlClient.buildVoucherTypeCountsTdlXml(companyName);
        const countsResp = await tdlClient.postTally(baseUrl, countsXml);
        const typeCounts = tdlClient.parseVoucherTypeCountsResponse(countsResp);
        if (typeCounts.length > 0) {
          const defaultType = orderType === 'purchase' ? 'Purchase Order' : orderType === 'sales' ? 'Sales Order' : orderType;
          const lines = [`No *${defaultType}* vouchers found in this company.`, '', '📋 *Available voucher types:*', ''];
          typeCounts.forEach((t, i) => {
            lines.push(`${i + 1}. ${t.name} — ${t.count} vouchers`);
          });
          lines.push('', 'Reply with a voucher type name to see those entries.');
          lines.push('Example: "show me all Payment vouchers"');
          return { success: true, message: lines.join('\n'), data: { voucherTypes: typeCounts } };
        }
      }
      return { success: parsed.success, message: parsed.message, data: parsed.data };
    } catch (err) {
      return tallyError(err, port);
    }
  }

  if (action === 'get_pending_orders') {
    const voucherType = params.voucher_type || null;
    const orderType = voucherType
      ? voucherType
      : ((params.type && params.type.toLowerCase().includes('purchase')) ? 'purchase' : 'sales');
    let dateFrom = params.date_from ? tdlClient.toTallyDate(params.date_from) : null;
    let dateTo = params.date_to ? tdlClient.toTallyDate(params.date_to) : null;
    if (dateFrom && dateTo && dateFrom > dateTo) { dateFrom = null; dateTo = null; }
    try {
      // Fetch orders
      const orderXml = tdlClient.buildOrderTrackingTdlXml(companyName, orderType, dateFrom, dateTo);
      const orderResp = await tdlClient.postTally(baseUrl, orderXml);
      const ordersData = tdlClient.parseOrderTrackingResponse(orderResp, orderType, dateFrom, dateTo);
      if (ordersData.data.orders.length === 0) {
        // Show available voucher types
        const countsXml = tdlClient.buildVoucherTypeCountsTdlXml(companyName);
        const countsResp = await tdlClient.postTally(baseUrl, countsXml);
        const typeCounts = tdlClient.parseVoucherTypeCountsResponse(countsResp);
        if (typeCounts.length > 0) {
          const defaultType = orderType === 'purchase' ? 'Purchase Order' : orderType === 'sales' ? 'Sales Order' : orderType;
          const lines = [`No *${defaultType}* vouchers found.`, '', '📋 *Available voucher types:*', ''];
          typeCounts.forEach((t, i) => lines.push(`${i + 1}. ${t.name} — ${t.count} vouchers`));
          lines.push('', 'Reply with a voucher type name to track those.');
          return { success: true, message: lines.join('\n'), data: { voucherTypes: typeCounts } };
        }
        return { success: true, message: ordersData.message, data: ordersData.data };
      }
      // Fetch invoices for comparison
      const invXml = tdlClient.buildOrderFulfillmentTdlXml(companyName, orderType, dateFrom, dateTo);
      const invResp = await tdlClient.postTally(baseUrl, invXml);
      const parsed = tdlClient.computePendingOrders(ordersData.data, invResp, orderType, dateFrom, dateTo);
      return { success: parsed.success, message: parsed.message, data: parsed.data };
    } catch (err) {
      return tallyError(err, port);
    }
  }

  if (action === 'get_payment_reminders') {
    try {
      // Fetch overdue bills
      const billXml = tdlClient.buildOverdueBillsTdlXml(companyName);
      const billResp = await tdlClient.postTally(baseUrl, billXml);
      const { parties } = tdlClient.parseOverdueBillsResponse(billResp);
      // Fetch party contacts
      const contactXml = tdlClient.buildPartyContactsTdlXml(companyName);
      const contactResp = await tdlClient.postTally(baseUrl, contactXml);
      const contacts = tdlClient.parsePartyContactsResponse(contactResp);
      const result = tdlClient.formatReminderSummary(parties, contacts);
      // Store reminder data for send_reminders action
      result.data._companyName = companyName;
      return result;
    } catch (err) {
      return tallyError(err, port);
    }
  }

  if (action === 'send_reminder') {
    // This action is handled by the orchestrator which has access to WhatsApp client
    // We just prepare the data here
    const partyName = params.party_name;
    if (!partyName) {
      return { success: false, message: 'Please specify a party name. Example: "send reminder to Meril"' };
    }
    try {
      const resolved = await resolvePartyName(partyName, baseUrl, companyName);
      if (resolved.match === 'none') return { success: false, message: `Party "${partyName}" not found in Tally.` };
      if (resolved.match === 'multiple') return { success: true, message: formatSuggestions(resolved.suggestions, partyName), data: { suggestions: resolved.suggestions } };
      // Fetch bills for this party
      const billXml = tdlClient.buildBillOutstandingTdlXml(resolved.name, companyName);
      const billResp = await tdlClient.postTally(baseUrl, billXml);
      const billParsed = tdlClient.parseBillOutstandingTdlResponse(billResp, resolved.name);
      if (!billParsed.data.bills || billParsed.data.bills.length === 0) {
        return { success: true, message: `No pending bills for *${resolved.name}*. No reminder needed. ✅` };
      }
      // Fetch party contact
      const partyXml = tdlClient.buildPartyDetailTdlXml(resolved.name, companyName);
      const partyResp = await tdlClient.postTally(baseUrl, partyXml);
      const partyDetail = tdlClient.parsePartyDetailResponse(partyResp);
      const phone = partyDetail.phone || '';
      // Generate reminder message
      const today = new Date();
      const todayStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
      const overdueBills = billParsed.data.bills.filter(b => b.dueDate && b.dueDate < todayStr);
      const partyData = {
        name: resolved.name,
        totalDue: Math.abs(billParsed.data.total),
        bills: overdueBills.length > 0 ? overdueBills.map(b => ({
          billName: b.name,
          amount: b.closingBalance,
          dueDate: b.dueDate,
          daysOverdue: Math.floor((today.getTime() - new Date(parseInt(b.dueDate.slice(0,4)), parseInt(b.dueDate.slice(4,6))-1, parseInt(b.dueDate.slice(6,8))).getTime()) / 86400000),
        })) : billParsed.data.bills.map(b => ({
          billName: b.name,
          amount: b.closingBalance,
          dueDate: b.dueDate || '',
          daysOverdue: 0,
        })),
        maxDaysOverdue: 0,
      };
      const reminderText = tdlClient.generateReminderMessage(companyName, partyData);
      return {
        success: true,
        message: `📨 *Reminder for ${resolved.name}:*\n\n${reminderText}\n\n${phone ? `📱 Phone: ${phone}` : '❌ No phone number in Tally'}`,
        data: { party: resolved.name, phone, reminderText, totalDue: partyData.totalDue },
        _sendReminder: phone ? { phone, text: reminderText } : null,
      };
    } catch (err) {
      return tallyError(err, port);
    }
  }

  if (action === 'create_voucher') {
    const voucherData = {
      type: params.voucher_type || params.type || 'Sales',
      party: params.party_name,
      amount: parseFloat(params.amount) || 0,
      date: params.date || null,
      narration: params.narration || '',
      items: params.items || [],
      salesLedger: params.ledger || null,
      cashLedger: params.cash_ledger || null,
    };
    // Validate
    const errors = tdlClient.validateVoucherData(voucherData);
    if (errors.length > 0) {
      return { success: false, message: '❌ Cannot create voucher:\n' + errors.map(e => '• ' + e).join('\n') };
    }
    // Resolve party name
    try {
      const resolved = await resolvePartyName(voucherData.party, baseUrl, companyName);
      if (resolved.match === 'none') return { success: false, message: `Party "${voucherData.party}" not found in Tally. The party ledger must exist in Tally first.` };
      if (resolved.match === 'multiple') return { success: true, message: formatSuggestions(resolved.suggestions, voucherData.party), data: { suggestions: resolved.suggestions } };
      voucherData.party = resolved.name;
      // Build and send XML
      const xml = tdlClient.buildCreateVoucherXml(voucherData, companyName);
      const responseXml = await tdlClient.postTally(baseUrl, xml);
      const result = tdlClient.parseCreateVoucherResponse(responseXml);
      if (result.success) {
        const msg = tdlClient.formatVoucherConfirmation(voucherData, result.voucherNumber);
        return { success: true, message: msg, data: { voucherData, voucherNumber: result.voucherNumber } };
      } else {
        return { success: false, message: '❌ Voucher creation failed: ' + (result.message || 'Unknown error. Check that all ledger names exist in Tally.') };
      }
    } catch (err) {
      return tallyError(err, port);
    }
  }

  return { success: false, message: 'Unknown Tally action: ' + action };
}

module.exports = { execute };
