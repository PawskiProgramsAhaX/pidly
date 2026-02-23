import { useState, useMemo, useCallback } from 'react';

/**
 * Find & Replace hook for class data table.
 */
export default function useFindReplace({ selectedClass, classData, detectedObjects, setDetectedObjects, projectId, saveObjectsToBackend, getSelectedClassSubclasses, getClassCustomColumns }) {
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [findField, setFindField] = useState('filename');
  const [matchCase, setMatchCase] = useState(false);

  const findMatches = useMemo(() => {
    if (!findText || !selectedClass) return [];
    const search = matchCase ? findText : findText.toLowerCase();
    return classData.filter(obj => {
      if (obj.status === 'orphaned') return false;
      let val = '';
      if (findField === 'filename') val = obj.filename?.replace('.pdf', '') || '';
      else if (findField.startsWith('subclass_')) val = obj.subclassValues?.[findField.replace('subclass_', '')] || '';
      else val = obj[findField] || '';
      const cmp = matchCase ? val : val.toLowerCase();
      return cmp.includes(search);
    });
  }, [findText, findField, matchCase, selectedClass, classData]);

  const handleReplaceSingle = useCallback(async (objId) => {
    if (!findText || findField === 'filename') return;
    const regex = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi');
    const updated = detectedObjects.map(obj => {
      if (obj.id !== objId) return obj;
      if (findField.startsWith('subclass_')) {
        const sub = findField.replace('subclass_', '');
        const val = obj.subclassValues?.[sub] || '';
        return { ...obj, subclassValues: { ...(obj.subclassValues || {}), [sub]: val.replace(regex, replaceText) } };
      }
      return { ...obj, [findField]: (obj[findField] || '').replace(regex, replaceText) };
    });
    setDetectedObjects(updated);
    try { await saveObjectsToBackend(projectId, updated); } catch (e) { console.error('Error:', e); }
  }, [findText, findField, replaceText, matchCase, detectedObjects, setDetectedObjects, projectId, saveObjectsToBackend]);

  const handleReplaceAll = useCallback(async () => {
    if (!findText || !findMatches.length || findField === 'filename') {
      if (findField === 'filename') alert('Cannot replace in filename field');
      return;
    }
    const ids = new Set(findMatches.map(o => o.id));
    const regex = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi');
    const updated = detectedObjects.map(obj => {
      if (!ids.has(obj.id)) return obj;
      if (findField.startsWith('subclass_')) {
        const sub = findField.replace('subclass_', '');
        const val = obj.subclassValues?.[sub] || '';
        return { ...obj, subclassValues: { ...(obj.subclassValues || {}), [sub]: val.replace(regex, replaceText) } };
      }
      return { ...obj, [findField]: (obj[findField] || '').replace(regex, replaceText) };
    });
    setDetectedObjects(updated);
    try {
      await saveObjectsToBackend(projectId, updated);
      alert(`Replaced ${findMatches.length} occurrence(s)`);
    } catch (e) { console.error('Error:', e); }
  }, [findText, findField, replaceText, matchCase, findMatches, detectedObjects, setDetectedObjects, projectId, saveObjectsToBackend]);

  const getSearchableFields = useCallback(() => {
    const fields = [{ id: 'filename', name: 'Document' }];
    const subs = getSelectedClassSubclasses();
    if (subs.length > 0) {
      subs.forEach(sub => fields.push({ id: `subclass_${sub.name}`, name: sub.name }));
    } else {
      fields.push({ id: 'ocr_text', name: 'Tag' });
    }
    getClassCustomColumns().forEach(col => { if (col.editable) fields.push({ id: col.id, name: col.name }); });
    return fields;
  }, [getSelectedClassSubclasses, getClassCustomColumns]);

  return {
    showFindReplace, setShowFindReplace,
    findText, setFindText, replaceText, setReplaceText,
    findField, setFindField, matchCase, setMatchCase,
    findMatches, handleReplaceSingle, handleReplaceAll,
    getSearchableFields,
  };
}
