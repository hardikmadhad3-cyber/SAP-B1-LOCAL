const PDF_DATA_PREFIX = 'data:application/pdf;base64,';
export const PDF_SAVE_PICKER_ID = 'sap-b1-document-print';

const escapeHtml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const normalizeBase64Pdf = (value) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('The PDF response is empty.');
  }

  return value
    .trim()
    .replace(PDF_DATA_PREFIX, '')
    .replace(/\s+/g, '');
};

export const base64ToPdfBlob = (base64Pdf) => {
  const normalizedBase64 = normalizeBase64Pdf(base64Pdf);
  const byteCharacters = atob(normalizedBase64);
  const chunkSize = 512;
  const byteArrays = [];

  for (let offset = 0; offset < byteCharacters.length; offset += chunkSize) {
    const slice = byteCharacters.slice(offset, offset + chunkSize);
    const byteNumbers = new Array(slice.length);

    for (let index = 0; index < slice.length; index += 1) {
      byteNumbers[index] = slice.charCodeAt(index);
    }

    byteArrays.push(new Uint8Array(byteNumbers));
  }

  return new Blob(byteArrays, { type: 'application/pdf' });
};

const writePdfPreviewDocument = (targetWindow, objectUrl, title) => {
  const safeTitle = escapeHtml(title || 'PDF Preview');
  const safeUrl = escapeHtml(objectUrl);

  targetWindow.document.open();
  targetWindow.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${safeTitle}</title>
  <style>
    html,
    body {
      width: 100%;
      height: 100%;
      margin: 0;
      background: #f5f6f7;
      overflow: hidden;
    }

    iframe {
      width: 100%;
      height: 100%;
      border: 0;
      display: block;
      background: #fff;
    }
  </style>
</head>
<body>
  <iframe src="${safeUrl}" title="${safeTitle}"></iframe>
</body>
</html>`);
  targetWindow.document.close();
};

export const openPdfBlobInNewTab = (blob, previewWindow = null, options = {}) => {
  const objectUrl = URL.createObjectURL(blob);
  const targetWindow = previewWindow || window.open('', '_blank', 'noopener,noreferrer');

  if (!targetWindow) {
    URL.revokeObjectURL(objectUrl);
    throw new Error('Please allow pop-ups to preview the PDF.');
  }

  try {
    targetWindow.opener = null;
  } catch (_error) {
    // Some browsers block touching opener after a cross-origin navigation.
  }

  try {
    writePdfPreviewDocument(targetWindow, objectUrl, options.title || options.fileName);
  } catch (_error) {
    if (typeof targetWindow.location?.replace === 'function') {
      targetWindow.location.replace(objectUrl);
    } else {
      targetWindow.location.href = objectUrl;
    }
  }

  try {
    targetWindow.addEventListener('beforeunload', () => URL.revokeObjectURL(objectUrl), { once: true });
  } catch (_error) {
    // Keep the timeout cleanup below as the cross-browser fallback.
  }

  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 10 * 60 * 1000);

  return objectUrl;
};

const normalizePdfFileName = (fileName = 'document.pdf') => {
  const safeName = String(fileName || 'document.pdf')
    .trim()
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/g, '');
  return /\.pdf$/i.test(safeName) ? safeName : `${safeName || 'document'}.pdf`;
};

export const choosePdfSaveTarget = async (fileName = 'document.pdf') => {
  const suggestedName = normalizePdfFileName(fileName);

  if (typeof window.showSaveFilePicker !== 'function') {
    return { kind: 'browser-download', fileName: suggestedName };
  }

  try {
    const fileHandle = await window.showSaveFilePicker({
      id: PDF_SAVE_PICKER_ID,
      suggestedName,
      types: [{
        description: 'PDF document',
        accept: { 'application/pdf': ['.pdf'] },
      }],
      excludeAcceptAllOption: false,
    });
    return {
      kind: 'file-system',
      fileHandle,
      fileName: fileHandle?.name || suggestedName,
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      return { kind: 'cancelled', cancelled: true, fileName: suggestedName };
    }
    throw error;
  }
};

export const savePdfBlobToTarget = async (blob, fileName = 'document.pdf', target = null) => {
  const saveTarget = target || await choosePdfSaveTarget(fileName);
  if (saveTarget?.cancelled || saveTarget?.kind === 'cancelled') {
    return { saved: false, cancelled: true, fileName: saveTarget?.fileName || normalizePdfFileName(fileName) };
  }

  if (saveTarget?.kind === 'file-system' && saveTarget.fileHandle) {
    const writable = await saveTarget.fileHandle.createWritable();
    try {
      await writable.write(blob);
    } finally {
      await writable.close();
    }
    return { saved: true, cancelled: false, fileName: saveTarget.fileName || normalizePdfFileName(fileName) };
  }

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = objectUrl;
  anchor.download = saveTarget?.fileName || normalizePdfFileName(fileName);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 0);

  return {
    saved: true,
    cancelled: false,
    fileName: saveTarget?.fileName || normalizePdfFileName(fileName),
    fallback: true,
  };
};

export const downloadPdfBlob = async (blob, fileName = 'document.pdf') => (
  savePdfBlobToTarget(blob, fileName)
);

export const downloadPdfUrl = async (url, fileName = 'report.pdf') => {
  // Open the picker during the click gesture, before fetching the PDF bytes.
  const target = await choosePdfSaveTarget(fileName);
  if (target.cancelled) return { saved: false, cancelled: true };
  const response = await fetch(url);
  if (!response.ok) throw new Error('Could not read the PDF for download.');
  return savePdfBlobToTarget(await response.blob(), fileName, target);
};
