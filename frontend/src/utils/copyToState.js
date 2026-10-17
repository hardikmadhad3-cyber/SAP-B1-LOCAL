import {
  buildActiveCompanyScopedSessionKey,
  createActiveCompanyScopedRouteState,
} from './companyStorageScope';

const COPY_TO_STORAGE_PREFIX = 'sap-copy-to:';
const WINDOW_STATE_STORAGE_PREFIX = 'sap-window-state:';
const TASKBAR_STORAGE_KEY = 'sap-window-taskbar/tasks';

export const normalizeCopyToPath = (path) =>
  `/${String(path || '').replace(/^\/+/, '')}`;

const normalizeDocType = (docType) =>
  String(docType || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

const firstCopyToValue = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
};

export const buildSapCopyToRemarks = ({
  sourceLabel = 'Document',
  sourceDocNo,
  sourceDocEntry,
  header = {},
} = {}) => {
  const documentNo = firstCopyToValue(
    sourceDocNo,
    header.docNo,
    header.DocNum,
    header.docNum,
    header.DocNo,
    header.documentNumber,
    header.number,
    sourceDocEntry
  );
  const label = firstCopyToValue(sourceLabel) || 'Document';

  return documentNo ? `Based on ${label} ${documentNo}.` : `Based on ${label}.`;
};

const combineCopyToRemarks = (manualRemarks, baseRemarks) => {
  const manual = String(manualRemarks || '').trim();
  const base = String(baseRemarks || '').trim();

  if (!manual) return base;
  if (!base || manual.includes(base)) return manual;
  return `${manual}\n${base}`;
};

const buildCopyToHeader = ({
  header,
  sourceLabel,
  sourceDocNo,
  sourceDocEntry,
}) => {
  const copiedHeader = { ...(header || {}) };
  const baseRemarks = buildSapCopyToRemarks({
    sourceLabel,
    sourceDocNo,
    sourceDocEntry,
    header: copiedHeader,
  });
  const remarks = combineCopyToRemarks(
    firstCopyToValue(copiedHeader.otherInstruction, copiedHeader.remarks, copiedHeader.Comments),
    baseRemarks
  );

  return {
    ...copiedHeader,
    remarks,
    otherInstruction: remarks,
    Comments: remarks,
  };
};

export const createDocumentWindowId = (docType, docEntry) =>
  `page-window:${normalizeDocType(docType)}-${docEntry || 'new'}`;

export const createCopyToWindowId = (targetDocType, sourceDocType, sourceDocEntry) =>
  `page-window:${normalizeDocType(targetDocType)}-copy-from-${normalizeDocType(sourceDocType)}-${sourceDocEntry}`;

export const persistCopyToState = (path, state) => {
  if (typeof window === 'undefined') return;

  const normalizedPath = normalizeCopyToPath(path);
  window.sessionStorage.setItem(
    buildActiveCompanyScopedSessionKey(`${COPY_TO_STORAGE_PREFIX}${normalizedPath}`),
    JSON.stringify(state)
  );
};

export const consumeCopyToState = (pathname, aliases = []) => {
  if (typeof window === 'undefined') return null;

  const normalizedPath = normalizeCopyToPath(pathname);
  const paths = [normalizedPath, ...aliases.map(normalizeCopyToPath)];
  const uniquePaths = Array.from(new Set(paths));

  for (const path of uniquePaths) {
    const storageKey = buildActiveCompanyScopedSessionKey(`${COPY_TO_STORAGE_PREFIX}${path}`);
    const rawValue = window.sessionStorage.getItem(storageKey);
    window.sessionStorage.removeItem(storageKey);

    if (!rawValue) continue;

    try {
      const parsedValue = JSON.parse(rawValue);
      if (parsedValue && typeof parsedValue === 'object') {
        return parsedValue;
      }
    } catch (_error) {
      return null;
    }
  }

  return null;
};

export const getWindowOnlyRouteState = (state) =>
  state?.sapWindow ? createActiveCompanyScopedRouteState({ sapWindow: state.sapWindow }) : null;

export const replaceRouteStatePreservingWindow = (navigate, pathname, state) => {
  if (!navigate) return;
  navigate(pathname, { replace: true, state: getWindowOnlyRouteState(state) });
};

export const getDocumentStatusMessage = (action) =>
  (action === 'close' ? 'Document closed.' : 'Document cancelled.');

// After SAP Data > Cancel/Close, re-open the same document through the page's
// own load-by-docEntry route effect; that load shows documentStatusMessage.
export const reloadRouteDocument = (navigate, location, stateKey, docEntry, action) => {
  if (!navigate || !docEntry) return;
  navigate(location.pathname, {
    replace: true,
    state: createActiveCompanyScopedRouteState({
      ...getWindowOnlyRouteState(location.state),
      [stateKey]: docEntry,
      documentStatusMessage: getDocumentStatusMessage(action),
    }),
  });
};

export const restoreTargetWindowState =(path, taskId = null) => {
  if (typeof window === 'undefined') return;

  const normalizedPath = normalizeCopyToPath(path);
  const normalizedTaskId = taskId || `page-window:${normalizedPath}`;
  window.sessionStorage.setItem(
    buildActiveCompanyScopedSessionKey(`${WINDOW_STATE_STORAGE_PREFIX}${normalizedTaskId}`),
    JSON.stringify({ isMaximized: false, isMinimized: false })
  );
};

const getStoredTask = (taskId) => {
  if (!taskId || typeof window === 'undefined') return null;

  try {
    const storageKey = buildActiveCompanyScopedSessionKey(TASKBAR_STORAGE_KEY);
    const tasks = JSON.parse(window.sessionStorage.getItem(storageKey) || '[]');
    return Array.isArray(tasks) ? tasks.find((task) => task?.id === taskId) || null : null;
  } catch (_error) {
    return null;
  }
};

