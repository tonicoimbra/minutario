(function (global) {
  if (typeof global.browser !== "undefined" && global.browser.runtime) {
    global.chrome = global.browser;
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
