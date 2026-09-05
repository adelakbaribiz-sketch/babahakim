// Search engine public surface (PHASE 14). Infrastructure layer ONLY —
// application services import from here, routes never deep-import modules.
export {
  searchKey, searchKeySpaced, searchKeyPersianDigits, tokenize,
  buildNeedles, matchesNeedles, SEARCH_LIMITS,
  type SearchNeedle,
} from './normalize'
export { applyQ, applyFilters, resolveSort, SEARCH_TOKENS_HARD_CAP, type FilterSpec, type FilterOp, type ParsedFilters, type SortSpec } from './query-build'
export {
  SEARCH_BOUNDS, REPORT_BOUNDS, clampWindow, assertOffsetBounded, withReportTimeout,
  OffsetTooDeepError, WindowTooWideError, ReportTimeoutError, type TimeWindow,
} from './bounds'
