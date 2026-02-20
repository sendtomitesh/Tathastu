/**
 * TDL Client — re-exports all modules.
 * Drop-in replacement for the old monolithic tdl-client.js
 */
module.exports = {
  ...require('./helpers'),
  ...require('./formatters'),
  ...require('./ledger-master'),
  ...require('./ledger-balance'),
  ...require('./ledger-statement'),
  ...require('./vouchers'),
  ...require('./list-ledgers'),
  ...require('./search-ledgers'),
  ...require('./outstanding'),
  ...require('./sales-purchase'),
  ...require('./cash-bank'),
  ...require('./profit-loss'),
  ...require('./expense-report'),
  ...require('./stock-summary'),
  ...require('./gst-summary'),
  ...require('./bill-outstanding'),
  ...require('./party-invoices'),
  ...require('./invoice-pdf'),
  ...require('./tally-manager'),
};
