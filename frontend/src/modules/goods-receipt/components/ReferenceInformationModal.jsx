import SapDateInput from '../../../components/common/SapDateInput';
import React, { useEffect, useMemo, useState } from 'react';
import { fetchSalesOrderReferenceDocumentLookup } from '../../../api/salesOrderApi';
import { fetchGoodsIssueList } from '../../../api/goodsIssueApi';
import { fetchGoodsReceipts } from '../../../api/goodsReceiptApi';
import { fetchInventoryTransferRequestList } from '../../../api/inventoryTransferRequestApi';
import { fetchInventoryTransferList } from '../../../api/inventoryTransferApi';
import SapGoldenArrowButton from '../../../components/document/SapGoldenArrowButton';
import { matchesSapSearchText } from '../../../utils/sapSearch';

const MIN_REFERENCE_ROWS = 8;
const DEFAULT_TRANSACTION_TYPE_GROUPS = [
  {
    label: 'Sales',
    options: [
      'Sales Quotation',
      'Sales Order',
      'Delivery Notes',
      'Return Request',
      'Return',
      'A/R Down Payment',
      'A/R Invoice',
      'A/R Credit Memo',
    ],
  },
  {
    label: 'Purchasing',
    options: [
      'Purchase Request',
      'Purchase Quotation',
      'Purchase Order',
      'Goods Receipt PO',
      'Goods Return Request',
      'Goods Return',
      'A/P Down Payment',
      'A/P Invoice',
      'A/P Credit Memo',
      'Landed Costs',
    ],
  },
  {
    label: 'Banking and Accounting',
    options: [
      'Incoming Payments',
      'Outgoing Payments',
      'Checks for Payment',
      'Internal Reconciliation',
      'Journal Entry',
    ],
  },
  {
    label: 'Inventory',
    options: [
      'Goods Receipt',
      'Goods Issue',
      'Inventory Transfer Request',
      'Inventory Transfer',
      'Inventory Counting',
      'Inventory Posting',
    ],
  },
  {
    label: 'General',
    options: ['Manual Reference'],
  },
];

const createReferencedToRow = (seed = {}) => ({
  transactionType: seed.transactionType || '',
  docEntry: seed.docEntry || '',
  docNumber: seed.docNumber || '',
  extDocNumber: seed.extDocNumber || '',
  date: seed.date || '',
  remarks: seed.remarks || '',
});

const isReferenceRowEmpty = (row) =>
  !row.transactionType &&
  !row.docEntry &&
  !row.docNumber &&
  !row.extDocNumber &&
  !row.date &&
  !row.remarks;

const ensureMinimumRows = (rows) => {
  const nextRows = [...rows];
  while (nextRows.length < MIN_REFERENCE_ROWS) {
    nextRows.push(createReferencedToRow());
  }
  return nextRows;
};

const buildTransactionTypeGroups = (customGroups = [], referencedDocument) => {
  const groupsToUse =
    Array.isArray(customGroups) && customGroups.length
      ? customGroups
      : DEFAULT_TRANSACTION_TYPE_GROUPS;

  const normalizedGroups = groupsToUse.map((group) => ({
    label: group.label,
    options: Array.isArray(group.options) ? [...group.options] : [],
  }));

  const currentLabel = referencedDocument?.sourceLabel || '';
  if (
    currentLabel &&
    !normalizedGroups.some((group) => group.options.includes(currentLabel))
  ) {
    normalizedGroups.unshift({
      label: 'Current Document',
      options: [currentLabel],
    });
  }

  return normalizedGroups;
};

const pickFirst = (...values) =>
  values.find((value) => value !== null && value !== undefined && value !== '');

const pickDocumentCollection = (payload) => {
  if (Array.isArray(payload)) return payload;

  return [
    payload?.options,
    payload?.documents,
    payload?.orders,
    payload?.items,
    payload?.data,
    payload?.results,
  ].find(Array.isArray) || [];
};

const formatDateForDisplay = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString('en-GB');
};

const formatDateForInput = (value) => {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().split('T')[0];
};

