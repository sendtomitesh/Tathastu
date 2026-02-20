'use strict';

class Metrics {
  constructor() {
    this.total = 0;
    this.tier1Hits = 0;
    this.tier2Hits = 0;
    this.tier3Hits = 0;
    this.corrections = 0;
  }

  record(tier) {
    if (tier === 1) this.tier1Hits++;
    else if (tier === 2) this.tier2Hits++;
    else if (tier === 3) this.tier3Hits++;
    else throw new Error(`Invalid tier: ${tier}. Must be 1, 2, or 3.`);
    this.total++;
  }

  recordCorrection() {
    this.corrections++;
  }

  toJSON(patternCount) {
    return {
      total: this.total,
      tier1Hits: this.tier1Hits,
      tier2Hits: this.tier2Hits,
      tier3Hits: this.tier3Hits,
      corrections: this.corrections,
      patternCount: patternCount || 0
    };
  }
}

module.exports = { Metrics };
