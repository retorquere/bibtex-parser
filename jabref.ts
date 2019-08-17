function decode(s, sep = ';') {
  s = s.replace(/\n/g, '')
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

const prefixes = {
  fileDirectory: 'jabref-meta: fileDirectory:',
  groupsversion: 'jabref-meta: groupsversion:',
  groupstree: 'jabref-meta: groupstree:',
}

type Group = {
  name: string
  keys: string[]
  children: Group[]
}

export function parse(comments) {
  const result: { root: Group[], groups: { [key: string]: Group }, fileDirectory: string, version: string } = {
    root: [],
    groups: {},
    fileDirectory: '',
    version: '',
  }

  const levels: Group[] = []

  const decoded = {
    fileDirectory: null,
    groupsversion: null,
    groupstree: null,
  }
  for (const comment of comments) {
    for (const [ meta, prefix ] of Object.entries(prefixes)) {
      if (comment.startsWith(prefix)) {
        decoded[meta] = decode(comment.substring(prefix.length))
      }
    }
  }

  result.version = decoded.groupsversion && decoded.groupsversion[0]
  result.fileDirectory = decoded.fileDirectory && decoded.fileDirectory[0]

  if (!decoded.groupstree) return result

  for (const encoded of decoded.groupstree) {
    const fields = decode(encoded)

    const level_type_name = decode(fields.shift(), ':')
    const m = /^([0-9]+) (.+)/.exec(level_type_name[0])
    if (!m) break

    const level = parseInt(m[1])
    // const type = m[2]

    if (level === 0) continue // root

    const name = level_type_name[1]
    const intersection = decode(fields.shift())[0]
    const keys = fields.map(field => decode(field)[0])

    const group = {
      name,
      keys,
      children: [],
    }

    result.groups[name] = result.groups[name] || group

    if (levels.length < level) {
      levels.push(group)
    } else {
      levels[level - 1] = group
    }

    if (level === 1) {
      result.root.push(group)

    } else {
      const parent: Group = levels[level - 2]
      switch (intersection) {
        case '0': // independent
          break
        case '1': // intersect
          group.keys = group.keys.filter(key => parent.keys.includes(key))
          break
        case '2': // union
          group.keys = group.keys.concat(parent.keys.filter(key => !group.keys.includes(key)))
          break
      }

      levels[level - 2].children.push(group)
    }
  }

  return result
}
