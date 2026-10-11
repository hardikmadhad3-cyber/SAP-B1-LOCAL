import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { fetchSalesDocumentLookup, fetchSalesDocumentSchema } from '../api/salesDocumentSchemaApi';
import { loadSalesDocumentFieldLookupOptions } from '../utils/salesDocumentLiveFields';

const INITIAL_LOOKUP_MODAL = {
  open: false,
  lineIndex: -1,
  field: '',
  title: 'List of User-Defined Values',
  options: [],
  searchPlaceholder: 'Search values',
  emptyMessage: 'No values found',
  allowCreate: true,
  columns: null,
};

const FIELD_TO_REF_BUCKET = {
  buyerQuality: ['quality_options', 'buyer'],
  sellerQuality: ['quality_options', 'seller'],
  buyerPrice: ['price_options', 'buyer'],
  sellerPrice: ['price_options', 'seller'],
};

const FIELD_TO_ALIAS = {
  buyerQuality: 'U_Buyer_Quality',
  sellerQuality: 'U_Seller_Quality',
  buyerPrice: 'U_Buyer_Price',
  sellerPrice: 'U_Seller_Price',
};

const FALLBACK_PAYMENT_TERMS = [
  { value: '0', label: 'Immediate' },
  { value: '1', label: 'Net 30' },
  { value: '2', label: 'Net 60' },
  { value: '3', label: 'Net 90' },
];

const buildPaymentTermOptions = (paymentTerms = []) => {
  const sourceTerms = paymentTerms.length
    ? paymentTerms.map((term) => ({
      code: String(term.GroupNum ?? ''),
      name: term.PymntGroup || String(term.GroupNum ?? ''),
    }))
    : FALLBACK_PAYMENT_TERMS.map((term) => ({
      code: term.value,
      name: term.label,
    }));

  return sourceTerms
    .filter((term) => term.name)
    .map((term) => ({
      value: term.name,
      description: term.code ? `Code: ${term.code}` : '',
      label: term.code ? `${term.name} (${term.code})` : term.name,
    }));
};

const buildSacOptions = (sacCodes = []) => sacCodes
  .map((sac) => {
    const serviceCode = String(sac.serviceCode || sac.code || sac.ServiceCode || sac.ServCode || '').trim();
    const serviceName = String(sac.serviceName || sac.description || sac.ServiceName || sac.ServName || '').trim();
    const value = serviceName || serviceCode;
    return {
      value,
      description: serviceCode ? `Service Code: ${serviceCode}` : '',
      label: serviceName && serviceCode ? `${serviceName} (${serviceCode})` : value,
      serviceName,
      serviceCode,
    };
  })
  .filter((option) => option.value);

const getLookupConfig = (field, refData) => {
  const configs = {
    buyerQuality: {
      title: 'List of Buyer Quality Values',
      options: refData.quality_options?.buyer || [],
      searchPlaceholder: 'Search buyer quality values',
      emptyMessage: 'No buyer quality values found',
    },
    sellerQuality: {
      title: 'List of Seller Quality Values',
      options: refData.quality_options?.seller || [],
      searchPlaceholder: 'Search seller quality values',
      emptyMessage: 'No seller quality values found',
    },
    buyerPrice: {
      title: 'List of Buyer Price Values',
      options: refData.price_options?.buyer || [],
      searchPlaceholder: 'Search buyer price values',
      emptyMessage: 'No buyer price values found',
    },
    sellerPrice: {
      title: 'List of Seller Price Values',
      options: refData.price_options?.seller || [],
      searchPlaceholder: 'Search seller price values',
      emptyMessage: 'No seller price values found',
    },
  };

  return configs[field] || {
    title: 'List of User-Defined Values',
    options: [],
    searchPlaceholder: 'Search values',
    emptyMessage: 'No values found',
    allowCreate: true,
  };
};

