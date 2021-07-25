function decode(s, sep = ';') {
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

export interface JabRefMetadata {
  /**
   * The root groups. You can find the nested groups in their `groups` property
   */
  root: Group[]

  /**
   * JabRef since 3.8 has changed their groups format. Entries have a `groups` field which has the names of the groups they belong to -- this name does not have to be unique in the groups hierarchy so if you
   * have multiple groups with the same name, it's not well-defined where the entries should end up. This property gives you the for each group name the first time the group showed up in the hierarchy. Note that
   * keys from the entries themselves have *not* yet been added to the [[Group]]s. You need to combine this yourself as you're parsing the entries.
   */
  groups: { [key: string]: Group }

  /**
   * The base path for file paths
   */
  fileDirectory?: string

  /**
   * The JabRef metadata format version
   */
  groupsversion?: number

  /**
   * The JabRef metadata database type
   */
  databaseType?: string
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
export function parse(comments: string[]): { comments: string[], jabref: JabRefMetadata } {
  const result: JabRefMetadata = {
    root: [],
    groups: {},
  }

  const levels: Group[] = []

  const decoded = {
    fileDirectory: null,
    groupsversion: null,
    groupstree: null,
    grouping: null,
    databaseType: null,
  }

  comments = comments.filter(comment => {
    const m = comment.match(/^jabref-meta:\s*([^:]+):([\s\S]*)/) // use \s\S because mozilla doesn't understand /s
    if (m) {
      decoded[m[1]] = decode(m[2])
      return false
    }
    return true
  })

  if (decoded.groupsversion) result.groupsversion = parseInt(decoded.groupsversion[0].trim()) || decoded.groupsversion[0]
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

      result.groups[name] = result.groups[name] || group

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

  return { comments, jabref: result }
}
