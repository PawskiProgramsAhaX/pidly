import { useState, useRef, useCallback } from 'react';
import ExcelJS from 'exceljs';

/**
 * Import/Export hook for ProjectClassesPage.
 * Handles JSON, CSV, XLSX import and formatted XLSX/JSON export.
 */
export default function useImportExport({ project, detectedObjects, setDetectedObjects, selectedClass, projectId, getSelectedClassSubclasses, saveObjectsToBackend }) {
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importData, setImportData] = useState(null);
  const [importMode, setImportMode] = useState('merge');
  const [importError, setImportError] = useState(null);
  const fileInputRef = useRef(null);

  // ─── Formatted XLSX builder ──────────────────────────────────────────
  const buildFormattedWorkbook = useCallback((sheetName, headers, dataRows) => {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'pidly';
    wb.created = new Date();
    const ws = wb.addWorksheet(sheetName.slice(0, 31));

    const headerRow = ws.addRow(headers);
    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2C3E50' } };
    const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Arial' };
    const thinBorder = {
      top: { style: 'thin', color: { argb: 'FFD0D0D0' } },
      bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
      left: { style: 'thin', color: { argb: 'FFD0D0D0' } },
      right: { style: 'thin', color: { argb: 'FFD0D0D0' } },
    };
    headerRow.eachCell(cell => {
      cell.fill = headerFill;
      cell.font = headerFont;
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = thinBorder;
    });
    headerRow.height = 28;
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    const dataFont = { size: 11, name: 'Arial' };
    const evenFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F9FA' } };
    dataRows.forEach((rowData, i) => {
      const row = ws.addRow(rowData);
      row.eachCell(cell => {
        cell.font = dataFont;
        cell.border = thinBorder;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        if (i % 2 === 1) cell.fill = evenFill;
      });
    });

    ws.columns.forEach((col, i) => {
      let maxLen = String(headers[i] || '').length;
      dataRows.forEach(row => { const v = String(row[i] ?? ''); if (v.length > maxLen) maxLen = v.length; });
      col.width = Math.max(maxLen + 4, 12);
    });

    headers.forEach((h, idx) => {
      if (h === 'confidence' || h === 'ocr_confidence') {
        ws.getColumn(idx + 1).numFmt = '0.0%';
        dataRows.forEach((_, ri) => {
          const cell = ws.getCell(ri + 2, idx + 1);
          const val = parseFloat(cell.value);
          if (!isNaN(val)) cell.value = val <= 1 ? val : val / 100;
        });
      }
    });
    return wb;
  }, []);

  const downloadWorkbook = useCallback(async (wb, filename) => {
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }, []);

  // ─── Exports ─────────────────────────────────────────────────────────
  const handleExportCSV = useCallback(async (classData) => {
    if (!classData?.length) { alert('No data to export'); return; }
    const subs = getSelectedClassSubclasses().map(s => s.name);
    const customCols = project?.classColumns?.[selectedClass.name] || [];
    const headers = [
      'id', 'className', 'label', 'ocr_text', 'filename', 'page', 'confidence', 'ocr_confidence', 'shapeType', 'isManual',
      'bbox_x', 'bbox_y', 'bbox_width', 'bbox_height',
      ...subs.map(k => `subclass_${k}`), ...customCols.map(c => `column_${c.name}`),
    ];
    const rows = classData.map(obj => [
      obj.id || '', obj.className || '', obj.label || '', obj.ocr_text || '', obj.filename || '',
      obj.page ?? '', obj.confidence ?? '', obj.ocr_confidence ?? '', obj.shapeType || 'rectangle', obj.isManual ? 'true' : 'false',
      obj.bbox?.x ?? '', obj.bbox?.y ?? '', obj.bbox?.width ?? '', obj.bbox?.height ?? '',
      ...subs.map(k => obj.subclassValues?.[k] || ''), ...customCols.map(c => obj[c.id] || ''),
    ]);
    const wb = buildFormattedWorkbook(selectedClass.name, headers, rows);
    await downloadWorkbook(wb, `${selectedClass.name}_export.xlsx`);
  }, [project, selectedClass, getSelectedClassSubclasses, buildFormattedWorkbook, downloadWorkbook]);

  const handleExportAllJSON = useCallback(() => {
    if (!detectedObjects.length) { alert('No objects to export'); return; }
    const exportData = {
      projectId, projectName: project?.name || 'Unknown', exportDate: new Date().toISOString(),
      objectCount: detectedObjects.length,
      structure: {
        subclasses: (project.classes || []).filter(c => c.parentId).map(c => ({ name: c.name, parentId: c.parentId })),
        customColumns: project.classColumns || {},
      },
      objects: detectedObjects,
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${project?.name || 'objects'}_export.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }, [detectedObjects, project, projectId]);

  const handleExportAllCSV = useCallback(async () => {
    if (!detectedObjects.length) { alert('No objects to export'); return; }
    const allSubs = (project.classes || []).filter(c => c.parentId).map(c => c.name);
    const allCustom = [];
    const seen = new Set();
    Object.values(project.classColumns || {}).forEach(cols => {
      cols.forEach(col => { if (!seen.has(col.name)) { seen.add(col.name); allCustom.push({ id: col.id, name: col.name }); } });
    });
    const headers = [
      'id', 'className', 'label', 'ocr_text', 'filename', 'page', 'confidence', 'ocr_confidence', 'shapeType', 'isManual',
      'bbox_x', 'bbox_y', 'bbox_width', 'bbox_height',
      ...allSubs.map(k => `subclass_${k}`), ...allCustom.map(c => `column_${c.name}`),
    ];
    const rows = detectedObjects.map(obj => [
      obj.id || '', obj.className || '', obj.label || '', obj.ocr_text || '', obj.filename || '',
      obj.page ?? '', obj.confidence ?? '', obj.ocr_confidence ?? '', obj.shapeType || 'rectangle', obj.isManual ? 'true' : 'false',
      obj.bbox?.x ?? '', obj.bbox?.y ?? '', obj.bbox?.width ?? '', obj.bbox?.height ?? '',
      ...allSubs.map(k => obj.subclassValues?.[k] || ''), ...allCustom.map(c => obj[c.id] || ''),
    ]);
    const wb = buildFormattedWorkbook(project?.name || 'All Objects', headers, rows);
    await downloadWorkbook(wb, `${project?.name || 'objects'}_all_export.xlsx`);
  }, [detectedObjects, project, buildFormattedWorkbook, downloadWorkbook]);

  // ─── CSV parser ──────────────────────────────────────────────────────
  const parseCSVLine = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else current += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',') { result.push(current.trim()); current = ''; }
        else current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  // ─── Parse object from row ───────────────────────────────────────────
  const parseObjectRow = (headers, values) => {
    const obj = {};
    headers.forEach((header, idx) => {
      const value = values[idx];
      if (value === '' || value === 'undefined') return;
      if (header === 'bbox_x') { obj.bbox = obj.bbox || {}; obj.bbox.x = parseFloat(value); }
      else if (header === 'bbox_y') { obj.bbox = obj.bbox || {}; obj.bbox.y = parseFloat(value); }
      else if (header === 'bbox_width') { obj.bbox = obj.bbox || {}; obj.bbox.width = parseFloat(value); }
      else if (header === 'bbox_height') { obj.bbox = obj.bbox || {}; obj.bbox.height = parseFloat(value); }
      else if (header.startsWith('subclass_')) {
        obj.subclassValues = obj.subclassValues || {};
        obj.subclassValues[header.replace('subclass_', '')] = value;
      } else if (header.startsWith('column_')) {
        obj._customColumnsByName = obj._customColumnsByName || {};
        obj._customColumnsByName[header.replace('column_', '')] = value;
      } else if (header === 'page') obj.page = parseInt(value, 10);
      else if (header === 'confidence') { let v = parseFloat(value); if (!isNaN(v) && v > 1) v /= 100; obj.confidence = v; }
      else if (header === 'ocr_confidence') { let v = parseFloat(value); if (!isNaN(v) && v > 1) v /= 100; obj.ocr_confidence = v; }
      else if (header === 'isManual') obj.isManual = value === 'true' || value === 'TRUE';
      else obj[header] = value;
    });
    return obj;
  };

  // ─── File select handler ─────────────────────────────────────────────
  const handleFileSelect = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.name.endsWith('.xlsx')) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(event.target.result);
          const ws = wb.worksheets[0];
          if (!ws || ws.rowCount < 2) throw new Error('Excel file must have a header row and at least one data row');

          const headers = [];
          ws.getRow(1).eachCell((cell, colNum) => { headers[colNum - 1] = String(cell.value || '').trim(); });

          const objects = [];
          for (let ri = 2; ri <= ws.rowCount; ri++) {
            const row = ws.getRow(ri);
            const values = headers.map((_, ci) => {
              let val = row.getCell(ci + 1).value;
              if (val && typeof val === 'object') {
                if (val.result !== undefined) val = val.result;
                else if (val.text) val = val.text;
                else if (val.richText) val = val.richText.map(r => r.text).join('');
                else val = String(val);
              }
              return val != null ? String(val) : '';
            });
            const obj = parseObjectRow(headers, values);
            if (!obj.id) obj.id = `imported_${Date.now()}_${ri}`;
            if (obj.className || obj.label) objects.push(obj);
          }
          if (!objects.length) throw new Error('No valid objects found in Excel file');
          setImportData({ format: 'xlsx', objects, fileName: file.name });
          setImportError(null);
          setShowImportDialog(true);
        } catch (err) {
          setImportError(err.message);
          setImportData(null);
          setShowImportDialog(true);
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target.result;
        try {
          if (file.name.endsWith('.json')) {
            const data = JSON.parse(content);
            const objects = data.objects || data;
            if (!Array.isArray(objects)) throw new Error('Invalid JSON format');
            const valid = objects.filter(o => o.id || o.className || o.label);
            if (!valid.length) throw new Error('No valid objects found.');
            setImportData({ format: 'json', objects: valid, fileName: file.name });
            setImportError(null);
          } else if (file.name.endsWith('.csv')) {
            const lines = content.split('\n').filter(l => l.trim());
            if (lines.length < 2) throw new Error('CSV needs header + data rows');
            const headers = parseCSVLine(lines[0]);
            const objects = [];
            for (let i = 1; i < lines.length; i++) {
              const values = parseCSVLine(lines[i]);
              if (values.length !== headers.length) continue;
              const obj = parseObjectRow(headers, values);
              if (!obj.id) obj.id = `imported_${Date.now()}_${i}`;
              if (obj.className || obj.label) objects.push(obj);
            }
            if (!objects.length) throw new Error('No valid objects found in CSV');
            setImportData({ format: 'csv', objects, fileName: file.name });
            setImportError(null);
          } else {
            throw new Error('Unsupported file format. Use .json, .csv, or .xlsx');
          }
          setShowImportDialog(true);
        } catch (err) {
          setImportError(err.message);
          setImportData(null);
          setShowImportDialog(true);
        }
      };
      reader.readAsText(file);
    }
    e.target.value = '';
  }, []);

  // ─── Execute import ──────────────────────────────────────────────────
  const handleImport = useCallback(async () => {
    if (!importData?.objects) return;
    try {
      const validSubclasses = new Set((project.classes || []).filter(c => c.parentId).map(c => c.name));
      const columnNameToId = new Map();
      Object.values(project.classColumns || {}).forEach(cols => { cols.forEach(col => columnNameToId.set(col.name, col.id)); });

      const filtered = importData.objects.map(obj => {
        const f = { ...obj };
        if (f.subclassValues) {
          const valid = {};
          Object.entries(f.subclassValues).forEach(([k, v]) => { if (validSubclasses.has(k)) valid[k] = v; });
          f.subclassValues = Object.keys(valid).length > 0 ? valid : undefined;
        }
        if (f._customColumnsByName) {
          Object.entries(f._customColumnsByName).forEach(([name, val]) => {
            const id = columnNameToId.get(name);
            if (id) f[id] = val;
          });
          delete f._customColumnsByName;
        }
        return f;
      });

      let newObjects;
      if (importMode === 'replace') {
        newObjects = filtered;
      } else {
        const existing = new Map(detectedObjects.map(o => [o.id, o]));
        filtered.forEach(o => existing.set(o.id, { ...existing.get(o.id), ...o }));
        newObjects = Array.from(existing.values());
      }

      setDetectedObjects(newObjects);
      await saveObjectsToBackend(projectId, newObjects);
      alert(`Successfully imported ${filtered.length} objects (${importMode} mode)`);
      setShowImportDialog(false);
      setImportData(null);
      setImportError(null);
    } catch (err) {
      console.error('Import failed:', err);
      alert('Import failed: ' + err.message);
    }
  }, [importData, importMode, project, detectedObjects, setDetectedObjects, projectId, saveObjectsToBackend]);

  return {
    // Import state
    showImportDialog, setShowImportDialog,
    importData, setImportData,
    importMode, setImportMode,
    importError, setImportError,
    fileInputRef, handleFileSelect, handleImport,
    // Export
    handleExportCSV, handleExportAllJSON, handleExportAllCSV,
  };
}