const normalizeReferenceDocuments = (documents = []) =>
  pickDocumentCollection(documents).map((document, index) => ({
    id:
      pickFirst(
        document.docEntry,
        document.DocEntry,
        document.doc_entry,
        document.docNumber,
        document.DocNum,
        document.docNum,
        document.id,
        document.ID
      ) ?? index,
    docEntry: pickFirst(document.docEntry, document.DocEntry, document.doc_entry, ''),
    docNum: String(
      pickFirst(
        document.docNumber,
        document.docNum,
        document.DocNum,
        document.doc_num,
        document.number,
        ''
      )
    ),
    date: pickFirst(
      document.docDate,
      document.postingDate,
      document.documentDate,
      document.DocDate,
      document.posting_date,
      document.document_date,
      ''
    ),
    dueDate: pickFirst(
      document.dueDate,
      document.DocDueDate,
      document.delivery_date,
      document.deliveryDate,
      ''
    ),
    partnerName: pickFirst(
      document.cardName,
      document.CardName,
      document.customerName,
      document.customer_name,
      document.vendorName,
      document.vendor_name,
      document.businessPartnerName,
      document.details,
      ''
    ),
    remarks: pickFirst(
      document.remarks,
      document.Remarks,
      document.comments,
      document.Comments,
      document.journalRemark,
      ''
    ),
    extDocNumber: String(
      pickFirst(
        document.extDocNumber,
        document.ExtDocNumber,
        document.NumAtCard,
        document.customerRefNo,
        document.vendorRefNo,
        document.ref2,
        document.Ref2,
        ''
      )
    ),
    raw: document,
  }));

const compactReferencedToRows = (rows = []) =>
  rows
    .map((row) => ({
      direction: 'to',
      transactionType: String(row.transactionType || '').trim(),
      docEntry: String(row.docEntry || '').trim(),
      docNumber: String(row.docNumber || '').trim(),
      extDocNumber: String(row.extDocNumber || '').trim(),
      issueDate: row.date || '',
      remark: row.remarks || '',
    }))
    .filter((row) =>
      String(row.transactionType || row.docEntry || row.docNumber || row.extDocNumber || '').trim()
    );

const normalizeSavedReferenceRows = (rows = []) =>
  (Array.isArray(rows) ? rows : []).map((row) =>
    createReferencedToRow({
      transactionType: getInventoryReferenceDocumentTypeLabel(
        row.transactionType || row.referencedObjectType || row.RefObjType || ''
      ),
      docEntry: row.docEntry || row.referencedDocEntry || row.RefDocEntr || '',
      docNumber: row.docNumber || row.referencedDocNumber || row.RefDocNum || '',
      extDocNumber: row.extDocNumber || row.externalDocNumber || row.ExtDocNum || '',
      date: row.issueDate || row.IssueDate || '',
      remarks: row.remark || row.Remark || '',
    })
  );

const REFERENCE_DOCUMENT_TYPE_CODES = {
  'Purchase Order': '22',
  'Sales Order': '17',
  'Delivery Notes': '15',
  Delivery: '15',
  'A/R Invoice': '13',
  'A/R Credit Memo': '14',
  'Sales Quotation': '23',
  'Goods Receipt PO': '20',
  'A/P Invoice': '18',
  'A/P Credit Memo': '19',
  'Purchase Request': '1470000113',
  'Purchase Quotation': '540000006',
};

const REFERENCE_DOCUMENT_TYPE_LABELS = {
  '22': 'Purchase Order',
  rot_PurchaseOrder: 'Purchase Order',
  '17': 'Sales Order',
  rot_SalesOrder: 'Sales Order',
  '15': 'Delivery Notes',
  rot_DeliveryNotes: 'Delivery Notes',
  '13': 'A/R Invoice',
  rot_SalesInvoice: 'A/R Invoice',
  '14': 'A/R Credit Memo',
  rot_SalesCreditNote: 'A/R Credit Memo',
  '23': 'Sales Quotation',
  rot_SalesQuotation: 'Sales Quotation',
  '20': 'Goods Receipt PO',
  rot_PurchaseDeliveryNotes: 'Goods Receipt PO',
  '18': 'A/P Invoice',
  rot_PurchaseInvoice: 'A/P Invoice',
  '19': 'A/P Credit Memo',
  rot_PurchaseCreditNote: 'A/P Credit Memo',
  '1470000113': 'Purchase Request',
  rot_PurchaseRequest: 'Purchase Request',
  '540000006': 'Purchase Quotation',
  rot_PurchaseQuotation: 'Purchase Quotation',
};

export const getInventoryReferenceDocumentTypeLabel = (value) => {
  const normalized = String(value || '').trim();
  return REFERENCE_DOCUMENT_TYPE_LABELS[normalized] || normalized;
};

