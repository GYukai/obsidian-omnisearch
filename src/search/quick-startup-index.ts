import MiniSearch, {
  type Options,
  type SearchResult,
} from 'minisearch'
import { Platform, type TFile } from 'obsidian'
import {
  eventBus,
  EventNames,
  RecencyCutoff,
  type DocumentRef,
  type ResultNote,
} from '../globals'
import type OmnisearchPlugin from '../main'
import { Query } from './query'
import { Tokenizer } from './tokenizer'
import {
  chunkArray,
  extractHeadingsFromCache,
  getAliasesFromMetadata,
  getTagsFromMetadata,
  pathWithoutFilename,
  removeDiacritics,
} from '../tools/utils'

type QuickIndexDocument = {
  path: string
  basename: string
  displayTitle: string
  directory: string
  aliases: string
  headings1: string
  headings2: string
  headings3: string
  tags: string
  unmarkedTags: string
  mtime: number
}

export class QuickStartupIndex {
  private tokenizer: Tokenizer
  private minisearch: MiniSearch
  private indexedDocuments: Map<string, number> = new Map()
  private ready = false

  constructor(private plugin: OmnisearchPlugin) {
    this.tokenizer = new Tokenizer(plugin)
    this.minisearch = new MiniSearch(this.getOptions())
  }

  public isEnabled(): boolean {
    return Platform.isIosApp && this.plugin.settings.mobileFastStartupSearch
  }

  public isReady(): boolean {
    return this.ready && this.indexedDocuments.size > 0
  }

  public canSearch(query: Query): boolean {
    return (
      this.isEnabled() &&
      this.isReady() &&
      !this.plugin.isFullIndexReady() &&
      !this.requiresFullIndex(query)
    )
  }

  public async loadCache(): Promise<boolean> {
    if (!this.isEnabled()) {
      return false
    }

    const cache = await this.plugin.database.getQuickIndexCache()
    if (!cache) {
      return false
    }

    try {
      this.minisearch = await MiniSearch.loadJSAsync(
        cache.data,
        this.getOptions()
      )
      this.indexedDocuments = new Map(cache.paths.map(o => [o.path, o.mtime]))
      this.ready = true
      eventBus.emit(EventNames.SearchIndexUpdated)
      return true
    } catch (e) {
      console.error('Omnisearch - Error while loading quick startup index')
      console.error(e)
      this.ready = false
      return false
    }
  }

  public async rebuildFromFiles(
    files: TFile[],
    options: { writeCache?: boolean } = {}
  ): Promise<void> {
    if (!this.isEnabled()) {
      return
    }

    const writeCache = options.writeCache ?? true

    try {
      const documents = files
        .filter(file => this.plugin.notesIndexer.isFileIndexable(file.path))
        .map(file => this.mapFile(file))

      const minisearch = new MiniSearch<QuickIndexDocument>(this.getOptions())
      for (const docs of chunkArray(documents, 1000)) {
        await minisearch.addAllAsync(docs)
      }

      this.minisearch = minisearch
      this.indexedDocuments = new Map(
        documents.map(doc => [doc.path, doc.mtime])
      )
      this.ready = true

      if (writeCache) {
        await this.plugin.database.writeQuickIndexCache(
          this.minisearch.toJSON(),
          this.getSerializedIndexedDocuments()
        )
      }

      eventBus.emit(EventNames.SearchIndexUpdated)
    } catch (e) {
      console.error('Omnisearch - Error while rebuilding quick startup index')
      console.error(e)
    }
  }

  public async getSuggestions(
    query: Query,
    options: { prefixLength: number; singleFilePath?: string }
  ): Promise<ResultNote[]> {
    if (query.isEmpty()) {
      return []
    }

    let results = this.search(query, options)
    if (!results.length) {
      return []
    }

    const selectionBoosts = this.plugin.searchHistory.getSelectionBoosts(query)
    if (selectionBoosts.size) {
      const maxScore = Math.max(...results.map(result => result.score), 0)
      for (const result of results) {
        const boost = selectionBoosts.get(result.id)
        if (boost) {
          result.score += maxScore * boost
        }
      }
    }

    results = results.sort((a, b) => b.score - a.score).slice(0, 50)
    return results.map(result => this.mapResult(query, result))
  }

  public getSerializedIndexedDocuments(): DocumentRef[] {
    return Array.from(this.indexedDocuments).map(([path, mtime]) => ({
      path,
      mtime,
    }))
  }

