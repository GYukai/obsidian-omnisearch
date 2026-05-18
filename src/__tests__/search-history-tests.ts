import { Query } from '../search/query'
import { SearchHistory } from '../search/search-history'

describe('SearchHistory', () => {
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
      searchHistory: new SearchHistory(plugin as any),
    }
  }

  describe('.recordSelection()', () => {
    it('should boost a selected result for the same query terms', async () => {
      // Arrange
      const { searchHistory } = createSearchHistory()

      // Act
      await searchHistory.recordSelection('foo bar', 'Selected.md')
      const query = new Query('bar foo', {
        ignoreDiacritics: true,
        ignoreArabicDiacritics: false,
      })

      // Assert
      expect(searchHistory.getSelectionBoosts(query).get('Selected.md')).toBe(
        1.5
      )
    })

    it('should increase the boost when the same result is selected repeatedly', async () => {
      // Arrange
      const { searchHistory } = createSearchHistory()

      // Act
      await searchHistory.recordSelection('foo', 'Selected.md')
      await searchHistory.recordSelection('foo', 'Selected.md')
      const query = new Query('foo', {
        ignoreDiacritics: true,
        ignoreArabicDiacritics: false,
      })

      // Assert
      expect(searchHistory.getSelectionBoosts(query).get('Selected.md')).toBe(
        2.5
      )
    })
  })
})
