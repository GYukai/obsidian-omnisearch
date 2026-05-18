const QUICK_ADD_DEFAULTS = {
  headerRow: 1,
  dateColumn: '日期',
  inputColumn: '内容',
  clearColumns: '备注',
  dateFormat: 'yyyy-mm-dd'
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('快速录入')
    .addItem('新增一条', 'quickAddOne')
    .addItem('复制上一条', 'copyPreviousRow')
    .addSeparator()
    .addItem('首次配置/修改配置', 'setupQuickAdd')
    .addToUi();
}

function setupQuickAdd() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getDocumentProperties();
  const cfg = getConfig_();

  props.setProperties({
    headerRow: ask_(ui, '表头行号', cfg.headerRow),
    dateColumn: ask_(ui, '自动填写日期的列名或列号', cfg.dateColumn),
    inputColumn: ask_(ui, '每次手动输入的列名或列号', cfg.inputColumn),
    clearColumns: ask_(ui, '新增时先清空的列，逗号分隔', cfg.clearColumns),
    dateFormat: ask_(ui, '日期显示格式', cfg.dateFormat)
  });

  SpreadsheetApp.getActive().toast('配置已更新。', '快速录入', 4);
}

function quickAddOne() {
  const ui = SpreadsheetApp.getUi();
  const cfg = getConfig_();
  const input = ui.prompt('新增一条', '请输入「' + cfg.inputColumn + '」：', ui.ButtonSet.OK_CANCEL);
  if (input.getSelectedButton() !== ui.Button.OK) return;

  const row = appendFromPrevious_(cfg);
  const sheet = SpreadsheetApp.getActiveSheet();
  const headers = getHeaderMap_(sheet, Number(cfg.headerRow));
  sheet.getRange(row, columnFor_(headers, cfg.inputColumn)).setValue(input.getResponseText());
  SpreadsheetApp.getActive().toast('已新增第 ' + row + ' 行。', '快速录入', 4);
}

function copyPreviousRow() {
  const row = appendFromPrevious_(getConfig_());
  SpreadsheetApp.getActive().toast('已复制到第 ' + row + ' 行。', '快速录入', 4);
}

function appendFromPrevious_(cfg) {
  const sheet = SpreadsheetApp.getActiveSheet();
  const headerRow = Number(cfg.headerRow);
  const lastRow = sheet.getLastRow();
  if (lastRow <= headerRow) throw new Error('没有可复制的数据行。');

  const lastColumn = sheet.getLastColumn();
  const newRow = lastRow + 1;
  sheet.getRange(lastRow, 1, 1, lastColumn)
    .copyTo(sheet.getRange(newRow, 1, 1, lastColumn), { contentsOnly: false });

  const headers = getHeaderMap_(sheet, headerRow);
  splitColumns_(cfg.clearColumns).forEach(ref => {
    sheet.getRange(newRow, columnFor_(headers, ref)).clearContent();
  });

  if (String(cfg.dateColumn).trim()) {
    sheet.getRange(newRow, columnFor_(headers, cfg.dateColumn))
      .setValue(new Date())
      .setNumberFormat(cfg.dateFormat);
  }

  return newRow;
}

function getConfig_() {
  const props = PropertiesService.getDocumentProperties().getProperties();
  return Object.assign({}, QUICK_ADD_DEFAULTS, props);
}

function getHeaderMap_(sheet, headerRow) {
  const values = sheet.getRange(headerRow, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  return values.reduce((map, value, index) => {
    const header = String(value).trim();
    if (header) map[header] = index + 1;
    return map;
  }, {});
}

function columnFor_(headers, ref) {
  const value = String(ref).trim();
  if (headers[value]) return headers[value];
  if (/^\d+$/.test(value)) return Number(value);
  if (/^[A-Za-z]+$/.test(value)) return lettersToColumn_(value);
  throw new Error('找不到列：' + value);
}

function lettersToColumn_(letters) {
  return letters.toUpperCase().split('').reduce((sum, char) => {
    return sum * 26 + char.charCodeAt(0) - 64;
  }, 0);
}

function splitColumns_(text) {
  return String(text || '').split(/[，,]/).map(s => s.trim()).filter(Boolean);
}

function ask_(ui, title, currentValue) {
  const result = ui.prompt(title, '当前值：' + currentValue, ui.ButtonSet.OK_CANCEL);
  if (result.getSelectedButton() !== ui.Button.OK) return String(currentValue);
  return result.getResponseText().trim() || String(currentValue);
}
