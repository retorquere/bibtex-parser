import init, {
  initSync,
  parseNormalized as parseNormalizedWasm,
  parseVerbatim as parseVerbatimWasm,
} from './bibtex_parser.js'

export { init, initSync }
export default init

export function parseVerbatim(input, options = {}) {
  return parseVerbatimWasm(input, options)
}

export function parseNormalized(input, options = {}) {
  return parseNormalizedWasm(input, options)
}