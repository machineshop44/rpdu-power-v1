(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RPDU_VERSION = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const APP_NAME = "rPDU Power";
  const VERSION_LABEL = "v1";
  const SEMVER = "1.3.0";
  return {
    APP_NAME: APP_NAME,
    VERSION_LABEL: VERSION_LABEL,
    SEMVER: SEMVER,
    DISPLAY_NAME: APP_NAME + " " + VERSION_LABEL,
  };
});
