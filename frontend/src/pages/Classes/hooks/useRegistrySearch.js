import { useState, useMemo, useCallback, useRef, useEffect } from 'react';

/**
 * Registry/Smart Search hook for ProjectClassesPage.
 * Handles: tag extraction, filtering, smart search across all columns.
 * 
 * Optimisations:
 * - Debounced search query (300ms) to avoid re-computing on every keystroke
 * - Pre-indexed objects by class name for O(1) class filtering
 * - Stable filename cache to avoid repeated .replace() calls
 * - Memoised filter options with single pass
 * - for-loops instead of .forEach() for hot paths
 */
export default function useRegistrySearch({ project, detectedObjects }) {
  const [registryFilter, setRegistryFilter] = useState('all');
  const [registrySearchQuery, setRegistrySearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState(null);
  const debounceRef = useRef(null);

  // Debounce search query — 300ms delay
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(registrySearchQuery);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [registrySearchQuery]);

  // ─── Pre-index: objects grouped by class name ─────────────────────
  const objectsByClass = useMemo(() => {
    const index = new Map();
    for (let i = 0; i < detectedObjects.length; i++) {
      const obj = detectedObjects[i];
      const cls = obj.label || obj.className;
      if (!index.has(cls)) index.set(cls, []);
      index.get(cls).push(obj);
    }
    return index;
  }, [detectedObjects]);

  // ─── Filename cache — avoid repeated .replace() ───────────────────
  const filenameCache = useMemo(() => {
    const cache = new Map();
    for (let i = 0; i < detectedObjects.length; i++) {
      const obj = detectedObjects[i];
      if (!cache.has(obj.id)) {
        cache.set(obj.id, (obj.filename || obj.originalFilename || 'Unknown').replace('.pdf', ''));
      }
    }
    return cache;
  }, [detectedObjects]);

  // ─── Filter options (classes + subclasses) — single pass ──────────
  const registryFilterOptions = useMemo(() => {
    const classes = project?.classes || [];
    const options = [{ value: 'all', label: 'All Tags' }];
    const rootMap = new Map();

    for (let i = 0; i < classes.length; i++) {
      const cls = classes[i];
      if (!cls.parentId) rootMap.set(cls.id, cls);
    }

    for (const [id, cls] of rootMap) {
      options.push({ value: cls.name, label: cls.name, type: 'class' });
      for (let i = 0; i < classes.length; i++) {
        const sub = classes[i];
        if (sub.parentId === id) {
          options.push({
            value: `subclass:${cls.name}:${sub.name}`,
            label: `  └ ${sub.name}`,
            type: 'subclass',
            parentClass: cls.name,
            subclassName: sub.name,
          });
        }
      }
    }
    return options;
  }, [project?.classes]);

  // ─── Registry tags — uses class index for filtered access ─────────
  const registryTags = useMemo(() => {
    const tags = new Map();
    const isSubFilter = registryFilter.startsWith('subclass:');
    let filterParts;
    if (isSubFilter) filterParts = registryFilter.split(':');

    const addTag = (tag, obj, className) => {
      let entry = tags.get(tag);
      if (!entry) {
        entry = { tag, occurrences: [] };
        tags.set(tag, entry);
      }
      entry.occurrences.push({
        objectId: obj.id, className,
        filename: filenameCache.get(obj.id) || 'Unknown',
        page: obj.pageNumber || 1, confidence: obj.confidence,
        subclassValues: obj.subclassValues, customData: obj.customData,
        obj,
      });
    };

    // Use class index instead of iterating all objects when filtered
    let objects;
    if (registryFilter === 'all') {
      objects = detectedObjects;
    } else if (isSubFilter) {
      objects = objectsByClass.get(filterParts[1]) || [];
    } else {
      objects = objectsByClass.get(registryFilter) || [];
    }

    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i];
      const className = obj.label || obj.className;

      if (isSubFilter) {
        const subVal = obj.subclassValues?.[filterParts[2]];
        if (subVal?.trim()) addTag(subVal.trim(), obj, className);
      } else {
        if (obj.ocr_text?.trim()) addTag(obj.ocr_text.trim(), obj, className);
        const subVals = obj.subclassValues;
        if (subVals) {
          const keys = Object.keys(subVals);
          for (let j = 0; j < keys.length; j++) {
            const val = subVals[keys[j]];
            if (val?.trim()) addTag(val.trim(), obj, className);
          }
        }
      }
    }

    const result = Array.from(tags.values());
    result.sort((a, b) => a.tag.localeCompare(b.tag));
    return result;
  }, [detectedObjects, registryFilter, objectsByClass, filenameCache]);

  // ─── Smart search across ALL objects + columns (DEBOUNCED) ────────
  const smartSearchResults = useMemo(() => {
    const search = debouncedQuery.trim().toLowerCase();
    if (!search) return null;

    const results = [];
    const allClassColumns = project?.classColumns || {};

    for (let i = 0; i < detectedObjects.length; i++) {
      const obj = detectedObjects[i];
      const matches = [];
      const className = obj.label || obj.className || obj.class_name;

      // Tag match
      if (obj.ocr_text && obj.ocr_text.toLowerCase().includes(search)) {
        matches.push({ field: 'Tag', value: obj.ocr_text });
      }

      // Subclass values
      const subVals = obj.subclassValues;
      if (subVals) {
        const keys = Object.keys(subVals);
        for (let j = 0; j < keys.length; j++) {
          const val = subVals[keys[j]];
          if (val && val.toLowerCase().includes(search)) {
            matches.push({ field: keys[j], value: val });
          }
        }
      }

      // Custom columns
      const cols = allClassColumns[className];
      if (cols) {
        for (let j = 0; j < cols.length; j++) {
          const col = cols[j];
          const v = obj[col.id];
          if (v && v.toString().toLowerCase().includes(search)) {
            matches.push({ field: col.name, value: v });
            continue;
          }
          const cv = obj.customData?.[col.id];
          if (cv && cv.toString().toLowerCase().includes(search)) {
            matches.push({ field: col.name, value: cv });
          }
        }
      }

      // Filename
      const fname = filenameCache.get(obj.id) || '';
      if (fname.toLowerCase().includes(search)) {
        matches.push({ field: 'Document', value: fname });
      }

      if (matches.length > 0) {
        results.push({
          obj, className, filename: fname,
          page: obj.page || 1, matches,
          tag: obj.ocr_text || '',
          subclassValues: obj.subclassValues || {},
          customData: obj.customData || {},
          confidence: obj.confidence,
        });
      }
    }

    // Group by class using plain object
    const byClass = {};
    for (let i = 0; i < results.length; i++) {
      const cls = results[i].className || 'Unknown';
      if (!byClass[cls]) byClass[cls] = [];
      byClass[cls].push(results[i]);
    }

    return { query: debouncedQuery, totalCount: results.length, byClass };
  }, [debouncedQuery, detectedObjects, project?.classColumns, filenameCache]);

  // ─── Filtered tags by search (debounced) ──────────────────────────
  const filteredRegistryTags = useMemo(() => {
    const search = debouncedQuery.trim().toLowerCase();
    if (!search) return registryTags;
    const filtered = [];
    for (let i = 0; i < registryTags.length; i++) {
      if (registryTags[i].tag.toLowerCase().includes(search)) {
        filtered.push(registryTags[i]);
      }
    }
    return filtered;
  }, [registryTags, debouncedQuery]);

  // ─── Selected tag detail data ─────────────────────────────────────
  const selectedTagData = useMemo(() => {
    if (!selectedTag) return null;
    let tagItem = null;
    for (let i = 0; i < registryTags.length; i++) {
      if (registryTags[i].tag === selectedTag) { tagItem = registryTags[i]; break; }
    }
    if (!tagItem) return null;

    const byClass = {};
    const occs = tagItem.occurrences;
    for (let i = 0; i < occs.length; i++) {
      const cls = occs[i].className;
      if (!byClass[cls]) byClass[cls] = [];
      byClass[cls].push(occs[i]);
    }
    return { tag: tagItem.tag, totalCount: occs.length, byClass };
  }, [selectedTag, registryTags]);

  // ─── Get columns for a specific class ─────────────────────────────
  const getColumnsForClass = useCallback((className) => {
    const classes = project?.classes || [];
    let rootClass = null;
    for (let i = 0; i < classes.length; i++) {
      if (classes[i].name === className && !classes[i].parentId) { rootClass = classes[i]; break; }
    }

    const cols = [];
    if (rootClass) {
      for (let i = 0; i < classes.length; i++) {
        if (classes[i].parentId === rootClass.id) {
          cols.push({ id: `subclass_${classes[i].name}`, name: classes[i].name, isSubclass: true, subclassName: classes[i].name });
        }
      }
    }
    if (cols.length === 0) {
      cols.push({ id: 'ocr_text', name: 'Tag' });
    }

    const customCols = project?.classColumns?.[className] || [];
    for (let i = 0; i < customCols.length; i++) {
      cols.push({ id: customCols[i].id, name: customCols[i].name, isCustom: true });
    }
    cols.push({ id: 'filename', name: 'Document' }, { id: 'page', name: 'Page' }, { id: 'confidence', name: 'Confidence' });
    return cols;
  }, [project?.classes, project?.classColumns]);

  // ─── Registry cell value ──────────────────────────────────────────
  const getRegistryCellValue = useCallback((occ, columnId) => {
    if (columnId === 'filename') return occ.filename;
    if (columnId === 'page') return occ.page;
    if (columnId === 'confidence') return occ.confidence ? `${(occ.confidence * 100).toFixed(0)}%` : '-';
    if (columnId === 'ocr_text') return occ.obj?.ocr_text || '-';
    if (columnId.startsWith('subclass_')) return occ.subclassValues?.[columnId.replace('subclass_', '')] || '-';
    return occ.customData?.[columnId] || occ.obj?.[columnId] || '-';
  }, []);

  return {
    registryFilter, setRegistryFilter,
    registrySearchQuery, setRegistrySearchQuery,
    selectedTag, setSelectedTag,
    registryFilterOptions, registryTags, filteredRegistryTags,
    smartSearchResults, selectedTagData,
    getColumnsForClass, getRegistryCellValue,
  };
}
