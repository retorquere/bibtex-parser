import merged from 'lodash.merge'

export function merge<T>(options: T, defaults: T): T {
  return merged(defaults, options) as T
}
