import { useEffect, useRef } from 'react';
import apiClient from '../api/client';
import { getActiveToken } from '../auth/storage';
import { getSapVisibleDocumentSeries, pickDocumentSeries } from '../utils/seriesDefaults';
import { isManualDocumentSeries } from '../utils/documentSeries';
import { readGeneralSettings } from '../utils/generalSettingsStorage';

const seriesSettingKeys = {
  '/sales-order': 'salesSeries',
  '/delivery': 'deliverySeries',
  '/dc-sales-order': 'dcSalesSeries',
  '/nc-sales-order': 'ncSalesSeries',
  '/soda-sales-order': 'sodaSalesSeries',
  '/dc-delivery': 'dcDeliverySeries',
  '/nc-delivery': 'ncDeliverySeries',
  '/soda-delivery': 'sodaDeliverySeries',
  '/sales-quotation': 'salesQuotationSeries',
  '/ar-invoice': 'arInvoiceSeries',
  '/ar-credit-memo': 'arCreditMemoSeries',
  '/purchase-request': 'purchaseRequestSeries',
  '/purchase-quotation': 'purchaseQuotationSeries',
  '/purchase-order': 'purchaseOrderSeries',
  '/grpo': 'grpoSeries',
  '/ap-invoice': 'apInvoiceSeries',
  '/ap-credit-memo': 'apCreditMemoSeries',
  '/services/ar-invoice': 'arInvoiceSeries',
  '/services/ar-credit-memo': 'arCreditMemoSeries',
  '/services/ap-invoice': 'apInvoiceSeries',
  '/services/ap-credit-memo': 'apCreditMemoSeries',
};

// A single owner for new-document series. Lookup responses belong to one
// company/user, posting date, branch and subtype; superseded responses are ignored.
export default function useDocumentSeries({ endpoint, companyKey, currentDocEntry, header, setHeader, setRefData, setPageState, ready = true, refreshKey = 0 }) {
  const generation = useRef(0);
  const lastCompany = useRef(null);
  const selection = useRef(header.series);
  selection.current = header.series;
  const date = header.postingDate;
  const branch = header.branch || '';
  const docSubType = header.docSubType || '';
  const token = getActiveToken();
  useEffect(() => {
    if (currentDocEntry) {
      // A historical document may replace a draft while its series request is pending.
      // Its saved number must not stay hidden behind the cancelled loading state.
      setPageState((prev) => prev.seriesLoading || prev.seriesError
        ? { ...prev, seriesLoading: false, seriesError: '' } : prev);
      return undefined;
    }
    if (!ready) return undefined;
    const companyScope = JSON.stringify([companyKey, token, endpoint]);
    const previousSelection = lastCompany.current === companyScope ? selection.current : '';
    // Read the active user's company settings afresh, never a previous page's header.
    const configuredSeries = readGeneralSettings()[seriesSettingKeys[endpoint]] || '';
    lastCompany.current = companyScope;
    const requestId = ++generation.current;
    const controller = new AbortController();
    let active = true;
    setRefData((prev) => ({ ...prev, series: [], manualAllowed: false }));
    setHeader(prev => ({ ...prev, series: '', nextNumber: '' }));
    // A failed save changes `ready` from false to true and refreshes the
    // series. Preserve that save error instead of making it flash and vanish.
    setPageState((prev) => ({ ...prev, seriesLoading: true, seriesError: '' }));
    const valid = () => active && requestId === generation.current && token === getActiveToken();
    const load = async () => {
      try {
        if (!date) throw new Error('Enter a posting date to load document series.');
        const response = await apiClient.get(endpoint + '/series', { params: { date, branch, docSubType, transactionType: header.transactionType }, signal: controller.signal });
        if (!valid()) return;
        const data = response.data || {};
        const rows = Array.isArray(data.series) ? data.series : [];
        setRefData((prev) => ({ ...prev, series: rows, manualAllowed: data.manualAllowed === true, defaultSeries: data.defaultSeries }));
        setHeader((prev) => {
          if (isManualDocumentSeries(previousSelection) && data.manualAllowed === true) return { ...prev, series: previousSelection };
          const selected = getSapVisibleDocumentSeries(rows).find(row => String(row.Series) === String(previousSelection))
            || pickDocumentSeries(rows, configuredSeries);
          return { ...prev, series: selected ? String(selected.Series) : '', nextNumber: selected ? String(selected.NextNumber ?? '') : '' };
        });
        setPageState((prev) => ({
          ...prev,
          seriesLoading: false,
          seriesError: data.reason || '',
          error: data.reason || prev.error,
        }));
      } catch (error) {
        if (!valid()) return;
        const message = error.response?.data?.message || error.message || 'Failed to load document series.';
        setRefData((prev) => ({ ...prev, series: [], manualAllowed: false }));
        setHeader((prev) => ({ ...prev, series: '', nextNumber: '' }));
        setPageState((prev) => ({ ...prev, seriesLoading: false, seriesError: message, error: message }));
      }
    };
    load();
    return () => { active = false; controller.abort(); };
  }, [endpoint, companyKey, token, currentDocEntry, date, branch, docSubType, header.transactionType, ready, refreshKey, setHeader, setRefData, setPageState]);
}
