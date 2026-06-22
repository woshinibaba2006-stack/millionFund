(function() {
    // Filter specific warning messages from tesseract wasm core
    const origWarn = console.warn.bind(console)
    const origError = console.error.bind(console)

    function shouldFilter(msg) {
        try {
            if (!msg) return false
            const s = String(msg)
            return s.includes('Parameter not found') || s.includes('allow_blob_division') || s.includes('language_model_ngram') || s.includes('segsearch_max_char_wh_ratio')
        } catch (e) { return false }
    }
    console.warn = function(...args) {
        try { if (args.some(a => shouldFilter(a))) return } catch (e) {}
        origWarn(...args)
    }
    console.error = function(...args) {
        try { if (args.some(a => shouldFilter(a))) return } catch (e) {}
        origError(...args)
    }

    // Load the official worker script from CDN to ensure compatibility with the bundle.
    // Using CDN keeps this wrapper compact; change to a local path if you host worker.min.js locally.
    importScripts('https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js');
})();