const createMarketingReferenceSource = (label) => ({
  title: `List of ${label}${label.endsWith('s') ? '' : 's'}`,
  load: async () => {
    const response = await fetchSalesOrderReferenceDocumentLookup({
      transactionType: REFERENCE_DOCUMENT_TYPE_CODES[label],
      top: 100,
    });
    return normalizeReferenceDocuments(response.data?.options || response.data || []);
  },
});

const REFERENCE_DOCUMENT_SOURCES = {
  'Purchase Order': createMarketingReferenceSource('Purchase Order'),
  'Purchase Request': createMarketingReferenceSource('Purchase Request'),
  'Purchase Quotation': createMarketingReferenceSource('Purchase Quotation'),
  'Goods Receipt PO': createMarketingReferenceSource('Goods Receipt PO'),
  'A/P Invoice': createMarketingReferenceSource('A/P Invoice'),
  'A/P Credit Memo': createMarketingReferenceSource('A/P Credit Memo'),
  'Sales Quotation': {
    title: 'List of Sales Quotations',
    load: async () => {
      const response = await fetchSalesOrderReferenceDocumentLookup({
        transactionType: REFERENCE_DOCUMENT_TYPE_CODES['Sales Quotation'],
        top: 100,
      });
      return normalizeReferenceDocuments(response.data?.options || response.data || []);
    },
  },
  'Sales Order': {
    title: 'List of Sales Orders',
    load: async () => {
      const response = await fetchSalesOrderReferenceDocumentLookup({
        transactionType: REFERENCE_DOCUMENT_TYPE_CODES['Sales Order'],
        top: 100,
      });
      return normalizeReferenceDocuments(response.data?.options || response.data || []);
    },
  },
  'Delivery Notes': {
    title: 'List of Delivery Notes',
    load: async () => {
      const response = await fetchSalesOrderReferenceDocumentLookup({
        transactionType: REFERENCE_DOCUMENT_TYPE_CODES['Delivery Notes'],
        top: 100,
      });
      return normalizeReferenceDocuments(response.data?.options || response.data || []);
    },
  },
  'A/R Invoice': {
    title: 'List of A/R Invoices',
    load: async () => {
      const response = await fetchSalesOrderReferenceDocumentLookup({
        transactionType: REFERENCE_DOCUMENT_TYPE_CODES['A/R Invoice'],
        top: 100,
      });
      return normalizeReferenceDocuments(response.data?.options || response.data || []);
    },
  },
  'A/R Credit Memo': createMarketingReferenceSource('A/R Credit Memo'),
  'Goods Issue': {
    title: 'List of Goods Issues',
    load: async () => {
      const response = await fetchGoodsIssueList();
      return normalizeReferenceDocuments(response.data || []);
    },
  },
  'Goods Receipt': {
    title: 'List of Goods Receipts',
    load: async () => {
      const response = await fetchGoodsReceipts();
      return normalizeReferenceDocuments(response.data || []);
    },
  },
  'Inventory Transfer Request': {
    title: 'List of Inventory Transfer Requests',
    load: async () => {
      const response = await fetchInventoryTransferRequestList();
      return normalizeReferenceDocuments(response.data || []);
    },
  },
  'Inventory Transfer': {
    title: 'List of Inventory Transfers',
    load: async () => {
      const response = await fetchInventoryTransferList();
      return normalizeReferenceDocuments(response.data || []);
    },
  },
};

