function decode(s = '', sep = ';') {
  s = s.replace(/\r?\n/g, '')
  let pos = 0
  const records = ['']
  while (pos < s.length) {
    switch (s[pos]) {
      case '\\':
        pos++
        records[0] += s[pos]
        break

      case sep:
        records.unshift('')
        break

      default:
        records[0] += s[pos]
    }
    pos++
  }
  return records.reverse().filter(record => record)
}

/**
 * A JabRef group.
 */
export interface Group {
  /**
   * the group name
   */
  name: string

  /**
   * The citation keys which are specified to belong to this group, after intersection calculation has been applied
   */
  entries: string[]

  /**
   * Sub-groups under this group
   */
  groups: Group[]
}

export class JabRefMetadata {
  #groups = new Map<string, Group>()

  /**
   * The root groups. You can find the nested groups in their `groups` property
   */
  root: Group[] = []

  /**
   * The base path for file paths
   */
  declare fileDirectory?: string

  /**
   * The JabRef metadata format version
   */
  declare groupsversion?: number

  /**
   * The JabRef metadata database type
   */
  declare databaseType?: string

  constructor(data: Partial<Pick<JabRefMetadata, 'root' | 'fileDirectory' | 'groupsversion' | 'databaseType'>> = {}) {
    this.root = data.root ?? []
    for (const field of ['fileDirectory', 'groupsversion', 'databaseType'] as const) {
      if (data[field] !== undefined) Object.assign(this, { [field]: data[field] })
    }
    const index = (groups: Group[]) => {
      for (const group of groups) {
        if (!this.#groups.has(group.name)) this.#groups.set(group.name, group)
        index(group.groups)
      }
    }
    index(this.root)
  }

  /** Populates JabRef 3.8+ memberships in `root` by group name; duplicate names select the first node. */
  addEntry(name: string, key: string): boolean {
    const group = this.#groups.get(name)
    if (!group) return false
    if (!group.entries.includes(key)) group.entries.push(key)
    return true
  }
}

/**
 * Import the JabRef groups from the `@string` comments in which they were stored. You would typically pass the comments parsed by [[bibtex.parse]] in here.
 *
 * JabRef knows several group types, and this parser parses most, but not all of them:
 *
 * * independent group: the keys listed in the group are the entries that are considered to belong to it
 * * intersection: the keys listed in the group are considered to belong to the group if they're also in the parent group
 * * union: the keys listed in the group are considered to belong to the group, and also the keys that are in the parent group
 * * query: not supported by this parser
 */
export function parse(comments: string[]): { comments: string[]; jabref: JabRefMetadata } {
  const result = new JabRefMetadata()

  const levels: Group[] = []

  const decoded: Record<string, string[] | null> = {
    fileDirectory: null as string[] | null,
    groupsversion: null as string[] | null,
    groupstree: null as string[] | null,
    grouping: null as string[] | null,
    databaseType: null as string[] | null,
  }

  comments = comments.filter(comment => {
    const m = comment.match(/^jabref-meta:\s*([^:]+):([\s\S]*)/) // use \s\S because mozilla doesn't understand /s
    if (m) {
      decoded[m[1]] = decode(m[2])
      return false
    }
    return true
  })

  if (decoded.groupsversion) result.groupsversion = parseInt(decoded.groupsversion[0].trim()) // eslint-disable-line @typescript-eslint/no-unsafe-argument
  if (decoded.fileDirectory) result.fileDirectory = decoded.fileDirectory[0]
  if (decoded.databaseType) result.databaseType = decoded.databaseType[0]

  for (const tree of ['groupstree', 'grouping']) {
    if (!decoded[tree]) continue

    for (const encoded of decoded[tree]) {
      const fields = decode(encoded)

      const level_type_name = decode(fields.shift(), ':')
      const m = /^([0-9]+) (.+)/.exec(level_type_name[0])
      if (!m) break

      const level = parseInt(m[1])
      const type = m[2] // test for StaticGroup?

      if (type === 'AllEntriesGroup') continue // root

      const name = level_type_name[1]
      const intersection = decode(fields.shift())[0]
      const keys = tree === 'grouping' ? [] : fields.map(field => decode(field)[0])

      const group = {
        name,
        entries: keys,
        groups: [],
      }

      if (levels.length < level) {
        levels.push(group)
      }
      else {
        levels[level - 1] = group
      }

      if (level === 1) {
        result.root.push(group)
      }
      else {
        const parent: Group = levels[level - 2]
        switch (intersection) {
          case '0': // independent
            break
          case '1': // intersect
            group.entries = group.entries.filter(key => parent.entries.includes(key))
            break
          case '2': // union
            group.entries = group.entries.concat(parent.entries.filter(key => !group.entries.includes(key)))
            break
        }

        levels[level - 2].groups.push(group)
      }
    }
  }

  return { comments, jabref: new JabRefMetadata(result) }
}
