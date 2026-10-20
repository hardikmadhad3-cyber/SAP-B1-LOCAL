const fs = require("fs");
const path = require("path");

const UPLOAD_DIR = path.join(__dirname, "../uploads");

// Attachments live per company, object kind and record
// (uploads/<kind>/<companyId>/<key>/), so the same code in two companies never
// shares files. Names are reduced to a plain file name: no folders, no "..".
const safeFileName = (value) => path.basename(String(value || ""))
  .replace(/[^A-Za-z0-9._ ()-]/g, "_").replace(/^\.+/, "").trim().slice(0, 180);

const attachmentError = (res, error) => res.status(error.status || 500).json({ message: error.message });

// Express handlers for one object kind. `param` names the route's record key,
// `baseUrl` is the API path the rows link back to.
const makeAttachmentHandlers = ({ kind, param, baseUrl }) => {
  const dirOf = (req) => {
    const companyId = Number(req.auth?.companyId);
    const key = safeFileName(req.params[param]);
    if (!(companyId > 0) || !key) {
      throw Object.assign(new Error("Select a company and save the record first."), { status: 400 });
    }
    return path.join(UPLOAD_DIR, kind, String(companyId), key);
  };
  const fileOf = (req) => {
    const name = safeFileName(req.params.attachmentId);
    if (!name) throw Object.assign(new Error("Invalid attachment name."), { status: 400 });
    return path.join(dirOf(req), name);
  };
  const rowOf = (key, dir, name) => {
    const stat = fs.statSync(path.join(dir, name));
    return {
      id: name, name, fileName: name, size: stat.size, type: path.extname(name).slice(1).toUpperCase(),
      attachmentDate: stat.mtime.toISOString().slice(0, 10),
      url: `${baseUrl}/${encodeURIComponent(key)}/attachments/${encodeURIComponent(name)}`,
    };
  };
  return {
    list: (req, res) => {
      try {
        const dir = dirOf(req);
        if (!fs.existsSync(dir)) return res.json([]);
        res.json(fs.readdirSync(dir).map((name) => rowOf(req.params[param], dir, name)));
      } catch (error) { attachmentError(res, error); }
    },
    upload: (req, res) => {
      try {
        if (!req.file) return res.status(400).json({ message: "No file uploaded." });
        const dir = dirOf(req);
        const name = safeFileName(req.file.originalname);
        if (!name) throw Object.assign(new Error("Invalid attachment name."), { status: 400 });
        fs.mkdirSync(dir, { recursive: true });
        fs.renameSync(req.file.path, path.join(dir, name));
        res.json(rowOf(req.params[param], dir, name));
      } catch (error) {
        if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        attachmentError(res, error);
      }
    },
    remove: (req, res) => {
      try {
        const file = fileOf(req);
        if (fs.existsSync(file)) fs.unlinkSync(file);
        res.json({ success: true });
      } catch (error) { attachmentError(res, error); }
    },
    serve: (req, res) => {
      try {
        const file = fileOf(req);
        if (!fs.existsSync(file)) return res.status(404).json({ message: "File not found." });
        res.download(file);
      } catch (error) { attachmentError(res, error); }
    },
  };
};

// Mounts GET/POST /:param/attachments and GET/DELETE /:param/attachments/:attachmentId.
const mountAttachments = (router, upload, options) => {
  const handlers = makeAttachmentHandlers(options);
  const base = `/:${options.param}/attachments`;
  router.get(base, handlers.list);
  router.post(base, upload.single("file"), handlers.upload);
  router.get(`${base}/:attachmentId`, handlers.serve);
  router.delete(`${base}/:attachmentId`, handlers.remove);
  return handlers;
};

module.exports = { makeAttachmentHandlers, mountAttachments, safeFileName };
