// Worker de pdf.js, précédé des fonctions récentes qui manquent aux anciennes WebView (voir pdf-polyfills.ts).
import './pdf-polyfills';
import 'pdfjs-dist/legacy/build/pdf.worker.min.mjs';
