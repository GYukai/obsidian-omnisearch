export const Platform = {
  isMacOS: false,
  isMobile: false,
  isIosApp: false,
  isMobileApp: false,
  isDesktopApp: true,
}

export class Notice {
  constructor(message, timeout) {
    this.message = message
    this.timeout = timeout
  }
}

export function parseFrontMatterAliases(frontmatter) {
  const aliases = frontmatter?.aliases ?? frontmatter?.alias
  if (Array.isArray(aliases)) {
    return aliases
  }
  if (typeof aliases === 'string') {
    return aliases
      .split(',')
      .map(alias => alias.trim())
      .filter(Boolean)
  }
  return null
}

export function getAllTags(metadata) {
  return metadata?.tags?.map(tag => tag.tag).filter(Boolean) ?? []
}
