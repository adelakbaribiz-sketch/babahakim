// PHASE 19 · ambient Bun runtime + test types for bare `tsc --noEmit` (CI
// type-check stage, spec §76). bun-types ships with the runtime; the app's
// tsconfig has no "types" restriction so this reference is additive.
/// <reference types="bun-types" />
