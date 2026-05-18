import type OmnisearchPlugin from '../main'
import type { SearchResultSelection } from '../settings/utils'
import { Query } from './query'

const MAX_RESULT_SELECTION_QUERIES = 100
const MAX_RESULT_SELECTIONS_PER_QUERY = 10

export class SearchHistory {
  /**
   * Show an empty input field next time the user opens Omnisearch modal
   */
  private nextQueryIsEmpty = false

  constructor(private plugin: OmnisearchPlugin) {}

  public async addToHistory(query: string): Promise<void> {
    if (!query) {
      this.nextQueryIsEmpty = true
      return
    }
    this.nextQueryIsEmpty = false
    const database = this.plugin.database
    let history = await database.searchHistory.toArray()
    history = history.filter(s => s.query !== query).reverse()
    history.unshift({ query })
    history = history.slice(0, 10)
    await database.searchHistory.clear()
    await database.searchHistory.bulkAdd(history)
  }

  /**
   * @returns The search history, in reverse chronological order
   */
  public async getHistory(): Promise<ReadonlyArray<string>> {
    const data = (await this.plugin.database.searchHistory.toArray())
      .reverse()
      .map(o => o.query)
    if (this.nextQueryIsEmpty) {
      data.unshift('')
    }
    return data
  }

  public async recordSelection(queryText: string, path: string): Promise<void> {
    if (!queryText || !path) {
      return
    }

    const query = new Query(queryText, {
      ignoreDiacritics: this.plugin.settings.ignoreDiacritics,
      ignoreArabicDiacritics: this.plugin.settings.ignoreArabicDiacritics,
    })
    const queryKey = query.getPreferenceKey()
    if (!queryKey) {
      return
    }

    const selections = this.plugin.settings.searchResultSelections ?? {}
    const previousSelections = selections[queryKey] ?? []
    const previousSelection = previousSelections.find(s => s.path === path)
    const nextSelection: SearchResultSelection = {
      path,
      count: (previousSelection?.count ?? 0) + 1,
      lastSelectedAt: Date.now(),
    }
    const nextSelections = [
      nextSelection,
      ...previousSelections.filter(s => s.path !== path),
    ]
      .sort((a, b) => b.count - a.count || b.lastSelectedAt - a.lastSelectedAt)
      .slice(0, MAX_RESULT_SELECTIONS_PER_QUERY)

    this.plugin.settings.searchResultSelections = this.pruneSelections({
      ...selections,
      [queryKey]: nextSelections,
    })
    await this.plugin.saveData(this.plugin.settings)
  }

  public getSelectionBoosts(query: Query): ReadonlyMap<string, number> {
    const queryKey = query.getPreferenceKey()
    const selections =
      this.plugin.settings.searchResultSelections?.[queryKey] ?? []
    if (!queryKey || !selections.length) {
      return new Map()
    }

    const latestSelectedAt = selections.reduce(
      (latest, selection) => Math.max(latest, selection.lastSelectedAt),
      0
    )
    return new Map(
      selections.map(selection => {
        const countBoost = Math.min(selection.count, 5)
        const recencyBoost =
          selection.lastSelectedAt === latestSelectedAt ? 0.5 : 0
        return [selection.path, countBoost + recencyBoost]
      })
    )
  }

  private pruneSelections(
    selections: Record<string, SearchResultSelection[]>
  ): Record<string, SearchResultSelection[]> {
    const getLatestSelectedAt = (items: SearchResultSelection[]): number => {
      return items.reduce(
        (latest, selection) => Math.max(latest, selection.lastSelectedAt),
        0
      )
    }

    return Object.fromEntries(
      Object.entries(selections)
        .map(([queryKey, items]): [string, SearchResultSelection[]] => [
          queryKey,
          items.slice(0, MAX_RESULT_SELECTIONS_PER_QUERY),
        ])
        .sort(([, a], [, b]) => getLatestSelectedAt(b) - getLatestSelectedAt(a))
        .slice(0, MAX_RESULT_SELECTION_QUERIES)
    )
  }
}
