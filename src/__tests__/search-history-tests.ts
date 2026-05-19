import { Query } from '../search/query'
import { SearchHistory } from '../search/search-history'
import type OmnisearchPlugin from '../main'

describe('SearchHistory', () => {
  const now = new Date('2026-05-19T00:00:00.000Z').valueOf()

  function createSearchHistory() {
    const plugin = {
      settings: {
        ignoreDiacritics: true,
        ignoreArabicDiacritics: false,
        searchResultSelections: {},
      },
      saveData: jest.fn().mockResolvedValue(undefined),
    }
    return {
      plugin,
      searchHistory: new SearchHistory(plugin as unknown as OmnisearchPlugin),
    }
  }

  function createQuery(text: string): Query {
    return new Query(text, {
      ignoreDiacritics: true,
      ignoreArabicDiacritics: false,
    })
  }

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(now)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('.recordSelection()', () => {
    it('should boost a selected result for the same query terms', async () => {
      // Arrange
      const { searchHistory } = createSearchHistory()

      // Act
      await searchHistory.recordSelection('foo bar', 'Selected.md')
      const query = createQuery('bar foo')

      // Assert
      expect(searchHistory.getSelectionBoosts(query).get('Selected.md')).toBe(1)
    })

    it('should increase the boost when the same result is selected repeatedly', async () => {
      // Arrange
      const { searchHistory } = createSearchHistory()

      // Act
      await searchHistory.recordSelection('foo', 'Selected.md')
      await searchHistory.recordSelection('foo', 'Selected.md')
      const query = createQuery('foo')

      // Assert
      expect(searchHistory.getSelectionBoosts(query).get('Selected.md')).toBe(2)
    })

    it('should decay selection boosts with a 7-day half-life', async () => {
      // Arrange
      const { searchHistory } = createSearchHistory()

      // Act
      await searchHistory.recordSelection('foo', 'Selected.md')
      ;(Date.now as jest.Mock).mockReturnValue(now + 7 * 24 * 3600_000)
      const query = createQuery('foo')

      // Assert
      expect(searchHistory.getSelectionBoosts(query).get('Selected.md')).toBe(
        0.5
      )
    })

    it('should boost selected results for near query terms', async () => {
      // Arrange
      const { searchHistory } = createSearchHistory()

      // Act
      await searchHistory.recordSelection('interpolation', 'Selected.md')
      const query = createQuery('interpolaton')

      // Assert
      expect(
        searchHistory.getSelectionBoosts(query).get('Selected.md')
      ).toBeCloseTo(12 / 13)
    })

    it('should not boost near terms across different filters', async () => {
      // Arrange
      const { searchHistory } = createSearchHistory()

      // Act
      await searchHistory.recordSelection('interpolation ext:md', 'Selected.md')
      const query = createQuery('interpolaton ext:canvas')

      // Assert
      expect(searchHistory.getSelectionBoosts(query).get('Selected.md')).toBe(
        undefined
      )
    })
  })
})
