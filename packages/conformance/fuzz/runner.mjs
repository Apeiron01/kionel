// Jazzer instruments modules imported by the target. Keep the bundled protocol
// subject separate from this thin entry point so edge coverage guides mutations.
export { fuzz } from "../fuzz-dist/subject.mjs";
