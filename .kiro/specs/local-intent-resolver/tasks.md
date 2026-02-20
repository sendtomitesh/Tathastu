# Implementation Plan: Local Intent Resolver

## Overview

Build a self-learning 3-tier intent resolution system that sits between the orchestrator and OpenAI, learning from successful parses to progressively reduce API calls. Implementation follows a bottom-up approach: core utilities first, then the pipeline, then integration.

## Tasks

- [x] 1. Set up project structure and install dependencies
  - Create `src/intent/` directory
  - Install `fast-check` as a dev dependency: `npm install --save-dev fast-check`
  - Create `src/intent/tests/` directory for test files
  - _Requirements: 9.1_

- [x] 2. Implement Normalizer
  - [x] 2.1 Implement `src/intent/normalizer.js`
    - Parse `config/knowledge.md` at startup to build the transliteration map (Hindi/Gujarati tokens → English keywords)
    - Implement `normalize(text)`: lowercase, trim, remove punctuation, transliterate, collapse whitespace
    - Implement `tokenize(normalizedText)`: split into a `Set<string>` of tokens
    - Export `normalize`, `tokenize`, and `getTransliterationMap` (for testing)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 2.2 Write property tests for Normalizer
    - **Property 7: Normalization correctness** — output is lowercase, no punctuation, no consecutive spaces, no leading/trailing whitespace
    - **Property 8: Normalization idempotence** — `normalize(normalize(x)) === normalize(x)`
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**

  - [x] 2.3 Write unit tests for Normalizer
    - Test specific Hindi/Gujarati transliterations from knowledge.md (e.g., "khata" → "ledger", "baki" → "outstanding")
    - Test edge cases: empty string, only punctuation, only whitespace, mixed scripts
    - _Requirements: 5.3_

- [x] 3. Implement PatternStore
  - [x] 3.1 Implement `src/intent/pattern-store.js`
    - Implement `PatternStore` class with constructor taking file path
    - Implement `load()`: read JSON file, handle missing/corrupted files gracefully
    - Implement `get(normalizedQuery)`: O(1) exact lookup
    - Implement `getAll()`: return all entries for fuzzy matching
    - Implement `put(normalizedQuery, intent)`: add or update entry with hitCount and timestamps
    - Implement `recordHit(normalizedQuery)`: increment hitCount and update lastUsedAt
    - Implement `remove(normalizedQuery)`: delete entry, return boolean
    - Implement `size()`: return entry count
    - Implement debounced `_persist()`: write to disk max once per 5 seconds
    - Implement `exportJSON()` and `importJSON(jsonString)` with merge logic (keep higher hitCount)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 10.3, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - [x] 3.2 Write property tests for PatternStore
    - **Property 3: Tier 1 exact match correctness** — get returns entry iff key exists
    - **Property 4: Hit count increment** — recordHit increases hitCount by 1
    - **Property 9: Pattern store round-trip persistence** — write then load produces equivalent entries
    - **Property 16: Import/export round-trip** — export then import into empty store produces equivalent entries
    - **Property 17: Import merge keeps higher hit count** — overlapping keys keep higher hitCount
    - **Validates: Requirements 2.1, 2.2, 2.3, 6.1, 6.2, 12.1, 12.2, 12.3, 12.4**

  - [x] 3.3 Write unit tests for PatternStore
    - Test loading from missing file (should initialize empty)
    - Test loading from corrupted JSON file (should initialize empty, log warning)
    - Test importing malformed JSON (should reject, leave store unchanged)
    - _Requirements: 6.3, 6.5, 12.6_

- [x] 4. Implement FuzzyMatcher
  - [x] 4.1 Implement `src/intent/fuzzy-matcher.js`
    - Implement `jaccardSimilarity(setA, setB)`: `|A ∩ B| / |A ∪ B|`
    - Implement `findBestMatch(normalizedQuery, entries, threshold)`: find highest similarity entry above threshold, use hitCount as tiebreaker
    - Use `tokenize()` from normalizer for token set creation
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 4.2 Write property tests for FuzzyMatcher
    - **Property 5: Fuzzy match best-selection** — returns entry with highest similarity, hitCount as tiebreaker
    - **Property 12: Jaccard similarity bounds** — result always in [0.0, 1.0], identical sets → 1.0, disjoint sets → 0.0
    - **Validates: Requirements 3.2, 3.3, 3.4**

  - [x] 4.3 Write unit tests for FuzzyMatcher
    - Test with known similar queries (e.g., "ledger meril" vs "ledger for meril")
    - Test with completely unrelated queries (should return null)
    - _Requirements: 3.2, 3.4_

