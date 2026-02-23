/**
 * Dialogs/index.js
 * 
 * Barrel export for all dialog and context menu components.
 * Import like: import { AssignDialog, HotspotContextMenu } from './Dialogs';
 */

export { default as AssignDialog } from './AssignDialog';
export { default as HotspotContextMenu } from './HotspotContextMenu';
export { default as MarkupContextMenu } from './MarkupContextMenu';
export { default as NoteDialog } from './NoteDialog';
export { default as SaveSymbolDialog } from './SaveSymbolDialog';
export { default as RegionAssignDialog } from './RegionAssignDialog';
export { default as RegionEditDialog } from './RegionEditDialog';
export { default as ObjectClassDialog } from './ObjectClassDialog';
export { default as ZoomSettingsDialog, loadZoomSettings, saveZoomSettings } from './ZoomSettingsDialog';
