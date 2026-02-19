# Tally Memory Violation Fix Guide

## Tally Settings to Check (F12 → Advanced Configuration)

1. **Enable Memory Restriction:**
   - Press **F12** in Tally
   - Go to **Advanced Configuration**
   - Enable: **"Restrict Memory Usage for Low Memory Environment"**
   - Disable: **"Use Additional Memory for Higher Speed of Reporting"** (if enabled)

2. **HTTP Server Settings:**
   - F12 → Advanced Configuration
   - Check **HTTP Server** is enabled on port 9000
   - Set **Connection Timeout** to a reasonable value (e.g., 60 seconds)

3. **Reduce Export Data:**
   - When exporting manually, use date filters
   - Export in smaller batches if needed

## What We're Doing in Code

Our XML requests now:
- ✅ Use **SVFROMDATE** and **SVTODATE** to limit date range (today only for minimal requests)
- ✅ Parse only first 2-3 items from responses
- ✅ Space requests 1.2 seconds apart
- ⚠️ Still need to explicitly request only master fields (not entries)

## Next Steps

We're updating the XML to use **NATIVEMETHOD** to request only specific fields (Name, GSTIN, Opening/Closing Balance) without ledger entries, which should prevent Tally from trying to export thousands of transactions.
