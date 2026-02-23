/**
 * PDF Markups API Route
 * Add this to your Express server to enable saving PDF markups
 * 
 * Required dependencies:
 *   npm install pdf-lib
 * 
 * Add to your server:
 *   const pdfMarkupsRoute = require('./pdf-markups-route');
 *   app.use('/api/pdf', pdfMarkupsRoute);
 */

const express = require('express');
const router = express.Router();
const { PDFDocument, rgb, StandardFonts, PDFName, pushGraphicsState, popGraphicsState, setFillingColor, moveTo, lineTo, closePath, fill } = require('pdf-lib');
const fs = require('fs').promises;
const path = require('path');

// Helper to convert hex color to RGB
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (result) {
    return {
      r: parseInt(result[1], 16) / 255,
      g: parseInt(result[2], 16) / 255,
      b: parseInt(result[3], 16) / 255
    };
  }
  return { r: 0, g: 0, b: 0 };
}

// Helper to remove annotations from a page by their IDs
function removeAnnotationsFromPage(page, annotIdsToRemove) {
  if (!annotIdsToRemove || annotIdsToRemove.length === 0) return 0;
  
  try {
    const pageDict = page.node;
    const annotsRef = pageDict.get(PDFName.of('Annots'));
    
    if (!annotsRef) return 0;
    
    // Get the actual annots array
    const annots = pageDict.context.lookup(annotsRef);
    if (!annots || !annots.asArray) return 0;
    
    const annotsArray = annots.asArray();
    let removedCount = 0;
    
    // Build a set of IDs to remove for faster lookup
    const idsToRemove = new Set(annotIdsToRemove.map(id => String(id)));
    
    // Filter out annotations that match the IDs to remove
    const filteredAnnots = annotsArray.filter(annotRef => {
      try {
        const annot = pageDict.context.lookup(annotRef);
        if (!annot) return true; // Keep if we can't look it up
        
        // Get annotation name/ID - check various possible fields
        const nmEntry = annot.get(PDFName.of('NM')); // Name
        const tEntry = annot.get(PDFName.of('T')); // Title
        
        // Also check the object reference number as ID
        const refString = annotRef.toString();
        const refMatch = refString.match(/(\d+)\s+\d+\s+R/);
        const refId = refMatch ? refMatch[1] + 'R' : null;
        
        // Check if any ID matches
        let annotId = null;
        if (nmEntry) {
          annotId = nmEntry.decodeText ? nmEntry.decodeText() : nmEntry.toString();
        }
        
        const shouldRemove = idsToRemove.has(annotId) || 
                             idsToRemove.has(refId) ||
                             (tEntry && idsToRemove.has(tEntry.toString()));
        
        if (shouldRemove) {
          removedCount++;
          console.log(`Removing annotation: ${annotId || refId}`);
          return false; // Remove this annotation
        }
        return true; // Keep this annotation
      } catch (e) {
        console.log('Error checking annotation:', e.message);
        return true; // Keep on error
      }
    });
    
    // Update the page's Annots array if we removed any
    if (removedCount > 0) {
      // Create new array with remaining annotations
      const newAnnotsArray = pageDict.context.obj(filteredAnnots);
      pageDict.set(PDFName.of('Annots'), newAnnotsArray);
    }
    
    return removedCount;
  } catch (error) {
    console.error('Error removing annotations:', error);
    return 0;
  }
}