export default function useSalesDocumentLineLookups({
  refData,
  setRefData,
  setLines,
  createLookupValue,
  documentType = 'SALES_ORDER',
  lineTable = 'RDR1',
}) {
  const [lineLookupModal, setLineLookupModal] = useState(INITIAL_LOOKUP_MODAL);
  const { company } = useAuth();
  const companyScope = `${company?.companyId || ''}:${company?.dbName || ''}`;
  const lookupRequest = useRef(0);

  useEffect(() => {
    lookupRequest.current += 1;
    setLineLookupModal(INITIAL_LOOKUP_MODAL);
  }, [companyScope]);

  const paymentTermOptions = useMemo(
    () => buildPaymentTermOptions(refData.payment_terms || []),
    [refData.payment_terms]
  );

  const sacOptions = useMemo(
    () => buildSacOptions(refData.sac_codes || []),
    [refData.sac_codes]
  );

  const openSACModal = useCallback((lineIndex) => {
    setLineLookupModal({
      open: true,
      lineIndex,
      field: 'sacCode',
      title: 'List of India SAC Code',
      options: sacOptions,
      searchPlaceholder: 'Search service name or service code',
      emptyMessage: 'No service SAC codes found',
      allowCreate: false,
      columns: [
        { key: 'serviceName', label: 'Service Name', primary: true },
        { key: 'serviceCode', label: 'Service Code', width: 140 },
      ],
    });
  }, [sacOptions]);

  const openPaymentTermsModal = useCallback((field, lineIndex) => {
    const isSellerField = field === 'sellerPaymentTerms';
    setLineLookupModal({
      open: true,
      lineIndex,
      field,
      title: isSellerField ? 'List of Seller Terms of Payment' : 'List of Buyer Terms of Payment',
      options: paymentTermOptions,
      searchPlaceholder: 'Search payment terms',
      emptyMessage: 'No payment terms found',
      allowCreate: false,
      columns: null,
    });
  }, [paymentTermOptions]);

  const openQualityModal = useCallback((field, lineIndex) => {
    const nextConfig = getLookupConfig(field, refData);
    const requestId = ++lookupRequest.current;
    const fieldId = `${lineTable}.${FIELD_TO_ALIAS[field] || field}`;
    let schemaField = refData.line_field_metadata?.live_schema?.lineFields
      ?.find((entry) => String(entry.id || '').toUpperCase() === fieldId.toUpperCase());
    const schemaSource = String(schemaField?.lookup?.source || schemaField?.lookupSource || '').toLowerCase();
    let source = ['udf-valid-values', 'sap-user-values', 'udf-linked-table', 'udo'].includes(schemaSource)
      ? schemaSource : 'udf-valid-values';
    setLineLookupModal({
      open: true,
      lineIndex,
      field,
      title: nextConfig.title,
      options: [],
      searchPlaceholder: nextConfig.searchPlaceholder,
      emptyMessage: 'Loading this company’s SAP values...',
      allowCreate: nextConfig.allowCreate !== false && source === 'udf-valid-values',
      columns: null,
    });
    const load = async () => {
      // Older company-specific pages do not preload the shared schema.
      if (!schemaField) {
        const schema = await fetchSalesDocumentSchema({ documentType });
        if (lookupRequest.current !== requestId) return [];
        schemaField = schema.lineFields?.find(entry => String(entry.id || '').toUpperCase() === fieldId.toUpperCase());
        source = schemaField?.lookup?.source || schemaField?.lookupSource || source;
      }
      setLineLookupModal(previous => ({ ...previous, allowCreate: source === 'udf-valid-values' && nextConfig.allowCreate !== false }));
      return loadSalesDocumentFieldLookupOptions({
        fetchLookup: fetchSalesDocumentLookup, source, field: { id: fieldId }, documentType, limit: 100,
      });
    };
    load().then((options) => {
      if (lookupRequest.current !== requestId) return;
      setLineLookupModal((previous) => ({
        ...previous,
        options: source === 'sap-user-values' ? options : (options.length ? options : nextConfig.options),
        emptyMessage: nextConfig.emptyMessage,
      }));
    }).catch((error) => {
      if (lookupRequest.current !== requestId) return;
      setLineLookupModal((previous) => ({
        ...previous,
        options: source === 'sap-user-values' ? [] : nextConfig.options,
        emptyMessage: nextConfig.options.length
          ? nextConfig.emptyMessage
          : (error?.response?.data?.detail || 'Unable to load this company’s SAP values.'),
      }));
    });
  }, [documentType, lineTable, refData]);

  const closeLineLookupModal = useCallback(() => {
    lookupRequest.current += 1;
    setLineLookupModal(INITIAL_LOOKUP_MODAL);
  }, []);

  const handleLineLookupSelect = useCallback((option) => {
    if (lineLookupModal.lineIndex < 0 || !lineLookupModal.field) return;

    setLines((prev) => prev.map((line, idx) => (
      idx === lineLookupModal.lineIndex
        ? { ...line, [lineLookupModal.field]: option?.value || '' }
        : line
    )));
  }, [lineLookupModal.field, lineLookupModal.lineIndex, setLines]);

  const handleLineLookupCreate = useCallback(async ({ value, description }) => {
    const field = lineLookupModal.field;
    if (!field || !createLookupValue) return null;

    const aliasId = FIELD_TO_ALIAS[field] || field;
    const response = await createLookupValue(aliasId, value, description);
    const createdOption = response?.data?.option || {
      value,
      description: description || value,
      label: description && description !== value ? `${value} - ${description}` : value,
    };
    const nextOptions = response?.data?.options || [];

    const bucket = FIELD_TO_REF_BUCKET[field];
    if (bucket) {
      const [groupKey, sideKey] = bucket;
      setRefData((prev) => ({
        ...prev,
        [groupKey]: {
          ...(prev[groupKey] || { buyer: [], seller: [] }),
          [sideKey]: nextOptions,
        },
      }));
    }

    setLineLookupModal((prev) => ({
      ...prev,
      options: nextOptions,
    }));

    return createdOption;
  }, [createLookupValue, lineLookupModal.field, setRefData]);

  return {
    lineLookupModal,
    openSACModal,
    openQualityModal,
    openPaymentTermsModal,
    closeLineLookupModal,
    handleLineLookupSelect,
    handleLineLookupCreate,
  };
}