- [x] 5. Checkpoint - Core utilities
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement ContextDetector and FeedbackHandler
  - [x] 6.1 Implement `src/intent/context-detector.js`
    - Implement `isContextDependent(text, patterns)`: check if message matches any context-dependent trigger pattern
    - Default patterns: single/double digit numbers, "more", "next", "next page", "page N", "aur", "aur dikhao", "aage", "vadhu", "aagal", "his", "her", "their", "same", "yes", "haan", "ha"
    - _Requirements: 13.1, 13.2, 13.3_

  - [x] 6.2 Implement `src/intent/feedback-handler.js`
    - Implement `isCorrectionTrigger(text, triggers)`: check if message is a correction trigger
    - Default triggers: "wrong", "galat", "ખોટું", "ghalat"
    - _Requirements: 10.1, 10.4_

  - [x] 6.3 Write unit tests for ContextDetector and FeedbackHandler
    - Test context detection for numbers, pagination words, Hindi/Gujarati equivalents
    - Test correction triggers in different cases
    - _Requirements: 10.4, 13.2_

- [x] 7. Implement Metrics
  - [x] 7.1 Implement `src/intent/metrics.js`
    - Implement `Metrics` class with `total`, `tier1Hits`, `tier2Hits`, `tier3Hits`, `corrections` counters
    - Implement `record(tier)` and `recordCorrection()`
    - Implement `toJSON(patternCount)` returning all counters plus pattern count
    - _Requirements: 8.1, 8.3_

  - [x] 7.2 Write property tests for Metrics
    - **Property 10: Metrics counter invariant** — `total === tier1Hits + tier2Hits + tier3Hits` always holds
    - **Validates: Requirements 8.1**

- [x] 8. Implement Resolver pipeline
  - [x] 8.1 Implement `src/intent/resolver.js`
    - Import all components: Normalizer, PatternStore, FuzzyMatcher, ContextDetector, FeedbackHandler, Metrics
    - Read config: `resolver.enabled`, `resolver.confidenceThreshold`, `resolver.patternStorePath`, `resolver.contextPatterns`, `resolver.correctionTriggers`, `resolver.openAIFallbackEnabled`
    - Implement `resolveIntent(userMessage, config, apiKey, history)`:
      1. Check correction trigger → remove last entry if exists
      2. Check context-dependent → route to OpenAI (or return unknown if fallback disabled)
      3. Normalize message
      4. Tier 1: exact pattern match
      5. Tier 2: fuzzy match
      6. Tier 3: OpenAI fallback (if enabled) → store learning entry on valid result
    - Track `lastResolvedKey` for correction feedback
    - Implement `getMetrics()`, `exportPatterns()`, `importPatterns(jsonString)`
    - Handle confidence threshold validation (default 0.7, clamp to [0.0, 1.0])
    - Log resolution results via `onLog` callback
    - Export `createResolver(config, onLog)` factory that returns `{ resolveIntent, getMetrics, exportPatterns, importPatterns }`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 4.1, 4.2, 4.3, 4.4, 4.5, 7.1, 7.2, 7.3, 7.4, 8.2, 9.1, 9.2, 10.1, 10.2, 11.1, 11.2, 11.3, 11.4, 13.1, 13.3, 13.4_

  - [x] 8.2 Write property tests for Resolver
    - **Property 1: Pipeline ordering** — tiers tried in order, stops at first success
    - **Property 2: Result structure completeness** — all required fields present
    - **Property 6: Learning entry storage correctness** — stored iff valid OpenAI result
    - **Property 11: Context-dependent bypass** — context messages go straight to Tier 3
    - **Property 13: Confidence threshold validation** — valid range accepted, invalid falls back to 0.7
    - **Property 14: Correction trigger removes entry** — correction removes last resolved entry
    - **Property 15: OpenAI fallback disabled** — no API calls when disabled
    - Use mock for OpenAI `parseIntent` in tests
    - **Validates: Requirements 1.1-1.5, 4.2, 4.3, 7.3, 7.4, 10.1, 11.2, 11.3, 13.1**

- [x] 9. Checkpoint - Resolver pipeline
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Integrate with Orchestrator
  - [x] 10.1 Update `config/skills.json` with resolver configuration
    - Add `resolver` section with `enabled: true`, `confidenceThreshold: 0.7`, `patternStorePath: "data/intent-patterns.json"`, `contextPatterns`, `correctionTriggers`, `openAIFallbackEnabled: true`
    - _Requirements: 7.1, 10.4, 11.1, 13.2_

  - [x] 10.2 Update `src/bot/orchestrator.js` to use Resolver
    - Import `createResolver` from `src/intent/resolver.js`
    - When `config.resolver?.enabled`, create resolver instance and use `resolveIntent` instead of `parseIntent`
    - When resolver is disabled or not configured, continue using `parseIntent` directly
    - Pass `onLog` callback to resolver for logging
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [x] 10.3 Write integration tests for Orchestrator wiring
    - Test that resolver is used when enabled in config
    - Test that parseIntent is used when resolver is disabled
    - Test backward compatibility with no resolver config
    - _Requirements: 9.3, 9.4_

- [x] 11. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- The project uses CommonJS (`require`/`module.exports`) — all new files should follow this convention
- Property tests use `fast-check` library with minimum 100 iterations per test
- Checkpoints ensure incremental validation at key milestones
