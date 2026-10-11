import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { downloadPdfUrl } from '../../utils/pdfUtils';

function PdfViewerSession({ fileName, previewUrl, isOpen, onClose, onOpen }) {
  const [pdf, setPdf] = useState(null);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [zoom, setZoom] = useState('width');
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const viewportRef = useRef(null);
  const canvasHostRef = useRef(null);
  const dialogRef = useRef(null);
  const activeDocumentRef = useRef(null);

  useEffect(() => {
    if (!isOpen || !previewUrl) return undefined;
    let cancelled = false;
    let task;
    setPdf(null);
    setPage(1);
    setPageInput('1');
    setZoom('width');
    setError('');
    setSaveStatus('');
    import('../../utils/pdfRenderer').then(async ({ loadPdfDocument }) => {
      if (cancelled) return;
      task = loadPdfDocument(previewUrl);
      const document = await task.promise;
      if (!cancelled) {
        activeDocumentRef.current = document;
        setPdf(document);
      }
    }).catch(() => {
      if (!cancelled) setError('Could not display this PDF. You can still download it or open it in a new tab.');
    });
    return () => {
      cancelled = true;
      activeDocumentRef.current = null;
      task?.destroy()?.catch(() => {});
    };
  }, [isOpen, previewUrl]);

  useEffect(() => {
    if (!isOpen || !previewUrl) return undefined;
    const previousFocus = document.activeElement;
    dialogRef.current?.focus();
    const viewport = viewportRef.current;
    const measure = () => setSize({ width: viewport.clientWidth, height: viewport.clientHeight });
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(viewport);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      previousFocus?.focus?.();
    };
  }, [isOpen, previewUrl]);

  useEffect(() => {
    setPageInput(String(page));
    viewportRef.current?.scrollTo?.(0, 0);
  }, [page]);

  useEffect(() => {
    if (!isOpen || !pdf || activeDocumentRef.current !== pdf || !size.width) return undefined;
    let cancelled = false;
    let renderTask;
    const host = canvasHostRef.current;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `Report page ${page} of ${pdf.numPages}`);
    host.replaceChildren(canvas);
    setError('');
    setRendering(true);
    // getPage can throw synchronously after the worker has been destroyed.
    // Keep that failure inside the preview, and ignore work from a closed session.
    Promise.resolve().then(() => {
      if (cancelled || activeDocumentRef.current !== pdf) return null;
      return pdf.getPage(page);
    }).then(async (pdfPage) => {
      if (cancelled || !pdfPage || activeDocumentRef.current !== pdf) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const fitWidth = Math.max(0.1, (size.width - 40) / base.width);
      const scale = zoom === 'width' ? fitWidth
        : zoom === 'page' ? Math.min(fitWidth, Math.max(0.1, (size.height - 40) / base.height))
          : Number(zoom) / 100 * (96 / 72);
      const viewport = pdfPage.getViewport({ scale });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.ceil(viewport.width * ratio);
      canvas.height = Math.ceil(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      renderTask = pdfPage.render({ canvas, viewport,
        transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0] });
      await renderTask.promise;
      if (!cancelled) setRendering(false);
    }).catch((cause) => {
      if (!cancelled && cause?.name !== 'RenderingCancelledException') {
        setRendering(false);
        setError('Could not render this page. Try opening the PDF in a new tab.');
      }
    });
    return () => { cancelled = true; renderTask?.cancel(); canvas.remove(); };
  }, [isOpen, pdf, page, zoom, size]);

  const goToPage = (number) => setPage(Math.max(1, Math.min(pdf?.numPages || 1, number)));
  const commitPage = () => {
    const number = Number(pageInput);
    if (Number.isInteger(number) && number >= 1 && number <= (pdf?.numPages || 1)) goToPage(number);
    else setPageInput(String(page));
  };
  const download = async () => {
    setSaving(true);
    setSaveStatus('');
    try {
      const result = await downloadPdfUrl(previewUrl, fileName || 'report.pdf');
      if (result.saved) setSaveStatus(result.fallback ? 'Downloaded using your browser download settings.' : 'PDF saved.');
    } catch (cause) {
      setSaveStatus(cause?.message || 'Could not save the PDF. Please try again.');
    } finally { setSaving(false); }
  };

  if (!isOpen || !previewUrl) return null;
  return createPortal(
    <div className="rs-modal__backdrop rs-pdf-backdrop">
      <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Report preview"
        className="rs-modal rs-modal--preview" onKeyDown={(event) => {
          if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
          if (event.key === 'Tab') {
            const controls = Array.from(dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)'));
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }
        }}>
        <div className="rs-modal__titlebar">
          <span>{fileName || 'Report Preview'}</span>
          <div className="rs-modal__actions">
            <button type="button" className="rs-btn" onClick={download} disabled={saving}>{saving ? 'Saving...' : 'Download PDF'}</button>
            <button type="button" className="rs-btn" onClick={onOpen}>Open In New Tab</button>
            <button type="button" className="rs-modal__close" onClick={onClose} aria-label="Close preview">x</button>
          </div>
        </div>
        <div className="rs-pdf-toolbar" aria-label="PDF navigation">
          <button type="button" className="rs-btn" onClick={() => goToPage(1)} disabled={!pdf || page === 1}>First</button>
          <button type="button" className="rs-btn" onClick={() => goToPage(page - 1)} disabled={!pdf || page === 1}>Previous</button>
          <label>Page <input aria-label="Page number" type="number" min="1" max={pdf?.numPages || 1} value={pageInput}
            disabled={!pdf} onChange={(event) => setPageInput(event.target.value)} onBlur={commitPage}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitPage(); } }} /></label>
          <span>of {pdf?.numPages || '—'}</span>
          <button type="button" className="rs-btn" onClick={() => goToPage(page + 1)} disabled={!pdf || page === pdf.numPages}>Next</button>
          <button type="button" className="rs-btn" onClick={() => goToPage(pdf.numPages)} disabled={!pdf || page === pdf.numPages}>Last</button>
          <label>Zoom <select aria-label="Zoom" value={zoom} onChange={(event) => setZoom(event.target.value)}>
            <option value="width">Fit width</option><option value="page">Fit page</option>
            {[50, 75, 100, 125, 150, 200, 300].map((value) => <option key={value} value={String(value)}>{value}%</option>)}
          </select></label>
        </div>
        {error && <div className="rs-message is-error" role="alert">{error}</div>}
        <div className="rs-pdf-canvas-viewport" ref={viewportRef} aria-busy={!pdf || rendering}>
          <div className="rs-pdf-canvas-host" ref={canvasHostRef} />
        </div>
        <div className="rs-pdf-status" role="status">
          <span>{!pdf ? (error ? 'Preview unavailable' : 'Loading report...') : rendering ? 'Rendering page...' : `Current page: ${page} / ${pdf.numPages}`}</span>
          <span>{saveStatus}</span>
        </div>
      </section>
    </div>, document.body
  );
}

export default function PdfViewer(props) {
  // A reopened or replaced report must never inherit a destroyed document proxy.
  if (!props.isOpen || !props.previewUrl) return null;
  return <PdfViewerSession key={props.previewUrl} {...props} />;
}
