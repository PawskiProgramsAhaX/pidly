/**
 * pdfAnnotationUtils.js — PDF annotation parsing, extraction, and deletion utilities.
 *
 * Extracted from PDFViewerArea.jsx to reduce main component size.
 *
 * Exports:
 *   - extractRawAnnotationData(pdfArrayBuffer) — extract raw annotation properties via pdf-lib
 *   - deleteAnnotationsFromPdf(pdfArrayBuffer, annotationIdsToDelete) — remove annotations from PDF
 *   - parseAnnotationsFromPdf({ pdfDoc, currentFile, currentFileIdentifier, pdfUrl, debugAnnotations }) — parse PDF.js annotations into markup format
 */

// Helper function to extract raw annotation properties from PDF using pdf-lib
// This gives us access to CA/ca opacity values that PDF.js doesn't expose
async function extractRawAnnotationData(pdfArrayBuffer) {
  try {
    // Dynamically import pdf-lib
    const { PDFDocument, PDFName, PDFNumber, PDFArray, PDFDict, PDFRef } = await import('pdf-lib');
    const pdfDoc = await PDFDocument.load(pdfArrayBuffer, { ignoreEncryption: true });
    
    const rawAnnotationData = new Map(); // Map of "pageNum_annotIndex" -> { ca, CA, ... }
    
    const pages = pdfDoc.getPages();
    console.log(`  📋 Extracting from ${pages.length} pages...`);
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const page = pages[pageIndex];
      const annotsRef = page.node.get(PDFName.of('Annots'));
      
      if (!annotsRef) {
        if (pageIndex < 12) console.log(`  Page ${pageIndex + 1}: No Annots array`);
        continue;
      }
      
      // Resolve the reference if needed
      let annots = annotsRef;
      if (annotsRef instanceof PDFRef) {
        annots = pdfDoc.context.lookup(annotsRef);
      }
      
      if (!(annots instanceof PDFArray)) {
        if (pageIndex < 12) console.log(`  Page ${pageIndex + 1}: Annots not an array`);
        continue;
      }
      
      console.log(`  Page ${pageIndex + 1}: Extracting ${annots.size()} annotations`);
      
      for (let annotIndex = 0; annotIndex < annots.size(); annotIndex++) {
        try {
          const annotRef = annots.get(annotIndex);
          
          // Resolve the annotation dictionary
          let annotDict = annotRef;
          if (annotRef instanceof PDFRef) {
            annotDict = pdfDoc.context.lookup(annotRef);
          }
          
          if (!(annotDict instanceof PDFDict)) continue;
          
          // Extract annotation properties
          const rawData = {};
          
          // Get opacity values (CA = stroke opacity, ca = fill opacity in PDF spec)
          const caVal = annotDict.get(PDFName.of('CA'));
          const ca2Val = annotDict.get(PDFName.of('ca'));
          
          // Debug: log all keys for Polygon annotations
          const subtypeCheck = annotDict.get(PDFName.of('Subtype'));
          if (subtypeCheck && subtypeCheck.toString() === '/Polygon') {
            console.log(`  🔍 Polygon annotation ${pageIndex + 1}_${annotIndex} - all keys:`);
            // Try to enumerate dict entries
            if (annotDict.entries) {
              for (const [key, value] of annotDict.entries()) {
                console.log(`    ${key.toString()}: ${value?.toString?.()?.substring(0, 100) || typeof value}`);
              }
            }
          }
          
          if (caVal instanceof PDFNumber) {
            rawData.CA = caVal.asNumber();
            console.log(`    Page ${pageIndex + 1} annot ${annotIndex}: CA=${rawData.CA}`);
          }
          if (ca2Val instanceof PDFNumber) {
            rawData.ca = ca2Val.asNumber();
            console.log(`    Page ${pageIndex + 1} annot ${annotIndex}: ca=${rawData.ca}`);
          }
          
          // Bluebeam Revu uses FillOpacity instead of standard ca
          const fillOpacityVal = annotDict.get(PDFName.of('FillOpacity'));
          if (fillOpacityVal instanceof PDFNumber) {
            rawData.FillOpacity = fillOpacityVal.asNumber();
            console.log(`    Page ${pageIndex + 1} annot ${annotIndex}: FillOpacity=${rawData.FillOpacity}`);
            // Use FillOpacity as ca if ca not set
            if (rawData.ca === undefined) {
              rawData.ca = rawData.FillOpacity;
            }
          }
          
          // Get subtype for matching
          const subtypeVal = annotDict.get(PDFName.of('Subtype'));
          if (subtypeVal instanceof PDFName) {
            rawData.subtype = subtypeVal.asString();
          }
          
          // Get rect for position-based matching
          const rectVal = annotDict.get(PDFName.of('Rect'));
          if (rectVal instanceof PDFArray) {
            rawData.rect = [];
            for (let i = 0; i < rectVal.size(); i++) {
              const val = rectVal.get(i);
              if (val instanceof PDFNumber) {
                rawData.rect.push(val.asNumber());
              }
            }
          }
          
          // Get RD (Rectangle Differences) for Square/Circle annotations
          // RD tells us how much padding was added to the Rect beyond the actual shape bounds
          const rdVal = annotDict.get(PDFName.of('RD'));
          if (rdVal instanceof PDFArray) {
            rawData.RD = [];
            for (let i = 0; i < rdVal.size(); i++) {
              const val = rdVal.get(i);
              if (val instanceof PDFNumber) {
                rawData.RD.push(val.asNumber());
              }
            }
          }
          
          // Get Pidly custom properties for round-trip persistence
          const pidlyRotVal = annotDict.get(PDFName.of('PidlyRotation'));
          if (pidlyRotVal instanceof PDFNumber) {
            rawData.PidlyRotation = pidlyRotVal.asNumber();
          }
          const pidlyCloudRect = annotDict.get(PDFName.of('PidlyCloudRect'));
          if (pidlyCloudRect) {
            rawData.PidlyCloudRect = true;
          }
          const pidlyArcSize = annotDict.get(PDFName.of('PidlyArcSize'));
          if (pidlyArcSize instanceof PDFNumber) {
            rawData.PidlyArcSize = pidlyArcSize.asNumber();
          }
          const pidlyInverted = annotDict.get(PDFName.of('PidlyInverted'));
          if (pidlyInverted) {
            rawData.PidlyInverted = true;
          }
          const pidlyImageStamp = annotDict.get(PDFName.of('PidlyImageStamp'));
          if (pidlyImageStamp) {
            rawData.PidlyImageStamp = true;
          }
          
          // Get PidlyBaseRect — original un-expanded shape bounds for rotation round-trip
          const pidlyBaseRect = annotDict.get(PDFName.of('PidlyBaseRect'));
          if (pidlyBaseRect instanceof PDFArray) {
            rawData.PidlyBaseRect = [];
            for (let i = 0; i < pidlyBaseRect.size(); i++) {
              const val = pidlyBaseRect.get(i);
              if (val instanceof PDFNumber) {
                rawData.PidlyBaseRect.push(val.asNumber());
              }
            }
          }
          
          // Get NM (annotation name/ID) if available
          const nmVal = annotDict.get(PDFName.of('NM'));
          if (nmVal) {
            rawData.NM = nmVal.toString?.() || String(nmVal);
            // Clean parentheses from PDF string format: (value) -> value
            if (rawData.NM.startsWith('(') && rawData.NM.endsWith(')')) {
              rawData.NM = rawData.NM.slice(1, -1);
            }
          }
          
          // Extract textPosition JSON — custom field storing FreeText box properties
          // PDF.js does NOT expose custom fields, so we must extract from raw dict
          const tpVal = annotDict.get(PDFName.of('textPosition'));
          if (tpVal) {
            try {
              let tpStr = tpVal.toString?.() || String(tpVal);
              // Clean PDF string parentheses: (value) -> value
              if (tpStr.startsWith('(') && tpStr.endsWith(')')) {
                tpStr = tpStr.slice(1, -1);
              }
              // Unescape PDF string encoding
              tpStr = tpStr.replace(/\\n/g, '\n').replace(/\\r/g, '\r')
                          .replace(/\\\(/g, '(').replace(/\\\)/g, ')')
                          .replace(/\\\\/g, '\\');
              rawData.textPosition = JSON.parse(tpStr);
            } catch (e) {
              console.warn('Failed to parse textPosition JSON:', e);
            }
          }
          
          // Extract L (Line coordinates) — fallback if PDF.js doesn't provide lineCoordinates
          const lVal = annotDict.get(PDFName.of('L'));
          if (lVal) {
            try {
              const lArr = [];
              const lSize = lVal.size?.() || 0;
              for (let li = 0; li < lSize; li++) {
                const v = lVal.get(li);
                lArr.push(typeof v?.asNumber === 'function' ? v.asNumber() : parseFloat(String(v)));
              }
              if (lArr.length === 4 && lArr.every(v => !isNaN(v))) {
                rawData.L = lArr;
              }
            } catch (e) { /* ignore parse errors */ }
          }

          // Extract PidlyLineCoords — our exact normalized coords for line/arrow round-trip
          const plcVal = annotDict.get(PDFName.of('PidlyLineCoords'));
          if (plcVal) {
            try {
              let plcStr = plcVal.toString?.() || String(plcVal);
              if (plcStr.startsWith('(') && plcStr.endsWith(')')) plcStr = plcStr.slice(1, -1);
              rawData.PidlyLineCoords = JSON.parse(plcStr);
            } catch (e) { /* ignore parse errors */ }
          }

          // Extract arrowHeadSize — stored as numeric field on Line annotations
          const ahsVal = annotDict.get(PDFName.of('ArrowHeadSize'));
          if (ahsVal instanceof PDFNumber) {
            rawData.ArrowHeadSize = ahsVal.asNumber();
          }
          
          // ─── Metadata fields for history display ──────────────────────
          
          // /Subj - Human-readable annotation type from authoring software (e.g. "Cloud", "Text Box", "Line")
          // PDF.js does NOT expose this field
          const subjVal = annotDict.get(PDFName.of('Subj'));
          if (subjVal) {
            rawData.Subj = subjVal.toString?.() || String(subjVal);
            if (rawData.Subj.startsWith('(') && rawData.Subj.endsWith(')')) {
              rawData.Subj = rawData.Subj.slice(1, -1);
            }
          }
          
          // /T - Author/title (who created the annotation)
          const tVal = annotDict.get(PDFName.of('T'));
          if (tVal) {
            rawData.T = tVal.toString?.() || String(tVal);
            if (rawData.T.startsWith('(') && rawData.T.endsWith(')')) {
              rawData.T = rawData.T.slice(1, -1);
            }
          }
          
          // /CreationDate
          const cdVal = annotDict.get(PDFName.of('CreationDate'));
          if (cdVal) {
            rawData.CreationDate = cdVal.toString?.() || String(cdVal);
            if (rawData.CreationDate.startsWith('(') && rawData.CreationDate.endsWith(')')) {
              rawData.CreationDate = rawData.CreationDate.slice(1, -1);
            }
          }
          
          // /M - Modification date
          const mVal = annotDict.get(PDFName.of('M'));
          if (mVal) {
            rawData.M = mVal.toString?.() || String(mVal);
            if (rawData.M.startsWith('(') && rawData.M.endsWith(')')) {
              rawData.M = rawData.M.slice(1, -1);
            }
          }
          
          // /RC - Rich Content (contains software info in xfa:APIVersion for Bluebeam)
          const rcVal = annotDict.get(PDFName.of('RC'));
          if (rcVal) {
            const rcStr = rcVal.toString?.() || String(rcVal);
            // Extract software hint: xfa:APIVersion="BluebeamPDFRevu:2018"
            const apiMatch = rcStr.match(/xfa:APIVersion="([^"]+)"/);
            if (apiMatch) {
              rawData.software = apiMatch[1]; // e.g. "BluebeamPDFRevu:2018"
            }
          }
          
          // Get border effect for cloud detection and arc size
          const beVal = annotDict.get(PDFName.of('BE'));
          if (beVal instanceof PDFDict) {
            const beStyle = beVal.get(PDFName.of('S'));
            if (beStyle instanceof PDFName) {
              rawData.borderEffect = beStyle.asString();
            }
            // BE.I = intensity — standard cloud arc size (Bluebeam, Adobe use this)
            const beIntensity = beVal.get(PDFName.of('I'));
            if (beIntensity instanceof PDFNumber) {
              rawData.borderEffectIntensity = beIntensity.asNumber();
            }
          }
          
          // Get BS (Border Style) dict — extract D (dash array) for lineStyle
          // PDF.js may not always expose dashArray; raw extraction is more reliable
          const bsVal = annotDict.get(PDFName.of('BS'));
          if (bsVal instanceof PDFDict) {
            const bsDash = bsVal.get(PDFName.of('D'));
            if (bsDash instanceof PDFArray) {
              rawData.dashArray = [];
              for (let i = 0; i < bsDash.size(); i++) {
                const val = bsDash.get(i);
                if (val instanceof PDFNumber) {
                  rawData.dashArray.push(val.asNumber());
                }
              }
              console.log(`    Page ${pageIndex + 1} annot ${annotIndex}: BS.D=[${rawData.dashArray.join(', ')}]`);
            }
            // Also log BS.S for debugging
            const bsStyle = bsVal.get(PDFName.of('S'));
            if (bsStyle instanceof PDFName) {
              console.log(`    Page ${pageIndex + 1} annot ${annotIndex}: BS.S=${bsStyle.asString()}, BS.D=${rawData.dashArray ? 'present' : 'absent'}`);
            }
          }
          
          // Get Q (Quadding) — standard text alignment for FreeText annotations
          const qVal = annotDict.get(PDFName.of('Q'));
          if (qVal instanceof PDFNumber) {
            rawData.Q = qVal.asNumber();
          }
          
          // Get intent for cloud detection
          const itVal = annotDict.get(PDFName.of('IT'));
          if (itVal instanceof PDFName) {
            rawData.intent = itVal.asString();
            console.log(`    Page ${pageIndex + 1} annot ${annotIndex}: IT=${rawData.intent}`);
          } else if (itVal) {
            console.log(`    Page ${pageIndex + 1} annot ${annotIndex}: IT exists but not PDFName, type:`, typeof itVal, itVal.constructor?.name);
          }
          
          // Get interior color (IC) for fill color
          const icVal = annotDict.get(PDFName.of('IC'));
          if (icVal instanceof PDFArray) {
            rawData.IC = [];
            for (let i = 0; i < icVal.size(); i++) {
              const val = icVal.get(i);
              if (val instanceof PDFNumber) {
                rawData.IC.push(val.asNumber());
              }
            }
            console.log(`    Page ${pageIndex + 1} annot ${annotIndex}: IC=[${rawData.IC.join(', ')}]`);
          }
          
          // Get LineStyleName — Bluebeam custom property for named line styles
          // e.g. "Software", "Pneumatic", "Hydraulic" etc. (P&ID signal line conventions)
          const lineStyleNameVal = annotDict.get(PDFName.of('LineStyleName'));
          if (lineStyleNameVal) {
            let lsnStr = lineStyleNameVal.toString?.() || String(lineStyleNameVal);
            if (lsnStr.startsWith('(') && lsnStr.endsWith(')')) lsnStr = lsnStr.slice(1, -1);
            rawData.LineStyleName = lsnStr;
            console.log(`    Page ${pageIndex + 1} annot ${annotIndex}: LineStyleName="${lsnStr}"`);
          }
          
          // Get LineStyle — Bluebeam custom property defining the repeating pattern
          // Format: [false, [startOffset, dashLen, -gapLen, [char, fontName, fontSize, bold, italic, underline], -gapLen]]
          // The pattern repeats along the line path.
          const lineStyleVal = annotDict.get(PDFName.of('LineStyle'));
          if (lineStyleVal instanceof PDFArray) {
            try {
              // Parse the nested PDF array into a JS structure
              const parseLineStyleArray = (pdfArr) => {
                const result = [];
                for (let i = 0; i < pdfArr.size(); i++) {
                  const item = pdfArr.get(i);
                  if (item instanceof PDFNumber) {
                    result.push(item.asNumber());
                  } else if (item instanceof PDFArray) {
                    result.push(parseLineStyleArray(item));
                  } else if (item instanceof PDFName) {
                    result.push(item.asString());
                  } else {
                    // PDFBool, PDFString, etc.
                    let str = item?.toString?.() || String(item);
                    if (str === 'true') result.push(true);
                    else if (str === 'false') result.push(false);
                    else {
                      if (str.startsWith('(') && str.endsWith(')')) str = str.slice(1, -1);
                      result.push(str);
                    }
                  }
                }
                return result;
              };
              
              rawData.LineStyle = parseLineStyleArray(lineStyleVal);
              console.log(`    Page ${pageIndex + 1} annot ${annotIndex}: LineStyle=${JSON.stringify(rawData.LineStyle)}`);
              
              // Extract the structured pattern for easier consumption
              // Pattern: [false, [startOffset, dashLen, -gapLen, [char, font, size, bold, italic, underline], -gapLen]]
              if (rawData.LineStyle.length >= 2 && Array.isArray(rawData.LineStyle[1])) {
                const pattern = rawData.LineStyle[1];
                const parsed = {
                  startOffset: pattern[0] || 0,
                  segments: [],
                };
                for (let i = 1; i < pattern.length; i++) {
                  const seg = pattern[i];
                  if (typeof seg === 'number') {
                    if (seg > 0) {
                      parsed.segments.push({ type: 'dash', length: seg });
                    } else {
                      parsed.segments.push({ type: 'gap', length: Math.abs(seg) });
                    }
                  } else if (Array.isArray(seg)) {
                    // Text character segment: [char, fontName, fontSize, bold, italic, underline]
                    parsed.segments.push({
                      type: 'text',
                      char: seg[0] || '',
                      fontFamily: seg[1] || 'Helvetica',
                      fontSize: seg[2] || 9,
                      bold: seg[3] || false,
                      italic: seg[4] || false,
                      underline: seg[5] || false,
                    });
                  }
                }
                rawData.LineStylePattern = parsed;
                console.log(`    Page ${pageIndex + 1} annot ${annotIndex}: LineStylePattern=${JSON.stringify(parsed)}`);
              }
            } catch (lsErr) {
              console.warn(`    Failed to parse LineStyle on page ${pageIndex + 1} annot ${annotIndex}:`, lsErr);
            }
          }
          
          // Store with a key that can be matched later
          const key = `${pageIndex + 1}_${annotIndex}`;
          rawAnnotationData.set(key, rawData);
          
          // Also store by rect for fallback matching
          if (rawData.rect && rawData.rect.length === 4) {
            const rectKey = `${pageIndex + 1}_${rawData.rect.map(r => Math.round(r)).join('_')}`;
            rawAnnotationData.set(rectKey, rawData);
          }
        } catch (annotErr) {
          // Skip this annotation if we can't parse it
          console.warn(`Could not parse annotation ${annotIndex} on page ${pageIndex + 1}:`, annotErr);
        }
      }
    }
    
    return rawAnnotationData;
  } catch (error) {
    console.warn('Could not extract raw annotation data with pdf-lib:', error);
    return new Map();
  }
}

