'use strict';

const fs = require('fs');
const path = require('path');

const PROFILE_PATH = path.join(process.cwd(), 'data', 'tally-volume-profile.json');
const SAFE_VOUCHERS_PER_REQUEST = 500; // Tally handles ~500 vouchers per request safely
const DEFAULT_CHUNK_DAYS = 7;
const MAX_CHUNK_DAYS = 31; // never query more than a month at once
const MIN_CHUNK_DAYS = 1;
const PROFILE_STALE_HOURS = 24; // re-probe after 24 hours

/**
 * Load the stored volume profile from disk.
 * @returns {{ avgPerDay: number, lastProbed: string, companyName: string } | null}
 */
function loadProfile() {
  try {
    if (fs.existsSync(PROFILE_PATH)) {
      const data = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'));
      if (data && typeof data.avgPerDay === 'number') return data;
    }
  } catch (_) { /* ignore */ }
  return null;
}

/**
 * Save volume profile to disk.
 * @param {{ avgPerDay: number, lastProbed: string, companyName: string }} profile
 */
function saveProfile(profile) {
  try {
    const dir = path.dirname(PROFILE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2), 'utf8');
  } catch (_) { /* ignore write failures */ }
}

/**
 * Check if the profile is stale and needs re-probing.
 * @param {{ lastProbed: string }} profile
 * @returns {boolean}
 */
function isProfileStale(profile) {
  if (!profile || !profile.lastProbed) return true;
  const elapsed = Date.now() - new Date(profile.lastProbed).getTime();
  return elapsed > PROFILE_STALE_HOURS * 60 * 60 * 1000;
}

/**
 * Probe Tally to estimate daily voucher volume.
 * Queries a single recent day and counts vouchers.
 * @param {string} baseUrl - Tally HTTP URL
 * @param {string} companyName - Company name
 * @param {object} tdlClient - TDL client module
 * @returns {Promise<number>} estimated vouchers per day
 */
async function probeDailyVolume(baseUrl, companyName, tdlClient) {
  // Try yesterday first (today might be incomplete)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const y = yesterday.getFullYear();
  const m = String(yesterday.getMonth() + 1).padStart(2, '0');
  const d = String(yesterday.getDate()).padStart(2, '0');
  const dateStr = `${y}${m}${d}`;

  try {
    const xml = tdlClient.buildVouchersTdlXml(companyName, dateStr, dateStr, null);
    const responseXml = await tdlClient.postTally(baseUrl, xml);
    const parsed = tdlClient.parseVouchersTdlResponse(responseXml, 0); // no limit
    const count = (parsed.data && parsed.data.length) || 0;
    // If yesterday had 0, it might be a holiday — use a conservative estimate
    return count > 0 ? count : 10;
  } catch (_) {
    // If probe fails, use a conservative default
    return 10;
  }
}

/**
 * Calculate optimal chunk size in days based on daily volume.
 * @param {number} avgPerDay - Average vouchers per day
 * @returns {number} chunk size in days
 */
function calculateChunkDays(avgPerDay) {
  if (avgPerDay <= 0) return MAX_CHUNK_DAYS;
  const days = Math.floor(SAFE_VOUCHERS_PER_REQUEST / avgPerDay);
  return Math.max(MIN_CHUNK_DAYS, Math.min(days, MAX_CHUNK_DAYS));
}

/**
 * Get the optimal chunk size for querying Tally.
 * Uses cached profile if fresh, otherwise probes Tally.
 * @param {string} baseUrl
 * @param {string} companyName
 * @param {object} tdlClient
 * @returns {Promise<{ chunkDays: number, avgPerDay: number, needsChunking: boolean }>}
 */
async function getQueryStrategy(baseUrl, companyName, tdlClient) {
  let profile = loadProfile();

  // Re-probe if stale or company changed
  if (!profile || isProfileStale(profile) || profile.companyName !== companyName) {
    const avgPerDay = await probeDailyVolume(baseUrl, companyName, tdlClient);
    profile = {
      avgPerDay,
      lastProbed: new Date().toISOString(),
      companyName,
    };
    saveProfile(profile);
  }

  const chunkDays = calculateChunkDays(profile.avgPerDay);
  // Only chunk if a full month would exceed safe limit
  const needsChunking = profile.avgPerDay * 31 > SAFE_VOUCHERS_PER_REQUEST;

  return { chunkDays, avgPerDay: profile.avgPerDay, needsChunking };
}

module.exports = {
  loadProfile,
  saveProfile,
  isProfileStale,
  probeDailyVolume,
  calculateChunkDays,
  getQueryStrategy,
  SAFE_VOUCHERS_PER_REQUEST,
};
