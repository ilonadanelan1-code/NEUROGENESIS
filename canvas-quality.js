(() => {
  "use strict";

  const DEFAULT_MAX_PIXELS = 2800000;
  const DEFAULT_MAX_DIMENSION = 8192;

  function positive(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function resolve(cssWidth, cssHeight, devicePixelRatio, options = {}) {
    const width = positive(cssWidth, 1);
    const height = positive(cssHeight, 1);
    const settings = options && typeof options === "object" ? options : {};
    const requestedDpr = Math.min(
      positive(devicePixelRatio, 1),
      positive(settings.maxDpr, 2.25)
    );
    const maxPixels = Math.max(1, Math.floor(positive(settings.maxPixels, DEFAULT_MAX_PIXELS)));
    const maxDimension = Math.max(1, Math.floor(positive(settings.maxDimension, DEFAULT_MAX_DIMENSION)));

    let dpr = Math.min(
      requestedDpr,
      Math.sqrt(maxPixels / (width * height)),
      maxDimension / width,
      maxDimension / height
    );
    if (!Number.isFinite(dpr) || dpr <= 0) dpr = Math.min(requestedDpr, 1);

    let backingWidth = 1;
    let backingHeight = 1;
    for (let attempt = 0; attempt < 32; attempt++) {
      backingWidth = Math.max(1, Math.round(width * dpr));
      backingHeight = Math.max(1, Math.round(height * dpr));
      if (backingWidth <= maxDimension &&
          backingHeight <= maxDimension &&
          backingWidth * backingHeight <= maxPixels) break;
      dpr *= 0.995;
    }

    backingWidth = Math.min(maxDimension, backingWidth);
    backingHeight = Math.min(maxDimension, backingHeight);
    return Object.freeze({
      cssWidth: width,
      cssHeight: height,
      dpr,
      requestedDpr,
      backingWidth,
      backingHeight,
      pixels: backingWidth * backingHeight,
      maxPixels,
      limited: dpr + 1e-4 < requestedDpr
    });
  }

  globalThis.NGCanvasQuality = Object.freeze({
    resolve,
    DEFAULT_MAX_PIXELS,
    DEFAULT_MAX_DIMENSION
  });
})();
