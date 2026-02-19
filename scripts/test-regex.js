const s = '<LEDGER>0</LEDGER> then <LEDGER NAME="Atul">data</LEDGER>';
const m = s.match(/<LEDGER\b[^>]*>([\s\S]*?)<\/LEDGER>/i);
console.log('match:', m[0]);
