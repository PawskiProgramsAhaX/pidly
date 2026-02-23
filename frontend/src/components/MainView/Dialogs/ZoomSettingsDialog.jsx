/**
 * ZoomSettingsDialog.jsx (PDFViewer version)
 * 
 * Popup dialog for zoom, navigation, and guide settings.
 * All values persist to localStorage (shared key with InfiniteView).
 * Place in: PDFViewer/Dialogs/ZoomSettingsDialog.jsx
 */
import React from 'react';

const STORAGE_KEY = 'pdfv-zoom-settings';

// Default settings
export const DEFAULT_ZOOM_SETTINGS = {
  zoomSensitivity: 1,       // 0.2 – 3
  scrollDirection: 'natural', // 'natural' | 'inverted'
  zoomTarget: 'cursor',      // 'cursor' | 'center'
  smoothZoom: true,
  showCrosshairs: false,
  showCoordinates: false,
  scrollPanSpeed: 1,         // 0.2 – 3
  doubleClickZoom: 2,        // 1.5, 2, 3, 4
};

export function loadZoomSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_ZOOM_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_ZOOM_SETTINGS };
}

export function saveZoomSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export default function ZoomSettingsDialog({ settings, onChange, onClose }) {
  const update = (key, value) => {
    const next = { ...settings, [key]: value };
    onChange(next);
    saveZoomSettings(next);
  };

  const reset = () => {
    onChange({ ...DEFAULT_ZOOM_SETTINGS });
    saveZoomSettings(DEFAULT_ZOOM_SETTINGS);
  };

  return (
    <div className="pdfv-dialog-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pdfv-dialog">
        <div className="pdfv-dialog-header">
          <h3>Zoom &amp; Navigation Settings</h3>
          <button className="pdfv-dialog-close" onClick={onClose}>×</button>
        </div>

        <div className="pdfv-dialog-body">
          {/* ── Zoom ── */}
          <div className="pdfv-settings-group">
            <div className="pdfv-settings-group-title">Zoom</div>

            <div className="pdfv-setting-row">
              <label>Zoom sensitivity</label>
              <div className="pdfv-setting-control">
                <span className="pdfv-setting-hint">Slow</span>
                <input
                  type="range" min="0.2" max="3" step="0.1"
                  value={settings.zoomSensitivity}
                  onChange={(e) => update('zoomSensitivity', parseFloat(e.target.value))}
                />
                <span className="pdfv-setting-hint">Fast</span>
                <span className="pdfv-setting-value">{settings.zoomSensitivity.toFixed(1)}×</span>
              </div>
            </div>

            <div className="pdfv-setting-row">
              <label>Scroll direction</label>
              <div className="pdfv-setting-control">
                <button
                  className={`pdfv-setting-chip ${settings.scrollDirection === 'natural' ? 'active' : ''}`}
                  onClick={() => update('scrollDirection', 'natural')}
                >Natural</button>
                <button
                  className={`pdfv-setting-chip ${settings.scrollDirection === 'inverted' ? 'active' : ''}`}
                  onClick={() => update('scrollDirection', 'inverted')}
                >Inverted</button>
              </div>
            </div>

            <div className="pdfv-setting-row">
              <label>Zoom towards</label>
              <div className="pdfv-setting-control">
                <button
                  className={`pdfv-setting-chip ${settings.zoomTarget === 'cursor' ? 'active' : ''}`}
                  onClick={() => update('zoomTarget', 'cursor')}
                >Cursor</button>
                <button
                  className={`pdfv-setting-chip ${settings.zoomTarget === 'center' ? 'active' : ''}`}
                  onClick={() => update('zoomTarget', 'center')}
                >Screen center</button>
              </div>
            </div>

            <div className="pdfv-setting-row">
              <label>Smooth zoom</label>
              <div className="pdfv-setting-control">
                <label className="pdfv-toggle-switch">
                  <input
                    type="checkbox"
                    checked={settings.smoothZoom}
                    onChange={(e) => update('smoothZoom', e.target.checked)}
                  />
                  <span className="pdfv-toggle-track" />
                </label>
              </div>
            </div>
          </div>

          {/* ── Navigation ── */}
          <div className="pdfv-settings-group">
            <div className="pdfv-settings-group-title">Navigation</div>

            <div className="pdfv-setting-row">
              <label>Pan speed</label>
              <div className="pdfv-setting-control">
                <span className="pdfv-setting-hint">Slow</span>
                <input
                  type="range" min="0.2" max="3" step="0.1"
                  value={settings.scrollPanSpeed}
                  onChange={(e) => update('scrollPanSpeed', parseFloat(e.target.value))}
                />
                <span className="pdfv-setting-hint">Fast</span>
                <span className="pdfv-setting-value">{settings.scrollPanSpeed.toFixed(1)}×</span>
              </div>
            </div>

            <div className="pdfv-setting-row">
              <label>Double-click zoom</label>
              <div className="pdfv-setting-control">
                {[1.5, 2, 3, 4].map(v => (
                  <button
                    key={v}
                    className={`pdfv-setting-chip ${settings.doubleClickZoom === v ? 'active' : ''}`}
                    onClick={() => update('doubleClickZoom', v)}
                  >{v}×</button>
                ))}
              </div>
            </div>
          </div>

          {/* ── Guides ── */}
          <div className="pdfv-settings-group">
            <div className="pdfv-settings-group-title">Guides</div>

            <div className="pdfv-setting-row">
              <label>Crosshairs</label>
              <div className="pdfv-setting-control">
                <label className="pdfv-toggle-switch">
                  <input
                    type="checkbox"
                    checked={settings.showCrosshairs}
                    onChange={(e) => update('showCrosshairs', e.target.checked)}
                  />
                  <span className="pdfv-toggle-track" />
                </label>
              </div>
            </div>

            <div className="pdfv-setting-row">
              <label>Show coordinates</label>
              <div className="pdfv-setting-control">
                <label className="pdfv-toggle-switch">
                  <input
                    type="checkbox"
                    checked={settings.showCoordinates}
                    onChange={(e) => update('showCoordinates', e.target.checked)}
                  />
                  <span className="pdfv-toggle-track" />
                </label>
              </div>
            </div>
          </div>
        </div>

        <div className="pdfv-dialog-footer">
          <button className="pdfv-dialog-btn secondary" onClick={reset}>Reset to Defaults</button>
          <button className="pdfv-dialog-btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
