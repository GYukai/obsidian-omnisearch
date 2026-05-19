import type OmnisearchPlugin from '../main'
import type { SearchResultSelection } from '../settings/utils'
import { Query, type QueryPreferenceKey } from './query'

const MAX_RESULT_SELECTION_QUERIES = 100
const MAX_RESULT_SELECTIONS_PER_QUERY = 10
const SELECTION_HALF_LIFE_MS = 7 * 24 * 3600_000
const MAX_SELECTION_BOOST = 5
const MIN_SELECTION_BOOST = 0.05

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

    const now = Date.now()
    const selections = this.plugin.settings.searchResultSelections ?? {}
    const previousSelections = selections[queryKey] ?? []
    const previousSelection = previousSelections.find(s => s.path === path)
    const previousWeight = previousSelection
      ? this.getDecayedSelectionWeight(previousSelection, now)
      : 0
    const nextSelection: SearchResultSelection = {
      path,
      count: (previousSelection?.count ?? 0) + 1,
      weight: previousWeight + 1,
      lastSelectedAt: now,
    }
    const nextSelections = [
      nextSelection,
      ...previousSelections.filter(s => s.path !== path),
    ]
      .sort(
        (a, b) =>
          this.getDecayedSelectionWeight(b, now) -
            this.getDecayedSelectionWeight(a, now) ||
          b.lastSelectedAt - a.lastSelectedAt
      )
      .slice(0, MAX_RESULT_SELECTIONS_PER_QUERY)

    this.plugin.settings.searchResultSelections = this.pruneSelections({
      ...selections,
      [queryKey]: nextSelections,
    })
    await this.plugin.saveData(this.plugin.settings)
  }

  public getSelectionBoosts(query: Query): ReadonlyMap<string, number> {
    const queryKeyParts = query.getPreferenceKeyParts()
    if (!queryKeyParts) {
      return new Map()
    }

    const now = Date.now()
    const boosts = new Map<string, number>()
    for (const [storedQueryKey, selections] of Object.entries(
      this.plugin.settings.searchResultSelections ?? {}
    )) {
      const storedQueryKeyParts = this.parsePreferenceKey(storedQueryKey)
      if (!storedQueryKeyParts || !selections.length) {
        continue
      }

      const querySimilarity = this.getPreferenceSimilarity(
        queryKeyParts,
        storedQueryKeyParts
      )
      if (!querySimilarity) {
        continue
      }

      for (const selection of selections) {
        const decayedWeight = this.getDecayedSelectionWeight(selection, now)
        if (decayedWeight < MIN_SELECTION_BOOST) {
          continue
        }
        const boost =
          Math.min(decayedWeight, MAX_SELECTION_BOOST) * querySimilarity
        boosts.set(
          selection.path,
          Math.max(boosts.get(selection.path) ?? 0, boost)
        )
      }
    }

    return boosts
  }

  private pruneSelections(
    selections: Record<string, SearchResultSelection[]>
  ): Record<string, SearchResultSelection[]> {
    const now = Date.now()
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
          [...items]
            .sort(
              (a, b) =>
                this.getDecayedSelectionWeight(b, now) -
                  this.getDecayedSelectionWeight(a, now) ||
                b.lastSelectedAt - a.lastSelectedAt
            )
            .slice(0, MAX_RESULT_SELECTIONS_PER_QUERY),
        ])
        .sort(([, a], [, b]) => getLatestSelectedAt(b) - getLatestSelectedAt(a))
        .slice(0, MAX_RESULT_SELECTION_QUERIES)
    )
  }

  private getDecayedSelectionWeight(
    selection: SearchResultSelection,
    now: number
  ): number {
    const elapsed = Math.max(0, now - selection.lastSelectedAt)
    const baseWeight = selection.weight ?? selection.count
    return baseWeight * Math.pow(0.5, elapsed / SELECTION_HALF_LIFE_MS)
  }

  private parsePreferenceKey(queryKey: string): QueryPreferenceKey | null {
    try {
      const parsed = JSON.parse(queryKey) as Partial<QueryPreferenceKey>
      const keys: (keyof QueryPreferenceKey)[] = [
        'text',
        'ext',
        'path',
        'excludeText',
        'excludeExt',
        'excludePath',
      ]
      if (!keys.every(key => Array.isArray(parsed[key]))) {
        return null
      }
      return parsed as QueryPreferenceKey
    } catch {
      return null
    }
  }

  private getPreferenceSimilarity(
    current: QueryPreferenceKey,
    stored: QueryPreferenceKey
  ): number {
    if (
      !this.arraysAreEqual(current.ext, stored.ext) ||
      !this.arraysAreEqual(current.path, stored.path) ||
      !this.arraysAreEqual(current.excludeText, stored.excludeText) ||
      !this.arraysAreEqual(current.excludeExt, stored.excludeExt) ||
      !this.arraysAreEqual(current.excludePath, stored.excludePath)
    ) {
      return 0
    }

    return this.getTextSimilarity(current.text, stored.text)
  }

  private getTextSimilarity(current: string[], stored: string[]): number {
    if (current.length !== stored.length || current.length === 0) {
      return 0
    }

    const unmatched = [...stored]
    let totalSimilarity = 0
    for (const currentTerm of current) {
      let bestIndex = -1
      let bestSimilarity = 0
      for (let i = 0; i < unmatched.length; i++) {
        const similarity = this.getTokenSimilarity(currentTerm, unmatched[i])
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity
          bestIndex = i
        }
      }
      if (bestIndex === -1 || bestSimilarity === 0) {
        return 0
      }
      unmatched.splice(bestIndex, 1)
      totalSimilarity += bestSimilarity
    }

    return totalSimilarity / current.length
  }

  private getTokenSimilarity(a: string, b: string): number {
    if (a === b) {
      return 1
    }
    if (a.startsWith('#') || b.startsWith('#')) {
      return 0
    }

    const minLength = Math.min(a.length, b.length)
    const maxLength = Math.max(a.length, b.length)
    if (minLength >= 3 && (a.startsWith(b) || b.startsWith(a))) {
      return minLength / maxLength
    }

    const distance = this.getLevenshteinDistance(a, b)
    const allowedDistance =
      maxLength <= 3
        ? 0
        : maxLength <= 5
        ? 1
        : Math.max(1, Math.floor(maxLength * 0.2))
    if (distance > allowedDistance) {
      return 0
    }

    return 1 - distance / maxLength
  }

  private getLevenshteinDistance(a: string, b: string): number {
    const previous = Array.from({ length: b.length + 1 }, (_, i) => i)
    const current = Array.from({ length: b.length + 1 }, () => 0)

    for (let i = 1; i <= a.length; i++) {
      current[0] = i
      for (let j = 1; j <= b.length; j++) {
        current[j] = Math.min(
          previous[j] + 1,
          current[j - 1] + 1,
          previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        )
      }
      previous.splice(0, previous.length, ...current)
    }

    return previous[b.length]
  }

  private arraysAreEqual(a: string[], b: string[]): boolean {
    return (
      a.length === b.length && a.every((value, index) => value === b[index])
    )
  }
}