function ReferenceInformationModal({
  isOpen,
  onClose,
  onSave,
  referenceDocuments = [],
  referencedDocument,
  documentDate,
  remarks,
  documentTotal,
  transactionTypeGroups = [],
  onOpenDocument,
}) {
  const [activeTab, setActiveTab] = useState('to');
  const [restrictToBusinessPartner, setRestrictToBusinessPartner] = useState(false);
  const [referencedToRows, setReferencedToRows] = useState(
    ensureMinimumRows([createReferencedToRow()])
  );
  const [pickerState, setPickerState] = useState({
    open: false,
    rowIndex: -1,
    transactionType: '',
    title: 'List of Documents',
    documents: [],
    loading: false,
    error: '',
    searchTerm: '',
    selectedId: null,
  });

  const availableTransactionTypeGroups = useMemo(
    () => buildTransactionTypeGroups(transactionTypeGroups, referencedDocument),
    [transactionTypeGroups, referencedDocument]
  );

  const referencedByRows = useMemo(() => {
    if (!referencedDocument) return [];

    return [
      {
        transactionType: referencedDocument.sourceLabel || '',
        refDocument: referencedDocument.docNum != null ? String(referencedDocument.docNum) : '',
        referenceType: 'Base Document',
        date: documentDate || '',
        refAmount: Number(documentTotal || 0).toFixed(2),
        remarks: remarks || '',
      },
    ];
  }, [documentDate, documentTotal, referencedDocument, remarks]);

  const filteredPickerDocuments = useMemo(() => {
    const term = pickerState.searchTerm.trim();
    if (!term) return pickerState.documents;

    return pickerState.documents.filter((document) =>
      [document.docNum, document.partnerName, document.remarks, document.extDocNumber]
        .filter(Boolean)
        .some((value) => matchesSapSearchText(value, term))
    );
  }, [pickerState.documents, pickerState.searchTerm]);

  useEffect(() => {
    if (!isOpen) return;

    setActiveTab('to');
    setRestrictToBusinessPartner(false);
    const savedRows = normalizeSavedReferenceRows(referenceDocuments);
    setReferencedToRows(
      ensureMinimumRows(
        savedRows.length
          ? savedRows
          : [
              createReferencedToRow(
                referencedDocument
                  ? {
                      transactionType: referencedDocument.sourceLabel || '',
                      docNumber:
                        referencedDocument.docNum != null ? String(referencedDocument.docNum) : '',
                      extDocNumber: '',
                      date: documentDate || '',
                      remarks: remarks || '',
                    }
                  : {}
              ),
            ]
      )
    );
  }, [documentDate, isOpen, referenceDocuments, referencedDocument, remarks]);

  if (!isOpen) return null;

  const updateReferencedToRow = (rowIndex, field, value) => {
    setReferencedToRows((current) => {
      const nextRows = current.map((row, index) =>
        index === rowIndex
          ? field === 'transactionType'
            ? {
                ...row,
                transactionType: value,
                docEntry: '',
                docNumber: '',
                extDocNumber: '',
                date: '',
                remarks: '',
              }
            : { ...row, [field]: value }
          : row
      );

      const hasContentInLastRow = !isReferenceRowEmpty(nextRows[nextRows.length - 1]);
      if (hasContentInLastRow) {
        nextRows.push(createReferencedToRow());
      }

      return ensureMinimumRows(nextRows);
    });
  };

  const closePicker = () => {
    setPickerState({
      open: false,
      rowIndex: -1,
      transactionType: '',
      title: 'List of Documents',
      documents: [],
      loading: false,
      error: '',
      searchTerm: '',
      selectedId: null,
    });
  };

  const openPicker = async (rowIndex) => {
    const row = referencedToRows[rowIndex];
    const source = REFERENCE_DOCUMENT_SOURCES[row?.transactionType];
    if (!row?.transactionType || !source) return;

    setPickerState({
      open: true,
      rowIndex,
      transactionType: row.transactionType,
      title: source.title,
      documents: [],
      loading: true,
      error: '',
      searchTerm: '',
      selectedId: null,
    });

    try {
      const documents = await source.load();
      setPickerState((current) => ({
        ...current,
        documents,
        loading: false,
      }));
    } catch (error) {
      setPickerState((current) => ({
        ...current,
        loading: false,
        error:
          error.response?.data?.message ||
          error.message ||
          'Failed to load reference documents.',
      }));
    }
  };

  const chooseReferenceDocument = (document) => {
    if (!document || pickerState.rowIndex < 0) return;

    setReferencedToRows((current) =>
      ensureMinimumRows(
        current.map((row, index) =>
          index === pickerState.rowIndex
            ? {
                ...row,
                docEntry: document.docEntry != null ? String(document.docEntry) : row.docEntry || '',
                docNumber: document.docNum || '',
                extDocNumber: document.extDocNumber || row.extDocNumber || '',
                date: formatDateForInput(document.date),
                remarks: document.remarks || row.remarks || '',
              }
            : row
        )
      )
    );
    closePicker();
  };

  const saveReferences = () => {
    onSave?.(compactReferencedToRows(referencedToRows));
    onClose();
  };

  return (
    <div className="po-modal-overlay gr-reference-modal__overlay" onClick={onClose}>
      <div
        className="po-modal gr-reference-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="po-modal__header">
          <span>Reference Information</span>
          <button type="button" className="po-modal__close" onClick={onClose}>
            x
          </button>
        </div>

        <div className="po-modal__body gr-reference-modal__body">
          <div className="gr-reference-modal__tabs">
            <button
              type="button"
              className={`po-tab${activeTab === 'to' ? ' po-tab--active' : ''}`}
              onClick={() => setActiveTab('to')}
            >
              Document Referenced To
            </button>
            <button
              type="button"
              className={`po-tab${activeTab === 'by' ? ' po-tab--active' : ''}`}
              onClick={() => setActiveTab('by')}
            >
              Document Referenced By
            </button>
          </div>

          <div className="gr-reference-modal__panel">
            <div className="po-grid-wrap gr-reference-modal__grid-wrap">
              {activeTab === 'to' ? (
                <table className="po-grid">
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>#</th>
                      <th style={{ minWidth: 140 }}>Transaction Type</th>
                      <th style={{ minWidth: 110 }}>Doc. Number</th>
                      <th style={{ minWidth: 150 }}>Ext. Doc. Number</th>
                      <th style={{ minWidth: 110 }}>Date</th>
                      <th style={{ minWidth: 200 }}>Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {referencedToRows.map((row, rowIndex) => (
                      <tr key={`to-${rowIndex}`}>
                        <td>{rowIndex + 1}</td>
                        <td>
                          <select
                            className="po-grid__input po-grid__input--text"
                            value={row.transactionType}
                            onChange={(event) =>
                              updateReferencedToRow(
                                rowIndex,
                                'transactionType',
                                event.target.value
                              )
                            }
                          >
                            <option value=""></option>
                            {availableTransactionTypeGroups.map((group) => (
                              <optgroup key={group.label} label={group.label}>
                                {group.options.map((option) => (
                                  <option key={`${group.label}-${option}`} value={option}>
                                    {option}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        </td>
                        <td>
                          <div className="gr-reference-modal__doc-number-cell">
                            <input
                              className="po-grid__input po-grid__input--text"
                              value={row.docNumber}
                              disabled={!row.transactionType}
                              onChange={(event) =>
                                updateReferencedToRow(rowIndex, 'docNumber', event.target.value)
                              }
                            />
                            <button
                              type="button"
                              className="po-btn gr-reference-modal__lookup-btn"
                              disabled={
                                !row.transactionType ||
                                !REFERENCE_DOCUMENT_SOURCES[row.transactionType]
                              }
                              onClick={() => openPicker(rowIndex)}
                              title={
                                REFERENCE_DOCUMENT_SOURCES[row.transactionType]
                                  ? 'Choose Document'
                                  : 'Document list not available for this transaction type yet'
                              }
                            >
                              ...
                            </button>
                            {row.transactionType && row.docEntry ? (
                              <SapGoldenArrowButton
                                onClick={() => onOpenDocument?.(row)}
                                title="Open referenced document"
                              />
                            ) : null}
                          </div>
                        </td>
                        <td>
                          <input
                            className="po-grid__input po-grid__input--text"
                            value={row.extDocNumber}
                            disabled={!row.transactionType}
                            onChange={(event) =>
                              updateReferencedToRow(
                                rowIndex,
                                'extDocNumber',
                                event.target.value
                              )
                            }
                          />
                        </td>
                        <td>
                          <SapDateInput
                            
                            className="po-grid__input po-grid__input--text"
                            value={row.date}
                            disabled={!row.transactionType}
                            onChange={(event) =>
                              updateReferencedToRow(rowIndex, 'date', event.target.value)
                            }
                          />
                        </td>
                        <td>
                          <input
                            className="po-grid__input po-grid__input--text"
                            value={row.remarks}
                            disabled={!row.transactionType}
                            onChange={(event) =>
                              updateReferencedToRow(rowIndex, 'remarks', event.target.value)
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="po-grid">
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>#</th>
                      <th style={{ minWidth: 130 }}>Transaction Type</th>
                      <th style={{ minWidth: 110 }}>Ref. Document</th>
                      <th style={{ minWidth: 140 }}>Reference Type</th>
                      <th style={{ minWidth: 110 }}>Date</th>
                      <th style={{ minWidth: 120 }}>Ref. Amount</th>
                      <th style={{ minWidth: 200 }}>Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {referencedByRows.length === 0 ? (
                      <tr>
                        <td colSpan="7" className="po-grid__cell--muted" style={{ textAlign: 'center', padding: 20 }}>
                          No referenced documents.
                        </td>
                      </tr>
                    ) : (
                      referencedByRows.map((row, rowIndex) => (
                        <tr key={`by-${rowIndex}`}>
                          <td>{rowIndex + 1}</td>
                          <td>{row.transactionType}</td>
                          <td>{row.refDocument}</td>
                          <td>{row.referenceType}</td>
                          <td>{row.date}</td>
                          <td className="po-grid__cell--num">{row.refAmount}</td>
                          <td>{row.remarks}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}
            </div>

            {activeTab === 'to' && (
              <label className="gr-reference-modal__checkbox">
                <input
                  type="checkbox"
                  checked={restrictToBusinessPartner}
                  onChange={(event) => setRestrictToBusinessPartner(event.target.checked)}
                />
                <span>Only Reference Business Partner on Main Document</span>
              </label>
            )}
          </div>
        </div>

        <div className="po-modal__footer">
          <button type="button" className="po-btn po-btn--primary" onClick={saveReferences}>
            OK
          </button>
          <button type="button" className="po-btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>

      {pickerState.open && (
        <div className="po-modal-overlay gr-reference-modal__overlay gr-reference-modal__picker-overlay">
          <div
            className="po-modal gr-reference-picker"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="po-modal__header">
              <span>{pickerState.title}</span>
              <button type="button" className="po-modal__close" onClick={closePicker}>
                x
              </button>
            </div>

            <div className="po-modal__body">
              <div className="gr-reference-picker__search">
                <label className="po-field__label">Find</label>
                <input
                  className="po-field__input"
                  value={pickerState.searchTerm}
                  onChange={(event) =>
                    setPickerState((current) => ({
                      ...current,
                      searchTerm: event.target.value,
                    }))
                  }
                  placeholder="Search by document number, partner, or remarks..."
                />
              </div>

              <div className="po-grid-wrap gr-reference-picker__grid-wrap">
                <table className="po-grid">
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>#</th>
                      <th style={{ minWidth: 110 }}>Doc No</th>
                      <th style={{ minWidth: 110 }}>Date</th>
                      <th style={{ minWidth: 220 }}>Business Partner</th>
                      <th style={{ minWidth: 180 }}>Remarks</th>
                      <th style={{ minWidth: 110 }}>Due Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pickerState.loading && (
                      <tr>
                        <td colSpan="6" className="po-grid__cell--muted" style={{ textAlign: 'center', padding: 20 }}>
                          Loading documents...
                        </td>
                      </tr>
                    )}

                    {!pickerState.loading && pickerState.error && (
                      <tr>
                        <td colSpan="6" className="po-grid__cell--muted" style={{ textAlign: 'center', padding: 20, color: '#c62828' }}>
                          {pickerState.error}
                        </td>
                      </tr>
                    )}

                    {!pickerState.loading && !pickerState.error && filteredPickerDocuments.length === 0 && (
                      <tr>
                        <td colSpan="6" className="po-grid__cell--muted" style={{ textAlign: 'center', padding: 20 }}>
                          No documents found.
                        </td>
                      </tr>
                    )}

                    {!pickerState.loading &&
                      !pickerState.error &&
                      filteredPickerDocuments.map((document, index) => (
                        <tr
                          key={`${document.id}-${index}`}
                          className={
                            pickerState.selectedId === document.id
                              ? 'gr-goods-receipt__row--active'
                              : ''
                          }
                          style={{ cursor: 'pointer' }}
                          onClick={() =>
                            setPickerState((current) => ({
                              ...current,
                              selectedId: document.id,
                            }))
                          }
                          onDoubleClick={() => chooseReferenceDocument(document)}
                        >
                          <td>{index + 1}</td>
                          <td>{document.docNum}</td>
                          <td>{formatDateForDisplay(document.date)}</td>
                          <td>{document.partnerName}</td>
                          <td>{document.remarks}</td>
                          <td>{formatDateForDisplay(document.dueDate)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="po-modal__footer">
              <button type="button" className="po-btn" onClick={closePicker}>
                Cancel
              </button>
              <button
                type="button"
                className="po-btn po-btn--primary"
                disabled={pickerState.selectedId == null || pickerState.loading}
                onClick={() =>
                  chooseReferenceDocument(
                    filteredPickerDocuments.find(
                      (document) => document.id === pickerState.selectedId
                    )
                  )
                }
              >
                Choose
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ReferenceInformationModal;
