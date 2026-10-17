import SapDateInput from '../../components/common/SapDateInput';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import '../purchase-order/styles/purchaseOrder.css';
import '../goods-receipt/styles/goodsReceipt.css';
import './styles/inventoryTransfer.css';
import BusinessPartnerModal from '../sales-order/components/BusinessPartnerModal';
import ContentsTab from './components/ContentsTab';
import AttachmentsTab from './components/AttachmentsTab';
import FormSettingsPanel from '../../components/purchase-order/FormSettingsPanel';
import HeaderUdfSidebar from '../../components/purchase-order/HeaderUdfSidebar';
import ItemSelectionModal from '../../components/common/ItemSelectionModal';
import DistributionRuleAssignmentModal from '../../components/DistributionRuleAssignmentModal';
import LineValueLookupModal from '../../components/sales-document/LineValueLookupModal';
import JournalEntryPreviewButton from '../../components/journal-entry/JournalEntryPreviewButton';
import {
  fetchInventoryTransferBusinessPartnerDetails,
  fetchInventoryTransferByDocEntry,
  fetchInventoryTransferDistributionRules,
  fetchInventoryTransferItems,
  fetchInventoryTransferMetadata,
  fetchInventoryTransferSeries,
  fetchInventoryTransferWarehouses,
  submitInventoryTransfer,
  updateInventoryTransfer,
} from '../../api/inventoryTransferApi';
import { useCompanyScopedFormSettings } from '../../utils/formSettingsStorage';
import { duplicateDocumentInPlace } from '../../utils/documentDuplicate';
import useValidationHighlights from '../../utils/useValidationHighlights';
import { getSapVisibleDocumentSeries } from '../../utils/seriesDefaults';
import {
  getDefaultInventoryPriceList,
  getInventoryItemPrice,
} from '../../utils/inventoryPriceLists';
import {
  INVENTORY_TRANSFER_FORM_SETTINGS_STORAGE_KEY,
  INVENTORY_TRANSFER_MATRIX_COLUMNS,
  createUdfState,
  normalizeUdfState,
  readSavedFormSettings,
} from '../../config/inventoryDocumentForm';

import useUnsavedChangesWarning, { hasEnteredDocumentLines } from '../../hooks/useUnsavedChangesWarning';
import DocumentStatusActions from '../../components/document/DocumentStatusActions';
import { reloadRouteDocument } from '../../utils/copyToState';
const TAB_NAMES = ['Contents', 'Attachments'];
const today = () => new Date().toISOString().split('T')[0];
const INVENTORY_TRANSFER_HEADER_CACHE_KEY = 'inventory-transfer-header-cache';

const createLine = (rowUdfFields = []) => ({
  itemCode: '',
  itemDescription: '',
  fromWarehouse: '',
  toWarehouse: '',
  location: '',
  quantity: '',
  itemCost: '',
  excisable: '',
  distributionRule: '',
  distributionRule2: '',
  distributionRule3: '',
  distributionRule4: '',
  distributionRule5: '',
  uomCode: '',
  uomName: '',
  branch: '',
  saudaNodeRef: '',
  apInvDocKey: '',
  apInvDocNum: '',
  apInvLineNum: '',
  assessableValue: '',
  bedRate: '',
  bedAmount: '',
  rg23dNo: '',
  specialRebate: '',
  commision: '',
  brokPerQty: '',
  unitPrice: '',
  sellerBrokerage: '',
  buyerBrokerage: '',
  buyerDelivery: '',
  sellerDelivery: '',
  buyerTermsOfPayment: '',
  sellerTermsOfPayment: '',
  buyerQuality: '',
  sellerQuality: '',
  buyerPrice: '',
  sellerPrice: '',
  buyerSpecialInstruction: '',
  sellerSpecialInstruction: '',
  sellerBrokerageAmountPer: '',
  sellerBrokeragePercentage: '',
  buyerBillDiscount: '',
  sellerBillDiscount: '',
  stcode: '',
  sellerItem: '',
  sellerQuantity: '',
  freightPurchase: '',
  freightSales: '',
  freightProvider: '',
  freightProviderName: '',
  documentCreated: '',
  brokerageNumber: '',
  sellerTermsOfPaymentDuplicate: '',
  udf: createUdfState(rowUdfFields),
});

const createHeader = () => ({
  number: 'Auto',
  series: '',
  status: 'Open',
  postingDate: today(),
  dueDate: today(),
  documentDate: today(),
  businessPartner: '',
  businessPartnerName: '',
  contactPerson: '',
  shipTo: '',
  shipToAddress: '',
  vat: false,
  priceList: '',
  fromBranch: '',
  fromWarehouse: '',
  toWarehouse: '',
  referencedDocument: '',
  salesEmployee: '',
  dutyStatus: 'With Payment of Duty',
  journalRemark: 'Inventory Transfer',
  pickPackRemarks: '',
  remarks: '',
  createQrCodeFrom: '',
});