// Delete specific annotations from PDF and return new PDF bytes
async function deleteAnnotationsFromPdf(pdfArrayBuffer, annotationIdsToDelete) {
  if (!annotationIdsToDelete || annotationIdsToDelete.size === 0) {
    return null;
  }
  
  try {
    const { PDFDocument, PDFName, PDFArray, PDFRef } = await import('pdf-lib');
    const pdfDoc = await PDFDocument.load(pdfArrayBuffer, { ignoreEncryption: true });
    
    const pages = pdfDoc.getPages();
    let deletedCount = 0;
    
    // Extract the reference numbers from our annotation IDs (e.g., "pdf_text_145R" -> "145")
    const refNumbersToDelete = new Set();
    for (const id of annotationIdsToDelete) {
      // Extract the reference number from IDs like "pdf_text_145R", "pdf_line_123R", etc.
      const match = id.match(/_(\d+)R$/);
      if (match) {
        refNumbersToDelete.add(parseInt(match[1], 10));
      }
    }
    
    console.log('Deleting annotations with ref numbers:', [...refNumbersToDelete]);
    
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const page = pages[pageIndex];
      const annotsRef = page.node.get(PDFName.of('Annots'));
      
      if (!annotsRef) continue;
      
      let annots = annotsRef;
      if (annotsRef instanceof PDFRef) {
        annots = pdfDoc.context.lookup(annotsRef);
      }
      
      if (!(annots instanceof PDFArray)) continue;
      
      // Build new annotations array without deleted ones
      const newAnnots = [];
      for (let i = 0; i < annots.size(); i++) {
        const annotRef = annots.get(i);
        let shouldDelete = false;
        
        if (annotRef instanceof PDFRef) {
          const objNum = annotRef.objectNumber;
          if (refNumbersToDelete.has(objNum)) {
            shouldDelete = true;
            deletedCount++;
            console.log('Deleting annotation with object number:', objNum);
          }
        }
        
        if (!shouldDelete) {
          newAnnots.push(annotRef);
        }
      }
      
      // Update the page's annotations array if we deleted any
      if (newAnnots.length !== annots.size()) {
        if (newAnnots.length === 0) {
          page.node.delete(PDFName.of('Annots'));
        } else {
          const newAnnotsArray = pdfDoc.context.obj(newAnnots);
          page.node.set(PDFName.of('Annots'), newAnnotsArray);
        }
      }
    }
    
    if (deletedCount === 0) {
      console.log('No annotations matched for deletion');
      return null;
    }
    
    console.log(`Deleted ${deletedCount} annotations from PDF`);
    const modifiedPdfBytes = await pdfDoc.save();
    return modifiedPdfBytes;
    
  } catch (error) {
    console.error('Error deleting annotations from PDF:', error);
    return null;
  }
}

// Make utilities available for import
/**
 * Strip ALL annotations from a PDF's bytes.
 * Used after saving markups to PDF so we can reload a clean background
 * while keeping our markup objects in the SVG layer.
 *
 * @param {ArrayBuffer|Uint8Array} pdfBytes — the PDF to strip
 * @returns {Promise<Uint8Array|null>} modified PDF bytes with no annotations, or null on failure
 */
async function stripAllAnnotations(pdfBytes) {
  try {
    const { PDFDocument, PDFName } = await import('pdf-lib');
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const pages = pdfDoc.getPages();
    let totalRemoved = 0;

    for (const page of pages) {
      const annotsRef = page.node.get(PDFName.of('Annots'));
      if (annotsRef) {
        page.node.delete(PDFName.of('Annots'));
        totalRemoved++;
      }
    }

    if (totalRemoved === 0) {
      console.log('stripAllAnnotations: no annotations found');
      return null;
    }

    console.log(`stripAllAnnotations: stripped annotations from ${totalRemoved} pages`);
    return await pdfDoc.save();
  } catch (error) {
    console.error('Error stripping annotations from PDF:', error);
    return null;
  }
}

export { extractRawAnnotationData, deleteAnnotationsFromPdf, stripAllAnnotations };

/**
 * Parse all annotations from a PDF document into our internal markup format.
 * Returns an array of markup objects (does NOT modify React state — caller handles that).
 *
 * @param {Object} params
 * @param {Object} params.pdfDoc           – loaded PDF.js document
 * @param {Object} params.currentFile      – current file object (for local file access)
 * @param {string} params.currentFileIdentifier – file identifier string
 * @param {string} params.pdfUrl           – URL of the PDF (for backend files)
 * @param {boolean} params.debugAnnotations – enable verbose annotation logging
 * @returns {Promise<Array>} Array of markup objects parsed from the PDF
 */

/**
 * APPROACH A: Extract embedded images directly from annotation appearance dictionaries via pdf-lib.
 * Checks Stamp annotations AND any other annotations whose appearance contains embedded images
 * (e.g. image annotations from Bluebeam, custom annotation types with image content).
 * This is fast — just reading bytes already in the PDF, no rendering needed.
 * 
 * @param {ArrayBuffer} pdfArrayBuffer - raw PDF bytes
 * @returns {Promise<Map>} Map of "pageNum_annotIndex" → { imageDataUrl, width, height, subtype }
 */
async function extractAnnotationImagesFromPdfLib(pdfArrayBuffer) {
  const result = new Map();
  if (!pdfArrayBuffer) return result;
  
  // Only skip interactive/structural annotations that never contain visual image content
  const SKIP_SUBTYPES = new Set(['/Link', '/Widget', '/Popup']);
  
  try {
    const { PDFDocument, PDFName, PDFNumber, PDFArray, PDFDict, PDFRef } = await import('pdf-lib');
    const pdfDoc = await PDFDocument.load(pdfArrayBuffer, { ignoreEncryption: true });
    const pages = pdfDoc.getPages();
    
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const page = pages[pageIndex];
      const annotsRef = page.node.get(PDFName.of('Annots'));
      if (!annotsRef) continue;
      
      let annots = annotsRef;
      if (annotsRef instanceof PDFRef) annots = pdfDoc.context.lookup(annotsRef);
      if (!(annots instanceof PDFArray)) continue;
      
      for (let annotIndex = 0; annotIndex < annots.size(); annotIndex++) {
        try {
          let annotDict = annots.get(annotIndex);
          if (annotDict instanceof PDFRef) annotDict = pdfDoc.context.lookup(annotDict);
          if (!(annotDict instanceof PDFDict)) continue;
          
          // Check annotation subtype
          const subtype = annotDict.get(PDFName.of('Subtype'));
          const subtypeStr = subtype?.toString?.() || '';
          
          // Always extract from Stamps; for other types, skip ones we render natively as vectors
          if (SKIP_SUBTYPES.has(subtypeStr)) continue;
          
          // Traverse: /AP → /N (normal appearance)
          const ap = annotDict.get(PDFName.of('AP'));
          if (!ap) continue;
          let apDict = ap;
          if (ap instanceof PDFRef) apDict = pdfDoc.context.lookup(ap);
          if (!(apDict instanceof PDFDict)) continue;
          
          let normalAppearance = apDict.get(PDFName.of('N'));
          if (!normalAppearance) continue;
          if (normalAppearance instanceof PDFRef) normalAppearance = pdfDoc.context.lookup(normalAppearance);
          
          // The normal appearance should be a stream (Form XObject)
          // Check its /Resources → /XObject for embedded images
          let formDict = null;
          if (normalAppearance instanceof PDFDict) {
            formDict = normalAppearance;
          } else if (normalAppearance?.dict) {
            formDict = normalAppearance.dict;
          }
          if (!formDict) continue;
          
          let resources = formDict.get(PDFName.of('Resources'));
          if (resources instanceof PDFRef) resources = pdfDoc.context.lookup(resources);
          if (!(resources instanceof PDFDict)) continue;
          
          let xobjects = resources.get(PDFName.of('XObject'));
          if (xobjects instanceof PDFRef) xobjects = pdfDoc.context.lookup(xobjects);
          if (!(xobjects instanceof PDFDict)) continue;
          
          // Iterate XObject entries looking for images
          const entries = xobjects.entries ? [...xobjects.entries()] : [];
          
          for (const [name, ref] of entries) {
            try {
              let imageStream = ref;
              if (ref instanceof PDFRef) imageStream = pdfDoc.context.lookup(ref);
              if (!imageStream) continue;
              
              const imgDict = imageStream.dict || imageStream;
              const imgSubtype = imgDict.get(PDFName.of('Subtype'));
              if (!imgSubtype || imgSubtype.toString() !== '/Image') continue;
              
              // Found an image — check its filter for encoding
              const filter = imgDict.get(PDFName.of('Filter'));
              const filterStr = filter?.toString?.() || '';
              
              const widthVal = imgDict.get(PDFName.of('Width'));
              const heightVal = imgDict.get(PDFName.of('Height'));
              const imgWidth = widthVal instanceof PDFNumber ? widthVal.asNumber() : 0;
              const imgHeight = heightVal instanceof PDFNumber ? heightVal.asNumber() : 0;
              
              if (imgWidth < 2 || imgHeight < 2) continue;
              
              // Extract raw bytes from the stream
              let rawBytes = null;
              if (typeof imageStream.getContents === 'function') {
                rawBytes = imageStream.getContents();
              } else if (typeof imageStream.contents === 'object') {
                rawBytes = imageStream.contents;
              }
              
              if (!rawBytes || rawBytes.length < 10) continue;
              
              let imageDataUrl = null;
              const label = subtypeStr.replace('/', '') || 'Annot';
              
              if (filterStr.includes('/DCTDecode')) {
                // JPEG — raw bytes are the JPEG file
                const base64 = uint8ArrayToBase64(rawBytes);
                imageDataUrl = `data:image/jpeg;base64,${base64}`;
                console.log(`  🖼️ [pdf-lib] Page ${pageIndex + 1} ${label} ${annotIndex}: JPEG ${imgWidth}×${imgHeight}`);
              } else if (filterStr.includes('/FlateDecode')) {
                // Compressed raw pixels — render to canvas
                imageDataUrl = rawPixelsToDataUrl(rawBytes, imgWidth, imgHeight, imgDict, PDFName, PDFNumber);
                if (imageDataUrl) {
                  console.log(`  🖼️ [pdf-lib] Page ${pageIndex + 1} ${label} ${annotIndex}: FlateDecode ${imgWidth}×${imgHeight}`);
                }
              } else if (filterStr === '' && rawBytes.length >= imgWidth * imgHeight * 3) {
                // Uncompressed raw pixels
                imageDataUrl = rawPixelsToDataUrl(rawBytes, imgWidth, imgHeight, imgDict, PDFName, PDFNumber);
                if (imageDataUrl) {
                  console.log(`  🖼️ [pdf-lib] Page ${pageIndex + 1} ${label} ${annotIndex}: Raw ${imgWidth}×${imgHeight}`);
                }
              }
              
              if (imageDataUrl) {
                const key = `${pageIndex + 1}_${annotIndex}`;
                result.set(key, { imageDataUrl, width: imgWidth, height: imgHeight, subtype: subtypeStr });
                break; // One image per annotation is enough
              }
            } catch (imgErr) {
              // Skip this xobject
            }
          }
        } catch (annotErr) {
          // Skip this annotation
        }
      }
    }
  } catch (err) {
    console.warn('extractAnnotationImagesFromPdfLib failed:', err);
  }
  
  return result;
}

