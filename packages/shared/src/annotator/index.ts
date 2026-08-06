/*
  Extensionless on purpose, and the published output does not match this.

  This package is consumed two ways. Here it is a `file:` dependency read as raw
  TypeScript, and Turbopack resolves `./types` to `types.ts` but does NOT resolve
  `./types.js` to it — writing the specifier the way Node's ESM loader wants
  breaks `next build` outright, with `isAnnotationTool` silently missing from the
  barrel. Published, it is compiled JavaScript, and there Node needs the
  extension or answers ERR_MODULE_NOT_FOUND.

  Both are true at once, so the specifier is written for the source consumer and
  `scripts/add-esm-extensions.mjs` rewrites it for the published one after tsc.
*/
export * from './types';
export * from './engine';
export * from './widget';
