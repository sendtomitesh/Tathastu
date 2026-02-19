# Tally Settings to Prevent Memory Violations

## Critical Settings (F12 → Advanced Configuration)

### 1. Memory Settings
- **Enable:** "Restrict Memory Usage for Low Memory Environment"
- **Disable:** "Use Additional Memory for Higher Speed of Reporting"

**How to access:**
1. Open TallyPrime
2. Press **F12** (or go to Gateway of Tally → F12: Configure)
3. Go to **Advanced Configuration**
4. Find **Memory** section
5. Enable memory restriction

### 2. HTTP Server Settings
- **Port:** 9000 (or your configured port)
- **Connection Timeout:** 60 seconds (or higher)
- **HTTP Log:** Optional (for debugging)

**How to access:**
1. F12 → Advanced Configuration
2. Find **HTTP Server** section
3. Enable HTTP Server
4. Set port to 9000
5. Configure timeout

## What Our Code Does

Our XML requests now:
- ✅ Request **only master fields** (Name, GSTIN, Opening/Closing Balance) using NATIVEMETHOD
- ✅ **Exclude ledger entries** completely (no transaction history)
- ✅ Space requests **1.2 seconds apart**
- ✅ Parse only **first 2-3 items** from responses

This should prevent Tally from trying to export thousands of transactions and causing memory violations.

## Testing

After enabling memory restriction in Tally:
1. Restart TallyPrime
2. Load your company
3. Run: `node scripts/test-tally-ledger-atul.js`

If it still fails, check Tally's error log or try exporting the ledger manually from Tally UI to see if it works there.