/** Convert Uint8Array to base64 string */
function uint8ArrayToBase64(bytes) {
  let binary = '';
  const len = bytes.length;
  // Process in chunks to avoid call stack overflow on large arrays
  const CHUNK = 8192;
  for (let i = 0; i < len; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, len));
    for (let j = 0; j < slice.length; j++) {
      binary += String.fromCharCode(slice[j]);
    }
  }
  return btoa(binary);
}

/** Convert raw pixel bytes to a data URL via canvas */
function rawPixelsToDataUrl(pixelData, width, height, imgDict, PDFName, PDFNumber) {
  try {
    const bitsPerComponent = imgDict.get(PDFName.of('BitsPerComponent'));
    const bpc = bitsPerComponent instanceof PDFNumber ? bitsPerComponent.asNumber() : 8;
    if (bpc !== 8) return null; // Only handle 8-bit
    
    const colorSpace = imgDict.get(PDFName.of('ColorSpace'));
    const csStr = colorSpace?.toString?.() || '/DeviceRGB';
    
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(width, height);
    
    const totalPixels = width * height;
    
    if (csStr.includes('DeviceGray') || csStr.includes('CalGray') || pixelData.length === totalPixels) {
      for (let i = 0; i < totalPixels; i++) {
        const gray = pixelData[i] || 0;
        imageData.data[i * 4] = gray;
        imageData.data[i * 4 + 1] = gray;
        imageData.data[i * 4 + 2] = gray;
        imageData.data[i * 4 + 3] = 255;
      }
    } else if (pixelData.length >= totalPixels * 3) {
      for (let i = 0; i < totalPixels; i++) {
        imageData.data[i * 4] = pixelData[i * 3] || 0;
        imageData.data[i * 4 + 1] = pixelData[i * 3 + 1] || 0;
        imageData.data[i * 4 + 2] = pixelData[i * 3 + 2] || 0;
        imageData.data[i * 4 + 3] = 255;
      }
    } else {
      canvas.width = 0;
      return null;
    }
    
    ctx.putImageData(imageData, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    canvas.width = 0;
    return dataUrl;
  } catch (e) {
    return null;
  }
}

/**
 * Create a copy of the PDF with only image-bearing annotations (Stamps + others with image content).
 * All vector annotation types (lines, circles, text, highlights, etc.) are removed.
 * Used for clean image-only rendering in the diff fallback.
 * 
 * @param {ArrayBuffer} pdfArrayBuffer - original PDF bytes
 * @param {Set<string>} imageAnnotKeys - set of "pageNum_annotIndex" keys that have extracted images
 * @returns {Promise<Uint8Array|null>} modified PDF bytes or null on failure
 */
async function createImageAnnotsOnlyPdf(pdfArrayBuffer, imageAnnotKeys) {
  try {
    const { PDFDocument, PDFName, PDFArray, PDFDict, PDFRef } = await import('pdf-lib');
    const pdfDoc = await PDFDocument.load(pdfArrayBuffer, { ignoreEncryption: true });
    const pages = pdfDoc.getPages();
    
    // Subtypes we render as vector SVG — REMOVE these from the diff PDF
    const VECTOR_SUBTYPES = new Set([
      '/Line', '/Square', '/Circle', '/Polygon', '/PolyLine',
      '/Ink', '/FreeText', '/Text',
      '/Highlight', '/Underline', '/StrikeOut', '/Squiggly',
      '/Link', '/Widget', '/Popup',
      '/Caret', '/Sound', '/Redact',
    ]);
    
    let removedCount = 0;
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const page = pages[pageIndex];
      const annotsRef = page.node.get(PDFName.of('Annots'));
      if (!annotsRef) continue;
      
      let annots = annotsRef;
      if (annotsRef instanceof PDFRef) annots = pdfDoc.context.lookup(annotsRef);
      if (!(annots instanceof PDFArray)) continue;
      
      const keepIndices = [];
      for (let i = 0; i < annots.size(); i++) {
        let annotDict = annots.get(i);
        if (annotDict instanceof PDFRef) annotDict = pdfDoc.context.lookup(annotDict);
        if (!(annotDict instanceof PDFDict)) continue;
        
        const subtype = annotDict.get(PDFName.of('Subtype'));
        const subtypeStr = subtype?.toString?.() || '';
        const key = `${pageIndex + 1}_${i}`;
        
        // Keep if: NOT a vector type, OR pdf-lib found an image in it
        if (!VECTOR_SUBTYPES.has(subtypeStr) || imageAnnotKeys.has(key)) {
          keepIndices.push(i);
        } else {
          removedCount++;
        }
      }
      
      if (keepIndices.length < annots.size()) {
        const newAnnots = pdfDoc.context.obj([]);
        for (const idx of keepIndices) {
          newAnnots.push(annots.get(idx));
        }
        page.node.set(PDFName.of('Annots'), newAnnots);
      }
    }
    
    console.log(`  🔧 Created image-annots-only PDF (removed ${removedCount} non-image annotations)`);
    return await pdfDoc.save();
  } catch (err) {
    console.warn('Failed to create image-annots-only PDF:', err);
    return null;
  }
}

/**
 * APPROACH B (fallback): Double-render diff to isolate annotation image appearance.
 * Renders the original page without annotations, then renders from an image-annots-only
 * PDF (all vector annotations removed), and diffs to extract just the image pixels
 * with transparent background. Works for Stamps and any other image-bearing annotation.
 * 
 * @param {Object} originalPage - PDF.js page from original document (for clean render)
 * @param {Object} imageAnnotsPage - PDF.js page from image-annots-only document
 * @param {Array} imageAnnotations - annotations needing diff extraction
 * @returns {Promise<Map>} Map of annotation id → { imageDataUrl, originalWidth, originalHeight }
 */
async function extractAnnotationImagesByDiff(originalPage, imageAnnotsPage, imageAnnotations) {
  if (!imageAnnotations || imageAnnotations.length === 0) return new Map();
  
  const RENDER_SCALE = 2;
  const viewport = originalPage.getViewport({ scale: RENDER_SCALE, rotation: 0 });
  
  const canvasClean = document.createElement('canvas');
  canvasClean.width = viewport.width;
  canvasClean.height = viewport.height;
  const ctxClean = canvasClean.getContext('2d');
  
  const canvasImgAnnots = document.createElement('canvas');
  canvasImgAnnots.width = viewport.width;
  canvasImgAnnots.height = viewport.height;
  const ctxImgAnnots = canvasImgAnnots.getContext('2d');
  
  try {
    // Render original page WITHOUT any annotations
    await originalPage.render({
      canvasContext: ctxClean,
      viewport,
      annotationMode: 0,
    }).promise;
    
    // Render image-annots-only page WITH annotations (only image annotations exist)
    await imageAnnotsPage.render({
      canvasContext: ctxImgAnnots,
      viewport,
      annotationMode: 2,
    }).promise;
  } catch (err) {
    console.warn('Failed to render pages for stamp diff extraction:', err);
    canvasClean.width = 0; canvasImgAnnots.width = 0;
    return new Map();
  }
  
  const result = new Map();
  
  for (const annot of imageAnnotations) {
    try {
      if (!annot.rect || annot.rect.length < 4) continue;
      
      const [pdfX1, pdfY1, pdfX2, pdfY2] = annot.rect;
      const [vx1, vy1] = viewport.convertToViewportPoint(pdfX1, pdfY1);
      const [vx2, vy2] = viewport.convertToViewportPoint(pdfX2, pdfY2);
      
      const x = Math.max(0, Math.floor(Math.min(vx1, vx2)));
      const y = Math.max(0, Math.floor(Math.min(vy1, vy2)));
      const w = Math.min(canvasClean.width - x, Math.ceil(Math.abs(vx2 - vx1)));
      const h = Math.min(canvasClean.height - y, Math.ceil(Math.abs(vy2 - vy1)));
      
      if (w < 2 || h < 2) continue;
      
      // Get pixel data from clean render and image-annots-only render
      const cleanPixels = ctxClean.getImageData(x, y, w, h);
      const imgAnnotPixels = ctxImgAnnots.getImageData(x, y, w, h);
      
      // Build diff: differing pixels → annotation content; same → transparent
      const diffCanvas = document.createElement('canvas');
      diffCanvas.width = w;
      diffCanvas.height = h;
      const diffCtx = diffCanvas.getContext('2d');
      const diffImageData = diffCtx.createImageData(w, h);
      
      let diffPixelCount = 0;
      const THRESHOLD = 5;
      
      for (let i = 0; i < cleanPixels.data.length; i += 4) {
        const dr = Math.abs(cleanPixels.data[i] - imgAnnotPixels.data[i]);
        const dg = Math.abs(cleanPixels.data[i + 1] - imgAnnotPixels.data[i + 1]);
        const db = Math.abs(cleanPixels.data[i + 2] - imgAnnotPixels.data[i + 2]);
        
        if (dr > THRESHOLD || dg > THRESHOLD || db > THRESHOLD) {
          diffImageData.data[i] = imgAnnotPixels.data[i];
          diffImageData.data[i + 1] = imgAnnotPixels.data[i + 1];
          diffImageData.data[i + 2] = imgAnnotPixels.data[i + 2];
          diffImageData.data[i + 3] = 255;
          diffPixelCount++;
        }
        // else: stays 0,0,0,0 (transparent)
      }
      
      const totalPixels = w * h;
      if (diffPixelCount < totalPixels * 0.005) {
        console.log(`  ⚠️ [diff] Stamp ${annot.id}: too few diff pixels (${diffPixelCount}/${totalPixels}), skipping`);
        diffCanvas.width = 0;
        continue;
      }
      
      diffCtx.putImageData(diffImageData, 0, 0);
      
      result.set(annot.id, {
        imageDataUrl: diffCanvas.toDataURL('image/png'),
        originalWidth: w,
        originalHeight: h,
      });
      
      console.log(`  🖼️ [diff] Captured stamp: ${w}×${h}px, ${diffPixelCount} diff pixels (annot ${annot.id})`);
      diffCanvas.width = 0;
    } catch (err) {
      console.warn(`Failed to diff-extract stamp ${annot.id}:`, err);
    }
  }
  
  canvasClean.width = 0; canvasClean.height = 0;
  canvasImgAnnots.width = 0; canvasImgAnnots.height = 0;
  
  return result;
}