  private search(
    query: Query,
    options: { prefixLength: number; singleFilePath?: string }
  ): SearchResult[] {
    const settings = this.plugin.settings
    let fuzziness: number
    switch (settings.fuzziness) {
      case '0':
        fuzziness = 0
        break
      case '1':
        fuzziness = 0.1
        break
      default:
        fuzziness = 0.2
        break
    }

    let results = this.minisearch.search(
      this.tokenizer.tokenizeForSearch(query.segmentsToStr()),
      {
        prefix: term => term.length >= options.prefixLength,
        fuzzy: term =>
          term.length <= 3 ? 0 : term.length <= 5 ? fuzziness / 2 : fuzziness,
        boost: {
          basename: settings.weightBasename,
          displayTitle: settings.weightBasename,
          aliases: settings.weightBasename,
          directory: settings.weightDirectory,
          headings1: settings.weightH1,
          headings2: settings.weightH2,
          headings3: settings.weightH3,
          tags: settings.weightUnmarkedTags,
          unmarkedTags: settings.weightUnmarkedTags,
        },
        tokenize: text => [text],
        boostDocument: (_id, _term, storedFields) =>
          this.getRecencyBoost(storedFields?.mtime as number | undefined),
      }
    )

    if (options.singleFilePath) {
      results = results.filter(r => r.id === options.singleFilePath)
    }

    if (query.query.ext?.length) {
      results = results.filter(r => {
        const ext = '.' + String(r.id).split('.').pop()
        return query.query.ext?.some(e =>
          ext.startsWith(e.startsWith('.') ? e : '.' + e)
        )
      })
    }

    if (query.query.path) {
      results = results.filter(r =>
        query.query.path?.some(p =>
          String(r.id).toLowerCase().includes(p.toLowerCase())
        )
      )
    }

    if (query.query.exclude.path) {
      results = results.filter(
        r =>
          !query.query.exclude.path?.some(p =>
            String(r.id).toLowerCase().includes(p.toLowerCase())
          )
      )
    }

    if (settings.hideExcluded) {
      results = results.filter(
        result =>
          !(
            this.plugin.app.metadataCache.isUserIgnored &&
            this.plugin.app.metadataCache.isUserIgnored(String(result.id))
          )
      )
    } else {
      results.forEach(result => {
        if (
          this.plugin.app.metadataCache.isUserIgnored &&
          this.plugin.app.metadataCache.isUserIgnored(String(result.id))
        ) {
          result.score /= 10
        }
      })
    }

    for (const result of results) {
      const path = String(result.id)
      if (settings.downrankedFoldersFilters.length > 0) {
        for (const filter of settings.downrankedFoldersFilters) {
          if (path === filter || path.startsWith(filter + '/')) {
            result.score /= 10
          }
        }

        for (const pathPart of path.split('/')) {
          if (settings.downrankedFoldersFilters.includes(pathPart)) {
            result.score /= 10
            break
          }
        }
      }

      for (const tag of query.getTags()) {
        if (String(result.tags ?? '').split(' ').includes(tag)) {
          result.score *= 100
        }
      }
    }

    return results
  }

  private mapFile(file: TFile): QuickIndexDocument {
    const metadata = this.plugin.app.metadataCache.getFileCache(file)
    let displayTitle: string
    if (this.plugin.settings.displayTitle === '#heading') {
      displayTitle = metadata?.headings?.find(h => h.level === 1)?.heading ?? ''
    } else {
      displayTitle =
        metadata?.frontmatter?.[this.plugin.settings.displayTitle] ?? ''
    }

    const tags = getTagsFromMetadata(metadata)
    return {
      path: file.path,
      basename: file.basename,
      displayTitle,
      directory: pathWithoutFilename(file.path),
      aliases: getAliasesFromMetadata(metadata).join(' '),
      headings1: metadata
        ? extractHeadingsFromCache(metadata, 1).join(' ')
        : '',
      headings2: metadata
        ? extractHeadingsFromCache(metadata, 2).join(' ')
        : '',
      headings3: metadata
        ? extractHeadingsFromCache(metadata, 3).join(' ')
        : '',
      tags: tags.join(' '),
      unmarkedTags: tags.map(t => t.replace('#', '')).join(' '),
      mtime: file.stat.mtime,
    }
  }

  private mapResult(query: Query, result: SearchResult): ResultNote {
    const path = String(result.id)
    const foundWords = [
      ...new Set([...result.terms, ...query.query.text, ...query.getTags()]),
    ]

    return {
      score: result.score,
      path,
      basename: String(result.basename ?? this.basenameFromPath(path)),
      displayTitle: String(result.displayTitle ?? ''),
      content: '',
      foundWords,
      matches: [],
      isEmbed: false,
    }
  }

  private requiresFullIndex(query: Query): boolean {
    return query.getExactTerms().length > 0 || query.query.exclude.text.length > 0
  }

  private getRecencyBoost(mtime?: number): number {
    const cutoff = this.plugin.settings.recencyBoost
    if (!mtime || cutoff === RecencyCutoff.Disabled) {
      return 1
    }

    const daysElapsed = (Date.now() - mtime) / (24 * 3600_000)
    const weight = {
      [RecencyCutoff.Day]: -3,
      [RecencyCutoff.Week]: -0.3,
      [RecencyCutoff.Month]: -0.1,
    } as const
    return 1 + Math.exp(weight[cutoff] * (daysElapsed / 1000))
  }

  private basenameFromPath(path: string): string {
    const filename = path.split('/').pop() ?? path
    const dot = filename.lastIndexOf('.')
    return dot > 0 ? filename.slice(0, dot) : filename
  }

  private getOptions(): Options<QuickIndexDocument> {
    return {
      tokenize: this.tokenizer.tokenizeForIndexing.bind(this.tokenizer),
      extractField: (doc, fieldName) => String((doc as any)[fieldName] ?? ''),
      processTerm: (term: string) =>
        (this.plugin.settings.ignoreDiacritics
          ? removeDiacritics(term, this.plugin.settings.ignoreArabicDiacritics)
          : term
        ).toLowerCase(),
      idField: 'path',
      fields: [
        'path',
        'basename',
        'displayTitle',
        'directory',
        'aliases',
        'headings1',
        'headings2',
        'headings3',
        'tags',
        'unmarkedTags',
      ],
      storeFields: [
        'basename',
        'displayTitle',
        'directory',
        'tags',
        'unmarkedTags',
        'mtime',
      ],
    }
  }
}
