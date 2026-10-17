const stores = new Map();

const sanitizeKeyPart = (value) =>
  String(value ?? "")
    .replace(/[^a-zA-Z0-9:/?&=._~-]/g, "")
    .slice(0, 500);

const getStore = (namespace) => {
  if (!stores.has(namespace)) {
    stores.set(namespace, new Map());
  }

  return stores.get(namespace);
};

const getCacheKey = (req, namespace) => {
  const companyId = req.auth?.companyId || "public";
  const userId = req.auth?.userId || "anonymous";
  return [
    namespace,
    `company:${sanitizeKeyPart(companyId)}`,
    `user:${sanitizeKeyPart(userId)}`,
    sanitizeKeyPart(req.method),
    sanitizeKeyPart(req.originalUrl),
  ].join(":");
};

const getCachedValue = (store, key) => {
  const entry = store.get(key);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }

  return entry;
};

const clearCache = (namespace) => {
  if (namespace) {
    getStore(namespace).clear();
    return;
  }

  for (const store of stores.values()) {
    store.clear();
  }
};

const cacheMiddleware = ({ namespace, ttlSeconds, shouldCache }) => {
  const ttlMs = Number(ttlSeconds) * 1000;

  return (req, res, next) => {
    if (
      req.method !== "GET" ||
      !Number.isFinite(ttlMs) ||
      ttlMs <= 0 ||
      (shouldCache && !shouldCache(req))
    ) {
      return next();
    }

    const resolvedNamespace = typeof namespace === "function" ? namespace(req) : namespace;
    const store = getStore(resolvedNamespace);
    const key = getCacheKey(req, resolvedNamespace);
    const cached = getCachedValue(store, key);

    if (cached) {
      const ageSeconds = Math.max(0, Math.floor((Date.now() - cached.createdAt) / 1000));
      res.set("X-Cache", "HIT");
      res.set("X-Cache-Age", String(ageSeconds));
      res.set("Cache-Control", `private, max-age=${Math.min(ttlSeconds, 60)}`);
      return res.status(cached.statusCode).json(cached.body);
    }

    const originalJson = res.json.bind(res);
    res.set("X-Cache", "MISS");

    res.json = (body) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        store.set(key, {
          body,
          statusCode: res.statusCode,
          createdAt: Date.now(),
          expiresAt: Date.now() + ttlMs,
        });
      }

      return originalJson(body);
    };

    return next();
  };
};

const invalidateCacheMiddleware = (namespace) => (req, res, next) => {
  if (req.method === "GET") return next();

  res.on("finish", () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      clearCache(namespace);
      // Cached /lookup/ lists (30 min) hold master data too: a new UoM, group or
      // account must show in every page's dropdowns at once.
      for (const [name, store] of stores) {
        if (String(name).startsWith("lookup:")) store.clear();
      }
    }
  });

  return next();
};

module.exports = {
  cacheMiddleware,
  clearCache,
  invalidateCacheMiddleware,
};
