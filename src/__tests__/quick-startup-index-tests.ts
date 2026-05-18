import { Platform } from 'obsidian'
import { RecencyCutoff } from '../globals'
import { Query } from '../search/query'
import { QuickStartupIndex } from '../search/quick-startup-index'
import { SearchEngine } from '../search/search-engine'

jest.mock('markdown-link-extractor', () => jest.fn(() => []))

describe('QuickStartupIndex', () => {
  beforeEach(() => {
    Platform.isIosApp = true
  })

  afterEach(() => {
    Platform.isIosApp = false
  })

  function createQuery(text: string): Query {
    return new Query(text, {
      ignoreDiacritics: true,
      ignoreArabicDiacritics: false,
    })
  }

  function createFile(path: string, mtime: number) {
    const filename = path.split('/').pop() ?? path
    const dot = filename.lastIndexOf('.')
    return {
      path,
      basename: dot > 0 ? filename.slice(0, dot) : filename,
      stat: { mtime },
    }
  }

  function createPlugin(fullIndexReady = false) {
    const metadataByPath: Record<string, any> = {
      'Projects/Alpha.md': {
        frontmatter: { title: 'Mobile Alpha', aliases: ['fast find'] },
        headings: [{ level: 1, heading: 'Launch Plan' }],
        tags: [{ tag: '#ios' }],
      },
      'Canvas/Alpha.canvas': {
        frontmatter: {},
        headings: [{ level: 2, heading: 'Canvas Alpha' }],
        tags: [{ tag: '#diagram' }],
      },
      'Archive/Beta.md': {
        frontmatter: { title: 'Beta Note' },
        headings: [],
        tags: [{ tag: '#archive' }],
      },
    }

    return {
      settings: {
        mobileFastStartupSearch: true,
        ignoreDiacritics: true,
        ignoreArabicDiacritics: false,
        tokenizeUrls: false,
        splitCamelCase: false,
        simpleSearch: false,
        fuzziness: '1',
        weightBasename: 10,
        weightDirectory: 7,
        weightH1: 6,
        weightH2: 5,
        weightH3: 4,
        weightUnmarkedTags: 2,
        hideExcluded: false,
        downrankedFoldersFilters: [],
        recencyBoost: RecencyCutoff.Disabled,
        displayTitle: 'title',
      },
      app: {
        metadataCache: {
          getFileCache: jest.fn((file: { path: string }) => {
            return metadataByPath[file.path] ?? null
          }),
          isUserIgnored: jest.fn(() => false),
        },
      },
      database: {
        getQuickIndexCache: jest.fn().mockResolvedValue(null),
        writeQuickIndexCache: jest.fn().mockResolvedValue(undefined),
      },
      notesIndexer: {
        isFileIndexable: jest.fn(() => true),
      },
      searchHistory: {
        getSelectionBoosts: jest.fn(() => new Map()),
      },
      getChsSegmenter: jest.fn(() => undefined),
      isFullIndexReady: jest.fn(() => fullIndexReady),
    }
  }

  it('searches lightweight fields and filters by extension and path', async () => {
    const plugin = createPlugin()
    const index = new QuickStartupIndex(plugin as any)
    const files = [
      createFile('Projects/Alpha.md', 1),
      createFile('Canvas/Alpha.canvas', 2),
      createFile('Archive/Beta.md', 3),
    ]

    await index.rebuildFromFiles(files as any, { writeCache: false })

    const mdResults = await index.getSuggestions(createQuery('alpha ext:md'), {
      prefixLength: 1,
    })
    expect(mdResults.map(result => result.path)).toEqual(['Projects/Alpha.md'])

    const pathResults = await index.getSuggestions(
      createQuery('alpha path:Canvas'),
      { prefixLength: 1 }
    )
    expect(pathResults.map(result => result.path)).toEqual([
      'Canvas/Alpha.canvas',
    ])
  })

  it('searches tags, aliases, and headings without reading file contents', async () => {
    const plugin = createPlugin()
    const index = new QuickStartupIndex(plugin as any)
    const files = [
      createFile('Projects/Alpha.md', 1),
      createFile('Archive/Beta.md', 2),
    ]

    await index.rebuildFromFiles(files as any, { writeCache: false })

    const tagResults = await index.getSuggestions(createQuery('#ios'), {
      prefixLength: 1,
    })
    expect(tagResults[0].path).toBe('Projects/Alpha.md')

    const aliasResults = await index.getSuggestions(createQuery('fast'), {
      prefixLength: 1,
    })
    expect(aliasResults[0].path).toBe('Projects/Alpha.md')

    const headingResults = await index.getSuggestions(createQuery('launch'), {
      prefixLength: 1,
    })
    expect(headingResults[0].path).toBe('Projects/Alpha.md')
    expect(headingResults[0].content).toBe('')
    expect(headingResults[0].matches).toEqual([])
  })

  it('is available only for iOS provisional searches that do not need full content', async () => {
    const plugin = createPlugin(false)
    const index = new QuickStartupIndex(plugin as any)

    await index.rebuildFromFiles(
      [createFile('Projects/Alpha.md', 1)] as any,
      { writeCache: false }
    )

    expect(index.canSearch(createQuery('alpha'))).toBe(true)
    expect(index.canSearch(createQuery('"alpha beta"'))).toBe(false)
    expect(index.canSearch(createQuery('alpha -beta'))).toBe(false)

    ;(plugin.isFullIndexReady as jest.Mock).mockReturnValue(true)
    expect(index.canSearch(createQuery('alpha'))).toBe(false)

    Platform.isIosApp = false
    ;(plugin.isFullIndexReady as jest.Mock).mockReturnValue(false)
    expect(index.canSearch(createQuery('alpha'))).toBe(false)
  })
})

describe('SearchEngine quick startup routing', () => {
  it('uses the quick startup index when explicitly allowed', async () => {
    const quickResults = [
      {
        score: 1,
        path: 'Projects/Alpha.md',
        basename: 'Alpha',
        displayTitle: '',
        content: '',
        foundWords: ['alpha'],
        matches: [],
        isEmbed: false,
      },
    ]
    const quickStartupIndex = {
      canSearch: jest.fn(() => true),
      getSuggestions: jest.fn().mockResolvedValue(quickResults),
    }
    const plugin = {
      settings: {
        simpleSearch: false,
        ignoreDiacritics: true,
        ignoreArabicDiacritics: false,
        tokenizeUrls: false,
        splitCamelCase: false,
      },
      quickStartupIndex,
      getChsSegmenter: jest.fn(() => undefined),
    }
    const searchEngine = new SearchEngine(plugin as any)
    const query = new Query('alpha', {
      ignoreDiacritics: true,
      ignoreArabicDiacritics: false,
    })

    await expect(
      searchEngine.getSuggestions(query, { allowQuickIndex: true })
    ).resolves.toBe(quickResults)
    expect(quickStartupIndex.getSuggestions).toHaveBeenCalledWith(query, {
      prefixLength: 1,
      singleFilePath: undefined,
    })
  })
})