export const minimizeSourceDocumentWindow = ({
  pathname,
  title = 'Document',
  restoreState = null,
  upsertTask,
  dispatchEvent = false,
} = {}) => {
  if (typeof window === 'undefined') return;

  const normalizedPath = normalizeCopyToPath(pathname || window.location.pathname);
  const taskId = restoreState?.sapWindow?.id || `page-window:${normalizedPath}`;

  window.sessionStorage.setItem(
    buildActiveCompanyScopedSessionKey(`${WINDOW_STATE_STORAGE_PREFIX}${taskId}`),
    JSON.stringify({ isMaximized: false, isMinimized: true })
  );

  upsertTask?.({
    id: taskId,
    path: normalizedPath,
    title,
    state: restoreState,
  });

  if (dispatchEvent) {
    window.dispatchEvent(new CustomEvent('sap-window-minimize-active'));
  }
};

export const buildCopyToState = ({
  sourceDocType,
  sourceLabel,
  sourceDocEntry,
  sourceDocNo,
  header,
  lines,
  headerUdfs,
  baseType,
  loadMode,
  extraCopyFrom = {},
  extraState = {},
}) => ({
  ...extraState,
  copyFrom: {
    type: sourceDocType,
    sourceLabel,
    docEntry: sourceDocEntry,
    docNo: firstCopyToValue(sourceDocNo, header?.docNo, header?.DocNum, header?.docNum, header?.DocNo),
    header: buildCopyToHeader({
      header,
      sourceLabel,
      sourceDocNo,
      sourceDocEntry,
    }),
    lines: Array.isArray(lines)
      ? lines.map((line, index) => {
          const sourceLineNum = line?.lineNum ?? line?.LineNum ?? index;
          return {
            ...line,
            lineNum: sourceLineNum,
            previousBaseType: line?.baseType ?? line?.BaseType,
            previousBaseEntry: line?.baseEntry ?? line?.BaseEntry,
            previousBaseLine: line?.baseLine ?? line?.BaseLine,
            baseType,
            baseEntry: sourceDocEntry,
            baseLine: sourceLineNum,
          };
        })
      : [],
    ...(headerUdfs ? { headerUdfs: { ...headerUdfs } } : {}),
    ...(loadMode ? { loadMode } : {}),
    baseDocument: {
      baseType,
      baseEntry: sourceDocEntry,
    },
    ...extraCopyFrom,
  },
});

export const openCopyToDocument = ({
  sourceDocType,
  sourceLabel = 'Document',
  sourceDocEntry,
  sourceDocNo,
  sourcePath,
  targetDocType,
  targetLabel = 'Target Document',
  targetPath,
  targetAliases = [],
  copyState,
  restoreState = {},
  navigate,
  upsertTask,
  removeTask,
  beforeNavigate,
  errorMessage = 'Open a saved document before using Copy To.',
  setError,
}) => {
  if (!sourceDocEntry) {
    setError?.(errorMessage);
    return false;
  }

  if (!targetPath || !navigate || !copyState?.copyFrom) {
    setError?.('Copy To is not configured for this target document.');
    return false;
  }

  const normalizedSourcePath = normalizeCopyToPath(sourcePath || (typeof window !== 'undefined' ? window.location.pathname : ''));
  const normalizedTargetPath = normalizeCopyToPath(targetPath);
  const activeSourceWindowId = restoreState?.sapWindow?.id || `page-window:${normalizedSourcePath}`;
  const legacySourceWindowId = createDocumentWindowId(sourceDocType, sourceDocEntry);
  const sourceWindowId = activeSourceWindowId;
  const targetWindowId = createCopyToWindowId(targetDocType, sourceDocType, sourceDocEntry);
  const sourceTitle = `${sourceLabel}${sourceDocNo || sourceDocEntry ? ` #${sourceDocNo || sourceDocEntry}` : ''}`;
  const targetTitle = `${targetLabel}${sourceDocNo || sourceDocEntry ? ` - ${sourceLabel} #${sourceDocNo || sourceDocEntry}` : ''}`;
  const sourceWindow = {
    id: sourceWindowId,
    path: normalizedSourcePath,
    title: sourceTitle,
  };
  const targetWindow = {
    id: targetWindowId,
    path: normalizedTargetPath,
    title: targetTitle,
  };
  const sourceRestoreState = createActiveCompanyScopedRouteState({
    ...restoreState,
    sapWindow: sourceWindow,
  });
  const targetState = createActiveCompanyScopedRouteState({
    ...copyState,
    sapWindow: targetWindow,
  });
  const existingTargetTask = getStoredTask(targetWindowId);

  // Temporary trace for Copy To hardening.
  console.info('[CopyTo] opening target window', {
    sourceDocType,
    sourceDocEntry,
    targetDocType,
    targetRoute: normalizedTargetPath,
    sourceWindowId,
    targetWindowId,
    existingTargetWindow: Boolean(existingTargetTask),
  });

  beforeNavigate?.();
  removeTask?.(legacySourceWindowId);
  minimizeSourceDocumentWindow({
    pathname: normalizedSourcePath,
    title: sourceTitle,
    restoreState: sourceRestoreState,
    upsertTask,
    dispatchEvent: true,
  });
  restoreTargetWindowState(normalizedTargetPath, targetWindowId);
  [normalizedTargetPath, ...targetAliases.map(normalizeCopyToPath)].forEach((path) => {
    persistCopyToState(path, targetState);
  });
  removeTask?.(targetWindowId);
  navigate(normalizedTargetPath, { state: targetState, replace: false });
  return true;
};
