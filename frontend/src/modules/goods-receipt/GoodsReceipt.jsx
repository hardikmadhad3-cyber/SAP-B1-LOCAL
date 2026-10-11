import SapDateInput from '../../components/common/SapDateInput';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import '../purchase-order/styles/purchaseOrder.css';
import './styles/goodsReceipt.css';
import ContentsTab from './components/ContentsTab';
import AttachmentsTab from './components/AttachmentsTab';
import FormSettingsPanel from '../../components/purchase-order/FormSettingsPanel';
import HeaderUdfSidebar from '../../components/purchase-order/HeaderUdfSidebar';
import CopyFromModal from './components/CopyFromModal';
import ItemSelectionModal from '../../components/common/ItemSelectionModal';
import ReferenceInformationModal, {
  getInventoryReferenceDocumentTypeLabel,
} from './components/ReferenceInformationModal';
import BatchAllocationModal from '../../components/BatchAllocationModal';
import DistributionRuleAssignmentModal from '../../components/DistributionRuleAssignmentModal';
import LineValueLookupModal from '../../components/sales-document/LineValueLookupModal';
import InventoryPrintLayoutActions from '../../components/print-layout/InventoryPrintLayoutActions';
import JournalEntryPreviewButton from '../../components/journal-entry/JournalEntryPreviewButton';
import { useSapWindowTaskbarActions } from '../../components/SapWindowTaskbarContext';
import {
  BATCH_QTY_TOLERANCE,
  getRequiredBatchQty,
  sumBatchQty,
} from '../../utils/batchQuantity';
import {
  fetchGoodsReceiptBatchesByItem,
  fetchGoodsReceiptByDocEntry,
  fetchGoodsReceiptCopySource,
  fetchGoodsReceiptDistributionRules,
  fetchGoodsReceiptGoodsIssues,
  fetchGoodsReceiptItems,
  fetchGoodsReceiptMetadata,
  fetchGoodsReceiptNextBatchNumber,
  fetchGoodsReceiptSeries,
  fetchGoodsReceiptWarehouses,
  submitGoodsReceipt,
  updateGoodsReceipt,
} from '../../api/goodsReceiptApi';
import { useCompanyScopedFormSettings } from '../../utils/formSettingsStorage';
import { duplicateDocumentInPlace } from '../../utils/documentDuplicate';
import { getSapVisibleDocumentSeries } from '../../utils/seriesDefaults';
import {
  getDefaultInventoryPriceList,
  getInventoryItemPrice,
} from '../../utils/inventoryPriceLists';
import useValidationHighlights from '../../utils/useValidationHighlights';
import {
  GOODS_RECEIPT_FORM_SETTINGS_STORAGE_KEY,
  GOODS_RECEIPT_MATRIX_COLUMNS,
  normalizeUdfState,
  readSavedFormSettings,
} from '../../config/inventoryDocumentForm';
import { openLinkedReferenceDocument } from '../../utils/sapLinkedNavigation';
import { replaceRouteStatePreservingWindow } from '../../utils/copyToState';
import useDocumentDraftTask from '../../hooks/useDocumentDraftTask';

const TAB_NAMES = ['Contents', 'Attachments'];
const today = () => new Date().toISOString().split('T')[0];

const createUdfState = (definitions = [], values = {}) =>
  definitions.reduce((acc, field) => {
    acc[field.key] = values[field.key] ?? field.defaultValue ?? '';
    return acc;
  }, {});

const createLine = (rowUdfFields = []) => ({
  itemCode: '',
  itemDescription: '',
  quantity: '',
  unitPrice: '',
  total: '',
  binLocationAllocation: '',
  warehouse: '',
  accountCode: '',
  itemCost: '',
  uomCode: '',
  uomName: '',
  distributionRule: '',
  distributionRule2: '',
  distributionRule3: '',
  distributionRule4: '',
  distributionRule5: '',
  location: '',
  branch: '',
  batchManaged: false,
  serialManaged: false,
  batches: [],
  inventoryUOM: '',
  uomFactor: 1,
  baseEntry: null,
  baseLine: null,
  baseType: null,
  lockedByCopy: false,
  udf: createUdfState(rowUdfFields),
});

const createHeader = () => ({
  number: 'Auto',
  series: '',
  postingDate: today(),
  documentDate: today(),
  ref2: '',
  priceList: '',
  branch: '',
  referencedDocument: null,
  remarks: '',
  journalRemark: 'Goods Receipt',
});

const getItemFlags = (item) => ({
  batchManaged:
    item?.batchManaged === true ||
    String(item?.batchManaged ?? item?.BatchManaged ?? item?.ManBtchNum ?? '').toUpperCase() ===
      'Y',
  serialManaged:
    item?.serialManaged === true ||
    String(item?.serialManaged ?? item?.SerialManaged ?? item?.ManSerNum ?? '').toUpperCase() ===
      'Y',
  inventoryUOM:
    item?.inventoryUOM || item?.InventoryUOM || item?.uomName || item?.uomCode || '',
});

const buildDistributionDimensions = (rules = []) => {
  const dimensions = new Map();

  (rules || []).forEach((rule) => {
    const dimensionCode = String(rule.DimensionCode || rule.DimCode || rule.dimensionCode || '1').trim() || '1';
    if (!dimensions.has(dimensionCode)) {
      dimensions.set(dimensionCode, {
        DimensionCode: dimensionCode,
        DimensionName: rule.DimensionName || rule.DimName || `Dimension ${dimensionCode}`,
      });
    }
  });

  return [...dimensions.values()].sort((a, b) => Number(a.DimensionCode) - Number(b.DimensionCode));
};