export async function parseAnnotationsFromPdf({ pdfDoc, currentFile, currentFileIdentifier, pdfUrl, debugAnnotations = false }) {
  const loadedMarkups = [];
  const DEBUG_ANNOTATIONS = debugAnnotations;

  if (DEBUG_ANNOTATIONS) {
    console.log('=== Loading annotations from PDF ===');
    console.log('File:', currentFile?.name || currentFileIdentifier);
  }
      // Extract raw annotation data using pdf-lib to get properties PDF.js doesn't expose
      // This gives us access to CA/ca opacity values, border effects, etc.
      let rawAnnotationData = new Map();
      let pdfLibAnnotImages = new Map();
      let pdfArrayBuffer = null; // Hoisted for use in diff fallback
      let imageAnnotsPdfDoc = null; // Lazy: created only if diff fallback needed
      try {
        // Get the PDF array buffer
        if (currentFile?.file) {
          // Local file
          pdfArrayBuffer = await currentFile.file.arrayBuffer();
        } else if (pdfUrl) {
          // Backend file - fetch it
          const response = await fetch(pdfUrl);
          pdfArrayBuffer = await response.arrayBuffer();
        }
        
        if (pdfArrayBuffer) {
          rawAnnotationData = await extractRawAnnotationData(pdfArrayBuffer);
          console.log('📋 Extracted raw annotation data for', rawAnnotationData.size, 'annotations');
          
          // Also extract annotation images directly from pdf-lib (Approach A)
          pdfLibAnnotImages = await extractAnnotationImagesFromPdfLib(pdfArrayBuffer);
          if (pdfLibAnnotImages.size > 0) {
            console.log(`🖼️ [pdf-lib] Extracted ${pdfLibAnnotImages.size} annotation image(s) directly`);
          }
          
          // Log a sample of what we found (annotations with opacity)
          let opacityCount = 0;
          for (const [key, data] of rawAnnotationData) {
            if (data.CA !== undefined || data.ca !== undefined) {
              opacityCount++;
              if (opacityCount <= 5) {
                console.log(`  Raw annotation ${key}: CA=${data.CA}, ca=${data.ca}, subtype=${data.subtype}`);
              }
            }
          }
          if (opacityCount > 5) {
            console.log(`  ... and ${opacityCount - 5} more annotations with opacity`);
          }
          if (opacityCount === 0) {
            console.log('  No annotations with explicit opacity (CA/ca) found in PDF');
          }
        }
      } catch (rawErr) {
        console.warn('Could not extract raw annotation data:', rawErr);
      }
      
      // Load annotations from all pages
      for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        const annotations = await page.getAnnotations();
        // Use rotation=0 for consistent coordinate space (annotations are in unrotated space)
        const viewport = page.getViewport({ scale: 1, rotation: 0 });
        
        // Debug logging - only when DEBUG_ANNOTATIONS is true
        if (DEBUG_ANNOTATIONS) {
          console.log(`\n=== PAGE ${pageNum}: ${annotations.length} total annotations ===`);
          
          // Log ALL annotation subtypes found
          const subtypeCounts = {};
          annotations.forEach(a => {
            subtypeCounts[a.subtype] = (subtypeCounts[a.subtype] || 0) + 1;
          });
          console.log('Subtypes on this page:', subtypeCounts);
          
          // Log ALL Polygon annotations with FULL data
          const polygons = annotations.filter(a => a.subtype === 'Polygon');
          if (polygons.length > 0) {
            console.log(`\n🔴 FOUND ${polygons.length} POLYGON ANNOTATIONS! 🔴`);
            polygons.forEach((poly, i) => {
              console.log(`\n--- POLYGON ${i + 1} FULL DUMP ---`);
              console.log('All keys:', Object.keys(poly));
              Object.keys(poly).forEach(key => {
                try {
                  const val = poly[key];
                  if (typeof val === 'function') {
                    console.log(`  ${key}: [function]`);
                  } else if (val === null) {
                    console.log(`  ${key}: null`);
                  } else if (val === undefined) {
                    console.log(`  ${key}: undefined`);
                  } else if (typeof val === 'object') {
                    console.log(`  ${key}:`, JSON.stringify(val));
                  } else {
                    console.log(`  ${key}:`, val);
                  }
                } catch (e) {
                  console.log(`  ${key}: [error: ${e.message}]`);
                }
              });
            });
          } else {
            console.log('No Polygon annotations on this page');
          }
          
          if (annotations.length > 0) {
            console.log(`Page ${pageNum}: Found ${annotations.length} annotations`);
            
            // === DETAILED ANNOTATION DATA DUMP ===
            console.log(`\n========== PAGE ${pageNum} FULL ANNOTATION DATA ==========`);
            annotations.forEach((annot, idx) => {
              console.log(`\n--- Annotation ${idx + 1} (${annot.subtype}) ---`);
              console.log('ID:', annot.id);
              console.log('Subtype:', annot.subtype);
              console.log('Rect:', annot.rect);
              console.log('Color:', annot.color);
              console.log('InteriorColor:', annot.interiorColor);
              console.log('Opacity:', annot.opacity);
              console.log('CA (fill opacity):', annot.CA);
              console.log('ca (stroke opacity):', annot.ca);
              console.log('Border:', annot.border);
              console.log('BorderStyle:', annot.borderStyle);
              console.log('Rotation:', annot.rotation);
              console.log('HasAppearance:', annot.hasAppearance);
              console.log('Contents:', annot.contents);
              console.log('Title/Author:', annot.title);
              console.log('Subject:', annot.subject);
              console.log('CreationDate:', annot.creationDate);
              console.log('ModificationDate:', annot.modificationDate);
              
              // Type-specific properties
              if (annot.subtype === 'Line') {
                console.log('LineCoordinates:', annot.lineCoordinates);
                console.log('LineEndings:', annot.lineEndings);
              }
              if (annot.subtype === 'Ink') {
                console.log('InkLists:', annot.inkLists);
                console.log('Vertices:', annot.vertices);
              }
              if (annot.subtype === 'FreeText') {
                console.log('DefaultAppearanceData:', annot.defaultAppearanceData);
                console.log('RichText:', annot.richText);
                console.log('TextContent:', annot.textContent);
                console.log('TextPosition:', annot.textPosition);
                console.log('Quadding (alignment):', annot.quadding);
              }
              if (annot.subtype === 'Polygon' || annot.subtype === 'PolyLine') {
                console.log('Vertices:', annot.vertices);
              }
              if (annot.subtype === 'Highlight' || annot.subtype === 'Underline' || annot.subtype === 'StrikeOut') {
                console.log('QuadPoints:', annot.quadPoints);
              }
              if (annot.subtype === 'Stamp') {
                console.log('Name:', annot.name);
                console.log('AP:', annot.AP);
              }
              
              // Dump ALL properties for complete inspection
              console.log('--- ALL PROPERTIES ---');
              const allKeys = Object.keys(annot);
              allKeys.forEach(key => {
                const val = annot[key];
                if (val !== undefined && val !== null && typeof val !== 'function') {
                  try {
                    if (typeof val === 'object') {
                      console.log(`  ${key}:`, JSON.stringify(val, null, 2));
                    } else {
                      console.log(`  ${key}:`, val);
                    }
                  } catch (e) {
                    console.log(`  ${key}: [Cannot stringify - ${typeof val}]`);
                  }
                }
              });
            });
            console.log(`\n========== END PAGE ${pageNum} ==========\n`);
          }
        }
        
        // Extract annotation images from this page using hybrid approach:
        // 1. Check pdf-lib direct image extraction (already done, keyed by pageNum_annotIndex)
        // 2. For image annotations not found, fall back to double-render diff
        // Covers Stamps, image annotations, and any other annotation with embedded images
        let annotImages = new Map(); // annot.id → { imageDataUrl, originalWidth, originalHeight }
        
        // Identify which annotations on this page have images (from pdf-lib) or are Stamps,
        // or are non-vector annotations that could contain image content
        const imageAnnotationsOnPage = [];
        // Subtypes we already render natively as vector SVG markups — don't override these
        const VECTOR_RENDERED_SUBTYPES = new Set([
          'Line', 'Square', 'Circle', 'Polygon', 'PolyLine',
          'Ink', 'FreeText', 'Text',
          'Highlight', 'Underline', 'StrikeOut', 'Squiggly',
          'Link', 'Widget', 'Popup',
        ]);
        {
          let tempIdx = 0;
          for (const annot of annotations) {
            if (!annot.rect) { tempIdx++; continue; }
            const pdfLibKey = `${pageNum}_${tempIdx}`;
            const isStamp = annot.subtype === 'Stamp';
            const hasPdfLibImage = pdfLibAnnotImages.has(pdfLibKey);
            // Non-vector annotation that might contain image content (custom types, FileAttachment with images, etc.)
            const isNonVectorType = !VECTOR_RENDERED_SUBTYPES.has(annot.subtype);
            
            if (isStamp || hasPdfLibImage || isNonVectorType) {
              imageAnnotationsOnPage.push({ annot, annotIdx: tempIdx, hasPdfLibImage });
            }
            tempIdx++;
          }
        }
        
        if (imageAnnotationsOnPage.length > 0) {
          console.log(`🖼️ Page ${pageNum}: Processing ${imageAnnotationsOnPage.length} image annotation(s)...`);
          
          // Map pdf-lib results to annot.id keys
          const needsDiffFallback = [];
          for (const { annot, annotIdx, hasPdfLibImage } of imageAnnotationsOnPage) {
            if (hasPdfLibImage) {
              const pdfLibKey = `${pageNum}_${annotIdx}`;
              const pdfLibImage = pdfLibAnnotImages.get(pdfLibKey);
              annotImages.set(annot.id, {
                imageDataUrl: pdfLibImage.imageDataUrl,
                originalWidth: pdfLibImage.width,
                originalHeight: pdfLibImage.height,
              });
              const label = annot.subtype || 'Annot';
              console.log(`  ✅ [pdf-lib] ${label} ${annot.id}: direct image ${pdfLibImage.width}×${pdfLibImage.height}`);
            } else {
              // Stamp without embedded image → needs diff fallback
              needsDiffFallback.push(annot);
            }
          }
          
          // Approach B: diff fallback for annotations without embedded images
          // Uses a image-annots-only PDF (all vector annotations removed) for clean extraction
          if (needsDiffFallback.length > 0) {
            console.log(`  🔄 Page ${pageNum}: ${needsDiffFallback.length} annotation(s) need diff fallback...`);
            try {
              // Lazily create image-annots-only PDF.js document (once for all pages)
              if (!imageAnnotsPdfDoc && pdfArrayBuffer) {
                // Pass the set of keys that have images so those annotations are also kept
                const imageAnnotKeys = new Set(pdfLibAnnotImages.keys());
                const imageAnnotsBytes = await createImageAnnotsOnlyPdf(pdfArrayBuffer, imageAnnotKeys);
                if (imageAnnotsBytes && window.pdfjsLib) {
                  imageAnnotsPdfDoc = await window.pdfjsLib.getDocument({ data: imageAnnotsBytes, verbosity: 0 }).promise;
                  console.log(`  📄 Loaded image-annots-only PDF (${imageAnnotsPdfDoc.numPages} pages)`);
                }
              }
              
              if (imageAnnotsPdfDoc) {
                const imageAnnotsPage = await imageAnnotsPdfDoc.getPage(pageNum);
                const diffResults = await extractAnnotationImagesByDiff(page, imageAnnotsPage, needsDiffFallback);
                for (const [annotId, imageData] of diffResults) {
                  annotImages.set(annotId, imageData);
                }
                console.log(`  🖼️ Page ${pageNum}: Diff captured ${diffResults.size} annotation(s)`);
              } else {
                console.warn(`  ⚠️ Page ${pageNum}: Could not create image-annots-only PDF for diff fallback`);
              }
            } catch (err) {
              console.warn(`  Failed diff extraction on page ${pageNum}:`, err);
            }
          }
          
          console.log(`🖼️ Page ${pageNum}: Total ${annotImages.size}/${imageAnnotationsOnPage.length} image annotations extracted`);
        }
        
        let annotIndex = 0;  // Track index for raw data lookup
        for (const annot of annotations) {
          // Skip link annotations and other non-markup types
          if (!annot.rect || annot.subtype === 'Link' || annot.subtype === 'Widget') {
            annotIndex++;
            continue;
          }
          
          // Skip annotation types we can't handle at all - PDF.js renders these
          // Note: Stamp is NOT skipped - we load it as read-only so it appears in markup list
          // Exception: if we extracted an image for any annotation, don't skip it
          const skipTypes = ['Caret', 'FileAttachment', 'Sound', 'Redact', 'Popup'];
          if (skipTypes.includes(annot.subtype) && !annotImages.has(annot.id)) {
            annotIndex++;
            continue;
          }
          
          // Look up raw annotation data from pdf-lib extraction
          // Try multiple keys: by index, by rect position
          const indexKey = `${pageNum}_${annotIndex}`;
          const rectKey = annot.rect ? `${pageNum}_${annot.rect.map(r => Math.round(r)).join('_')}` : null;
          let rawData = rawAnnotationData.get(indexKey) || (rectKey ? rawAnnotationData.get(rectKey) : null) || {};
          
          // Fallback for Polygon/PolyLine: if no match found, search by rect similarity
          if ((annot.subtype === 'Polygon' || annot.subtype === 'PolyLine') && !rawData.intent && annot.rect) {
            const [ax1, ay1, ax2, ay2] = annot.rect;
            for (const [key, data] of rawAnnotationData.entries()) {
              if (data.rect && data.subtype && data.subtype.includes(annot.subtype)) {
                const [rx1, ry1, rx2, ry2] = data.rect;
                // Check if rects are close (within 5 units)
                if (Math.abs(ax1 - rx1) < 5 && Math.abs(ay1 - ry1) < 5 && 
                    Math.abs(ax2 - rx2) < 5 && Math.abs(ay2 - ry2) < 5) {
                  console.log(`     ✅ Fallback match found via rect similarity: ${key}`);
                  rawData = data;
                  break;
                }
              }
            }
          }
          
          // Debug: show what keys we tried and if we found rawData
          if (annot.subtype === 'Polygon' || annot.subtype === 'PolyLine') {
            console.log(`  🔍 Looking up rawData for ${annot.subtype} ${annot.id}:`);
            console.log(`     indexKey: ${indexKey}, found: ${rawAnnotationData.has(indexKey)}`);
            console.log(`     rectKey: ${rectKey}, found: ${rectKey ? rawAnnotationData.has(rectKey) : 'N/A'}`);
            console.log(`     rawData.intent: ${rawData.intent}, rawData.IC: ${rawData.IC ? JSON.stringify(rawData.IC) : 'none'}`);
          }
          
          // Debug: show when we found raw data with opacity
          if (rawData.CA !== undefined || rawData.ca !== undefined) {
            console.log(`  📌 Found raw opacity for ${annot.subtype} ${annot.id}: CA=${rawData.CA}, ca=${rawData.ca}`);
          }
          
          // NOTE: We NO LONGER skip Polygon with hasAppearance
          // Cloud annotations (PolygonCloud) have appearance streams but we can recreate them
          // from their vertices data
          
          // Parse editable annotation types (text, lines, rectangles, etc.)
          
          // Convert PDF coordinates to normalized (0-1) coordinates
          const [x1, y1, x2, y2] = annot.rect;
          const normalizedX1 = x1 / viewport.width;
          const normalizedY1 = 1 - (y2 / viewport.height); // PDF Y is bottom-up
          const normalizedX2 = x2 / viewport.width;
          const normalizedY2 = 1 - (y1 / viewport.height);
          
          // Parse color - handle multiple formats
          const parseColor = (colorArray) => {
            // Handle null/undefined
            if (!colorArray) return null;
            // Handle both regular arrays AND TypedArrays (like Uint8ClampedArray from PDF.js)
            if (!Array.isArray(colorArray) && !(colorArray instanceof Uint8ClampedArray) && !(colorArray instanceof Uint8Array)) {
              return null;
            }
            if (colorArray.length < 3) return null;
            
            const maxVal = Math.max(colorArray[0] || 0, colorArray[1] || 0, colorArray[2] || 0);
            let r, g, b;
            if (maxVal <= 1) {
              // Values are 0-1 range (normalized)
              r = Math.round((colorArray[0] || 0) * 255);
              g = Math.round((colorArray[1] || 0) * 255);
              b = Math.round((colorArray[2] || 0) * 255);
            } else {
              // Values are 0-255 range
              r = Math.round(colorArray[0] || 0);
              g = Math.round(colorArray[1] || 0);
              b = Math.round(colorArray[2] || 0);
            }
            return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
          };
          
          // Get stroke/border color
          let color = parseColor(annot.color) || '#ff0000';
          
          // Get fill/interior color if present
          // First try PDF.js interiorColor, then fallback to raw IC from pdf-lib
          let fillColor = parseColor(annot.interiorColor) || null;
          if (!fillColor && rawData.IC && rawData.IC.length >= 3) {
            // IC values are 0-1 range
            const r = Math.round(rawData.IC[0] * 255);
            const g = Math.round(rawData.IC[1] * 255);
            const b = Math.round(rawData.IC[2] * 255);
            fillColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
            console.log(`Using rawData.IC for fillColor: ${fillColor}`);
          }
          
          // Get opacity - check raw data from pdf-lib first (more reliable), then PDF.js values
          // PDF spec: CA = stroke opacity, ca = fill opacity (both 0-1 range)
          // NOTE: CA=0 means intentionally invisible stroke (e.g., Revu fill-only shapes)
          //       ca=0 is unlikely but would mean invisible fill
          let opacity = 1;
          let strokeOpacity = 1;
          let fillOpacity = 1;
          
          // Debug: log raw opacity values
          if (annot.subtype === 'Polygon' || annot.subtype === 'PolyLine') {
            console.log(`  Opacity debug for ${annot.subtype} ${annot.id}: rawData.CA=${rawData.CA}, rawData.ca=${rawData.ca}, annot.opacity=${annot.opacity}`);
          }
          
          // First try raw data from pdf-lib (has actual CA/ca values)
          // CA=0 is respected as "invisible stroke" (intentional in Revu for fill-only shapes)
          if (rawData.CA !== undefined) {
            strokeOpacity = rawData.CA;
            opacity = rawData.CA > 0 ? rawData.CA : 1; // Don't let general opacity be 0
          }
          if (rawData.ca !== undefined) {
            fillOpacity = rawData.ca;
            // If stroke opacity wasn't set, use fill opacity as general
            if (rawData.CA === undefined) {
              opacity = rawData.ca > 0 ? rawData.ca : 1;
            }
          }
          
          // Fall back to PDF.js values if raw data didn't have opacity
          if (rawData.CA === undefined && rawData.ca === undefined) {
            // Note: PDF.js may return 0 for annotations that don't have explicit opacity
            // We treat 0 as "not set" and default to 1 (fully opaque) for PDF.js values only
            if (annot.opacity !== undefined && annot.opacity > 0) {
              opacity = annot.opacity;
              strokeOpacity = annot.opacity;
              fillOpacity = annot.opacity;
            } else if (annot.ca !== undefined && annot.ca > 0) {
              opacity = annot.ca;
              strokeOpacity = annot.ca;
            } else if (annot.CA !== undefined && annot.CA > 0) {
              opacity = annot.CA;
              fillOpacity = annot.CA;
            }
            // If all are 0 or undefined, keep defaults of 1
          }
          
          // Debug: log final opacity values
          if (annot.subtype === 'Polygon' || annot.subtype === 'PolyLine') {
            console.log(`  Final opacity for ${annot.subtype} ${annot.id}: strokeOpacity=${strokeOpacity}, fillOpacity=${fillOpacity}, opacity=${opacity}`);
          }
          
          if (DEBUG_ANNOTATIONS && (rawData.CA !== undefined || rawData.ca !== undefined)) {
            console.log(`Annotation ${annot.id}: Raw opacity CA=${rawData.CA}, ca=${rawData.ca} -> opacity=${opacity}`);
          }
          
          // Get stroke width from various possible locations
          // If borderStyle.width is explicitly 0, there's no border
          // If no border info at all, default to 1 (but we'll check hasStroke later)
          let strokeWidth = 1;
          let hasBorderInfo = false;
          
          if (annot.borderStyle?.width !== undefined) {
            strokeWidth = annot.borderStyle.width;
            hasBorderInfo = true;
          } else if (annot.border && annot.border[2] !== undefined) {
            strokeWidth = annot.border[2];
            hasBorderInfo = true;
          }
          
          // If no border info was found, check if annotation has a color - if so, assume it has a border
          if (!hasBorderInfo && color) {
            strokeWidth = 1; // Default thin border if color exists but no width specified
          }
          
          // Get border style (solid, dashed, etc.)
          // PDF.js borderStyle.style returns numeric enum:
          //   1 = SOLID, 2 = DASHED, 3 = BEVELED, 4 = INSET, 5 = UNDERLINE
          // Or may return string: 'S' = solid, 'D' = dashed (depending on PDF.js version)
          const borderStyleVal = annot.borderStyle?.style;
          const isDashedStyle = borderStyleVal === 'D' || borderStyleVal === 2;
          // Prefer PDF.js dashArray, fall back to raw BS.D extraction (more reliable)
          const dashArray = isDashedStyle 
            ? (annot.borderStyle?.dashArray || rawData.dashArray || null) 
            : (rawData.dashArray || null);
          
          // Convert dashArray to lineStyle for our internal format
          // Our server.js patterns (relative to strokeWidth sw):
          //   dashed: [sw*6, sw*4], dotted: [sw*1.5, sw*3], dashdot: [sw*6, sw*3, sw*1.5, sw*3], longdash: [sw*12, sw*4]
          let lineStyle = 'solid';
          if (dashArray && dashArray.length > 0) {
            if (dashArray.length >= 4) {
              // 4+ elements = dashdot pattern
              lineStyle = 'dashdot';
            } else {
              // Check first element ratio to strokeWidth
              const sw = strokeWidth || 1;
              const firstRatio = dashArray[0] / sw;
              if (firstRatio >= 10) {
                lineStyle = 'longdash';
              } else if (firstRatio <= 2) {
                lineStyle = 'dotted';
              } else {
                lineStyle = 'dashed';
              }
            }
          } else if (isDashedStyle) {
            // BS.S = D but no D array found — default to 'dashed' (most common)
            // Old saves and other viewers may set S=/D without a D array
            lineStyle = 'dashed';
          }
          
          // Debug: log lineStyle detection chain
          if (lineStyle !== 'solid') {
            console.log(`lineStyle detection: borderStyleVal=${borderStyleVal}, isDashed=${isDashedStyle}, pdfjs.dashArray=${JSON.stringify(annot.borderStyle?.dashArray)}, raw.dashArray=${JSON.stringify(rawData.dashArray)}, resolved dashArray=${JSON.stringify(dashArray)}, → lineStyle=${lineStyle}, strokeWidth=${strokeWidth}`);
          }
          
          // Get rotation - PDF rotation is in degrees (0, 90, 180, 270)
          // This applies to the annotation content, not the coordinate system
          const annotRotation = annot.rotation || 0;
          
          // Check if annotation has a custom appearance stream
          // If so, the visual may include transformations (rotation, etc) that we can't extract
          // PDF.js will render these correctly, so we'll skip them in our SVG
          const hasCustomAppearance = annot.hasAppearance === true;
          
          // Common properties for all annotations
          // Use currentFileIdentifier for consistent tracking (works for both local and backend files)
          // Note: We don't include 'opacity' here - use strokeOpacity/fillOpacity for shapes instead
          
          // Extract author - PDF.js may expose as titleObj.str or title string
          const author = (typeof annot.title === 'string' && annot.title)
            || annot.titleObj?.str
            || rawData.T
            || null;
          
          // Extract contents - PDF.js may expose as contentsObj.str or contents string
          const annotContents = (typeof annot.contents === 'string' && annot.contents)
            || annot.contentsObj?.str
            || null;
          
          // Extract subject (annotation type label) — NOT exposed by PDF.js, only from raw /Subj
          const pdfSubject = rawData.Subj || null; // e.g. "Cloud", "Text Box", "Line", "Stamp"
          
          // Annotation unique name — from raw /NM
          const annotationName = rawData.NM || null;
          
          // Software hint — extracted from /RC xfa:APIVersion
          const software = rawData.software || null; // e.g. "BluebeamPDFRevu:2018"
          
          // Dates
          const createdDate = annot.creationDate || rawData.CreationDate || null;
          const modifiedDate = annot.modificationDate || rawData.M || null;
          
          const commonProps = {
            page: pageNum - 1,
            filename: currentFileIdentifier,
            fromPdf: true,
            pdfAnnotId: annot.id,
            pdfSubtype: annot.subtype, // Raw PDF subtype: "FreeText", "Line", "Polygon", "Square", etc.
            // opacity is intentionally NOT included - shapes use strokeOpacity/fillOpacity
            rotation: annotRotation, // Store rotation in degrees
            hasCustomAppearance, // If true, PDF.js renders this, we skip in SVG
            // ── Metadata for history/display ──
            author,            // Who created it (e.g. "Randika.Kariyawasam")
            pdfSubject,        // Authoring software's label (e.g. "Cloud", "Text Box")
            annotationName,    // Unique ID within PDF (e.g. "KATEGIKBGDQGWHHZ")
            software,          // Authoring software (e.g. "BluebeamPDFRevu:2018")
            createdDate,       // PDF date string (e.g. "D:20251125232315+08'00'")
            modifiedDate,      // PDF date string (e.g. "D:20251125232419+08'00'")
            contents: annotContents, // Comment/note text
          };
          
          
          let markup = null;
          
          if (annot.subtype === 'Square') {
            // Check if there's actually a stroke - default to 'none' if strokeWidth is 0
            const hasStroke = strokeWidth > 0;
            
            // Recover the original shape bounds:
            // 1. PidlyBaseRect — exact original bounds stored by Pidly for rotated annotations (best)
            // 2. RD adjustment — standard PDF field for padding inset (handles non-rotated Pidly + other apps)
            // 3. Raw Rect — fallback
            let adjX1 = normalizedX1, adjY1 = normalizedY1, adjX2 = normalizedX2, adjY2 = normalizedY2;
            if (rawData.PidlyBaseRect && rawData.PidlyBaseRect.length === 4) {
              // PidlyBaseRect stores the exact un-expanded base bounds in PDF coordinates
              const [bx1, by1, bx2, by2] = rawData.PidlyBaseRect;
              adjX1 = bx1 / viewport.width;
              adjY1 = 1 - (by2 / viewport.height);
              adjX2 = bx2 / viewport.width;
              adjY2 = 1 - (by1 / viewport.height);
            } else if (rawData.RD && rawData.RD.length === 4) {
              const [rdLeft, rdBottom, rdRight, rdTop] = rawData.RD;
              adjX1 = (x1 + rdLeft) / viewport.width;
              adjY1 = 1 - ((y2 - rdTop) / viewport.height);
              adjX2 = (x2 - rdRight) / viewport.width;
              adjY2 = 1 - ((y1 + rdBottom) / viewport.height);
            }
            
            markup = {
              ...commonProps,  // Spread FIRST so our values override
              id: `pdf_rect_${annot.id || `${pageNum}_${Math.round(normalizedX1 * 1000)}_${Math.round(normalizedY1 * 1000)}`}`,
              type: 'rectangle',
              startX: adjX1,
              startY: adjY1,
              endX: adjX2,
              endY: adjY2,
              color: hasStroke ? color : 'none',
              fillColor: fillColor || 'none',
              strokeWidth: hasStroke ? strokeWidth : 0,
              strokeOpacity: strokeOpacity,
              fillOpacity: fillOpacity,
              lineStyle,
              rotation: rawData.PidlyRotation || 0,
            };
          } else if (annot.subtype === 'Circle') {
            // Check if there's actually a stroke - default to 'none' if strokeWidth is 0
            // BUT: pdf.js sometimes reports borderStyle.width=0 for circles that clearly have
            // visible borders in their appearance stream (common with Bluebeam instrument bubbles).
            // If color exists + appearance stream exists + width is 0, fall back to a visible default.
            let circleStrokeWidth = strokeWidth;
            if (circleStrokeWidth === 0 && color && color !== 'none' && hasCustomAppearance) {
              // Likely a pdf.js parsing quirk — the circle has a visible border in the AP stream
              // Use 0.75 as default (matches companion Square annotations in Bluebeam groups)
              circleStrokeWidth = 0.75;
              console.log(`Circle ${annot.id}: pdf.js reported borderWidth=0 but has color=${color} + appearance stream — using fallback strokeWidth=0.75`);
            }
            const hasStroke = circleStrokeWidth > 0;
            
            // Recover the original shape bounds (same logic as Square)
            let adjX1 = normalizedX1, adjY1 = normalizedY1, adjX2 = normalizedX2, adjY2 = normalizedY2;
            if (rawData.PidlyBaseRect && rawData.PidlyBaseRect.length === 4) {
              const [bx1, by1, bx2, by2] = rawData.PidlyBaseRect;
              adjX1 = bx1 / viewport.width;
              adjY1 = 1 - (by2 / viewport.height);
              adjX2 = bx2 / viewport.width;
              adjY2 = 1 - (by1 / viewport.height);
            } else if (rawData.RD && rawData.RD.length === 4) {
              const [rdLeft, rdBottom, rdRight, rdTop] = rawData.RD;
              adjX1 = (x1 + rdLeft) / viewport.width;
              adjY1 = 1 - ((y2 - rdTop) / viewport.height);
              adjX2 = (x2 - rdRight) / viewport.width;
              adjY2 = 1 - ((y1 + rdBottom) / viewport.height);
            }
            
            markup = {
              ...commonProps,  // Spread FIRST so our values override
              id: `pdf_circle_${annot.id || `${pageNum}_${Math.round(normalizedX1 * 1000)}_${Math.round(normalizedY1 * 1000)}`}`,
              type: 'circle',
              startX: adjX1,
              startY: adjY1,
              endX: adjX2,
              endY: adjY2,
              color: hasStroke ? color : 'none',
              fillColor: fillColor || 'none',
              strokeWidth: hasStroke ? circleStrokeWidth : 0,
              strokeOpacity: strokeOpacity,
              fillOpacity: fillOpacity,
              lineStyle,
              rotation: rawData.PidlyRotation || 0,
            };
          } else if (annot.subtype === 'Line') {
            // lineEndings format: [LE1, LE2]
            const lineEndings = annot.lineEndings || [];

            // Check which end has the arrow
            const isArrowEnding = (ending) => ending && ending !== 'None' && (
              ending.includes('Arrow') || ending === 'OpenArrow' || ending === 'ClosedArrow'
            );

            const hasArrowAtStart = lineEndings[0] && isArrowEnding(lineEndings[0]);
            const hasArrowAtEnd = lineEndings[1] && isArrowEnding(lineEndings[1]);
            const hasArrowEnding = hasArrowAtStart || hasArrowAtEnd;

            const markupType = hasArrowEnding ? 'arrow' : 'line';

            let startX, startY, endX, endY;

            if (rawData.PidlyLineCoords && rawData.PidlyLineCoords.length === 4) {
              // Our own annotation — use exact normalized coords for perfect round-trip
              [startX, startY, endX, endY] = rawData.PidlyLineCoords;
            } else {
              // Third-party annotation — derive from PDF L coordinates
              const lineCoords = annot.lineCoordinates || rawData.L || [x1, y1, x2, y2];

              // Swap start/end to handle Y-flip direction reversal for third-party PDFs
              startX = lineCoords[2] / viewport.width;
              startY = 1 - (lineCoords[3] / viewport.height);
              endX = lineCoords[0] / viewport.width;
              endY = 1 - (lineCoords[1] / viewport.height);

              // For arrows with LE[1]=arrow (at PDF x2,y2 = our start after swap),
              // swap back so arrowhead is at our end (where our renderer draws it)
              if (hasArrowAtEnd && !hasArrowAtStart) {
                [startX, endX] = [endX, startX];
                [startY, endY] = [endY, startY];
              }
            }

            markup = {
              ...commonProps,  // Spread FIRST so our values override
              id: `pdf_${markupType}_${annot.id || `${pageNum}_${Math.round(startX * 1000)}_${Math.round(startY * 1000)}`}`,
              type: markupType,
              startX,
              startY,
              endX,
              endY,
              color,
              strokeWidth,
              strokeOpacity: strokeOpacity,
              lineStyle,
              lineEndings,
              hasArrowAtStart,
              hasArrowAtEnd,
              // ArrowHeadSize: read from custom field (canvas pixels), default 12
              arrowHeadSize: hasArrowEnding ? (rawData.ArrowHeadSize || 12) : undefined,
              // Bluebeam named line style (e.g. "Software", "Pneumatic")
              lineStyleName: rawData.LineStyleName || undefined,
              lineStylePattern: rawData.LineStylePattern || undefined,
              lineStyleRaw: rawData.LineStyle || undefined,
            };
          } else if (annot.subtype === 'Ink') {
            const inkLists = annot.inkLists || (annot.vertices ? [annot.vertices] : null);
            
            if (inkLists) {
              let inkIndex = 0;
              for (const inkList of inkLists) {
                const points = [];
                if (Array.isArray(inkList) && typeof inkList[0] === 'number') {
                  for (let i = 0; i < inkList.length; i += 2) {
                    points.push({
                      x: inkList[i] / viewport.width,
                      y: 1 - (inkList[i + 1] / viewport.height)
                    });
                  }
                } else if (Array.isArray(inkList)) {
                  for (const pt of inkList) {
                    if (pt && typeof pt.x === 'number') {
                      points.push({
                        x: pt.x / viewport.width,
                        y: 1 - (pt.y / viewport.height)
                      });
                    }
                  }
                }
                
                if (points.length > 1) {
                  // Determine if this is a highlighter based on stroke width or explicit opacity
                  // Thick strokes (>15) are typically highlighters
                  const isHighlighter = strokeWidth > 15 || opacity < 1;
                  
                  // Use the actual opacity value if we got it from the PDF (via pdf-lib)
                  // If PDF had no explicit opacity and this looks like a highlighter (thick stroke),
                  // apply default highlighter opacity of 0.4
                  // This is a necessary heuristic because many PDFs (Bluebeam, Adobe) store
                  // highlighter opacity in the appearance stream graphics state, not as an annotation property
                  let finalOpacity = opacity;
                  if (opacity === 1 && isHighlighter) {
                    // No explicit opacity found, but it's a thick stroke (likely highlighter)
                    // Apply default highlighter transparency
                    finalOpacity = 0.4;
                  }
                  
                  markup = {
                    ...commonProps,  // Spread FIRST so our values override
                    id: `pdf_ink_${annot.id || pageNum}_${inkIndex}`,
                    type: isHighlighter ? 'highlighter' : 'pen',
                    points,
                    color,
                    strokeWidth: isHighlighter ? strokeWidth : Math.min(strokeWidth, 5),
                    opacity: finalOpacity,
                  };
                  loadedMarkups.push(markup);
                  markup = null;
                  inkIndex++;
                }
              }
            }
          } else if (annot.subtype === 'FreeText') {
            // Extract text from various possible locations
            let textContent = '';
            if (annot.contents) {
              textContent = annot.contents;
            } else if (annot.richText?.str) {
              textContent = annot.richText.str.trim();
            } else if (Array.isArray(annot.textContent) && annot.textContent.length > 0) {
              textContent = annot.textContent.join(' ').trim();
            } else if (annot.title) {
              textContent = annot.title;
            } else if (annot.fieldValue) {
              textContent = annot.fieldValue;
            }
            
            if (textContent) {
              // Get font size from annotation data
              const fontSize = annot.defaultAppearanceData?.fontSize || annot.fontSize || 12;
              const [rectX1, rectY1, rectX2, rectY2] = annot.rect;
              const rectWidth = rectX2 - rectX1;
              const rectHeight = rectY2 - rectY1;
              
              // Try to infer rotation from rect dimensions vs text length
              // If rect is much taller than wide but text is short, likely rotated 90°
              const textLen = textContent.length;
              const expectedWidth = textLen * fontSize * 0.6;
              const expectedHeight = fontSize * 1.5;
              
              // Start with annotation's rotation value (PDF.js might provide it)
              let textRotation = annot.rotation || 0;
              
              // Debug: log all rotation-related properties
              console.log(`FreeText "${textContent.substring(0, 15)}...": annot.rotation=${annot.rotation}, rect=${rectWidth.toFixed(1)}x${rectHeight.toFixed(1)}, PidlyRotation=${rawData.PidlyRotation}`);
              
              // Check PidlyRotation first — exact value stored by Pidly (best for round-trip)
              if (rawData.PidlyRotation !== undefined) {
                textRotation = rawData.PidlyRotation;
                console.log(`  → Using PidlyRotation: ${textRotation}°`);
              }
              // Heuristic fallback for non-Pidly annotations (e.g. from Bluebeam/Adobe)
              else if (textRotation === 0 && rectHeight > rectWidth * 1.5 && expectedWidth > expectedHeight) {
                // Rect is vertical but text should be horizontal - likely rotated
                // Most CAD/P&ID software uses 270° (or -90°) for vertical text reading bottom-to-top
                textRotation = 270;
                console.log(`  → Inferred 270° rotation for vertical text`);
              }
              
              // Recover original bounds for rotated text (Rect is expanded for rotation)
              let textNX1 = normalizedX1, textNY1 = normalizedY1, textNX2 = normalizedX2, textNY2 = normalizedY2;
              if (rawData.PidlyBaseRect && rawData.PidlyBaseRect.length === 4) {
                const [bx1, by1, bx2, by2] = rawData.PidlyBaseRect;
                textNX1 = bx1 / viewport.width;
                textNY1 = 1 - (by2 / viewport.height);
                textNX2 = bx2 / viewport.width;
                textNY2 = 1 - (by1 / viewport.height);
              }
              
              let textX, textY;
              
              if (annot.textPosition && annot.textPosition.length >= 2) {
                const [offsetX, offsetY] = annot.textPosition;
                const textPdfX = rectX1 + offsetX;
                const textTopPdfY = rectY1 + offsetY + (fontSize * 0.8);
                textX = textPdfX / viewport.width;
                textY = 1 - (textTopPdfY / viewport.height);
              } else {
                let marginPx = 3;
                if (annot.richText?.html?.attributes?.style?.margin) {
                  const marginStr = annot.richText.html.attributes.style.margin;
                  const marginMatch = marginStr.match(/(\d+)/);
                  if (marginMatch) marginPx = parseInt(marginMatch[1]);
                }
                
                const paddingX = marginPx / viewport.width;
                const paddingY = marginPx / viewport.height;
                textX = normalizedX1 + paddingX;
                textY = normalizedY1 + paddingY;
              }
              
              // Get font name from annotation
              let fontFamily = 'Helvetica, Arial, sans-serif';
              if (annot.defaultAppearanceData?.fontName) {
                const fn = annot.defaultAppearanceData.fontName;
                if (fn === 'Helv' || fn === 'Helvetica') {
                  fontFamily = 'Helvetica, Arial, sans-serif';
                } else if (fn === 'TiRo' || fn === 'Times' || fn === 'TimesRoman') {
                  fontFamily = 'Times New Roman, Times, serif';
                } else if (fn === 'Cour' || fn === 'Courier') {
                  fontFamily = 'Courier New, Courier, monospace';
                } else {
                  fontFamily = fn + ', sans-serif';
                }
              }
              
              // Get text alignment from Q (Quadding) — standard PDF field
              // PDF.js exposes as annot.quadding; also check raw data as fallback
              const quaddingVal = annot.quadding !== undefined ? annot.quadding : rawData.Q;
              const textAlign = quaddingVal === 1 ? 'center' : quaddingVal === 2 ? 'right' : 'left';
              
              // ===== TEXT COLOR =====
              // Get text color from defaultAppearanceData.fontColor or richText style
              let textColor = '#000000'; // Default black
              
              // Try richText style color first (it's already a hex string)
              if (annot.richText?.html?.attributes?.style?.color) {
                textColor = annot.richText.html.attributes.style.color;
              }
              // Or from defaultAppearanceData.fontColor (RGB object)
              else if (annot.defaultAppearanceData?.fontColor) {
                const fc = annot.defaultAppearanceData.fontColor;
                const r = fc[0] || fc['0'] || 0;
                const g = fc[1] || fc['1'] || 0;
                const b = fc[2] || fc['2'] || 0;
                textColor = `#${Math.round(r).toString(16).padStart(2, '0')}${Math.round(g).toString(16).padStart(2, '0')}${Math.round(b).toString(16).padStart(2, '0')}`;
              }
              // Fallback to annotation color (stroke color) if nothing else
              else if (color && color !== '#000000') {
                textColor = color;
              }
              
              // ===== BORDER COLOR =====
              // Check if annotation has a border
              const hasBorder = annot.borderStyle?.width > 0 || (annot.border && annot.border[2] > 0);
              // Border color comes from annot.color (the stroke color)
              const borderColor = hasBorder ? (color || 'none') : 'none';
              
              // ===== FILL/BACKGROUND COLOR =====
              // fillColor comes from interiorColor (IC, already parsed above)
              // Fallback to textPosition JSON if IC not present
              const tp = rawData.textPosition || {};
              const bgColor = fillColor || tp.fillColor || 'none';
              
              // Border color: from BS/C standard fields, fallback to textPosition
              const resolvedBorderColor = borderColor !== 'none' ? borderColor : (tp.borderColor || 'none');
              
              // Vertical alignment: no standard PDF field — only from textPosition JSON
              const verticalAlign = tp.verticalAlign || 'top';

              // Line spacing: no standard PDF field — only from textPosition JSON
              const lineSpacing = tp.lineSpacing || 1.2;

              // Padding: no standard PDF field — only from textPosition JSON
              const padding = tp.padding !== undefined ? tp.padding : 4;

              // Font family: prefer textPosition, fallback to parsed DA font
              const resolvedFontFamily = tp.fontFamily || fontFamily || 'Helvetica';

              // Border width: prefer textPosition for round-trip, fallback to BS
              const resolvedBorderWidth = tp.borderWidth !== undefined ? tp.borderWidth : (hasBorder ? (annot.borderStyle?.width || 1) : 0);

              // Text align: prefer standard Q field, fallback to textPosition
              const resolvedTextAlign = (quaddingVal !== undefined && quaddingVal !== 0)
                ? textAlign
                : (tp.textAlign || textAlign);
              
              markup = {
                ...commonProps,  // Spread FIRST so our values override
                id: `pdf_text_${annot.id || `${pageNum}_${Math.round(normalizedX1 * 1000)}_${Math.round(normalizedY1 * 1000)}`}`,
                type: 'text',
                // Use recovered bounds (contracted from expanded Rect if PidlyBaseRect available)
                startX: textNX1,
                startY: textNY1,
                endX: textNX2,
                endY: textNY2,
                // Keep x,y for backwards compatibility
                x: textX,
                y: textY,
                origBounds: {
                  x1: textNX1,
                  y1: textNY1,
                  x2: textNX2,
                  y2: textNY2
                },
                text: textContent,
                color: textColor,           // TEXT color (not border!)
                textColor: textColor,       // Explicit text color property
                fillColor: bgColor,         // Background fill
                borderColor: resolvedBorderColor,   // Border/outline color
                borderWidth: resolvedBorderWidth,
                fontSize,
                fontFamily: resolvedFontFamily,
                padding,
                textAlign: resolvedTextAlign,
                verticalAlign,
                lineSpacing,
                rotation: textRotation,     // FreeText-specific rotation takes precedence
              };
            }
          } else if (annot.subtype === 'Stamp') {
            const stampName = annot.name || annot.AP?.N?.name || 'Stamp';
            const annotImage = annotImages.get(annot.id);
            const isPidlyStamp = !!(rawData && rawData.PidlyImageStamp);
            
            // Recover rotation from Pidly custom property (PDF.js doesn't expose stamp rotation)
            const stampRotation = rawData.PidlyRotation || 0;
            
            // Recover original bounds for rotated stamps (Rect is expanded for rotation)
            let stampX1 = normalizedX1, stampY1 = normalizedY1, stampX2 = normalizedX2, stampY2 = normalizedY2;
            if (rawData.PidlyBaseRect && rawData.PidlyBaseRect.length === 4) {
              const [bx1, by1, bx2, by2] = rawData.PidlyBaseRect;
              stampX1 = bx1 / viewport.width;
              stampY1 = 1 - (by2 / viewport.height);
              stampX2 = bx2 / viewport.width;
              stampY2 = 1 - (by1 / viewport.height);
            }
            
            // Recover opacity — stamps use a single opacity for the whole image
            const stampOpacity = (rawData.CA !== undefined) ? rawData.CA 
                               : (rawData.ca !== undefined) ? rawData.ca 
                               : (opacity < 1 ? opacity : 1);
            
            if (annotImage) {
              // We have a captured image — create a fully interactive image markup
              markup = {
                ...commonProps,  // Spread FIRST so our type-specific values override
                id: `pdf_stamp_${annot.id || `${pageNum}_${Math.round(normalizedX1 * 1000)}_${Math.round(normalizedY1 * 1000)}`}`,
                type: 'image',
                startX: stampX1,
                startY: stampY1,
                endX: stampX2,
                endY: stampY2,
                image: annotImage.imageDataUrl,
                originalWidth: annotImage.originalWidth,
                originalHeight: annotImage.originalHeight,
                stampName, // Keep for display in markup history
                isStamp: true, // Flag so we know this was originally a stamp
                isPidlyStamp, // True if saved by Pidly (round-trip)
                rotation: stampRotation,
                opacity: stampOpacity,
              };
              console.log(`  ✅ Stamp "${stampName}" → interactive image (${annotImage.originalWidth}×${annotImage.originalHeight}), rotation: ${stampRotation}, opacity: ${stampOpacity}${isPidlyStamp ? ' [Pidly round-trip]' : ''}`);
            } else {
              // Fallback: read-only placeholder (extraction failed)
              markup = {
                ...commonProps,  // Spread FIRST so our type-specific values override
                id: `pdf_stamp_${annot.id || `${pageNum}_${Math.round(normalizedX1 * 1000)}_${Math.round(normalizedY1 * 1000)}`}`,
                type: 'stamp',
                startX: stampX1,
                startY: stampY1,
                endX: stampX2,
                endY: stampY2,
                color: color || '#9333ea',
                stampName,
                readOnly: true,
                rotation: stampRotation,
                opacity: stampOpacity,
              };
            }
          } else if (annot.subtype === 'Highlight') {
            // Highlight color often comes from annotation color, but might also be in interiorColor
            const highlightColor = color || fillColor || '#ffff00'; // Default yellow if no color
            // Highlight opacity should be low for transparency - use annotation opacity or default to 0.3
            const highlightOpacity = opacity < 1 ? opacity : 0.3;
            
            if (annot.quadPoints) {
              for (let i = 0; i < annot.quadPoints.length; i += 8) {
                const qx1 = Math.min(annot.quadPoints[i], annot.quadPoints[i+2], annot.quadPoints[i+4], annot.quadPoints[i+6]) / viewport.width;
                const qx2 = Math.max(annot.quadPoints[i], annot.quadPoints[i+2], annot.quadPoints[i+4], annot.quadPoints[i+6]) / viewport.width;
                const qy1 = 1 - Math.max(annot.quadPoints[i+1], annot.quadPoints[i+3], annot.quadPoints[i+5], annot.quadPoints[i+7]) / viewport.height;
                const qy2 = 1 - Math.min(annot.quadPoints[i+1], annot.quadPoints[i+3], annot.quadPoints[i+5], annot.quadPoints[i+7]) / viewport.height;
                
                loadedMarkups.push({
                  ...commonProps,  // Spread FIRST so our values override
                  id: `pdf_highlight_${annot.id || pageNum}_${i}`,
                  type: 'textHighlight',
                  subtype: 'Highlight',
                  startX: qx1,
                  startY: qy1,
                  endX: qx2,
                  endY: qy2,
                  color: highlightColor,
                  opacity: highlightOpacity,  // Now this won't be overwritten
                });
              }
            }
          } else if (annot.subtype === 'Underline') {
            if (annot.quadPoints) {
              for (let i = 0; i < annot.quadPoints.length; i += 8) {
                const qx1 = Math.min(annot.quadPoints[i], annot.quadPoints[i+2], annot.quadPoints[i+4], annot.quadPoints[i+6]) / viewport.width;
                const qx2 = Math.max(annot.quadPoints[i], annot.quadPoints[i+2], annot.quadPoints[i+4], annot.quadPoints[i+6]) / viewport.width;
                const qy2 = 1 - Math.min(annot.quadPoints[i+1], annot.quadPoints[i+3], annot.quadPoints[i+5], annot.quadPoints[i+7]) / viewport.height;
                
                loadedMarkups.push({
                  id: `pdf_underline_${annot.id || pageNum}_${i}`,
                  type: 'textMarkup',
                  subtype: 'Underline',
                  startX: qx1,
                  startY: qy2,
                  endX: qx2,
                  endY: qy2,
                  color,
                  strokeWidth: 1,
                  ...commonProps
                });
              }
            }
          } else if (annot.subtype === 'StrikeOut') {
            if (annot.quadPoints) {
              for (let i = 0; i < annot.quadPoints.length; i += 8) {
                const qx1 = Math.min(annot.quadPoints[i], annot.quadPoints[i+2], annot.quadPoints[i+4], annot.quadPoints[i+6]) / viewport.width;
                const qx2 = Math.max(annot.quadPoints[i], annot.quadPoints[i+2], annot.quadPoints[i+4], annot.quadPoints[i+6]) / viewport.width;
                const qy1 = 1 - Math.max(annot.quadPoints[i+1], annot.quadPoints[i+3], annot.quadPoints[i+5], annot.quadPoints[i+7]) / viewport.height;
                const qy2 = 1 - Math.min(annot.quadPoints[i+1], annot.quadPoints[i+3], annot.quadPoints[i+5], annot.quadPoints[i+7]) / viewport.height;
                const midY = (qy1 + qy2) / 2;
                
                loadedMarkups.push({
                  id: `pdf_strikeout_${annot.id || pageNum}_${i}`,
                  type: 'textMarkup',
                  subtype: 'StrikeOut',
                  startX: qx1,
                  startY: midY,
                  endX: qx2,
                  endY: midY,
                  color,
                  strokeWidth: 1,
                  ...commonProps
                });
              }
            }
          } else if (annot.subtype === 'Squiggly') {
            if (annot.quadPoints) {
              for (let i = 0; i < annot.quadPoints.length; i += 8) {
                const qx1 = Math.min(annot.quadPoints[i], annot.quadPoints[i+2], annot.quadPoints[i+4], annot.quadPoints[i+6]) / viewport.width;
                const qx2 = Math.max(annot.quadPoints[i], annot.quadPoints[i+2], annot.quadPoints[i+4], annot.quadPoints[i+6]) / viewport.width;
                const qy2 = 1 - Math.min(annot.quadPoints[i+1], annot.quadPoints[i+3], annot.quadPoints[i+5], annot.quadPoints[i+7]) / viewport.height;
                
                loadedMarkups.push({
                  id: `pdf_squiggly_${annot.id || pageNum}_${i}`,
                  type: 'textMarkup',
                  subtype: 'Squiggly',
                  startX: qx1,
                  startY: qy2,
                  endX: qx2,
                  endY: qy2,
                  color,
                  strokeWidth: 1,
                  ...commonProps
                });
              }
            }
          } else if (annot.subtype === 'Polygon') {
            // Polygon annotation - closed shape (could be cloud or regular polygon)
            
            // PDF.js returns vertices as array of {x, y} objects OR flat array [x1,y1,x2,y2,...]
            const rawVertices = annot.vertices || [];
            
            // Convert to array of {x, y} points - handle both formats
            let points = [];
            if (rawVertices.length > 0) {
              if (typeof rawVertices[0] === 'object' && rawVertices[0].x !== undefined) {
                // Already {x, y} objects
                points = rawVertices.map(v => ({
                  x: v.x / viewport.width,
                  y: 1 - (v.y / viewport.height)
                }));
              } else if (typeof rawVertices[0] === 'number') {
                // Flat array [x1, y1, x2, y2, ...]
                for (let i = 0; i < rawVertices.length; i += 2) {
                  points.push({
                    x: rawVertices[i] / viewport.width,
                    y: 1 - (rawVertices[i + 1] / viewport.height)
                  });
                }
              }
            }
            
            // Check if this is a cloud annotation
            // Look for explicit cloud intent indicators from both PDF.js and raw pdf-lib data
            // Note: rawData.intent may have leading slash from PDF Name (e.g., '/PolygonCloud')
            const intentStr = (rawData.intent || '').replace(/^\//, ''); // Strip leading slash
            const isCloud = annot.it === 'PolygonCloud' || 
                            annot.IT === 'PolygonCloud' || 
                            annot.intent === 'PolygonCloud' ||
                            intentStr === 'PolygonCloud' ||
                            intentStr === 'PolyLineCloud' || // Cloud polylines may also have this intent
                            (annot.borderEffect && annot.borderEffect.style === 'C') ||
                            (annot.BE && annot.BE.S === 'C') ||
                            rawData.borderEffect === 'C';
            
            // Always log cloud detection for debugging
            console.log(`Polygon ${annot.id}: isCloud=${isCloud}, annot.it=${annot.it}, annot.intent=${annot.intent}, rawData.intent=${rawData.intent}, intentStr=${intentStr}`);
            console.log(`Polygon ${annot.id}: fillColor=${fillColor}, annot.interiorColor=`, annot.interiorColor, ', strokeOpacity=', strokeOpacity, ', fillOpacity=', fillOpacity);
            
            if (points.length >= 3) { // Need at least 3 points for a polygon
              const hasStroke = strokeWidth > 0;
              
              // Compute bounds from points
              const minX = Math.min(...points.map(p => p.x));
              const maxX = Math.max(...points.map(p => p.x));
              const minY = Math.min(...points.map(p => p.y));
              const maxY = Math.max(...points.map(p => p.y));
              
              // Determine if this is a rectangular cloud (Pidly's 'cloud' type) vs freeform cloudPolyline
              const isCloudRect = isCloud && rawData.PidlyCloudRect;
              
              // Restore custom cloud properties from Pidly persistence, or use defaults
              const arcSize = rawData.PidlyArcSize || 8;
              const inverted = rawData.PidlyInverted || false;
              const cloudRotation = rawData.PidlyRotation || 0;
              
              if (isCloudRect) {
                // Rectangular cloud — use 'cloud' type with startX/startY/endX/endY bounds
                markup = {
                  ...commonProps,
                  id: `pdf_cloud_${annot.id || `${pageNum}_${Math.round(normalizedX1 * 1000)}`}`,
                  type: 'cloud',
                  startX: minX,
                  startY: minY,
                  endX: maxX,
                  endY: maxY,
                  color: hasStroke ? color : 'none',
                  fillColor: fillColor || 'none',
                  strokeWidth: hasStroke ? (strokeWidth || 2) : 0,
                  strokeOpacity: strokeOpacity,
                  fillOpacity: fillOpacity,
                  lineStyle,
                  inverted,
                  arcSize,
                  rotation: cloudRotation,
                };
              } else {
                // Freeform cloud polyline or regular polygon
                markup = {
                  ...commonProps,
                  id: `pdf_polygon_${annot.id || `${pageNum}_${Math.round(normalizedX1 * 1000)}`}`,
                  type: isCloud ? 'cloudPolyline' : 'polygon',
                  points,
                  startX: minX,
                  startY: minY,
                  endX: maxX,
                  endY: maxY,
                  color: hasStroke ? color : 'none',
                  fillColor: fillColor || 'none',
                  strokeWidth: hasStroke ? (strokeWidth || 2) : 0,
                  strokeOpacity: strokeOpacity,
                  fillOpacity: fillOpacity,
                  lineStyle,
                  closed: true,
                  inverted,
                  arcSize,
                  rotation: cloudRotation,
                };
              }
            }
          } else if (annot.subtype === 'PolyLine') {
            // PolyLine annotation - open shape
            const rawVertices = annot.vertices || [];
            
            // Convert to array of {x, y} points - handle both formats
            let points = [];
            if (rawVertices.length > 0) {
              if (typeof rawVertices[0] === 'object' && rawVertices[0].x !== undefined) {
                // Already {x, y} objects
                points = rawVertices.map(v => ({
                  x: v.x / viewport.width,
                  y: 1 - (v.y / viewport.height)
                }));
              } else if (typeof rawVertices[0] === 'number') {
                // Flat array [x1, y1, x2, y2, ...]
                for (let i = 0; i < rawVertices.length; i += 2) {
                  points.push({
                    x: rawVertices[i] / viewport.width,
                    y: 1 - (rawVertices[i + 1] / viewport.height)
                  });
                }
              }
            }
            
            if (points.length >= 2) { // At least 2 points for a polyline
              // Compute bounds from points
              const minX = Math.min(...points.map(p => p.x));
              const maxX = Math.max(...points.map(p => p.x));
              const minY = Math.min(...points.map(p => p.y));
              const maxY = Math.max(...points.map(p => p.y));
              
              // Check if this is a cloud polyline (open cloud shape)
              // Note: rawData.intent may have leading slash from PDF Name
              const intentStr = (rawData.intent || '').replace(/^\//, '');
              const isCloudPolyline = annot.it === 'PolyLineCloud' || 
                              annot.IT === 'PolyLineCloud' || 
                              annot.intent === 'PolyLineCloud' ||
                              intentStr === 'PolyLineCloud' ||
                              intentStr === 'PolygonCloud' || // Sometimes cloud polylines use PolygonCloud intent
                              (annot.borderEffect && annot.borderEffect.style === 'C') ||
                              rawData.borderEffect === 'C';
              
              console.log(`PolyLine ${annot.id}: isCloud=${isCloudPolyline}, rawData.intent=${rawData.intent}, intentStr=${intentStr}`);
              
              // Restore custom cloud properties from Pidly persistence, or use defaults
              const polylineArcSize = rawData.PidlyArcSize || 8;
              const polylineInverted = rawData.PidlyInverted || false;
              const polylineHasStroke = strokeWidth > 0;
              
              // Detect polylineArrow from LE (line endings) field
              const polyLE = annot.lineEndings || [];
              const hasPolyArrow = polyLE.some && polyLE.some(e => e && e !== 'None' && (e.includes?.('Arrow') || e === 'ClosedArrow' || e === 'OpenArrow'));
              const polylineType = isCloudPolyline ? 'cloudPolyline' : (hasPolyArrow ? 'polylineArrow' : 'polyline');
              
              markup = {
                ...commonProps,  // Spread FIRST so our values override
                id: `pdf_polyline_${annot.id || `${pageNum}_${Math.round(normalizedX1 * 1000)}`}`,
                type: polylineType,
                points,
                startX: minX,
                startY: minY,
                endX: maxX,
                endY: maxY,
                color: polylineHasStroke ? color : 'none',
                strokeWidth: polylineHasStroke ? strokeWidth : 0,
                strokeOpacity: strokeOpacity,
                fillOpacity: fillOpacity,
                lineStyle,
                lineEndings: annot.lineEndings || [],
                closed: false,
                inverted: polylineInverted,
                arcSize: polylineArcSize,
                arrowHeadSize: hasPolyArrow ? (rawData.ArrowHeadSize || 12) : undefined,
                // Bluebeam named line style (e.g. "Software", "Pneumatic", "Hydraulic")
                lineStyleName: rawData.LineStyleName || undefined,
                // Parsed repeating pattern: { startOffset, segments: [{ type:'dash'|'gap'|'text', ... }] }
                lineStylePattern: rawData.LineStylePattern || undefined,
                // Raw LineStyle array for round-trip persistence
                lineStyleRaw: rawData.LineStyle || undefined,
              };
            }
          } else if (annot.subtype === 'Text') {
            // Text annotation (sticky note/comment popup)
            markup = {
              id: `pdf_note_${annot.id || `${pageNum}_${Math.round(normalizedX1 * 1000)}_${Math.round(normalizedY1 * 1000)}`}`,
              type: 'note',
              x: normalizedX1,
              y: normalizedY1,
              text: annot.contents || '',
              color: color || '#ffeb3b',
              iconName: annot.name || 'Note', // Note, Comment, Help, Insert, Key, NewParagraph, Paragraph
              ...commonProps
            };
          } else if (annot.subtype === 'Caret') {
            // Caret annotation (insertion point marker)
            markup = {
              id: `pdf_caret_${annot.id || `${pageNum}_${Math.round(normalizedX1 * 1000)}_${Math.round(normalizedY1 * 1000)}`}`,
              type: 'caret',
              x: (normalizedX1 + normalizedX2) / 2,
              y: normalizedY2,
              color,
              readOnly: true, // Caret is display-only
              ...commonProps
            };
          } else if (annot.subtype === 'FileAttachment') {
            // File attachment annotation
            markup = {
              id: `pdf_fileattach_${annot.id || `${pageNum}_${Math.round(normalizedX1 * 1000)}`}`,
              type: 'fileAttachment',
              startX: normalizedX1,
              startY: normalizedY1,
              endX: normalizedX2,
              endY: normalizedY2,
              color: color || '#3498db',
              fileName: annot.file?.filename || 'Attachment',
              readOnly: true, // Can't recreate file attachments
              ...commonProps
            };
          } else if (annot.subtype === 'Sound') {
            // Sound annotation
            markup = {
              id: `pdf_sound_${annot.id || `${pageNum}_${Math.round(normalizedX1 * 1000)}`}`,
              type: 'sound',
              x: normalizedX1,
              y: normalizedY1,
              color: color || '#e91e63',
              readOnly: true,
              ...commonProps
            };
          } else if (annot.subtype === 'Redact') {
            // Redaction annotation
            markup = {
              id: `pdf_redact_${annot.id || `${pageNum}_${Math.round(normalizedX1 * 1000)}`}`,
              type: 'redact',
              startX: normalizedX1,
              startY: normalizedY1,
              endX: normalizedX2,
              endY: normalizedY2,
              color: color || '#000000',
              fillColor: fillColor || '#000000',
              readOnly: true, // Redactions are security-sensitive
              ...commonProps
            };
          } else {
            // Unknown/unsupported annotation type - still display it
            console.log(`Unhandled annotation type: ${annot.subtype}`, annot);
            markup = {
              id: `pdf_unknown_${annot.subtype}_${annot.id || `${pageNum}_${Math.round(normalizedX1 * 1000)}`}`,
              type: 'unknown',
              subtype: annot.subtype,
              startX: normalizedX1,
              startY: normalizedY1,
              endX: normalizedX2,
              endY: normalizedY2,
              color: color || '#999999',
              readOnly: true, // Unknown types are read-only
              ...commonProps
            };
          }
          
          // Image override: if we extracted an image for this annotation and it wasn't
          // already converted to an image markup, override it now. This handles non-Stamp
          // annotation types that have embedded image content (e.g. custom image annotations).
          if (markup && markup.type !== 'image' && annotImages.has(annot.id)) {
            const annotImage = annotImages.get(annot.id);
            const origType = markup.type;
            
            // Recover bounds and rotation (same as Stamp handling)
            let imgX1 = normalizedX1, imgY1 = normalizedY1, imgX2 = normalizedX2, imgY2 = normalizedY2;
            if (rawData.PidlyBaseRect && rawData.PidlyBaseRect.length === 4) {
              const [bx1, by1, bx2, by2] = rawData.PidlyBaseRect;
              imgX1 = bx1 / viewport.width;
              imgY1 = 1 - (by2 / viewport.height);
              imgX2 = bx2 / viewport.width;
              imgY2 = 1 - (by1 / viewport.height);
            }
            const imgRotation = rawData.PidlyRotation || 0;
            const imgOpacity = (rawData.CA !== undefined) ? rawData.CA : (opacity < 1 ? opacity : 1);
            
            markup = {
              ...commonProps,  // Spread FIRST so type-specific values override
              id: markup.id,
              type: 'image',
              startX: imgX1,
              startY: imgY1,
              endX: imgX2,
              endY: imgY2,
              image: annotImage.imageDataUrl,
              originalWidth: annotImage.originalWidth,
              originalHeight: annotImage.originalHeight,
              stampName: annot.name || annot.subtype || 'Image',
              isStamp: true, // Treat as stamp-like for rendering
              rotation: imgRotation,
              opacity: imgOpacity,
            };
            console.log(`  ✅ ${annot.subtype} ${annot.id} (was ${origType}) → interactive image (${annotImage.originalWidth}×${annotImage.originalHeight}), rotation: ${imgRotation}`);
          }
          
          if (markup) {
            loadedMarkups.push(markup);
          }
          
          annotIndex++;  // Track annotation index for raw data lookup
        }
      }
      
      // Clean up image-annots-only PDF document if created
      if (imageAnnotsPdfDoc) {
        try { imageAnnotsPdfDoc.destroy(); } catch (e) { /* ignore */ }
        imageAnnotsPdfDoc = null;
      }
      
      // === FINAL SUMMARY ===
      console.log('\n========== ANNOTATION LOADING SUMMARY ==========');
      console.log('Total markups loaded:', loadedMarkups.length);
      
      // Group by type
      const typeCount = {};
      loadedMarkups.forEach(m => {
        typeCount[m.type] = (typeCount[m.type] || 0) + 1;
      });
      console.log('By type:', typeCount);
      
      // Show details of each loaded markup
      console.log('\n--- Loaded Markups Detail ---');
      loadedMarkups.forEach((m, i) => {
        console.log(`${i + 1}. ${m.type}${m.readOnly ? ' 🔒' : ''} (id: ${m.id}) - page ${m.page + 1}`);
        if (m.type === 'text') {
          console.log(`   Text: "${m.text?.substring(0, 50)}${m.text?.length > 50 ? '...' : ''}"`);
          console.log(`   Font: ${m.fontSize}px, Color: ${m.color}, Fill: ${m.fillColor}, Border: ${m.borderColor}, Rotation: ${m.rotation || 0}°`);
        } else if (m.type === 'rectangle' || m.type === 'circle') {
          console.log(`   Color: ${m.color}, Fill: ${m.fillColor}, StrokeWidth: ${m.strokeWidth}`);
        } else if (m.type === 'line' || m.type === 'arrow') {
          console.log(`   Color: ${m.color}, StrokeWidth: ${m.strokeWidth}`);
        } else if (m.type === 'pen' || m.type === 'highlighter') {
          console.log(`   Points: ${m.points?.length}, Color: ${m.color}, Opacity: ${m.opacity}`);
        } else if (m.type === 'stamp') {
          console.log(`   Stamp: ${m.stampName} (read-only)`);
        } else if (m.type === 'image' && m.isStamp) {
          console.log(`   Stamp→Image: "${m.stampName}" (${m.originalWidth}×${m.originalHeight}px, draggable)`);
        } else if (m.type === 'cloudPolyline' || m.type === 'polygon') {
          console.log(`   Points: ${m.points?.length}, Color: ${m.color}, Fill: ${m.fillColor}, FillOpacity: ${m.fillOpacity}, Closed: ${m.closed}`);
        }
      });
      console.log('========== END SUMMARY ==========\n');

  return loadedMarkups;
}

/**
 * dumpAllAnnotationData — Extract ALL annotation data from a PDF (both raw pdf-lib dict
 * entries and PDF.js parsed fields) and return as a formatted text string.
 * Optionally triggers a file download.
 *
 * This is a diagnostic/inspection tool to see exactly what metadata each annotation carries
 * before designing any UI around it.
 */
export async function dumpAllAnnotationData({ pdfDoc, currentFile, pdfUrl, download = true }) {
  console.log('📋 dumpAllAnnotationData called', { pdfDoc: !!pdfDoc, fileName: currentFile?.name, pdfUrl: !!pdfUrl });
  
  const lines = [];
  const line = (text = '') => lines.push(text);
  const divider = (char = '=', len = 80) => line(char.repeat(len));
  
  const fileName = currentFile?.name || 'unknown';
  line(`ANNOTATION DATA DUMP`);
  line(`File: ${fileName}`);
  line(`Date: ${new Date().toISOString()}`);
  line(`PDF Pages: ${pdfDoc.numPages}`);
  divider();
  line();

  // ─── PART 1: Raw pdf-lib dictionary entries (the actual PDF objects) ──────
  line(`PART 1: RAW PDF DICTIONARY DATA (via pdf-lib)`);
  line(`This shows every key/value pair in each annotation's PDF dictionary object.`);
  divider('-');
  line();
  
  let pdfArrayBuffer = null;
  try {
    if (currentFile?.file) {
      pdfArrayBuffer = await currentFile.file.arrayBuffer();
    } else if (pdfUrl) {
      const response = await fetch(pdfUrl);
      pdfArrayBuffer = await response.arrayBuffer();
    }
  } catch (err) {
    line(`[ERROR] Could not get PDF buffer: ${err.message}`);
  }
  
  if (pdfArrayBuffer) {
    try {
      const { PDFDocument: PdfLibDoc, PDFName, PDFNumber, PDFArray, PDFDict, PDFRef, PDFString, PDFHexString, PDFBool, PDFStream } = await import('pdf-lib');
      const pdfLibDoc = await PdfLibDoc.load(pdfArrayBuffer, { ignoreEncryption: true });
      const pages = pdfLibDoc.getPages();
      
      // Helper to stringify a pdf-lib value
      const valToString = (value, depth = 0) => {
        if (depth > 3) return '[nested too deep]';
        if (value === undefined || value === null) return 'null';
        if (value instanceof PDFName) return value.asString();
        if (value instanceof PDFNumber) return String(value.asNumber());
        if (value instanceof PDFString) return `"${value.asString()}"`;
        if (value instanceof PDFHexString) return `hex:"${value.asString()}"`;
        if (value instanceof PDFBool) return String(value.asBoolean());
        if (value instanceof PDFRef) {
          // Try to resolve
          try {
            const resolved = pdfLibDoc.context.lookup(value);
            if (resolved instanceof PDFDict || resolved instanceof PDFStream) {
              return `[Ref -> ${resolved.constructor.name}]`;
            }
            return valToString(resolved, depth + 1);
          } catch { return `[Ref: ${value.toString()}]`; }
        }
        if (value instanceof PDFArray) {
          const items = [];
          for (let i = 0; i < value.size(); i++) {
            items.push(valToString(value.get(i), depth + 1));
          }
          return `[${items.join(', ')}]`;
        }
        if (value instanceof PDFStream) return `[Stream, ${value.contents?.length || '?'} bytes]`;
        if (value instanceof PDFDict) {
          if (depth >= 2) return '[Dict...]';
          const entries = [];
          if (value.entries) {
            for (const [k, v] of value.entries()) {
              entries.push(`${k.toString()}: ${valToString(v, depth + 1)}`);
            }
          }
          return `{${entries.join(', ')}}`;
        }
        try { return value.toString?.()?.substring(0, 200) || typeof value; }
        catch { return `[${typeof value}]`; }
      };
      
      let totalAnnots = 0;
      
      for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        const page = pages[pageIndex];
        const annotsRef = page.node.get(PDFName.of('Annots'));
        if (!annotsRef) continue;
        
        let annots = annotsRef;
        if (annotsRef instanceof PDFRef) annots = pdfLibDoc.context.lookup(annotsRef);
        if (!(annots instanceof PDFArray)) continue;
        
        const pageAnnotCount = annots.size();
        if (pageAnnotCount === 0) continue;
        
        line(`── Page ${pageIndex + 1} (${pageAnnotCount} annotations) ──`);
        line();
        
        for (let annotIndex = 0; annotIndex < pageAnnotCount; annotIndex++) {
          try {
            let annotDict = annots.get(annotIndex);
            if (annotDict instanceof PDFRef) annotDict = pdfLibDoc.context.lookup(annotDict);
            if (!(annotDict instanceof PDFDict)) continue;
            
            totalAnnots++;
            
            // Get subtype for header
            const subtype = annotDict.get(PDFName.of('Subtype'));
            const subtypeStr = subtype ? valToString(subtype) : '?';
            
            line(`  [${pageIndex + 1}.${annotIndex}] Subtype: ${subtypeStr}`);
            
            // Enumerate ALL dictionary entries
            if (annotDict.entries) {
              for (const [key, value] of annotDict.entries()) {
                const keyStr = key.toString();
                // Skip appearance streams (AP) content — too large
                if (keyStr === '/AP') {
                  line(`    ${keyStr}: [Appearance Stream - skipped for brevity]`);
                  continue;
                }
                const valStr = valToString(value);
                line(`    ${keyStr}: ${valStr}`);
              }
            }
            line();
          } catch (err) {
            line(`  [${pageIndex + 1}.${annotIndex}] ERROR: ${err.message}`);
            line();
          }
        }
      }
      line(`Total raw annotations: ${totalAnnots}`);
    } catch (err) {
      line(`[ERROR] pdf-lib extraction failed: ${err.message}`);
    }
  } else {
    line(`[SKIPPED] No PDF buffer available for raw extraction`);
  }
  
  line();
  divider();
  line();
  
  // ─── PART 2: PDF.js parsed annotation data ──────────────────────────────
  line(`PART 2: PDF.JS PARSED ANNOTATION DATA`);
  line(`This shows what PDF.js exposes after parsing — the fields our app can access directly.`);
  divider('-');
  line();
  
  let totalParsed = 0;
  
  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const annotations = await page.getAnnotations();
    const viewport = page.getViewport({ scale: 1, rotation: 0 });
    
    // Filter out non-markup types
    const markupAnnots = annotations.filter(a => 
      a.rect && a.subtype !== 'Link' && a.subtype !== 'Widget'
    );
    
    if (markupAnnots.length === 0) continue;
    
    line(`── Page ${pageNum} (${markupAnnots.length} markup annotations, ${annotations.length} total) ──`);
    line(`   Viewport: ${viewport.width.toFixed(1)} × ${viewport.height.toFixed(1)}`);
    line();
    
    markupAnnots.forEach((annot, idx) => {
      totalParsed++;
      line(`  [${pageNum}.${idx}] ${annot.subtype} (id: ${annot.id})`);
      
      // Core fields
      line(`    Rect: [${annot.rect?.map(r => r.toFixed(2)).join(', ')}]`);
      if (annot.color) line(`    Color: [${Array.from(annot.color).join(', ')}]`);
      if (annot.interiorColor) line(`    InteriorColor: [${Array.from(annot.interiorColor).join(', ')}]`);
      
      // Metadata fields — the ones we care about for history display
      if (annot.title) line(`    Title/Author: "${annot.title}"`);
      if (annot.subject) line(`    Subject: "${annot.subject}"`);
      if (annot.contents) {
        const cStr = typeof annot.contents === 'string' ? annot.contents : JSON.stringify(annot.contents);
        line(`    Contents: "${cStr.substring(0, 100)}${cStr.length > 100 ? '...' : ''}"`);
      }
      if (annot.creationDate) line(`    CreationDate: "${annot.creationDate}"`);
      if (annot.modificationDate) line(`    ModificationDate: "${annot.modificationDate}"`);
      
      // Opacity
      if (annot.opacity !== undefined) line(`    Opacity: ${annot.opacity}`);
      if (annot.CA !== undefined) line(`    CA: ${annot.CA}`);
      if (annot.ca !== undefined) line(`    ca: ${annot.ca}`);
      
      // Border
      if (annot.borderStyle) line(`    BorderStyle: ${JSON.stringify(annot.borderStyle)}`);
      if (annot.border) line(`    Border: [${annot.border?.join(', ')}]`);
      
      // Appearance & rendering
      if (annot.hasAppearance !== undefined) line(`    HasAppearance: ${annot.hasAppearance}`);
      if (annot.rotation) line(`    Rotation: ${annot.rotation}`);
      
      // Type-specific
      if (annot.lineCoordinates) line(`    LineCoordinates: [${annot.lineCoordinates.join(', ')}]`);
      if (annot.lineEndings) line(`    LineEndings: [${annot.lineEndings.join(', ')}]`);
      if (annot.vertices) line(`    Vertices: ${annot.vertices.length} coords (${annot.vertices.length / 2} points)`);
      if (annot.inkLists) line(`    InkLists: ${annot.inkLists?.length} strokes`);
      if (annot.quadPoints) line(`    QuadPoints: ${annot.quadPoints?.length} values`);
      if (annot.defaultAppearanceData) line(`    DefaultAppearanceData: ${JSON.stringify(annot.defaultAppearanceData)}`);
      if (annot.richText) {
        const rtStr = typeof annot.richText === 'string' ? annot.richText : JSON.stringify(annot.richText);
        line(`    RichText: "${rtStr.substring(0, 150)}${rtStr.length > 150 ? '...' : ''}"`);
      }
      if (annot.textContent) {
        const tcStr = typeof annot.textContent === 'string' ? annot.textContent : JSON.stringify(annot.textContent);
        line(`    TextContent: "${tcStr.substring(0, 150)}"`);
      }
      if (annot.quadding !== undefined) line(`    Quadding: ${annot.quadding}`);
      if (annot.name) line(`    Name: "${annot.name}"`);
      
      // Dump all remaining keys not yet printed
      const printedKeys = new Set([
        'rect', 'color', 'interiorColor', 'title', 'subject', 'contents',
        'creationDate', 'modificationDate', 'opacity', 'CA', 'ca',
        'borderStyle', 'border', 'hasAppearance', 'rotation',
        'lineCoordinates', 'lineEndings', 'vertices', 'inkLists', 'quadPoints',
        'defaultAppearanceData', 'richText', 'textContent', 'quadding', 'name',
        'subtype', 'id', 'annotationType', 'annotationFlags',
      ]);
      const otherKeys = Object.keys(annot).filter(k => 
        !printedKeys.has(k) && annot[k] !== undefined && annot[k] !== null && typeof annot[k] !== 'function'
      );
      if (otherKeys.length > 0) {
        line(`    ── Other fields ──`);
        otherKeys.forEach(key => {
          try {
            const val = annot[key];
            if (typeof val === 'object') {
              const str = JSON.stringify(val);
              line(`    ${key}: ${str.length > 200 ? str.substring(0, 200) + '...' : str}`);
            } else {
              line(`    ${key}: ${val}`);
            }
          } catch {
            line(`    ${key}: [cannot stringify]`);
          }
        });
      }
      
      line();
    });
  }
  
  line(`Total parsed annotations: ${totalParsed}`);
  line();
  divider();
  line();
  
  // ─── PART 3: Summary of unique field names found across all annotations ──
  line(`PART 3: FIELD INVENTORY`);
  line(`Unique fields found across all PDF.js annotations and which subtypes have them.`);
  divider('-');
  line();
  
  const fieldMap = {}; // field -> Set of subtypes that have it
  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const annotations = await page.getAnnotations();
    annotations.filter(a => a.rect && a.subtype !== 'Link' && a.subtype !== 'Widget').forEach(annot => {
      Object.keys(annot).forEach(key => {
        if (annot[key] !== undefined && annot[key] !== null && typeof annot[key] !== 'function') {
          if (!fieldMap[key]) fieldMap[key] = new Set();
          fieldMap[key].add(annot.subtype);
        }
      });
    });
  }
  
  const sortedFields = Object.keys(fieldMap).sort();
  sortedFields.forEach(field => {
    const subtypes = [...fieldMap[field]].sort().join(', ');
    line(`  ${field.padEnd(30)} → ${subtypes}`);
  });
  
  line();
  divider();
  
  // ─── Combine and optionally download ──────────────────────────────────────
  const text = lines.join('\n');
  
  if (download) {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `annotation-dump_${fileName.replace(/\.pdf$/i, '')}_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.log(`📋 Annotation dump downloaded (${lines.length} lines, ${text.length} chars)`);
  }
  
  return text;
}
