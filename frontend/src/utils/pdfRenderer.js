import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

const assets = `${process.env.PUBLIC_URL || ''}/pdfjs-assets`;
export const loadPdfDocument = (url) => getDocument({
  url,
  useSystemFonts: true,
  cMapUrl: `${assets}/cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${assets}/standard_fonts/`,
  wasmUrl: `${assets}/wasm/`,
});
