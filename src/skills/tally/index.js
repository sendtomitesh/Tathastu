const { buildLedgerXml, buildDayBookXml, buildListLedgersXml, postTally, parseLedgerResponse, parseDayBookResponse, parseListLedgersResponse } = require('./client');

/**
 * Tally skill: execute(skillId, action, params, skillConfig) => Promise<{ success, message?, data? }>
 * skillConfig: { port, companyName }
 * Actions: get_ledger, get_vouchers, list_ledgers
 */
async function execute(skillId, action, params = {}, skillConfig = {}) {
  const port = skillConfig.port ?? 9000;
  const companyName = skillConfig.companyName || null;
  const baseUrl = `http://localhost:${port}`;

  if (action === 'get_ledger') {
    const partyName = params.party_name;
    if (!partyName || typeof partyName !== 'string') {
      return { success: false, message: 'Please specify a party name for get_ledger.' };
    }
    const xml = buildLedgerXml(partyName, companyName);
    try {
      const responseXml = await postTally(baseUrl, xml);
      const parsed = parseLedgerResponse(responseXml);
      if (!parsed.success) return { success: false, message: parsed.message || 'Ledger not found.' };
      return { success: true, message: parsed.summary, data: parsed.data };
    } catch (err) {
      if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') {
        return { success: false, message: 'Tally is not reachable. Please open TallyPrime and enable HTTP server on port ' + port + '.' };
      }
      return { success: false, message: err.message || String(err) };
    }
  }

  if (action === 'get_vouchers') {
    const dateFrom = params.date_from || null;
    const dateTo = params.date_to || null;
    const voucherType = params.voucher_type || null;
    const limit = typeof params.limit === 'number' ? params.limit : (params.limit ? parseInt(String(params.limit), 10) : 10);
    const xml = buildDayBookXml(dateFrom, dateTo, voucherType, companyName);
    try {
      const responseXml = await postTally(baseUrl, xml);
      const parsed = parseDayBookResponse(responseXml, limit);
      if (!parsed.success) return { success: false, message: parsed.message || 'Could not fetch vouchers.' };
      return { success: true, message: parsed.summary, data: parsed.data };
    } catch (err) {
      if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') {
        return { success: false, message: 'Tally is not reachable. Please open TallyPrime and enable HTTP server on port ' + port + '.' };
      }
      return { success: false, message: err.message || String(err) };
    }
  }

  if (action === 'list_ledgers') {
    const groupFilter = params.group_filter || null;
    const xml = buildListLedgersXml(groupFilter, companyName);
    try {
      const responseXml = await postTally(baseUrl, xml);
      const parsed = parseListLedgersResponse(responseXml);
      if (!parsed.success) return { success: false, message: parsed.message || 'Could not list ledgers.' };
      return { success: true, message: parsed.summary, data: parsed.data };
    } catch (err) {
      if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') {
        return { success: false, message: 'Tally is not reachable. Please open TallyPrime and enable HTTP server on port ' + port + '.' };
      }
      return { success: false, message: err.message || String(err) };
    }
  }

  return { success: false, message: 'Unknown Tally action: ' + action };
}

module.exports = { execute };