const readInventoryTransferHeaderCache = () => {
  if (typeof window === 'undefined') return {};

  try {
    const rawValue = window.localStorage.getItem(INVENTORY_TRANSFER_HEADER_CACHE_KEY);
    if (!rawValue) return {};

    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
};

const writeInventoryTransferHeaderCache = (docEntry, header) => {
  if (typeof window === 'undefined' || docEntry == null) return;

  const cache = readInventoryTransferHeaderCache();
  const cacheKey = String(docEntry);

  cache[cacheKey] = {
    businessPartner: header.businessPartner || '',
    businessPartnerName: header.businessPartnerName || '',
    contactPerson: header.contactPerson || '',
    shipTo: header.shipTo || '',
    shipToAddress: header.shipToAddress || '',
    vat: Boolean(header.vat),
    priceList: header.priceList || '',
  };

  try {
    window.localStorage.setItem(
      INVENTORY_TRANSFER_HEADER_CACHE_KEY,
      JSON.stringify(cache)
    );
  } catch (error) {
    // Ignore local cache write failures so document flow still works.
  }
};

const buildDistributionDimensions = (rules = []) => {
  const dimensions = new Map();

  (rules || []).forEach((rule) => {
    const dimensionCode = String(
      rule.DimensionCode || rule.DimCode || rule.dimensionCode || '1'
    ).trim() || '1';
    if (!dimensions.has(dimensionCode)) {
      dimensions.set(dimensionCode, {
        DimensionCode: dimensionCode,
        DimensionName: rule.DimensionName || rule.DimName || `Dimension ${dimensionCode}`,
      });
    }
  });

  return [...dimensions.values()].sort(
    (a, b) => Number(a.DimensionCode) - Number(b.DimensionCode)
  );
};

const mergeInventoryTransferHeaderFallback = (document, requestedDocEntry) => {
  const docEntry = document?.docEntry ?? requestedDocEntry;
  if (docEntry == null) return document;

  const cachedHeader = readInventoryTransferHeaderCache()[String(docEntry)];
  if (!cachedHeader) return document;

  const currentHeader = document?.header || {};

  return {
    ...document,
    header: {
      ...currentHeader,
      businessPartner: currentHeader.businessPartner || cachedHeader.businessPartner || '',
      businessPartnerName:
        currentHeader.businessPartnerName || cachedHeader.businessPartnerName || '',
      contactPerson: currentHeader.contactPerson || cachedHeader.contactPerson || '',
      shipTo: currentHeader.shipTo || cachedHeader.shipTo || '',
      shipToAddress: currentHeader.shipToAddress || cachedHeader.shipToAddress || '',
      vat:
        typeof currentHeader.vat === 'boolean'
          ? currentHeader.vat
          : Boolean(cachedHeader.vat),
      priceList:
        currentHeader.priceList && String(currentHeader.priceList) !== '-1'
          ? currentHeader.priceList
          : cachedHeader.priceList || '',
    },
  };
};

function InventoryTransfer() {
  const location = useLocation();
  const navigate = useNavigate();
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
    INVENTORY_TRANSFER_FORM_SETTINGS_STORAGE_KEY,
    readSavedFormSettings,
    [headerUdfFields, rowUdfFields, INVENTORY_TRANSFER_MATRIX_COLUMNS],
    { saveMode: 'explicit' },
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [formSettingsOpen, setFormSettingsOpen] = useState(false);
  const [businessPartners, setBusinessPartners] = useState([]);
  const [salesEmployees, setSalesEmployees] = useState([]);
  const [distributionRules, setDistributionRules] = useState([]);
  const [distributionDimensions, setDistributionDimensions] = useState([]);
  const [locations, setLocations] = useState([]);
  const [paymentTerms, setPaymentTerms] = useState([]);
  const [contactOptions, setContactOptions] = useState([]);
  const [shipToOptions, setShipToOptions] = useState([]);
  const [pageState, setPageState] = useState({
    loading: false,
    posting: false,
    partnerLoading: false,
    error: '',
    success: '',
  });
  const [valErrors, setValErrors] = useState({
    header: {},
    lines: {},
    form: '',
  });
  const [isDirty, setIsDirty] = useState(false);
  useValidationHighlights(valErrors);
  const [itemModal, setItemModal] = useState({
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
  const [distributionRuleModal, setDistributionRuleModal] = useState({
    open: false,
    lineIndex: -1,
  });
  const [bpModal, setBpModal] = useState(false);

  const currentSeriesOption =
    seriesOptions.find((seriesOption) => seriesOption.series === String(header.series)) ||
    seriesOptions[0] ||
    null;
  const hasUnsavedChanges = Boolean(currentDocEntry && isDirty);
  useUnsavedChangesWarning(hasUnsavedChanges || (!currentDocEntry && hasEnteredDocumentLines(lines)));
  const updateActionLabel = hasUnsavedChanges ? 'Update' : 'OK';
  const primaryActionLabel = pageState.posting
    ? 'Saving...'
    : currentDocEntry
      ? updateActionLabel
      : 'Add';
  const markDirty = (event) => {
    if (event?.target?.closest?.('[data-document-dirty-ignore="true"]')) return;
    if (currentDocEntry) setIsDirty(true);
  };
  const defaultPriceList = getDefaultInventoryPriceList(priceLists);
  const defaultBranch = branches[0] || null;
  const selectedBusinessPartner = useMemo(
    () =>
      businessPartners.find(
        (partner) => partner.cardCode === String(header.businessPartner || '')
      ) || null,
    [businessPartners, header.businessPartner]
  );
  const businessPartnerModalItems = useMemo(
    () =>
      businessPartners.map((partner) => ({
        CardCode: partner.cardCode,
        CardName: partner.cardName,
        CardType: partner.cardType,
        Balance: partner.currentAccountBalance ?? partner.balance ?? 0,
        CurrentAccountBalance: partner.currentAccountBalance ?? partner.balance ?? 0,
        balance: partner.currentAccountBalance ?? partner.balance ?? 0,
        currentAccountBalance: partner.currentAccountBalance ?? partner.balance ?? 0,
      })),
    [businessPartners]
  );
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
      value: partner.cardCode || partner.CardCode || '',
      description: partner.cardName || partner.CardName || '',
      code: partner.cardCode || partner.CardCode || '',
      name: partner.cardName || partner.CardName || '',
    })).filter((option) => option.value),
    paymentTerm: (paymentTerms || []).map((term) => ({
      value: term.name || term.PymntGroup || String(term.code ?? term.GroupNum ?? ''),
      description: term.code != null || term.GroupNum != null ? `Code: ${term.code ?? term.GroupNum}` : '',
      code: String(term.code ?? term.GroupNum ?? ''),
      name: term.name || term.PymntGroup || '',
    })).filter((option) => option.value),
  }), [businessPartners, distributionRules, items, locations, paymentTerms]);
  const fromWarehouseOptions = header.fromBranch
    ? warehouses.filter(
        (warehouse) =>
          !warehouse.branchId || warehouse.branchId === String(header.fromBranch)
      )
    : warehouses;
  const selectedShipTo =
    shipToOptions.find((address) => address.id === header.shipTo) ||
    shipToOptions.find((address) => address.label === header.shipTo) ||
    null;

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    let ignore = false;

    const load = async () => {
      setPageState((current) => ({ ...current, loading: true, error: '', success: '' }));

      try {
        const [metadataResponse, itemsResponse, warehousesResponse, seriesResponse] =
          await Promise.all([
            fetchInventoryTransferMetadata(),
            fetchInventoryTransferItems(),
            fetchInventoryTransferWarehouses(),
            fetchInventoryTransferSeries({ date: today() }),
          ]);

        if (ignore) return;

        const metadata = metadataResponse.data || {};
        const loadedSeries = seriesResponse.data || [];
        const initialSeries =
          loadedSeries.find((series) => series.isDefault) || loadedSeries[0] || null;
        const initialPriceList = getDefaultInventoryPriceList(metadata.priceLists);
        const initialBranch = metadata.branches?.[0] || null;

        setItems(itemsResponse.data || []);
        setWarehouses(warehousesResponse.data || []);
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
            INVENTORY_TRANSFER_MATRIX_COLUMNS,
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
        setBusinessPartners(metadata.businessPartners || []);
        setSalesEmployees(metadata.salesEmployees || []);
        setDistributionRules(metadata.distributionRules || []);
        setDistributionDimensions(buildDistributionDimensions(metadata.distributionRules || []));
        setLocations(metadata.locations || []);
        setPaymentTerms(metadata.paymentTerms || []);
        setHeader((current) => ({
          ...current,
          series: current.series || initialSeries?.series || '',
          number: initialSeries?.nextNumber || current.number,
          priceList: current.priceList || initialPriceList?.id || '',
          fromBranch: current.fromBranch || initialBranch?.id || '',
        }));
      } catch (error) {
        if (!ignore) {
          setPageState((current) => ({
            ...current,
            error:
              error.response?.data?.message ||
              error.message ||
              'Failed to load Inventory Transfer reference data.',
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
    const docEntry = location.state?.inventoryTransferDocEntry;
    if (!docEntry) return;

    let ignore = false;

    const load = async () => {
      setPageState((current) => ({ ...current, loading: true, error: '', success: '' }));

      try {
        const response = await fetchInventoryTransferByDocEntry(docEntry);
        const document = mergeInventoryTransferHeaderFallback(response.data, docEntry);
        if (ignore || !document) return;

        setCurrentDocEntry(document.docEntry || Number(docEntry));
        setHeader(() => ({
          ...createHeader(),
          ...document.header,
        }));
        setHeaderUdfs(document.headerUdfs || {});
        setLines(
          Array.isArray(document.lines) && document.lines.length
            ? document.lines.map((line) => ({
                ...createLine(rowUdfFields),
                ...line,
                udf: createUdfState(rowUdfFields, line.udf || {}),
              }))
            : [{
                ...createLine(rowUdfFields),
                fromWarehouse: document.header?.fromWarehouse || '',
                toWarehouse: document.header?.toWarehouse || '',
                location: document.header?.toWarehouse
                  ? getWarehouseLocationCode(document.header.toWarehouse)
                  : '',
                branch: document.header?.toWarehouse
                  ? getWarehouseBranch(document.header.toWarehouse)
                  : '',
              }]
        );
        setAttachments([]);
        setSelectedAttachmentId(null);
        setActiveTab('Contents');
        setValErrors({ header: {}, lines: {}, form: '' });
        setIsDirty(false);
        setPageState((current) => ({
          ...current,
          success: location.state?.documentStatusMessage || (document.docNum
            ? `Inventory Transfer ${document.docNum} loaded.`
            : 'Inventory Transfer loaded.'),
        }));
      } catch (error) {
        if (!ignore) {
          setPageState((current) => ({
            ...current,
            error:
              error.response?.data?.message ||
              error.message ||
              'Failed to load inventory transfer.',
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
    if (!header.businessPartner) {
      setContactOptions([]);
      setShipToOptions([]);
      return;
    }

    let ignore = false;

    const loadBusinessPartnerDetails = async () => {
      setPageState((current) => ({ ...current, partnerLoading: true }));
      try {
        const response = await fetchInventoryTransferBusinessPartnerDetails(
          header.businessPartner
        );
        if (ignore) return;

        const data = response.data || {};
        const nextContacts = data.contacts || [];
        const nextShipToAddresses = data.shipToAddresses || [];

        setContactOptions(nextContacts);
        setShipToOptions(nextShipToAddresses);
        setHeader((current) => ({
          ...current,
          businessPartnerName:
            selectedBusinessPartner?.cardName || current.businessPartnerName,
          contactPerson: current.contactPerson || nextContacts[0]?.id || '',
          shipTo: current.shipTo || nextShipToAddresses[0]?.id || '',
          shipToAddress:
            nextShipToAddresses.find((address) => address.id === current.shipTo)?.fullAddress ||
            nextShipToAddresses.find((address) => address.label === current.shipTo)?.fullAddress ||
            current.shipToAddress ||
            '',
        }));
      } catch (error) {
        if (!ignore) {
          setPageState((current) => ({
            ...current,
            error:
              error.response?.data?.message ||
              error.message ||
              'Failed to load business partner details.',
          }));
        }
      } finally {
        if (!ignore) {
          setPageState((current) => ({ ...current, partnerLoading: false }));
        }
      }
    };

    loadBusinessPartnerDetails();

    return () => {
      ignore = true;
    };
  }, [header.businessPartner, selectedBusinessPartner]);

  const getWarehouseByCode = (whsCode) =>
    warehouses.find((warehouse) => warehouse.whsCode === String(whsCode || ''));

  const getWarehouseBranch = (whsCode) => getWarehouseByCode(whsCode)?.branchId || '';
  const getWarehouseLocationCode = (whsCode) => {
    const warehouse = getWarehouseByCode(whsCode);
    return warehouse?.locationCode != null ? String(warehouse.locationCode) : '';
  };
  const getWarehouseBranchDisplay = (whsCode, branchId = '') => {
    const warehouse = getWarehouseByCode(whsCode);
    if (warehouse?.city) return warehouse.city;
    if (warehouse?.branchId) {
      const branch = branches.find((entry) => String(entry.id || '') === String(warehouse.branchId));
      if (branch?.name) return branch.name;
    }
    if (branchId) {
      const branch = branches.find((entry) => String(entry.id || '') === String(branchId));
      if (branch?.name) return branch.name;
    }
    return branchId || '';
  };

  const getItem = (itemCode) => items.find((item) => item.itemCode === itemCode);

  const getItemPrice = (item, priceList) => {
    return getInventoryItemPrice(item, priceList);
  };

  const normalizeLine = (line) => {
    const quantity = Number(line.quantity || 0);
    const item = getItem(line.itemCode);
    const price = getItemPrice(item, header.priceList);

    return {
      ...line,
      quantity: line.quantity === '' ? '' : String(line.quantity),
      branch: line.branch || getWarehouseBranch(line.toWarehouse),
      assessableValue:
        quantity > 0 ? (quantity * price).toFixed(2) : line.assessableValue || '0.00',
      itemCost:
        line.itemCost === '' || line.itemCost == null
          ? ''
          : Number(line.itemCost).toFixed(2),
    };
  };

  const patchLineFromItem = (line, itemCode, priceList = header.priceList) => {
    const item = getItem(itemCode);
    if (!item) {
      return normalizeLine({
        ...createLine(rowUdfFields),
        branch: getWarehouseBranch(header.toWarehouse),
      });
    }

    return normalizeLine({
      ...line,
      itemCode: item.itemCode,
      itemDescription: item.itemName,
      fromWarehouse: line.fromWarehouse || header.fromWarehouse || item.defaultWarehouse || '',
      toWarehouse: line.toWarehouse || header.toWarehouse || '',
      location: getWarehouseLocationCode(line.toWarehouse || header.toWarehouse),
      uomCode: item.uomCode || '',
      uomName: item.uomName || '',
      branch: line.branch || getWarehouseBranch(line.toWarehouse || header.toWarehouse),
      itemCost: item.itemCost != null ? String(item.itemCost) : '',
      assessableValue: line.assessableValue || String(getItemPrice(item, priceList)),
      unitPrice: line.unitPrice || String(getItemPrice(item, priceList)),
    });
  };

  useEffect(() => {
    let ignore = false;
    fetchInventoryTransferSeries({ date: header.postingDate, branch: header.fromBranch })
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
  }, [header.postingDate, header.fromBranch]);

  const handleHeaderChange = (field, value) => {
    setHeader((current) => {
      const next = { ...current, [field]: value };
      if (field === 'series') {
        const selectedSeries = seriesOptions.find(
          (seriesOption) => seriesOption.series === String(value)
        );
        next.number = selectedSeries?.nextNumber || 'Auto';
      }
      if (field === 'businessPartner') {
        const matchedPartner = businessPartners.find(
          (partner) => partner.cardCode === String(value)
        );
        next.businessPartnerName =
          matchedPartner?.cardName || '';
        next.contactPerson = '';
        next.shipTo = '';
        next.shipToAddress = '';
        next.priceList = matchedPartner?.priceList || next.priceList;
      }
      if (field === 'shipTo') {
        next.shipToAddress =
          shipToOptions.find((address) => address.id === value)?.fullAddress ||
          shipToOptions.find((address) => address.label === value)?.fullAddress ||
          '';
      }
      return next;
    });

    if (field === 'priceList') {
      setLines((current) =>
        current.map((line) =>
          line.itemCode ? patchLineFromItem(line, line.itemCode, value) : line
        )
      );
    }

    if (field === 'fromBranch') {
      setLines((current) =>
        current.map((line) => ({
          ...line,
          branch: line.toWarehouse ? getWarehouseBranch(line.toWarehouse) : line.branch,
        }))
      );
    }

    if (field === 'fromWarehouse') {
      setLines((current) =>
        current.map((line) => ({
          ...line,
          fromWarehouse: value,
        }))
      );
    }

    if (field === 'toWarehouse') {
      setLines((current) =>
        current.map((line) => ({
          ...line,
          toWarehouse: value,
          location: value ? getWarehouseLocationCode(value) : '',
          branch: value ? getWarehouseBranch(value) : '',
        }))
      );
    }
  };

  const openBpModal = () => {
    setBpModal(true);
  };

  const closeBpModal = () => {
    setBpModal(false);
  };

  const selectBusinessPartner = (cardCode) => {
    handleHeaderChange('businessPartner', cardCode);
  };

  const handleBusinessPartnerInputChange = (value) => {
    setHeader((current) => ({
      ...current,
      businessPartner: value,
      businessPartnerName:
        businessPartners.find(
          (partner) => partner.cardCode === String(value || '').trim()
        )?.cardName || '',
      contactPerson: '',
      shipTo: '',
      shipToAddress: '',
    }));
  };

  const commitBusinessPartnerInput = () => {
    const businessPartnerCode = String(header.businessPartner || '').trim();

    if (!businessPartnerCode) {
      handleHeaderChange('businessPartner', '');
      return;
    }

    const matchedPartner = businessPartners.find(
      (partner) => partner.cardCode.toLowerCase() === businessPartnerCode.toLowerCase()
    );

    if (matchedPartner) {
      selectBusinessPartner(matchedPartner.cardCode);
    }
  };

  const handleBpSelect = (bp) => {
    const cardCode = bp?.CardCode || bp?.cardCode || '';
    if (!cardCode) return;
    selectBusinessPartner(cardCode);
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
      current.map((line, index) => (index === rowIndex ? { ...line, itemCode } : line))
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

        const nextLine = { ...line, [field]: value };
        if (field === 'toWarehouse') {
          nextLine.branch = value ? getWarehouseBranch(value) : '';
          nextLine.location = value ? getWarehouseLocationCode(value) : '';
        }
        return normalizeLine(nextLine);
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

  const addLine = () => {
    setLines((current) => [
      ...current,
      {
        ...createLine(rowUdfFields),
        fromWarehouse: header.fromWarehouse || '',
        toWarehouse: header.toWarehouse || '',
        location: getWarehouseLocationCode(header.toWarehouse),
        branch: getWarehouseBranch(header.toWarehouse),
      },
    ]);
  };

  const removeLine = (rowIndex) => {
    setLines((current) => {
      if (current.length === 1) {
        return [
          {
            ...createLine(rowUdfFields),
            fromWarehouse: header.fromWarehouse || '',
            toWarehouse: header.toWarehouse || '',
            location: getWarehouseLocationCode(header.toWarehouse),
            branch: getWarehouseBranch(header.toWarehouse),
          },
        ];
      }
      return current.filter((_, index) => index !== rowIndex);
    });
  };

  const validateDocument = () => {
    const nextErrors = { header: {}, lines: {}, form: '' };
    const activeLines = lines.filter((line) => line.itemCode);

    if (!header.postingDate) nextErrors.header.postingDate = 'Posting Date is required';
    if (!header.dueDate) nextErrors.header.dueDate = 'Due Date is required';
    if (!header.documentDate) nextErrors.header.documentDate = 'Document Date is required';

    if (!activeLines.length) {
      nextErrors.form = 'Add at least one line before saving.';
    }

    lines.forEach((line, index) => {
      if (!line.itemCode) return;

      const rowErrors = {};
      if (!line.itemCode) rowErrors.itemCode = 'Item required';
      if (line.itemCode && !getItem(line.itemCode)) rowErrors.itemCode = 'Invalid item';
      if (Number(line.quantity || 0) <= 0) rowErrors.quantity = 'Qty > 0';
      if (!(line.fromWarehouse || header.fromWarehouse)) {
        rowErrors.fromWarehouse = 'Required';
      }
      if (!(line.toWarehouse || header.toWarehouse)) {
        rowErrors.toWarehouse = 'Required';
      }

      if (Object.keys(rowErrors).length) {
        nextErrors.lines[index] = rowErrors;
      }
    });

    if (
      !nextErrors.form &&
      (Object.keys(nextErrors.header).length || Object.keys(nextErrors.lines).length)
    ) {
      nextErrors.form = 'Fix the highlighted fields before saving.';
    }

    setValErrors(nextErrors);
    return (
      !nextErrors.form &&
      Object.keys(nextErrors.header).length === 0 &&
      Object.keys(nextErrors.lines).length === 0
    );
  };

  const resetForm = (options = {}) => {
    const { successMessage = '' } = options;
    const nextSeries = currentSeriesOption?.series || '';
    const nextBranch = header.fromBranch || defaultBranch?.id || '';

    setIsDirty(false);
    setCurrentDocEntry(null);
    setHeader(() => ({
      ...createHeader(),
      series: nextSeries,
      number: currentSeriesOption?.nextNumber || 'Auto',
      priceList: header.priceList || defaultPriceList?.id || '',
      fromBranch: nextBranch,
    }));
    setHeaderUdfs(normalizeUdfState(headerUdfFields));
    setLines([{ ...createLine(rowUdfFields) }]);
    attachmentsRef.current.forEach((attachment) => {
      if (attachment.previewUrl) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
    });
    setAttachments([]);
    setSelectedAttachmentId(null);
    setActiveTab('Contents');
    setValErrors({ header: {}, lines: {}, form: '' });
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

  const openLineLookup = async (column, lineIndex, udfField = null) => {
    if (column.lookup === 'distRule') {
      setDistributionRuleModal({ open: true, lineIndex });
      try {
        const response = await fetchInventoryTransferDistributionRules();
        const liveRules = Array.isArray(response.data) ? response.data : [];
        setDistributionRules(liveRules);
        setDistributionDimensions(buildDistributionDimensions(liveRules));
      } catch (error) {
        setPageState((current) => ({
          ...current,
          error:
            error.response?.data?.message ||
            error.message ||
            'Failed to load distribution rules.',
        }));
      }
      return;
    }

    setLineLookupModal({
      open: true,
      lineIndex,
      field: column.key,
      udfKey: udfField?.key || '',
      title: `List of ${column.label}`,
      options: lookupOptions[column.lookup] || [],
      columns: [
        { key: 'code', label: 'Code', width: 140, primary: true },
        { key: 'name', label: 'Description' },
      ],
    });
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

    setLines((current) =>
      current.map((line, index) => {
        if (index !== lineIndex) return line;
        const nextLine = { ...line };
        Object.entries(valuesByDimension).forEach(([dimensionCode, ruleCode]) => {
          const fieldName = fieldByDimension[Number(dimensionCode)];
          if (fieldName) nextLine[fieldName] = ruleCode || '';
        });
        return normalizeLine(nextLine);
      })
    );
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
    setLineLookupModal((current) => ({
      ...current,
      open: false,
      lineIndex: -1,
      field: '',
      udfKey: '',
    }));
  };

  const handleLineLookupSelect = (option) => {
    const { lineIndex, field, udfKey } = lineLookupModal;
    if (lineIndex < 0 || !field) return;
    const value = option?.value || '';

    setLines((current) =>
      current.map((line, index) => {
        if (index !== lineIndex) return line;
        if (udfKey) {
          return {
            ...line,
            udf: {
              ...(line.udf || {}),
              [udfKey]: value,
            },
          };
        }
        const nextLine = { ...line, [field]: value };
        if (field === 'freightProvider') {
          nextLine.freightProviderName = option?.description || option?.name || '';
        }
        if (field === 'sellerItem') {
          const selectedItem = items.find((item) => item.itemCode === value);
          if (selectedItem) {
            nextLine.sellerItem = selectedItem.itemCode;
          }
        }
        return normalizeLine(nextLine);
      })
    );
    closeLineLookup();
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
      successMessage: 'Inventory Transfer duplicated. Review and add it as a new entry.',
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
        error: 'Fix the highlighted fields before saving.',
        success: '',
      }));
      return;
    }

    setPageState((current) => ({ ...current, posting: true, error: '', success: '' }));

    try {
      const payload = {
        header,
        header_udfs: normalizeUdfState(headerUdfFields, headerUdfs),
        lines: lines
          .filter((line) => line.itemCode)
          .map((line) => ({
            itemCode: line.itemCode,
            itemDescription: line.itemDescription,
            fromWarehouse: line.fromWarehouse || header.fromWarehouse,
            toWarehouse: line.toWarehouse || header.toWarehouse,
            location: line.location,
            quantity: Number(line.quantity || 0),
            itemCost: Number(line.itemCost || 0),
            excisable: line.excisable,
            distributionRule: line.distributionRule,
            distributionRule2: line.distributionRule2,
            distributionRule3: line.distributionRule3,
            distributionRule4: line.distributionRule4,
            distributionRule5: line.distributionRule5,
            uomCode: line.uomCode,
            uomName: line.uomName,
        uomNameEdited: line.uomNameEdited,
            branch: line.branch,
            saudaNodeRef: line.saudaNodeRef,
            apInvDocKey: line.apInvDocKey,
            apInvDocNum: line.apInvDocNum,
            apInvLineNum: line.apInvLineNum,
            assessableValue: Number(line.assessableValue || 0),
            bedRate: line.bedRate,
            bedAmount: line.bedAmount,
            rg23dNo: line.rg23dNo,
            specialRebate: line.specialRebate,
            commision: line.commision,
            brokPerQty: line.brokPerQty,
            unitPrice: line.unitPrice,
            sellerBrokerage: line.sellerBrokerage,
            buyerBrokerage: line.buyerBrokerage,
            buyerDelivery: line.buyerDelivery,
            sellerDelivery: line.sellerDelivery,
            buyerTermsOfPayment: line.buyerTermsOfPayment,
            sellerTermsOfPayment: line.sellerTermsOfPayment,
            buyerQuality: line.buyerQuality,
            sellerQuality: line.sellerQuality,
            buyerPrice: line.buyerPrice,
            sellerPrice: line.sellerPrice,
            buyerSpecialInstruction: line.buyerSpecialInstruction,
            sellerSpecialInstruction: line.sellerSpecialInstruction,
            sellerBrokerageAmountPer: line.sellerBrokerageAmountPer,
            sellerBrokeragePercentage: line.sellerBrokeragePercentage,
            buyerBillDiscount: line.buyerBillDiscount,
            sellerBillDiscount: line.sellerBillDiscount,
            stcode: line.stcode,
            sellerItem: line.sellerItem,
            sellerQuantity: line.sellerQuantity,
            freightPurchase: line.freightPurchase,
            freightSales: line.freightSales,
            freightProvider: line.freightProvider,
            freightProviderName: line.freightProviderName,
            documentCreated: line.documentCreated,
            brokerageNumber: line.brokerageNumber,
            sellerTermsOfPaymentDuplicate: line.sellerTermsOfPaymentDuplicate,
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
        ? await updateInventoryTransfer(currentDocEntry, payload)
        : await submitInventoryTransfer(payload);
      const result = response.data || {};
      const successMessage = `${result.message || 'Inventory Transfer saved successfully.'} DocEntry: ${
        result.docEntry
      }, DocNum: ${result.docNum}`;
      const savedDocEntry =
        result.docEntry != null ? Number(result.docEntry) : currentDocEntry;

      setIsDirty(false);
      writeInventoryTransferHeaderCache(savedDocEntry, header);
      resetForm({ successMessage });
    } catch (error) {
      setPageState((current) => ({
        ...current,
        posting: false,
        error:
          error.response?.data?.message || error.message || 'Failed to save Inventory Transfer.',
      }));
    }
  };

  const totalQuantity = lines
    .filter((line) => line.itemCode)
    .reduce((sum, line) => sum + Number(line.quantity || 0), 0)
    .toFixed(2);
  const visibleHeaderUdfFields = headerUdfFields.filter(
    (field) => formSettings.headerUdfs?.[field.key]?.visible !== false
  );
  const isRightSidebarOpen = sidebarOpen || formSettingsOpen;

  return (
    <form className={`po-page sap-document-page itr-transfer-request__page inventory-document-page${isRightSidebarOpen ? ' po-page--sidebar-open inventory-document-page--sidebar-open' : ''}`} onSubmit={handleSubmit} onChangeCapture={markDirty}>
      <div className="po-toolbar sap-document-toolbar">
        <div className="po-toolbar__title sap-document-toolbar__title">
          Inventory Transfer
          {currentDocEntry ? ` - #${header.number || currentDocEntry}` : ''}
        </div>
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
        <button
          type="button"
          className="po-btn sap-document-toolbar__find"
          onClick={() => navigate('/inventory-transfer/find')}
        >
          Find
        </button>
        <button type="button" className="po-btn sap-document-toolbar__new" onClick={resetForm}>
          New
        </button>
        <DocumentStatusActions
          type="inventory-transfer"
          docEntry={currentDocEntry}
          actions={['cancel']}
          className="po-btn"
          disabled={pageState.posting || pageState.loading}
          onDone={(action) => reloadRouteDocument(navigate, location, 'inventoryTransferDocEntry', currentDocEntry, action)}
          onError={(message) => setPageState((p) => ({ ...p, error: message, success: '' }))}
        />
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
        <JournalEntryPreviewButton
          documentType="inventoryTransfer"
          documentLabel="Inventory Transfer"
          docEntry={currentDocEntry}
          buildPayload={() => ({ header, lines, header_udfs: headerUdfs })}
          disabled={pageState.posting || pageState.loading}
          className="po-btn sap-document-toolbar__journal-preview"
        />
      </div>

      {pageState.loading && <div className="po-alert po-alert--success">Loading...</div>}
      {pageState.error && <div className="po-alert po-alert--error">{pageState.error}</div>}
      {pageState.success && <div className="po-alert po-alert--success">{pageState.success}</div>}

      <div className={`po-layout${isRightSidebarOpen ? ' is-sidebar-open' : ''}`}>
        <div className="po-layout__main">
      <div className="po-header-card">
        <div className="itr-transfer-request__header-grid">
          <div className="itr-transfer-request__header-column">
            <div className="po-field">
              <label className="po-field__label">Business Partner</label>
              <div className="itr-transfer-request__selector">
                <input
                  className={`po-field__input${
                    valErrors.header.businessPartner ? ' po-field__input--error' : ''
                  }`}
                  value={header.businessPartner}
                  placeholder="Business Partner Code"
                  onChange={(event) =>
                    handleBusinessPartnerInputChange(event.target.value)
                  }
                  onBlur={commitBusinessPartnerInput}
                />
                <button
                  type="button"
                  className="po-btn"
                  onClick={openBpModal}
                  title="Select Business Partner"
                  style={{ minWidth: 36, paddingInline: 0 }}
                >
                  ...
                </button>
              </div>
            </div>
            <div className="po-field">
              <label className="po-field__label">Name</label>
              <input className="po-field__input" value={header.businessPartnerName} readOnly />
            </div>
            <div className="po-field">
              <label className="po-field__label">Contact Person</label>
              <select
                className="po-field__select"
                value={header.contactPerson}
                onChange={(event) => handleHeaderChange('contactPerson', event.target.value)}
                disabled={!header.businessPartner || pageState.partnerLoading}
              >
                <option value="">Select Contact</option>
                {contactOptions.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="po-field">
              <label className="po-field__label">Ship To</label>
              <select
                className="po-field__select"
                value={header.shipTo}
                onChange={(event) => handleHeaderChange('shipTo', event.target.value)}
                disabled={!header.businessPartner || pageState.partnerLoading}
              >
                <option value="">Select Ship To</option>
                {shipToOptions.map((address) => (
                  <option key={address.id} value={address.id}>
                    {address.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="po-field" style={{ alignItems: 'flex-start' }}>
              <label className="po-field__label" style={{ paddingTop: 4 }}>
                Address
              </label>
              <textarea
                className="po-textarea itr-transfer-request__address"
                rows={4}
                value={selectedShipTo?.fullAddress || header.shipToAddress || ''}
                readOnly
              />
            </div>
            <label className="po-field" style={{ alignItems: 'center', gap: 10 }}>
              <span className="po-field__label">VAT</span>
              <input
                type="checkbox"
                checked={header.vat}
                onChange={(event) => handleHeaderChange('vat', event.target.checked)}
              />
            </label>
            <div className="po-field">
              <label className="po-field__label">Price List</label>
              <select
                className="po-field__select"
                value={header.priceList}
                onChange={(event) => handleHeaderChange('priceList', event.target.value)}
              >
                <option value="">Select Price List</option>
                {priceLists.map((priceList) => (
                  <option key={priceList.id} value={priceList.id}>
                    {priceList.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="itr-transfer-request__header-column itr-transfer-request__header-column--compact">
            <div className="po-field">
              <label className="po-field__label">No.</label>
              <div className="itr-transfer-request__selector">
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
                <input className="po-field__input" value={header.number} readOnly />
              </div>
            </div>
            <div className="po-field">
              <label className="po-field__label">Status</label>
              <input className="po-field__input" value={header.status} readOnly />
            </div>
            <div className="po-field">
              <label className="po-field__label">Posting Date</label>
              <SapDateInput
                
                className={`po-field__input${
                  valErrors.header.postingDate ? ' po-field__input--error' : ''
                }`}
                value={header.postingDate}
                onChange={(event) => handleHeaderChange('postingDate', event.target.value)}
              />
            </div>
            <div className="po-field">
              <label className="po-field__label">Due Date</label>
              <SapDateInput
                
                className={`po-field__input${
                  valErrors.header.dueDate ? ' po-field__input--error' : ''
                }`}
                value={header.dueDate}
                onChange={(event) => handleHeaderChange('dueDate', event.target.value)}
              />
            </div>
            <div className="po-field">
              <label className="po-field__label">Document Date</label>
              <SapDateInput
                
                className={`po-field__input${
                  valErrors.header.documentDate ? ' po-field__input--error' : ''
                }`}
                value={header.documentDate}
                onChange={(event) => handleHeaderChange('documentDate', event.target.value)}
              />
            </div>
            <div className="po-field">
              <label className="po-field__label">Referenced Document</label>
              <div className="itr-transfer-request__selector">
                <input
                  className="po-field__input"
                  value={header.referencedDocument}
                  onChange={(event) => handleHeaderChange('referencedDocument', event.target.value)}
                />
                <button
                  type="button"
                  className="po-btn"
                  disabled
                  title="Reference document lookup"
                  style={{ minWidth: 36, paddingInline: 0 }}
                >
                  ...
                </button>
              </div>
            </div>
            <div className="po-field">
              <label className="po-field__label">From Branch</label>
              <select
                className="po-field__select"
                value={header.fromBranch}
                onChange={(event) => handleHeaderChange('fromBranch', event.target.value)}
              >
                <option value="">Select Branch</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="po-field">
              <label className="po-field__label">From Warehouse</label>
              <select
                className={`po-field__select${
                  valErrors.header.fromWarehouse ? ' po-field__input--error' : ''
                }`}
                value={header.fromWarehouse}
                onChange={(event) => handleHeaderChange('fromWarehouse', event.target.value)}
              >
                <option value="">Select From Warehouse</option>
                {fromWarehouseOptions.map((warehouse) => (
                  <option key={warehouse.whsCode} value={warehouse.whsCode}>
                    {warehouse.whsCode} - {warehouse.whsName}
                  </option>
                ))}
              </select>
            </div>
            <div className="po-field">
              <label className="po-field__label">To Warehouse</label>
              <select
                className={`po-field__select${
                  valErrors.header.toWarehouse ? ' po-field__input--error' : ''
                }`}
                value={header.toWarehouse}
                onChange={(event) => handleHeaderChange('toWarehouse', event.target.value)}
              >
                <option value="">Select To Warehouse</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.whsCode} value={warehouse.whsCode}>
                    {warehouse.whsCode} - {warehouse.whsName}
                  </option>
                ))}
              </select>
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
            fromWarehouses={fromWarehouseOptions}
            warehouses={warehouses}
            getBranchDisplay={getWarehouseBranchDisplay}
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

      {/* SAP B1 footer: Sales Employee, Journal Remark, Remarks (OWTR/OWTQ SlpCode, JrnlMemo, Comments). */}
      <div className="po-header-card">
        <div className="sap-document-footer-fields">
        <div className="po-field">
          <label className="po-field__label" htmlFor="it-sales-employee">Sales Employee</label>
          <select
            id="it-sales-employee"
            className="po-field__select"
            value={header.salesEmployee || ''}
            onChange={(event) => handleHeaderChange('salesEmployee', event.target.value)}
          >
            <option value="">-No Sales Employee-</option>
            {salesEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
          </select>
        </div>
        <div className="po-field">
          <label className="po-field__label" htmlFor="it-journal-remark">Journal Remark</label>
          <input
            id="it-journal-remark"
            className="po-field__input"
            value={header.journalRemark || ''}
            onChange={(event) => handleHeaderChange('journalRemark', event.target.value)}
          />
        </div>
        <div className="po-field" style={{ alignItems: 'flex-start' }}>
          <label className="po-field__label" htmlFor="it-remarks">Remarks</label>
          <textarea
            id="it-remarks"
            className="po-textarea"
            rows={3}
            value={header.remarks || ''}
            onChange={(event) => handleHeaderChange('remarks', event.target.value)}
          />
        </div>
        </div>
      </div>

      {valErrors.form && <div className="po-alert po-alert--error">{valErrors.form}</div>}

      <div className="po-toolbar itr-transfer-request__action-bar">
        <div className="itr-transfer-request__action-right">
          <div className="itr-transfer-request__total-box">
            <label className="po-field__label" style={{ width: 'auto', textAlign: 'left' }}>
              Total Qty
            </label>
            <input className="po-field__input" value={totalQuantity} readOnly />
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
          matrixFields={INVENTORY_TRANSFER_MATRIX_COLUMNS}
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

      <BusinessPartnerModal
        isOpen={bpModal}
        onClose={closeBpModal}
        onSelect={handleBpSelect}
        businessPartners={businessPartnerModalItems}
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

export default InventoryTransfer;