function GoodsReceipt() {
  const location = useLocation();
  const navigate = useNavigate();
  const { upsertTask } = useSapWindowTaskbarActions();
  const formRef = useRef(null);
  const fileInputRef = useRef(null);
  const attachmentsRef = useRef([]);
  const [currentDocEntry, setCurrentDocEntry] = useState(null);
  const [header, setHeader] = useState(createHeader);
  const [lines, setLines] = useState([createLine()]);
  const [attachments, setAttachments] = useState([]);
  const [selectedAttachmentId, setSelectedAttachmentId] = useState(null);
  const [activeTab, setActiveTab] = useState('Contents');
  const [activeRow, setActiveRow] = useState(0);
  const [items, setItems] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [seriesOptions, setSeriesOptions] = useState([]);
  const [priceLists, setPriceLists] = useState([]);
  const [branches, setBranches] = useState([]);
  const [headerUdfFields, setHeaderUdfFields] = useState([]);
  const [headerUdfs, setHeaderUdfs] = useState({});
  const [rowUdfFields, setRowUdfFields] = useState([]);
  const [formSettings, setFormSettings, formSettingsStorageKey, , formSettingsStatus] = useCompanyScopedFormSettings(
    GOODS_RECEIPT_FORM_SETTINGS_STORAGE_KEY,
    readSavedFormSettings,
    [headerUdfFields, rowUdfFields, GOODS_RECEIPT_MATRIX_COLUMNS],
    { saveMode: 'explicit' },
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [formSettingsOpen, setFormSettingsOpen] = useState(false);
  const [distributionRules, setDistributionRules] = useState([]);
  const [distributionDimensions, setDistributionDimensions] = useState([]);
  const [locations, setLocations] = useState([]);
  const [businessPartners, setBusinessPartners] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [paymentTerms, setPaymentTerms] = useState([]);
  const [goodsIssues, setGoodsIssues] = useState([]);
  const [pageState, setPageState] = useState({
    loading: false,
    posting: false,
    error: '',
    success: '',
  });
  const [valErrors, setValErrors] = useState({
    lines: {},
    form: '',
  });
  const [isDirty, setIsDirty] = useState(false);
  useValidationHighlights(valErrors);
  const [copyFromModal, setCopyFromModal] = useState(false);
  const [selectedCopyDocEntry, setSelectedCopyDocEntry] = useState(null);
  const [copyLoading, setCopyLoading] = useState(false);
  const [batchModal, setBatchModal] = useState({
    open: false,
    lineIndex: null,
    availableBatches: [],
    loading: false,
    error: '',
  });
  const [referenceModalOpen, setReferenceModalOpen] = useState(false);
  const [referenceDocuments, setReferenceDocuments] = useState([]);
  const [referenceDocumentsChanged, setReferenceDocumentsChanged] = useState(false);
  const [itemModal, setItemModal] = useState({
    open: false,
    lineIndex: -1,
  });
  const [distributionRuleModal, setDistributionRuleModal] = useState({
    open: false,
    lineIndex: -1,
  });
  const [lineLookupModal, setLineLookupModal] = useState({
    open: false,
    lineIndex: -1,
    field: '',
    udfKey: '',
    title: '',
    options: [],
    columns: null,
  });
  const currentSeriesOption =
    seriesOptions.find((seriesOption) => seriesOption.series === String(header.series)) ||
    seriesOptions[0] ||
    null;
  const hasUnsavedChanges = Boolean(currentDocEntry && isDirty);
  const updateActionLabel = hasUnsavedChanges ? 'Update' : 'OK';
  const primaryActionLabel = pageState.posting
    ? 'Saving...'
    : currentDocEntry
      ? updateActionLabel
      : 'Add';
  useEffect(() => {
    const draft = location.state?.goodsReceiptDraft;
    if (!draft) return;

    setCurrentDocEntry(draft.currentDocEntry || null);
    setHeader(draft.header || createHeader());
    setLines(Array.isArray(draft.lines) && draft.lines.length ? draft.lines : [createLine(rowUdfFields)]);
    setHeaderUdfs(draft.headerUdfs || {});
    setReferenceDocuments(Array.isArray(draft.referenceDocuments) ? draft.referenceDocuments : []);
    setReferenceDocumentsChanged(Boolean(draft.referenceDocumentsChanged));
    setActiveTab(draft.activeTab || 'Contents');
    setIsDirty(Boolean(draft.isDirty));
    replaceRouteStatePreservingWindow(navigate, location.pathname, location.state);
  }, [location.state, navigate, location.pathname, rowUdfFields]);

  const buildLinkedRestoreState = useCallback(() => ({
    goodsReceiptDraft: {
      currentDocEntry,
      header,
      lines,
      headerUdfs,
      referenceDocuments,
      referenceDocumentsChanged,
      activeTab,
      isDirty,
    },
  }), [activeTab, currentDocEntry, header, headerUdfs, isDirty, lines, referenceDocuments, referenceDocumentsChanged]);

  useDocumentDraftTask({
    buildDraftState: buildLinkedRestoreState,
    title: 'Goods Receipt',
  });

  const openReferenceDocumentLink = useCallback((row) => {
    openLinkedReferenceDocument({
      transactionType: row?.transactionType,
      docEntry: row?.docEntry,
      docNumber: row?.docNumber,
      sourcePath: location.pathname,
      sourceTitle: `Goods Receipt${header.number || currentDocEntry ? ` #${header.number || currentDocEntry}` : ''}`,
      sourceRestoreState: buildLinkedRestoreState(),
      navigate,
      upsertTask,
    });
  }, [buildLinkedRestoreState, currentDocEntry, header.number, location.pathname, navigate, upsertTask]);

  const markDirty = (event) => {
    if (event?.target?.closest?.('[data-document-dirty-ignore="true"]')) return;
    if (currentDocEntry) setIsDirty(true);
  };
  const defaultPriceList = getDefaultInventoryPriceList(priceLists);
  const defaultBranch = branches[0] || null;
  const getBranchName = useCallback(
    (branchValue) => {
      const rawValue = String(branchValue ?? '').trim();
      if (!rawValue) return '';

      const match = branches.find(
        (branch) =>
          String(branch.id ?? '').trim() === rawValue ||
          String(branch.name ?? '').trim() === rawValue
      );
      return match?.name || rawValue;
    },
    [branches]
  );
  const headerBranchName = getBranchName(header.branch);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!event.target.closest('.po-dropdown')) {
        document
          .querySelectorAll('.po-dropdown')
          .forEach((dropdown) => dropdown.classList.remove('active'));
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const branchFilteredWarehouses = header.branch
    ? warehouses.filter(
        (warehouse) => !warehouse.branchId || warehouse.branchId === String(header.branch)
      )
    : warehouses;

  const getItem = (itemCode) => items.find((item) => item.itemCode === itemCode);
  const getWarehouseLocationCode = (warehouseCode) => {
    const warehouse = warehouses.find((entry) => entry.whsCode === warehouseCode);
    return warehouse?.locationCode != null ? String(warehouse.locationCode) : '';
  };

  const getItemPrice = (item, priceList) => {
    return getInventoryItemPrice(item, priceList);
  };

  const normalizeLine = (line) => {
    const quantity = Number(line.quantity || 0);
    const unitPrice = Number(line.unitPrice || 0);

    return {
      ...line,
      quantity: line.quantity === '' ? '' : String(line.quantity),
      unitPrice: line.unitPrice === '' ? '' : String(line.unitPrice),
      total:
        quantity > 0 || unitPrice > 0
          ? (quantity * unitPrice).toFixed(2)
          : line.total || '0.00',
      itemCost:
        line.itemCost === '' || line.itemCost == null
          ? ''
          : Number(line.itemCost).toFixed(2),
      batches: Array.isArray(line.batches) ? line.batches : [],
    };
  };

  const hydrateLineMetadata = useCallback(
    (line, sourceItems = items) => {
      const item = sourceItems.find((entry) => entry.itemCode === line.itemCode);
      if (!item) {
        return normalizeLine(line);
      }

      const itemFlags = getItemFlags(item);
      return normalizeLine({
        ...line,
        accountCode: line.accountCode || item.accountCode || '',
        itemCost:
          line.itemCost === '' || line.itemCost == null
            ? item.itemCost != null
              ? String(item.itemCost)
              : ''
            : line.itemCost,
        uomCode: line.uomCode || item.uomCode || '',
        uomName: line.uomName || item.uomName || '',
        batchManaged: itemFlags.batchManaged,
        serialManaged: itemFlags.serialManaged,
        inventoryUOM: line.inventoryUOM || itemFlags.inventoryUOM,
        uomFactor: line.uomFactor || 1,
      });
    },
    [items]
  );

  const patchLineFromItem = (line, itemCode, priceList = header.priceList) => {
    const item = getItem(itemCode);
    if (!item) {
      return normalizeLine({
        ...createLine(rowUdfFields),
        location: line.location || '',
        branch: header.branch || '',
      });
    }

    const itemFlags = getItemFlags(item);
    const fallbackWarehouse = branchFilteredWarehouses[0]?.whsCode || warehouses[0]?.whsCode || '';
    const warehouseCode = line.warehouse || item.defaultWarehouse || fallbackWarehouse;
    return normalizeLine({
      ...line,
      itemCode: item.itemCode,
      itemDescription: item.itemName,
      unitPrice:
        line.baseEntry != null || line.lockedByCopy
          ? line.unitPrice
          : String(getItemPrice(item, priceList)),
      warehouse: warehouseCode,
      accountCode: line.accountCode || item.accountCode || '',
      itemCost: item.itemCost != null ? String(item.itemCost) : '',
      uomCode: item.uomCode || '',
      uomName: item.uomName || '',
      location: getWarehouseLocationCode(warehouseCode),
      branch: line.branch || header.branch || '',
      batchManaged: itemFlags.batchManaged,
      serialManaged: itemFlags.serialManaged,
      batches: [],
      inventoryUOM: itemFlags.inventoryUOM,
      uomFactor: 1,
    });
  };

  useEffect(() => {
    setLines((current) =>
      current.map((line) => ({
        ...line,
        branch: line.branch || header.branch || '',
      }))
    );
  }, [header.branch]);

  useEffect(() => {
    let ignore = false;

    const load = async () => {
      setPageState((current) => ({ ...current, loading: true, error: '', success: '' }));

      try {
        const [
          metadataResponse,
          itemsResponse,
          warehousesResponse,
          seriesResponse,
          goodsIssuesResponse,
        ] = await Promise.all([
          fetchGoodsReceiptMetadata(),
          fetchGoodsReceiptItems(),
          fetchGoodsReceiptWarehouses(),
          fetchGoodsReceiptSeries({ date: today() }),
          fetchGoodsReceiptGoodsIssues(),
        ]);

        if (ignore) return;

        const metadata = metadataResponse.data || {};
        const loadedItems = itemsResponse.data || [];
        const loadedWarehouses = warehousesResponse.data || [];
        const getLoadedWarehouseLocationCode = (warehouseCode) => {
          const warehouse = loadedWarehouses.find((entry) => entry.whsCode === warehouseCode);
          return warehouse?.locationCode != null ? String(warehouse.locationCode) : '';
        };
        const loadedSeries = seriesResponse.data || [];
        const defaultSeries =
          loadedSeries.find((series) => series.isDefault) || loadedSeries[0] || null;
        const nextDefaultPriceList = getDefaultInventoryPriceList(metadata.priceLists);
        const nextDefaultBranch = metadata.branches?.[0] || null;

        setItems(loadedItems);
        setWarehouses(loadedWarehouses);
        setSeriesOptions(loadedSeries);
        setPriceLists(metadata.priceLists || []);
        setBranches(metadata.branches || []);
        const nextHeaderUdfs = metadata.udfMetadata?.header || [];
        const nextRowUdfs = metadata.udfMetadata?.rows || [];

        setHeaderUdfFields(nextHeaderUdfs);
        setHeaderUdfs((current) => normalizeUdfState(nextHeaderUdfs, current));
        setRowUdfFields(nextRowUdfs);
        setFormSettings((current) => {
          const nextDefaults = readSavedFormSettings(
            nextHeaderUdfs,
            nextRowUdfs,
            GOODS_RECEIPT_MATRIX_COLUMNS,
            formSettingsStorageKey
          );
          return {
            headerUdfs: {
              ...nextDefaults.headerUdfs,
              ...(current.headerUdfs || {}),
            },
            matrixColumns: {
              ...nextDefaults.matrixColumns,
              ...(current.matrixColumns || {}),
            },
            rowUdfs: {
              ...nextDefaults.rowUdfs,
              ...(current.rowUdfs || {}),
            },
          };
        });
        setDistributionRules(metadata.distributionRules || []);
        setDistributionDimensions(metadata.distributionDimensions || []);
        setLocations(metadata.locations || []);
        setBusinessPartners(metadata.businessPartners || []);
        setAccounts(metadata.accounts || []);
        setPaymentTerms(metadata.paymentTerms || []);
        setGoodsIssues(goodsIssuesResponse.data || []);
        setHeader((current) => ({
          ...current,
          series: current.series || defaultSeries?.series || '',
          number: defaultSeries?.nextNumber || current.number,
          priceList: current.priceList || nextDefaultPriceList?.id || '',
          branch: current.branch || nextDefaultBranch?.id || '',
        }));
        setLines((current) =>
          current.map((line) =>
            line.itemCode
              ? hydrateLineMetadata(
                  {
                    ...line,
                    udf: createUdfState(metadata.udfMetadata?.rows || [], line.udf || {}),
                    itemCode: line.itemCode,
                    location: line.location || getLoadedWarehouseLocationCode(line.warehouse),
                    branch: line.branch || header.branch || nextDefaultBranch?.id || '',
                  },
                  loadedItems
                )
              : {
                  ...line,
                  udf: createUdfState(metadata.udfMetadata?.rows || [], line.udf || {}),
                  location: line.location || getLoadedWarehouseLocationCode(line.warehouse),
                  branch: line.branch || header.branch || nextDefaultBranch?.id || '',
                }
          )
        );
      } catch (error) {
        if (!ignore) {
          setPageState((current) => ({
            ...current,
            error:
              error.response?.data?.message ||
              error.message ||
              'Failed to load Goods Receipt reference data.',
          }));
        }
      } finally {
        if (!ignore) {
          setPageState((current) => ({ ...current, loading: false }));
        }
      }
    };

    load();

    return () => {
      ignore = true;
      attachmentsRef.current.forEach((attachment) => {
        if (attachment.previewUrl) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      });
    };
  }, []);

  useEffect(() => {
    const docEntry = location.state?.goodsReceiptDocEntry;
    if (!docEntry) return;

    let ignore = false;

    const load = async () => {
      setPageState((current) => ({ ...current, loading: true, error: '', success: '' }));

      try {
        const response = await fetchGoodsReceiptByDocEntry(docEntry);
        const document = response.data;
        if (ignore || !document) return;

        setCurrentDocEntry(document.docEntry || Number(docEntry));
        setHeader(() => ({
          ...createHeader(),
          ...document.header,
        }));
        setReferenceDocuments(document.reference_documents || document.referenceDocuments || []);
        setReferenceDocumentsChanged(false);
        setHeaderUdfs(document.headerUdfs || {});
        setLines(
          Array.isArray(document.lines) && document.lines.length
            ? document.lines.map((line) => hydrateLineMetadata({ ...createLine(rowUdfFields), ...line, udf: createUdfState(rowUdfFields, line.udf || {}) }))
            : [{ ...createLine(rowUdfFields), location: '', branch: document.header?.branch || '' }]
        );
        setAttachments([]);
        setSelectedAttachmentId(null);
        setActiveTab('Contents');
        setValErrors({ lines: {}, form: '' });
        setIsDirty(false);
        setPageState((current) => ({
          ...current,
          success: document.docNum
            ? `Goods Receipt ${document.docNum} loaded.`
            : 'Goods Receipt loaded.',
        }));
      } catch (error) {
        if (!ignore) {
          setPageState((current) => ({
            ...current,
            error:
              error.response?.data?.message ||
              error.message ||
              'Failed to load goods receipt.',
          }));
        }
      } finally {
        if (!ignore) {
          setPageState((current) => ({ ...current, loading: false }));
          navigate(location.pathname, { replace: true, state: null });
        }
      }
    };

    load();

    return () => {
      ignore = true;
    };
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    let ignore = false;
    fetchGoodsReceiptSeries({ date: header.postingDate, branch: header.branch })
      .then((response) => {
        if (ignore) return;
        const rows = response.data || [];
        setSeriesOptions(rows);
        setHeader((current) => {
          if (rows.some((row) => String(row.series) === String(current.series))) return current;
          const fallback = rows.find((row) => row.isDefault) || rows[0];
          return fallback
            ? { ...current, series: fallback.series, number: fallback.nextNumber || current.number }
            : current;
        });
      })
      .catch(() => {});
    return () => { ignore = true; };
  }, [header.postingDate, header.branch]);

  const handleHeaderChange = (field, value) => {
    setHeader((current) => {
      const next = { ...current, [field]: value };
      if (field === 'series') {
        const selectedSeries = seriesOptions.find(
          (seriesOption) => seriesOption.series === String(value)
        );
        next.number = selectedSeries?.nextNumber || 'Auto';
      }
      return next;
    });

    if (field === 'priceList') {
      setLines((current) =>
        current.map((line) =>
          line.itemCode && line.baseEntry == null
            ? patchLineFromItem(line, line.itemCode, value)
            : line
        )
      );
    }

    if (field === 'branch') {
      setLines((current) =>
        current.map((line) => ({
          ...line,
          branch: line.baseEntry != null ? line.branch : value,
        }))
      );
    }
  };

  const handleItemChange = (rowIndex, itemCode) => {
    setLines((current) =>
      current.map((line, index) =>
        index === rowIndex ? patchLineFromItem({ ...line, itemCode }, itemCode) : line
      )
    );
  };

  const handleItemCodeChange = (rowIndex, itemCode) => {
    setLines((current) =>
      current.map((line, index) =>
        index === rowIndex ? normalizeLine({ ...line, itemCode }) : line
      )
    );
  };

  const handleItemCommit = (rowIndex) => {
    const line = lines[rowIndex];
    const itemCode = String(line?.itemCode || '').trim();

    if (!itemCode) return;
    if (!getItem(itemCode)) return;

    handleItemChange(rowIndex, itemCode);
  };

  const handleLineChange = (rowIndex, field, value) => {
    setLines((current) =>
      current.map((line, index) => {
        if (index !== rowIndex) return line;
        const warehouseChanged = field === 'warehouse' && line.warehouse !== value;

        return normalizeLine({
          ...line,
          [field]: value,
          location: warehouseChanged ? getWarehouseLocationCode(value) : line.location,
          batches: warehouseChanged ? [] : line.batches || [],
        });
      })
    );
  };

  const handleRowUdfChange = (rowIndex, fieldKey, value) => {
    setLines((current) =>
      current.map((line, index) =>
        index === rowIndex
          ? { ...line, udf: { ...(line.udf || {}), [fieldKey]: value } }
          : line
      )
    );
  };

  const handleHeaderUdfChange = (fieldKey, value) => {
    setHeaderUdfs((current) => ({
      ...current,
      [fieldKey]: value,
    }));
  };

  const updateFormSetting = (groupKey, fieldKey, settingKey, value) => {
    setFormSettings((current) => ({
      ...current,
      [groupKey]: {
        ...(current[groupKey] || {}),
        [fieldKey]: {
          ...(current[groupKey]?.[fieldKey] || {}),
          [settingKey]: value,
        },
      },
    }));
  };

  const lookupOptions = useMemo(() => ({
    distRule: (distributionRules || []).map((rule) => ({
      value: rule.FactorCode || rule.OcrCode || rule.code || '',
      description: rule.FactorDescription || rule.OcrName || rule.name || '',
      code: rule.FactorCode || rule.OcrCode || rule.code || '',
      name: rule.FactorDescription || rule.OcrName || rule.name || '',
    })).filter((option) => option.value),
    location: (locations || []).map((entry) => ({
      value: String(entry.code ?? entry.Code ?? ''),
      description: entry.name || entry.Location || entry.Name || '',
      code: String(entry.code ?? entry.Code ?? ''),
      name: entry.name || entry.Location || entry.Name || '',
    })).filter((option) => option.value),
    item: (items || []).map((item) => ({
      value: item.itemCode || '',
      description: item.itemName || '',
      code: item.itemCode || '',
      name: item.itemName || '',
    })).filter((option) => option.value),
    businessPartner: (businessPartners || []).map((partner) => ({
      value: partner.CardCode || partner.code || '',
      description: partner.CardName || partner.name || '',
      code: partner.CardCode || partner.code || '',
      name: partner.CardName || partner.name || '',
    })).filter((option) => option.value),
    account: (accounts || []).map((account) => ({
      value: account.code || account.Code || '',
      description: account.name || account.Name || '',
      code: account.code || account.Code || '',
      name: account.name || account.Name || '',
    })).filter((option) => option.value),
    paymentTerm: (paymentTerms || []).map((term) => ({
      value: term.name || term.PymntGroup || String(term.code ?? term.GroupNum ?? ''),
      description: term.code != null || term.GroupNum != null ? `Code: ${term.code ?? term.GroupNum}` : '',
      code: String(term.code ?? term.GroupNum ?? ''),
      name: term.name || term.PymntGroup || '',
    })).filter((option) => option.value),
  }), [accounts, businessPartners, distributionRules, items, locations, paymentTerms]);

  const openLineLookup = async (column, lineIndex, udfField = null) => {
    if (column.lookup === 'distRule') {
      setDistributionRuleModal({ open: true, lineIndex });
      try {
        const response = await fetchGoodsReceiptDistributionRules();
        const liveRules = Array.isArray(response.data) ? response.data : [];
        setDistributionRules(liveRules);
        setDistributionDimensions(buildDistributionDimensions(liveRules));
      } catch (error) {
        setPageState((current) => ({
          ...current,
          error: error.response?.data?.message || error.message || 'Failed to load distribution rules.',
        }));
      }
      return;
    }

    const options = lookupOptions[column.lookup] || [];
    setLineLookupModal({
      open: true,
      lineIndex,
      field: column.key,
      udfKey: udfField?.key || '',
      title: `List of ${column.label}`,
      options,
      columns: [
        { key: 'code', label: 'Code', width: 140, primary: true },
        { key: 'name', label: 'Description' },
      ],
    });

    if (column.lookup !== 'distRule') return;

    try {
      const response = await fetchGoodsReceiptDistributionRules();
      const liveRules = Array.isArray(response.data) ? response.data : [];
      const liveOptions = liveRules.map((rule) => ({
        value: rule.FactorCode || rule.OcrCode || rule.code || '',
        description: rule.FactorDescription || rule.OcrName || rule.name || '',
        code: rule.FactorCode || rule.OcrCode || rule.code || '',
        name: rule.FactorDescription || rule.OcrName || rule.name || '',
      })).filter((option) => option.value);

      setDistributionRules(liveRules);
      setLineLookupModal((current) => (
        current.open && current.lineIndex === lineIndex && current.field === column.key
          ? { ...current, options: liveOptions }
          : current
      ));
    } catch (error) {
      setPageState((current) => ({
        ...current,
        error: error.response?.data?.message || error.message || 'Failed to load distribution rules.',
      }));
    }
  };

  const closeDistributionRuleModal = () => {
    setDistributionRuleModal({ open: false, lineIndex: -1 });
  };

  const handleDistributionRuleApply = (valuesByDimension = {}) => {
    const fieldByDimension = {
      1: 'distributionRule',
      2: 'distributionRule2',
      3: 'distributionRule3',
      4: 'distributionRule4',
      5: 'distributionRule5',
    };
    const lineIndex = distributionRuleModal.lineIndex;

    if (lineIndex < 0) {
      closeDistributionRuleModal();
      return;
    }

    setLines((current) => current.map((line, index) => {
      if (index !== lineIndex) return line;
      const next = { ...line };
      Object.entries(valuesByDimension).forEach(([dimensionCode, ruleCode]) => {
        const fieldName = fieldByDimension[Number(dimensionCode)];
        if (fieldName) next[fieldName] = ruleCode || '';
      });
      return normalizeLine(next);
    }));
    setValErrors((current) => ({
      ...current,
      lines: {
        ...current.lines,
        [lineIndex]: {
          ...(current.lines[lineIndex] || {}),
          distributionRule: '',
        },
      },
      form: '',
    }));
    closeDistributionRuleModal();
  };

  const closeLineLookup = () => {
    setLineLookupModal((current) => ({ ...current, open: false, lineIndex: -1, field: '', udfKey: '' }));
  };

  const handleLineLookupSelect = (option) => {
    const { lineIndex, field, udfKey } = lineLookupModal;
    if (lineIndex < 0 || !field) return;
    const value = option?.value || '';
    const providerNameField = rowUdfFields.find((fieldDefinition) => {
      const identity = [fieldDefinition.key, fieldDefinition.sapField, fieldDefinition.aliasId, fieldDefinition.label]
        .join(' ')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
      return identity.includes('freightprovidername') || identity.includes('frtransname');
    });
    setLines((current) => current.map((line, index) => {
      if (index !== lineIndex) return line;
      if (udfKey) {
        const nextUdf = { ...(line.udf || {}), [udfKey]: value };
        if (field === 'freightProvider' && providerNameField) {
          nextUdf[providerNameField.key] = option?.description || option?.name || '';
        }
        return { ...line, udf: nextUdf };
      }
      return normalizeLine({ ...line, [field]: value });
    }));
    closeLineLookup();
  };

  const addLine = () => {
    setLines((current) => [
      ...current,
      { ...createLine(rowUdfFields), location: '', branch: header.branch || '' },
    ]);
  };

  const removeLine = (rowIndex) => {
    setLines((current) => {
      if (current.length === 1) {
        return [{ ...createLine(rowUdfFields), location: '', branch: header.branch || '' }];
      }
      return current.filter((_, index) => index !== rowIndex);
    });
  };

  const applyBatchValidation = (line, rowErrors) => {
    if (line.serialManaged) {
      rowErrors.batches = 'Serial-managed items are not yet supported.';
    }
    if (line.batchManaged) {
      if (!Array.isArray(line.batches) || line.batches.length === 0) {
        rowErrors.batches = 'Batch allocation is required.';
      } else {
        const requiredBatchQty = getRequiredBatchQty(line);
        const assignedBatchQty = sumBatchQty(line.batches);
        const inventoryUOM = line.inventoryUOM || line.uomName || line.uomCode || 'Base UoM';
        if (Math.abs(assignedBatchQty - requiredBatchQty) > BATCH_QTY_TOLERANCE) {
          rowErrors.quantity = `Batch quantity (${assignedBatchQty.toFixed(
            2
          )} ${inventoryUOM}) must match line quantity (${requiredBatchQty.toFixed(
            2
          )} ${inventoryUOM})`;
        }
      }
    }
  };

  const validateDocument = () => {
    const nextErrors = { lines: {}, form: '' };
    const activeLines = lines.filter((line) => line.itemCode || line.baseEntry != null);

    if (!activeLines.length) {
      nextErrors.form = 'Add at least one line before saving.';
    }

    lines.forEach((line, index) => {
      if (!line.itemCode && line.baseEntry == null) return;

      const rowErrors = {};
      if (line.baseEntry != null) {
        applyBatchValidation(line, rowErrors);
        if (Object.keys(rowErrors).length) {
          nextErrors.lines[index] = rowErrors;
        }
        return;
      }

      if (!line.itemCode) rowErrors.itemCode = 'Item required';
      if (line.itemCode && !getItem(line.itemCode)) rowErrors.itemCode = 'Invalid item';
      if (Number(line.quantity || 0) <= 0) rowErrors.quantity = 'Qty > 0';
      if (line.itemCode && !line.warehouse) rowErrors.warehouse = 'Warehouse required';
      applyBatchValidation(line, rowErrors);

      if (Object.keys(rowErrors).length) {
        nextErrors.lines[index] = rowErrors;
      }
    });

    setValErrors(nextErrors);
    return !nextErrors.form && Object.keys(nextErrors.lines).length === 0;
  };

  const resetForm = (options = {}) => {
    const { successMessage = '' } = options;
    const nextSeries = currentSeriesOption?.series || '';
    const nextBranch = header.branch || defaultBranch?.id || '';

    setIsDirty(false);
    setCurrentDocEntry(null);
    setHeader(() => ({
      ...createHeader(),
      series: nextSeries,
      number: currentSeriesOption?.nextNumber || 'Auto',
      priceList: header.priceList || defaultPriceList?.id || '',
      branch: nextBranch,
    }));
    setHeaderUdfs(normalizeUdfState(headerUdfFields));
    setReferenceDocuments([]);
    setReferenceDocumentsChanged(false);
    setLines([{ ...createLine(rowUdfFields), location: '', branch: nextBranch }]);
    attachmentsRef.current.forEach((attachment) => {
      if (attachment.previewUrl) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
    });
    setAttachments([]);
    setSelectedAttachmentId(null);
    setActiveTab('Contents');
    setValErrors({ lines: {}, form: '' });
    setPageState((current) => ({
      ...current,
      error: '',
      success: successMessage,
      posting: false,
    }));
  };

  const handleBrowseAttachment = () => {
    fileInputRef.current?.click();
  };

  const handleAttachmentFiles = (event) => {
    const incomingFiles = Array.from(event.target.files || []);
    if (!incomingFiles.length) return;

    const addedIds = [];

    setAttachments((current) => {
      const next = [...current];
      incomingFiles.forEach((file) => {
        const id = `${Date.now()}-${file.name}-${Math.random().toString(36).slice(2)}`;
        addedIds.push(id);
        next.push({
          id,
          targetPath: 'Local Upload',
          fileName: file.name,
          attachmentDate: today(),
          freeText: '',
          previewUrl: URL.createObjectURL(file),
          file,
        });
      });
      return next;
    });

    setSelectedAttachmentId(addedIds[0] || null);
    event.target.value = '';
  };

  const handleDisplayAttachment = () => {
    const target = attachments.find((attachment) => attachment.id === selectedAttachmentId);
    if (target?.previewUrl) {
      window.open(target.previewUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const handleDeleteAttachment = () => {
    setAttachments((current) => {
      const target = current.find((attachment) => attachment.id === selectedAttachmentId);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return current.filter((attachment) => attachment.id !== selectedAttachmentId);
    });
    setSelectedAttachmentId(null);
  };

  const handleAttachmentFreeTextChange = (attachmentId, freeText) => {
    setAttachments((current) =>
      current.map((attachment) =>
        attachment.id === attachmentId ? { ...attachment, freeText } : attachment
      )
    );
  };

  const openItemModal = (rowIndex) => {
    setItemModal({
      open: true,
      lineIndex: rowIndex,
    });
  };

  const closeItemModal = () => {
    setItemModal({
      open: false,
      lineIndex: -1,
    });
  };

  const handleItemSelect = (item) => {
    const lineIndex = itemModal.lineIndex;
    const itemCode = item?.itemCode || item?.ItemCode || '';

    if (lineIndex < 0 || !itemCode) {
      closeItemModal();
      return;
    }

    handleItemChange(lineIndex, itemCode);
    setActiveRow(lineIndex);
    closeItemModal();
  };

  const openBatchModal = async (lineIndex) => {
    const line = lines[lineIndex];
    if (!line?.itemCode) {
      setPageState((current) => ({
        ...current,
        error: 'Select an item before allocating batches.',
      }));
      return;
    }
    if (line?.serialManaged) {
      setPageState((current) => ({
        ...current,
        error: 'Serial-managed items are not yet supported on Goods Receipt.',
      }));
      return;
    }
    if (!line?.warehouse) {
      setPageState((current) => ({
        ...current,
        error: 'Select a warehouse before allocating batches.',
      }));
      return;
    }

    setBatchModal({
      open: true,
      lineIndex,
      availableBatches: [],
      loading: true,
      error: '',
    });

    try {
      const response = await fetchGoodsReceiptBatchesByItem(line.itemCode, line.warehouse);
      setBatchModal((current) =>
        current.open && current.lineIndex === lineIndex
          ? {
              open: true,
              lineIndex,
              availableBatches: response.data?.batches || [],
              loading: false,
              error: '',
            }
          : current
      );
    } catch (error) {
      setBatchModal((current) =>
        current.open && current.lineIndex === lineIndex
          ? {
              open: true,
              lineIndex,
              availableBatches: [],
              loading: false,
              error:
                error.response?.data?.message ||
                error.message ||
                'Failed to load warehouse batches.',
            }
          : current
      );
    }
  };

  const closeBatchModal = () => {
    setBatchModal({
      open: false,
      lineIndex: null,
      availableBatches: [],
      loading: false,
      error: '',
    });
  };

  const saveLineBatches = (nextBatches) => {
    if (batchModal.lineIndex == null) return;

    setLines((current) =>
      current.map((line, index) =>
        index === batchModal.lineIndex ? normalizeLine({ ...line, batches: nextBatches }) : line
      )
    );
    setValErrors((current) => ({
      ...current,
      lines: {
        ...current.lines,
        [batchModal.lineIndex]: {
          ...(current.lines[batchModal.lineIndex] || {}),
          batches: '',
          quantity: '',
        },
      },
      form: '',
    }));
    closeBatchModal();
  };

  const saveReferenceDocuments = (rows) => {
    setReferenceDocuments(rows);
    setReferenceDocumentsChanged(true);
    if (currentDocEntry) setIsDirty(true);
  };

  const openFirstBatchErrorModal = () => {
    const lineIndex = lines.findIndex((line) => {
      if (!line.itemCode || !line.batchManaged || line.serialManaged) return false;
      if (!Array.isArray(line.batches) || line.batches.length === 0) return true;
      const requiredBatchQty = getRequiredBatchQty(line);
      const assignedBatchQty = sumBatchQty(line.batches);
      return Math.abs(assignedBatchQty - requiredBatchQty) > BATCH_QTY_TOLERANCE;
    });

    if (lineIndex < 0) return;
    setActiveTab('Contents');
    window.setTimeout(() => openBatchModal(lineIndex), 0);
  };

  const openCopyFromModal = () => {
    setSelectedCopyDocEntry(null);
    setCopyFromModal(true);
  };

  const handleCopyFrom = async (docEntry = selectedCopyDocEntry) => {
    if (!docEntry) return;

    setCopyLoading(true);
    setPageState((current) => ({ ...current, error: '', success: '' }));

    try {
      const response = await fetchGoodsReceiptCopySource('goods-issue', docEntry);
      const payload = response.data || {};

      setHeader((current) => ({
        ...current,
        ...payload.header,
        number: current.number,
        series: current.series,
      }));
      setCurrentDocEntry(null);
      setLines(
        Array.isArray(payload.lines) && payload.lines.length
          ? payload.lines.map((line) => hydrateLineMetadata({ ...createLine(rowUdfFields), ...line }))
          : [{ ...createLine(rowUdfFields), location: '', branch: payload.header?.branch || header.branch || '' }]
      );
      setValErrors({ lines: {}, form: '' });
      setCopyFromModal(false);
      setPageState((current) => ({
        ...current,
        success: 'Copied from Goods Issue. Please review and save.',
      }));
    } catch (error) {
      setPageState((current) => ({
        ...current,
        error: error.response?.data?.message || error.message || 'Copy From failed.',
      }));
    } finally {
      setCopyLoading(false);
    }
  };

  const handleDuplicate = () => {
    const duplicated = duplicateDocumentInPlace({
      currentDocEntry,
      header,
      initialHeader: createHeader(),
      lines,
      createLine,
      rowUdfDefinitions: rowUdfFields,
      setCurrentDocEntry,
      setHeader,
      setLines,
      setActiveTab,
      setValErrors,
      setPageState,
      setIsDirty,
      navigate,
      location,
      successMessage: 'Goods Receipt duplicated. Review and add it as a new entry.',
    });

    if (!duplicated) return;

    setHeaderUdfs(normalizeUdfState(headerUdfFields, headerUdfs));
    setHeader((current) => ({
      ...current,
      series: current.series || currentSeriesOption?.series || '',
      number: currentSeriesOption?.nextNumber || 'Auto',
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (currentDocEntry && !hasUnsavedChanges) return;

    if (!validateDocument()) {
      setPageState((current) => ({
        ...current,
        error: 'Fix the highlighted line errors before saving.',
        success: '',
      }));
      openFirstBatchErrorModal();
      return;
    }

    setPageState((current) => ({ ...current, posting: true, error: '', success: '' }));

    try {
      const payload = {
        header,
        header_udfs: normalizeUdfState(headerUdfFields, headerUdfs),
        reference_documents: referenceDocuments,
        reference_documents_changed:
          referenceDocumentsChanged || (!currentDocEntry && referenceDocuments.length > 0),
        lines: lines
          .filter((line) => line.itemCode || line.baseEntry != null)
          .map((line) => ({
            itemCode: line.itemCode,
            itemDescription: line.itemDescription,
            quantity: Number(line.quantity || 0),
            unitPrice: Number(line.unitPrice || 0),
            total: Number(line.total || 0),
            warehouse: line.warehouse,
            accountCode: line.accountCode,
            itemCost: Number(line.itemCost || 0),
            uomCode: line.uomCode,
            uomName: line.uomName,
        uomNameEdited: line.uomNameEdited,
            distributionRule: line.distributionRule,
            distributionRule2: line.distributionRule2,
            distributionRule3: line.distributionRule3,
            distributionRule4: line.distributionRule4,
            distributionRule5: line.distributionRule5,
            location: line.location,
            branch: line.branch,
            batchManaged: line.batchManaged,
            serialManaged: line.serialManaged,
            batches: line.batches || [],
            baseEntry: line.baseEntry,
            baseLine: line.baseLine,
            baseType: line.baseType,
            udf: line.udf || {},
          })),
        attachments: attachments.map((attachment) => ({
          targetPath: attachment.targetPath,
          fileName: attachment.fileName,
          attachmentDate: attachment.attachmentDate,
          freeText: attachment.freeText,
        })),
      };

      const response = currentDocEntry
        ? await updateGoodsReceipt(currentDocEntry, payload)
        : await submitGoodsReceipt(payload);
      const result = response.data || {};
      const successMessage = `${result.message || 'Goods Receipt saved successfully.'} DocEntry: ${
        result.docEntry
      }, DocNum: ${result.docNum}`;

      if (!currentDocEntry) {
        resetForm({ successMessage });
        return;
      }

      setPageState((current) => ({
        ...current,
        posting: false,
        success: successMessage,
      }));

      if (result.docEntry != null) {
        setCurrentDocEntry(Number(result.docEntry));
      }
      setIsDirty(false);
      setReferenceDocumentsChanged(false);
      setHeader((current) => ({
        ...current,
        number: result.docNum != null ? String(result.docNum) : current.number,
      }));
      setValErrors({ lines: {}, form: '' });
    } catch (error) {
      setPageState((current) => ({
        ...current,
        posting: false,
        error:
          error.response?.data?.message ||
          error.message ||
          'Failed to save Goods Receipt.',
      }));
    }
  };

  const documentTotal = lines
    .filter((line) => line.itemCode || line.baseEntry != null)
    .reduce((sum, line) => sum + Number(line.total || 0), 0)
    .toFixed(2);

  const batchModalLine =
    batchModal.lineIndex != null
      ? {
          ...lines[batchModal.lineIndex],
          itemNo: lines[batchModal.lineIndex]?.itemCode,
          whse: lines[batchModal.lineIndex]?.warehouse,
        }
      : null;
  const visibleHeaderUdfFields = headerUdfFields.filter(
    (field) => formSettings.headerUdfs?.[field.key]?.visible !== false
  );
  const isRightSidebarOpen = sidebarOpen || formSettingsOpen;
  const primaryReferenceDocument = referenceDocuments.find(
    (row) => String(row.transactionType || row.docNumber || row.docEntry || '').trim()
  );
  const referencedDocumentDisplay = header.referencedDocument
    ? `${header.referencedDocument.sourceLabel} ${header.referencedDocument.docNum}`
    : primaryReferenceDocument
      ? `${getInventoryReferenceDocumentTypeLabel(primaryReferenceDocument.transactionType)} ${
          primaryReferenceDocument.docNumber || primaryReferenceDocument.docEntry
        }`
      : '';

  return (
    <form ref={formRef} className={`po-page sap-document-page gr-goods-receipt__page${isRightSidebarOpen ? ' po-page--sidebar-open' : ''}`} onSubmit={handleSubmit} onChangeCapture={markDirty}>
      <div className="po-toolbar sap-document-toolbar">
        <span className="po-toolbar__title sap-document-toolbar__title">
          Goods Receipt{currentDocEntry ? ` - #${header.number || currentDocEntry}` : ''}
        </span>
        <span className={`po-mode-badge po-mode-badge--${currentDocEntry ? 'update' : 'add'}`}>
          {currentDocEntry ? 'Update' : 'Add'} Mode
        </span>
        <button type="submit" className="po-btn po-btn--primary sap-document-toolbar__primary" disabled={pageState.posting} title={primaryActionLabel}>
          {primaryActionLabel}
        </button>
        <button
          type="button"
          className="po-btn sap-document-toolbar__cancel"
          onClick={resetForm}
          disabled={pageState.posting}
        >
          Cancel
        </button>
        <button type="button" className="po-btn sap-document-toolbar__find" onClick={() => navigate('/goods-receipt/find')}>
          Find
        </button>
        <button type="button" className="po-btn sap-document-toolbar__new" onClick={resetForm}>
          New
        </button>
        <button
          type="button"
          className="po-btn sap-document-toolbar__duplicate"
          onClick={handleDuplicate}
          disabled={!currentDocEntry}
        >
          Duplicate
        </button>
        <button type="button" className="po-btn sap-document-toolbar__udf" onClick={() => {
          setFormSettingsOpen(false);
          setSidebarOpen((open) => !open);
        }}>
          {sidebarOpen ? 'Hide UDFs' : 'Show UDFs'}
        </button>
        <button
          type="button"
          className="po-btn sap-document-toolbar__settings"
          onClick={() => {
            setSidebarOpen(false);
            setFormSettingsOpen((open) => !open);
          }}
        >
          Form Settings
        </button>
        <InventoryPrintLayoutActions
          documentKey="goodsReceipt"
          docEntry={currentDocEntry}
          docNumber={header.number}
          series={header.series}
          disabled={pageState.posting || pageState.loading}
          onSuccess={(message) => setPageState((current) => ({ ...current, error: '', success: message }))}
          onError={(message) => setPageState((current) => ({ ...current, success: '', error: message }))}
        />
        <JournalEntryPreviewButton
          documentType="goodsReceipt"
          documentLabel="Goods Receipt"
          docEntry={currentDocEntry}
          buildPayload={() => ({ header, lines, header_udfs: headerUdfs, referenceDocuments })}
          disabled={pageState.posting || pageState.loading}
          className="po-btn sap-document-toolbar__journal-preview"
        />
        <div className="po-dropdown">
          <button
            type="button"
            className="po-btn"
            disabled={pageState.posting || !!currentDocEntry}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const dropdown = event.currentTarget.parentElement;
              const isActive = dropdown.classList.contains('active');
              document
                .querySelectorAll('.po-dropdown')
                .forEach((node) => node.classList.remove('active'));
              if (!isActive) dropdown.classList.add('active');
            }}
          >
            Copy From
          </button>
          <div className="po-dropdown-menu">
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openCopyFromModal();
                document
                  .querySelectorAll('.po-dropdown')
                  .forEach((node) => node.classList.remove('active'));
              }}
            >
              Goods Issue
            </button>
          </div>
        </div>
      </div>

      {pageState.loading && <div className="po-alert po-alert--success">Loading...</div>}
      {pageState.error && <div className="po-alert po-alert--error">{pageState.error}</div>}
      {pageState.success && <div className="po-alert po-alert--success">{pageState.success}</div>}

      <div className={`po-layout${isRightSidebarOpen ? ' is-sidebar-open' : ''}`}>
        <div className="po-layout__main">
      <div className="po-header-card">
        <div className="gr-goods-receipt__header-grid">
          <div className="po-field-grid" style={{ gridTemplateColumns: '1fr' }}>
            <div className="po-field">
              <label className="po-field__label">Number</label>
              <input className="po-field__input" value={header.number} readOnly />
            </div>
            <div className="po-field">
              <label className="po-field__label">Series</label>
              <select
                className="po-field__select"
                value={header.series}
                onChange={(event) => handleHeaderChange('series', event.target.value)}
              >
                <option value="">Select Series</option>
                {getSapVisibleDocumentSeries(seriesOptions, {
                  selectedSeries: header.series,
                  postingDate: header.postingDate || header.documentDate || header.date,
                }).map((series) => (
                  <option key={series.series} value={series.series}>
                    {series.seriesName}
                  </option>
                ))}
              </select>
            </div>
            <div className="po-field">
              <label className="po-field__label">Price List</label>
              <select
                className="po-field__select"
                value={header.priceList}
                onChange={(event) => handleHeaderChange('priceList', event.target.value)}
                disabled={!!header.referencedDocument}
              >
                <option value="">Select Price List</option>
                {priceLists.map((priceList) => (
                  <option key={priceList.id} value={priceList.id}>
                    {priceList.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="po-field">
              <label className="po-field__label">Branch</label>
              <select
                className="po-field__select"
                value={header.branch}
                onChange={(event) => handleHeaderChange('branch', event.target.value)}
                disabled={!!header.referencedDocument}
              >
                <option value="">Select Branch</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="po-field-grid" style={{ gridTemplateColumns: '1fr' }}>
            <div className="po-field">
              <label className="po-field__label">Posting Date</label>
              <SapDateInput
                
                className="po-field__input"
                value={header.postingDate}
                onChange={(event) => handleHeaderChange('postingDate', event.target.value)}
              />
            </div>
            <div className="po-field">
              <label className="po-field__label">Document Date</label>
              <SapDateInput
                
                className="po-field__input"
                value={header.documentDate}
                onChange={(event) => handleHeaderChange('documentDate', event.target.value)}
              />
            </div>
            <div className="po-field">
              <label className="po-field__label">Ref. 2</label>
              <input
                className="po-field__input"
                value={header.ref2}
                onChange={(event) => handleHeaderChange('ref2', event.target.value)}
              />
            </div>
            <div className="po-field">
              <label className="po-field__label">Referenced Document</label>
              <div className="gr-goods-receipt__selector">
                <input
                  className="po-field__input"
                  readOnly
                  value={referencedDocumentDisplay}
                />
                <button
                  type="button"
                  className="po-btn"
                  onClick={() => setReferenceModalOpen(true)}
                >
                  ...
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="po-tabs">
        {TAB_NAMES.map((tabName) => (
          <button
            key={tabName}
            type="button"
            className={`po-tab${activeTab === tabName ? ' po-tab--active' : ''}`}
            onClick={() => setActiveTab(tabName)}
          >
            {tabName}
          </button>
        ))}
      </div>

      <div className="po-tab-panel">
        {activeTab === 'Contents' && (
          <ContentsTab
            lines={lines}
            warehouses={branchFilteredWarehouses}
            headerBranchName={headerBranchName}
            activeRow={activeRow}
            onFocusRow={setActiveRow}
            onItemCodeChange={handleItemCodeChange}
            onItemCommit={handleItemCommit}
            onOpenItemModal={openItemModal}
            onFieldChange={handleLineChange}
            onRowUdfChange={handleRowUdfChange}
            rowUdfFields={rowUdfFields}
            formSettings={formSettings}
            onOpenLineLookup={openLineLookup}
            onOpenBatchModal={openBatchModal}
            onAddLine={addLine}
            onRemoveLine={removeLine}
            errors={valErrors.lines}
          />
        )}

        {activeTab === 'Attachments' && (
          <AttachmentsTab
            attachments={attachments}
            selectedAttachmentId={selectedAttachmentId}
            onSelectAttachment={setSelectedAttachmentId}
            onBrowseAttachment={handleBrowseAttachment}
            onDisplayAttachment={handleDisplayAttachment}
            onDeleteAttachment={handleDeleteAttachment}
            onFreeTextChange={handleAttachmentFreeTextChange}
          />
        )}
      </div>

      {valErrors.form && <div className="po-alert po-alert--error">{valErrors.form}</div>}

      <div className="po-header-card gr-goods-receipt__footer-card" style={{ marginTop: 0 }}>
        <div>
          <div>
            <div className="po-field" style={{ alignItems: 'flex-start' }}>
              <label className="po-field__label" style={{ paddingTop: 4 }}>
                Remarks
              </label>
              <textarea
                className="po-textarea"
                rows={3}
                value={header.remarks}
                onChange={(event) => handleHeaderChange('remarks', event.target.value)}
              />
            </div>
            <div className="po-field">
              <label className="po-field__label">Journal Remark</label>
              <input
                className="po-field__input"
                value={header.journalRemark}
                onChange={(event) => handleHeaderChange('journalRemark', event.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="po-toolbar gr-goods-receipt__action-bar">
        <div className="gr-goods-receipt__action-right">
          <div className="gr-goods-receipt__total-box">
            <label className="po-field__label" style={{ width: 'auto', textAlign: 'left' }}>
              Total
            </label>
            <input className="po-field__input" value={documentTotal} readOnly />
          </div>
        </div>
      </div>

        </div>

        <HeaderUdfSidebar
          className="po-layout__sidebar"
          isOpen={sidebarOpen}
          fields={visibleHeaderUdfFields}
          formSettings={formSettings}
          values={headerUdfs}
          disabled={pageState.posting}
          onFieldChange={handleHeaderUdfChange}
          onClose={() => setSidebarOpen(false)}
        />

        <FormSettingsPanel
          variant="sidebar"
          className="po-layout__sidebar"
          isOpen={formSettingsOpen}
          onClose={() => setFormSettingsOpen(false)}
          matrixFields={GOODS_RECEIPT_MATRIX_COLUMNS}
          headerUdfFields={headerUdfFields}
          rowUdfFields={rowUdfFields}
          formSettings={formSettings}
          onSettingChange={updateFormSetting}
          onColumnOrderChange={formSettingsStatus.reorder}
          settingsLoaded={formSettingsStatus.loaded}
          isSaving={formSettingsStatus.saving}
          hasUnsavedChanges={formSettingsStatus.hasUnsavedChanges}
          saveError={formSettingsStatus.error}
          onSave={formSettingsStatus.save}
          onCancel={formSettingsStatus.discard}
          settingsScopeLabel={formSettingsStatus.scopeLabel}
        />
      </div>

      <CopyFromModal
        isOpen={copyFromModal}
        goodsIssues={goodsIssues}
        selectedDocEntry={selectedCopyDocEntry}
        onSelectDocEntry={setSelectedCopyDocEntry}
        onClose={() => setCopyFromModal(false)}
        onCopy={handleCopyFrom}
        loading={copyLoading}
      />

      <ReferenceInformationModal
        isOpen={referenceModalOpen}
        onClose={() => setReferenceModalOpen(false)}
        onSave={saveReferenceDocuments}
        referenceDocuments={referenceDocuments}
        referencedDocument={header.referencedDocument}
        documentDate={header.documentDate}
        remarks={header.remarks}
        documentTotal={documentTotal}
        onOpenDocument={openReferenceDocumentLink}
      />

      <ItemSelectionModal
        isOpen={itemModal.open}
        onClose={closeItemModal}
        onSelect={handleItemSelect}
        items={items}
        loading={pageState.loading}
      />

      <LineValueLookupModal
        isOpen={lineLookupModal.open}
        onClose={closeLineLookup}
        onSelect={handleLineLookupSelect}
        options={lineLookupModal.options}
        title={lineLookupModal.title}
        allowCreate={false}
        columns={lineLookupModal.columns}
      />

      <DistributionRuleAssignmentModal
        isOpen={distributionRuleModal.open}
        line={distributionRuleModal.lineIndex >= 0 ? lines[distributionRuleModal.lineIndex] : null}
        rules={distributionRules}
        dimensions={distributionDimensions}
        onClose={closeDistributionRuleModal}
        onApply={handleDistributionRuleApply}
      />

      <BatchAllocationModal
        isOpen={batchModal.open}
        mode="receipt"
        line={batchModalLine}
        availableBatches={batchModal.availableBatches}
        loading={batchModal.loading}
        error={batchModal.error}
        onGenerateBatchNumber={() => fetchGoodsReceiptNextBatchNumber('JKL')}
        workspaceRef={formRef}
        onClose={closeBatchModal}
        onSave={saveLineBatches}
      />

      <input
        ref={fileInputRef}
        type="file"
        hidden
        multiple
        onChange={handleAttachmentFiles}
      />
    </form>
  );
}

export default GoodsReceipt;
