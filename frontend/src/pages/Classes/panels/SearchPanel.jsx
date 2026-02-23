/**
 * Smart Search / Object Search panel.
 * Full-text search across all objects, classes, tags, subclasses, and custom columns.
 */
import { memo, useMemo } from 'react';

export default function SearchPanel({
  registrySearchQuery, setRegistrySearchQuery,
  smartSearchResults,
  getColumnsForClass,
  classes, setSelectedClass, setViewMode,
}) {
  // Pre-compute flattened results list to avoid re-creating in render
  const flatResults = useMemo(() => {
    if (!smartSearchResults?.byClass) return [];
    const results = [];
    const entries = Object.entries(smartSearchResults.byClass);
    for (let i = 0; i < entries.length; i++) {
      const [className, classResults] = entries[i];
      const classColumns = getColumnsForClass(className);
      for (let j = 0; j < classResults.length; j++) {
        results.push({ result: classResults[j], className, classColumns });
      }
    }
    return results;
  }, [smartSearchResults, getColumnsForClass]);

  return (
    <div className="smart-search-view" style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#1a1a1a' }}>
      {/* Search Header */}
      <div style={{ padding: '16px 40px 20px', borderBottom: '1px solid #333', background: '#1e1e1e' }}>
        <h2 style={{ color: '#fff', fontWeight: 700, margin: '0 0 8px', fontSize: '24px' }}>Object Search</h2>
        <p style={{ color: '#888', margin: '0 0 20px', fontSize: '14px' }}>Search across all classes, tags, subclasses, and custom columns</p>

        {/* Search Input */}
        <div style={{ position: 'relative', maxWidth: '600px' }}>
          <input
            type="text"
            placeholder="Search for tags, equipment IDs, values..."
            value={registrySearchQuery}
            onChange={(e) => setRegistrySearchQuery(e.target.value)}
            autoFocus
            style={{
              width: '100%', padding: '14px 20px 14px 48px', fontSize: '16px',
              background: '#2a2a2a', border: '2px solid #3a3a3a', borderRadius: '10px',
              color: '#fff', outline: 'none', transition: 'border-color 0.2s',
            }}
            onFocus={(e) => e.target.style.borderColor = '#3498db'}
            onBlur={(e) => e.target.style.borderColor = '#3a3a3a'}
          />
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2"
            style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)' }}>
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          {registrySearchQuery && (
            <button
              onClick={() => setRegistrySearchQuery('')}
              style={{
                position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
                background: '#444', border: 'none', borderRadius: '50%',
                width: '24px', height: '24px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888',
              }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Search Results */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px 40px' }}>
        {!registrySearchQuery.trim() ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '300px', color: '#666' }}>
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ marginBottom: '16px', opacity: 0.5 }}>
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <h3 style={{ margin: '0 0 8px', fontWeight: 600, color: '#888' }}>Start Searching</h3>
            <p style={{ margin: 0, fontSize: '14px', textAlign: 'center', maxWidth: '400px' }}>
              Enter a tag, equipment ID, or any value to find matching objects across all classes
            </p>
          </div>
        ) : smartSearchResults && smartSearchResults.totalCount === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '300px', color: '#666' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.5 }}>🔍</div>
            <h3 style={{ margin: '0 0 8px', fontWeight: 600, color: '#888' }}>No Results Found</h3>
            <p style={{ margin: 0, fontSize: '14px', color: '#666' }}>No objects match "{registrySearchQuery}"</p>
          </div>
        ) : smartSearchResults ? (
          <>
            <div style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ color: '#fff', fontWeight: 600, fontSize: '16px' }}>
                {smartSearchResults.totalCount} result{smartSearchResults.totalCount !== 1 ? 's' : ''}
              </span>
              <span style={{ color: '#666', fontSize: '14px' }}>for "{smartSearchResults.query}"</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {flatResults.map(({ result, className, classColumns }, idx) => (
                <SearchResultCard
                  key={result.obj?.id || `${className}-${idx}`}
                  result={result}
                  className={className}
                  classColumns={classColumns}
                  searchQuery={registrySearchQuery}
                  onViewClass={() => {
                    const cls = classes.find(c => c.name === className);
                    if (cls) { setSelectedClass(cls); setViewMode('class'); }
                  }}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Individual search result card — memoised to avoid re-renders */
const SearchResultCard = memo(function SearchResultCard({ result, className, classColumns, searchQuery, onViewClass }) {
  return (
    <div style={{
      display: 'flex', gap: '20px', background: '#1e1e1e',
      borderRadius: '10px', border: '1px solid #333', overflow: 'hidden',
    }}>
      {/* Left: Matched Value */}
      <div style={{
        width: '200px', flexShrink: 0, padding: '20px', background: '#252525',
        display: 'flex', flexDirection: 'column', justifyContent: 'center', borderRight: '1px solid #333',
      }}>
        <div style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
          Matched in {result.matches[0]?.field || 'Tag'}
        </div>
        <div style={{ fontSize: '18px', fontWeight: 700, color: '#3498db', wordBreak: 'break-word' }}>
          {result.matches[0]?.value || result.tag || '-'}
        </div>
      </div>

      {/* Right: Class Card with all columns */}
      <div style={{ flex: 1, padding: '16px 20px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', paddingBottom: '10px', borderBottom: '1px solid #333' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3498db" strokeWidth="2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
            <line x1="12" y1="22.08" x2="12" y2="12" />
          </svg>
          <span style={{ fontWeight: 700, color: '#fff', fontSize: '14px' }}>{className}</span>
          <button
            onClick={onViewClass}
            style={{ marginLeft: 'auto', padding: '4px 10px', background: '#333', border: 'none', borderRadius: '4px', color: '#888', fontSize: '11px', cursor: 'pointer' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#3498db'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#333'; e.currentTarget.style.color = '#888'; }}
          >
            View Class →
          </button>
        </div>

        {/* Column Data Grid */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 24px' }}>
          {classColumns.map(col => {
            let value = '-';
            if (col.id === 'filename') value = result.filename;
            else if (col.id === 'page') value = result.page;
            else if (col.id === 'confidence') value = result.confidence ? `${(result.confidence * 100).toFixed(0)}%` : '-';
            else if (col.id === 'ocr_text') value = result.tag || '-';
            else if (col.isSubclass) value = result.subclassValues[col.subclassName] || '-';
            else if (col.isCustom) value = result.obj[col.id] || result.customData[col.id] || '-';

            const searchLower = searchQuery.toLowerCase();
            const isMatch = value.toString().toLowerCase().includes(searchLower);

            return (
              <div key={col.id} style={{ minWidth: '100px' }}>
                <div style={{ fontSize: '10px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
                  {col.name}
                </div>
                <div style={{
                  fontSize: '13px', fontWeight: 600,
                  color: isMatch ? '#3498db' : '#fff',
                  background: isMatch ? 'rgba(52, 152, 219, 0.15)' : 'transparent',
                  padding: isMatch ? '2px 6px' : '0',
                  borderRadius: '4px', display: 'inline-block',
                }}>
                  {value}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
