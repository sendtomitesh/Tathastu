// Debug: test the parser against actual Tally response
const xml = `<LEDGER NAME="Atul Singh" RESERVEDNAME="">
     <PARENT TYPE="String">Sundry Creditors</PARENT>
     <LEDSTATENAME TYPE="String">Gujarat</LEDSTATENAME>
     <LANGUAGENAME.LIST>
      <NAME.LIST TYPE="String">
       <NAME>Atul Singh</NAME>
      </NAME.LIST>
      <LANGUAGEID TYPE="Number"> 1033</LANGUAGEID>
     </LANGUAGENAME.LIST>
    </LEDGER>`;

// Step 1: Does the LEDGER regex match?
const ledgerMatch = xml.match(/<LEDGER\b[^>]*>([\s\S]*?)<\/LEDGER>/i);
console.log('ledgerMatch found:', !!ledgerMatch);
if (ledgerMatch) {
  console.log('block:', ledgerMatch[0].substring(0, 200));
}

// Step 2: Does NAME attribute extraction work?
const block = ledgerMatch ? ledgerMatch[0] : '';
const nameAttr = block.match(/<LEDGER\b[^>]*\bNAME="([^"]*)"[^>]*>/i);
console.log('nameAttr:', nameAttr ? nameAttr[1] : 'NO MATCH');

// Step 3: NAME.LIST extraction
const nameInner = block.match(/<NAME\.LIST[^>]*>\s*<NAME>([^<]*)<\/NAME>/i);
console.log('nameInner:', nameInner ? nameInner[1] : 'NO MATCH');

// Step 4: PARENT extraction
const parentMatch = block.match(/<PARENT[^>]*>([^<]*)<\/PARENT>/i);
console.log('parent:', parentMatch ? parentMatch[1] : 'NO MATCH');

// Step 5: LEDSTATENAME
const stateMatch = block.match(/<LEDSTATENAME[^>]*>([^<]*)<\/LEDSTATENAME>/i);
console.log('state:', stateMatch ? stateMatch[1] : 'NO MATCH');