// Save PDF with markups
router.post('/save-markups', async (req, res) => {
  try {
    const { pdfFilename, markups, annotationsToRemove, flatten, canvasWidth, canvasHeight } = req.body;
    
    if (!pdfFilename || !markups) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    console.log('Save markups request:', {
      filename: pdfFilename,
      markupsCount: markups.length,
      annotationsToRemove: annotationsToRemove || []
    });
    
    // Load the original PDF
    const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
    const pdfPath = path.join(uploadsDir, pdfFilename);
    
    const existingPdfBytes = await fs.readFile(pdfPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const pages = pdfDoc.getPages();
    
    // Remove original annotations that are being modified
    if (annotationsToRemove && annotationsToRemove.length > 0) {
      console.log('Attempting to remove annotations:', annotationsToRemove);
      for (let i = 0; i < pages.length; i++) {
        const removed = removeAnnotationsFromPage(pages[i], annotationsToRemove);
        if (removed > 0) {
          console.log(`Removed ${removed} annotations from page ${i + 1}`);
        }
      }
    }
    
    // Load font for text annotations
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    
    // Group markups by page
    const markupsByPage = {};
    markups.forEach(m => {
      if (!markupsByPage[m.page]) markupsByPage[m.page] = [];
      markupsByPage[m.page].push(m);
    });
    
    // Process each page with markups
    for (const [pageNum, pageMarkups] of Object.entries(markupsByPage)) {
      const pageIndex = parseInt(pageNum);
      if (pageIndex >= pages.length) continue;
      
      const page = pages[pageIndex];
      const { width: pageWidth, height: pageHeight } = page.getSize();
      
      // Convert canvas coordinates to PDF coordinates
      // PDF origin is bottom-left, canvas origin is top-left
      const scaleX = pageWidth / canvasWidth;
      const scaleY = pageHeight / canvasHeight;
      
      for (const markup of pageMarkups) {
        // Handle 'none' color - use black as fallback for parsing but check before use
        const colorHex = (markup.color && markup.color !== 'none') ? markup.color : '#000000';
        const color = hexToRgb(colorHex);
        const rgbColor = rgb(color.r, color.g, color.b);
        
        if (markup.type === 'pen' || markup.type === 'highlighter') {
          // Draw path as a series of lines
          if (markup.points && markup.points.length >= 2) {
            const opacity = markup.type === 'highlighter' ? (markup.opacity || 0.4) : 1;
            
            for (let i = 1; i < markup.points.length; i++) {
              const p1 = markup.points[i - 1];
              const p2 = markup.points[i];
              
              // Convert coordinates (flip Y axis for PDF)
              const x1 = p1.x * pageWidth;
              const y1 = pageHeight - (p1.y * pageHeight);
              const x2 = p2.x * pageWidth;
              const y2 = pageHeight - (p2.y * pageHeight);
              
              page.drawLine({
                start: { x: x1, y: y1 },
                end: { x: x2, y: y2 },
                thickness: markup.strokeWidth * scaleX,
                color: rgbColor,
                opacity: opacity
              });
            }
          }
        } else if (markup.type === 'rectangle') {
          const x = Math.min(markup.startX, markup.endX) * pageWidth;
          const y = pageHeight - (Math.max(markup.startY, markup.endY) * pageHeight);
          const w = Math.abs(markup.endX - markup.startX) * pageWidth;
          const h = Math.abs(markup.endY - markup.startY) * pageHeight;
          
          console.log('Processing rectangle:', {
            fillColor: markup.fillColor,
            color: markup.color,
            opacity: markup.opacity
          });
          
          // Handle fill color
          let fillColor = null;
          if (markup.fillColor && markup.fillColor !== 'none') {
            const fill = hexToRgb(markup.fillColor);
            fillColor = rgb(fill.r, fill.g, fill.b);
          }
          
          // Handle line color (can be 'none')
          const hasStroke = markup.color && markup.color !== 'none';
          
          page.drawRectangle({
            x, y, width: w, height: h,
            borderColor: hasStroke ? rgbColor : undefined,
            borderWidth: hasStroke ? markup.strokeWidth * scaleX : 0,
            color: fillColor || undefined,
            opacity: markup.opacity || 1
          });
        } else if (markup.type === 'circle') {
          const cx = ((markup.startX + markup.endX) / 2) * pageWidth;
          const cy = pageHeight - (((markup.startY + markup.endY) / 2) * pageHeight);
          const rx = Math.abs(markup.endX - markup.startX) * pageWidth / 2;
          const ry = Math.abs(markup.endY - markup.startY) * pageHeight / 2;
          
          // Handle fill color
          let fillColor = null;
          if (markup.fillColor && markup.fillColor !== 'none') {
            const fill = hexToRgb(markup.fillColor);
            fillColor = rgb(fill.r, fill.g, fill.b);
          }
          
          // Handle line color (can be 'none')
          const hasStroke = markup.color && markup.color !== 'none';
          
          page.drawEllipse({
            x: cx, y: cy,
            xScale: rx, yScale: ry,
            borderColor: hasStroke ? rgbColor : undefined,
            borderWidth: hasStroke ? markup.strokeWidth * scaleX : 0,
            color: fillColor || undefined,
            opacity: markup.opacity || 1
          });
        } else if (markup.type === 'arrow') {
          const x1 = markup.startX * pageWidth;
          const y1 = pageHeight - (markup.startY * pageHeight);
          const x2 = markup.endX * pageWidth;
          const y2 = pageHeight - (markup.endY * pageHeight);
          const opacity = markup.opacity || 1;
          
          // Calculate arrowhead parameters
          const angle = Math.atan2(y2 - y1, x2 - x1);
          const arrowLength = 12 * scaleX;
          const arrowAngle = Math.PI / 7;
          
          // Shorten line so it doesn't poke through arrowhead (matching frontend)
          const lineEndX = x2 - arrowLength * 0.7 * Math.cos(angle);
          const lineEndY = y2 - arrowLength * 0.7 * Math.sin(angle);
          
          // Draw main line (shortened)
          page.drawLine({
            start: { x: x1, y: y1 },
            end: { x: lineEndX, y: lineEndY },
            thickness: markup.strokeWidth * scaleX,
            color: rgbColor,
            opacity: opacity
          });
          
          // Calculate arrowhead points
          const ax1 = x2 - arrowLength * Math.cos(angle - arrowAngle);
          const ay1 = y2 - arrowLength * Math.sin(angle - arrowAngle);
          const ax2 = x2 - arrowLength * Math.cos(angle + arrowAngle);
          const ay2 = y2 - arrowLength * Math.sin(angle + arrowAngle);
          
          // Draw filled triangle arrowhead
          page.drawSvgPath(`M ${x2} ${y2} L ${ax1} ${ay1} L ${ax2} ${ay2} Z`, {
            color: rgbColor,
            opacity: opacity
          });
        } else if (markup.type === 'text') {
          // Support both old format (x, y) and new text box format (startX, startY, endX, endY)
          const isTextBox = markup.startX !== undefined && markup.endX !== undefined;
          const fontSize = (markup.fontSize || 12) * scaleX;
          
          console.log('Processing text markup:', {
            isTextBox,
            startX: markup.startX,
            endX: markup.endX,
            text: markup.text?.substring(0, 30),
            fillColor: markup.fillColor,
            borderColor: markup.borderColor,
            textAlign: markup.textAlign
          });
          
          if (isTextBox) {
            // New text box format
            const boxX = Math.min(markup.startX, markup.endX) * pageWidth;
            const boxY = pageHeight - (Math.max(markup.startY, markup.endY) * pageHeight);
            const boxW = Math.abs(markup.endX - markup.startX) * pageWidth;
            const boxH = Math.abs(markup.endY - markup.startY) * pageHeight;
            const opacity = markup.opacity || 1;
            
            // Draw fill background if specified
            if (markup.fillColor && markup.fillColor !== 'none') {
              const fill = hexToRgb(markup.fillColor);
              page.drawRectangle({
                x: boxX, y: boxY, width: boxW, height: boxH,
                color: rgb(fill.r, fill.g, fill.b),
                opacity: opacity
              });
            }
            
            // Draw border if specified
            if (markup.borderColor && markup.borderColor !== 'none') {
              const border = hexToRgb(markup.borderColor);
              page.drawRectangle({
                x: boxX, y: boxY, width: boxW, height: boxH,
                borderColor: rgb(border.r, border.g, border.b),
                borderWidth: 1,
                opacity: opacity
              });
            }
            
            // Draw text with word wrap
            if (markup.text) {
              const padding = 4 * scaleX;
              const textX = boxX + padding;
              const textStartY = boxY + boxH - padding - fontSize; // Start from top
              
              // Simple word wrap
              const maxWidth = boxW - (padding * 2);
              const lines = [];
              const paragraphs = markup.text.split('\n');
              
              for (const para of paragraphs) {
                const words = para.split(' ');
                let currentLine = '';
                
                for (const word of words) {
                  const testLine = currentLine ? currentLine + ' ' + word : word;
                  const testWidth = font.widthOfTextAtSize(testLine, fontSize);
                  
                  if (testWidth > maxWidth && currentLine) {
                    lines.push(currentLine);
                    currentLine = word;
                  } else {
                    currentLine = testLine;
                  }
                }
                if (currentLine) lines.push(currentLine);
              }
              
              // Draw each line
              const lineHeight = fontSize * 1.2;
              for (let i = 0; i < lines.length; i++) {
                const lineY = textStartY - (i * lineHeight);
                if (lineY < boxY) break; // Stop if we exceed the box
                
                let lineX = textX;
                // Handle text alignment
                if (markup.textAlign === 'center') {
                  const lineWidth = font.widthOfTextAtSize(lines[i], fontSize);
                  lineX = boxX + (boxW - lineWidth) / 2;
                } else if (markup.textAlign === 'right') {
                  const lineWidth = font.widthOfTextAtSize(lines[i], fontSize);
                  lineX = boxX + boxW - padding - lineWidth;
                }
                
                page.drawText(lines[i], {
                  x: lineX, y: lineY,
                  size: fontSize,
                  font: font,
                  color: rgbColor
                });
              }
            }
          } else {
            // Old format - single position text
            const x = markup.x * pageWidth;
            const y = pageHeight - (markup.y * pageHeight);
            
            page.drawText(markup.text || '', {
              x, y,
              size: fontSize,
              font: font,
              color: rgbColor
            });
          }
        } else if (markup.type === 'line') {
          // Simple line (no arrowhead)
          const x1 = markup.startX * pageWidth;
          const y1 = pageHeight - (markup.startY * pageHeight);
          const x2 = markup.endX * pageWidth;
          const y2 = pageHeight - (markup.endY * pageHeight);
          
          page.drawLine({
            start: { x: x1, y: y1 },
            end: { x: x2, y: y2 },
            thickness: markup.strokeWidth * scaleX,
            color: rgbColor,
            opacity: markup.opacity || 1
          });
        } else if (markup.type === 'note') {
          // Sticky note - draw as a small colored square with text nearby
          const x = markup.x * pageWidth;
          const y = pageHeight - (markup.y * pageHeight);
          const noteSize = 20 * scaleX;
          const opacity = markup.opacity || 1;
          
          // Draw note icon
          page.drawRectangle({
            x: x - noteSize/2, y: y - noteSize/2,
            width: noteSize, height: noteSize,
            color: rgb(1, 0.95, 0.6), // Light yellow
            borderColor: rgb(0.8, 0.7, 0.3),
            borderWidth: 1,
            opacity: opacity
          });
          
          // If there's text, draw it next to the note
          if (markup.text) {
            const fontSize = 10 * scaleX;
            page.drawText(markup.text.substring(0, 50) + (markup.text.length > 50 ? '...' : ''), {
              x: x + noteSize, y: y,
              size: fontSize,
              font: font,
              color: rgb(0, 0, 0),
              opacity: opacity
            });
          }
        } else if (markup.type === 'polyline') {
          // Draw polygon/polyline
          const opacity = markup.opacity || 1;
          if (markup.points && markup.points.length >= 2) {
            for (let i = 0; i < markup.points.length; i++) {
              const p1 = markup.points[i];
              const p2 = markup.points[(i + 1) % markup.points.length];
              
              const x1 = p1.x * pageWidth;
              const y1 = pageHeight - (p1.y * pageHeight);
              const x2 = p2.x * pageWidth;
              const y2 = pageHeight - (p2.y * pageHeight);
              
              page.drawLine({
                start: { x: x1, y: y1 },
                end: { x: x2, y: y2 },
                thickness: markup.strokeWidth * scaleX,
                color: rgbColor,
                opacity: opacity
              });
            }
          }
        } else if (markup.type === 'cloud' || markup.type === 'callout') {
          // Draw as rectangle for now (cloud shape is complex)
          const x = Math.min(markup.startX, markup.endX) * pageWidth;
          const y = pageHeight - (Math.max(markup.startY, markup.endY) * pageHeight);
          const w = Math.abs(markup.endX - markup.startX) * pageWidth;
          const h = Math.abs(markup.endY - markup.startY) * pageHeight;
          
          page.drawRectangle({
            x, y, width: w, height: h,
            borderColor: rgbColor,
            borderWidth: markup.strokeWidth * scaleX,
            opacity: markup.opacity || 1
          });
        }
      }
    }
    
    // If flatten is requested, we need to render pages to images and create new PDF
    // For now, we'll just save the PDF with the drawn elements
    // (true flattening requires rendering to image and re-embedding)
    
    const pdfBytes = await pdfDoc.save();
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${flatten ? 'flattened_' : 'annotated_'}${pdfFilename}"`);
    res.send(Buffer.from(pdfBytes));
    
  } catch (error) {
    console.error('Error saving markups:', error);
    res.status(500).json({ error: 'Failed to save markups', details: error.message });
  }
});

module.exports = router;
