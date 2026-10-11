import SapDateInput from './common/SapDateInput';
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import ComboBox from '../modules/item-master/components/ComboBox';
import { createCompanyScopedRouteState } from '../utils/companyStorageScope';
import '../modules/item-master/styles/itemMaster.css';
import '../styles/sales-order-list.css';

const PAGE_SIZE_OPTIONS = [25, 50, 100];
const STATUS_OPTIONS = [
  { code: 'Open', name: 'Open documents' },
  { code: 'Closed', name: 'Closed documents' },
];
const INITIAL_FILTERS = {
  query: '',
  docNum: '',
  partnerCode: '',
  partnerName: '',
  sellerCode: '',
  sellerName: '',
  status: '',
  postingDateFrom: '',
  postingDateTo: '',
};

const getErrorMessage = (error, fallbackMessage) => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (detail?.error?.message) return detail.error.message;
  if (detail?.message) return detail.message;
  return error?.message || fallbackMessage;
};

function DocumentFindPage({
  title,
  backPath,
  partnerLabel,
  partnerParamPrefix,
  resultKey,
  emptyLabel,
  loadingLabel,
  fetchDocuments,
  fetchPartnerOptions,
  editPath,
  editStateKey,
  codeField,
  nameField,
  includeSellerFilters = false,
  sellerCodeField = 'seller_code',
  sellerNameField = 'seller_name',
}) {
  const navigate = useNavigate();
  const { company } = useAuth();
  const [documents, setDocuments] = useState([]);
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState(INITIAL_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 25,
    totalCount: 0,
    totalPages: 1,
  });
  const [pageState, setPageState] = useState({
    loading: true,
    error: '',
  });

  useEffect(() => {
    let ignore = false;

    const loadDocuments = async () => {
      setPageState({ loading: true, error: '' });

      try {
        const response = await fetchDocuments({
          openOnly: false,
          query: appliedFilters.query || '',
          docNum: appliedFilters.docNum || '',
          [`${partnerParamPrefix}Code`]: appliedFilters.partnerCode || '',
          [`${partnerParamPrefix}Name`]: appliedFilters.partnerName || '',
          ...(includeSellerFilters ? {
            sellerCode: appliedFilters.sellerCode || '',
            sellerName: appliedFilters.sellerName || '',
          } : {}),
          status: appliedFilters.status || '',
          postingDateFrom: appliedFilters.postingDateFrom || '',
          postingDateTo: appliedFilters.postingDateTo || '',
          page,
          pageSize,
        });

        if (!ignore) {
          setDocuments(response.data?.[resultKey] || []);
          setPagination(response.data?.pagination || {
            page,
            pageSize,
            totalCount: response.data?.[resultKey]?.length || 0,
            totalPages: 1,
          });
          setPageState({ loading: false, error: '' });
        }
      } catch (error) {
        if (!ignore) {
          setPageState({
            loading: false,
            error: getErrorMessage(error, `Failed to load ${title.toLowerCase()}.`),
          });
        }
      }
    };

    loadDocuments();

    return () => {
      ignore = true;
    };
  }, [appliedFilters, page, pageSize, fetchDocuments, resultKey, title, partnerParamPrefix, includeSellerFilters]);

  const hasActiveFilters = Object.values(appliedFilters).some((value) => String(value || '').trim() !== '');
  const pageStart = pagination.totalCount === 0 ? 0 : ((pagination.page - 1) * pagination.pageSize) + 1;
  const pageEnd = Math.min(pagination.page * pagination.pageSize, pagination.totalCount);

  const updateFilter = (name, value) => {
    setFilters((prev) => ({ ...prev, [name]: value }));
  };

  const handleFilterChange = (event) => {
    const { name, value } = event.target;
    updateFilter(name, value);
  };

  const handleFilterSelect = (name, option) => {
    const nextFilters = {
      ...filters,
      [name]: option?.code || '',
    };

    setFilters(nextFilters);
    setAppliedFilters(nextFilters);
    setPage(1);
  };

  const handleApplyFilters = () => {
    setAppliedFilters({ ...filters });
    setPage(1);
  };

  const handleClearFilters = () => {
    setFilters(INITIAL_FILTERS);
    setAppliedFilters(INITIAL_FILTERS);
    setPage(1);
  };

  const handlePageSizeChange = (event) => {
    setPageSize(Number(event.target.value) || 25);
    setPage(1);
  };

  const handleFilterKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleApplyFilters();
    }
  };

  const loadPartnerOptions = async (searchTerm = '', display = 'code') => {
    const response = await fetchPartnerOptions({
      query: searchTerm,
      [`${partnerParamPrefix}Code`]: display === 'name' ? (filters.partnerCode || '') : '',
      [`${partnerParamPrefix}Name`]: display === 'code' ? (filters.partnerName || '') : '',
      top: 0,
      display,
    });

    return response.data?.options || [];
  };

  return (
    <div className="container-fluid sap-find-page">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="mb-1">{title}</h2>
          <small className="text-muted">Filter by document, {partnerLabel.toLowerCase()}, status, and posting date.</small>
        </div>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          onClick={() => navigate(backPath)}
        >
          Back
        </button>
      </div>

      {pageState.error && (
        <div className="alert alert-danger" role="alert">
          {pageState.error}
        </div>
      )}

      <div className="card p-3 sap-find-card">
        <div className="sap-find-filter-grid mb-3">
          <div className="sap-find-field">
            <label className="form-label mb-1">Doc No</label>
            <input
              type="text"
              className="form-control"
              name="docNum"
              value={filters.docNum}
              onChange={handleFilterChange}
              onKeyDown={handleFilterKeyDown}
              placeholder="Enter Doc No"
            />
          </div>

          {includeSellerFilters && (
            <>
              <div className="sap-find-field">
                <label className="form-label mb-1">Seller Code</label>
                <input
                  type="text"
                  className="form-control"
                  name="sellerCode"
                  value={filters.sellerCode}
                  onChange={handleFilterChange}
                  onKeyDown={handleFilterKeyDown}
                  placeholder="Enter Seller Code"
                />
              </div>

              <div className="sap-find-field">
                <label className="form-label mb-1">Seller Name</label>
                <input
                  type="text"
                  className="form-control"
                  name="sellerName"
                  value={filters.sellerName}
                  onChange={handleFilterChange}
                  onKeyDown={handleFilterKeyDown}
                  placeholder="Enter Seller Name"
                />
              </div>
            </>
          )}

          <div className="sap-find-field">
            <label className="form-label mb-1">{partnerLabel} Code</label>
            <div onKeyDown={handleFilterKeyDown}>
              <ComboBox
                key={`${partnerParamPrefix}-code-filter`}
                name="partnerCode"
                value={filters.partnerCode}
                onChange={handleFilterChange}
                onSelect={(option) => handleFilterSelect('partnerCode', option)}
                fetchOptions={(searchTerm) => loadPartnerOptions(searchTerm, 'code')}
                className="sales-order-list__filter-combobox"
                dropdownSearchable
                dropdownSearchPlaceholder={`Search ${partnerLabel.toLowerCase()} code`}
                placeholder={`Type or choose ${partnerLabel} Code`}
                title={`Search ${partnerLabel.toLowerCase()} codes from database`}
              />
            </div>
          </div>

          <div className="sap-find-field">
            <label className="form-label mb-1">{partnerLabel} Name</label>
            <div onKeyDown={handleFilterKeyDown}>
              <ComboBox
                key={`${partnerParamPrefix}-name-filter`}
                name="partnerName"
                value={filters.partnerName}
                onChange={handleFilterChange}
                onSelect={(option) => handleFilterSelect('partnerName', option)}
                fetchOptions={(searchTerm) => loadPartnerOptions(searchTerm, 'name')}
                className="sales-order-list__filter-combobox"
                dropdownSearchable
                dropdownSearchPlaceholder={`Search ${partnerLabel.toLowerCase()} name`}
                placeholder={`Type or choose ${partnerLabel} Name`}
                title={`Search ${partnerLabel.toLowerCase()} names from database`}
              />
            </div>
          </div>

          <div className="sap-find-field">
            <label className="form-label mb-1">Status</label>
            <div onKeyDown={handleFilterKeyDown}>
              <ComboBox
                key={`${partnerParamPrefix}-status-filter`}
                name="status"
                value={filters.status}
                onChange={handleFilterChange}
                onSelect={(option) => handleFilterSelect('status', option)}
                staticOptions={STATUS_OPTIONS}
                className="sales-order-list__filter-combobox"
                dropdownSearchable
                dropdownSearchPlaceholder="Search status"
                placeholder="All Statuses"
              />
            </div>
          </div>

          <div className="sap-find-field">
            <label className="form-label mb-1">Posting Date From</label>
            <SapDateInput
              
              className="form-control"
              name="postingDateFrom"
              value={filters.postingDateFrom}
              onChange={handleFilterChange}
              onKeyDown={handleFilterKeyDown}
            />
          </div>

          <div className="sap-find-field">
            <label className="form-label mb-1">Posting Date To</label>
            <SapDateInput
              
              className="form-control"
              name="postingDateTo"
              value={filters.postingDateTo}
              onChange={handleFilterChange}
              onKeyDown={handleFilterKeyDown}
            />
          </div>

          <div className="sap-find-field sap-find-actions">
            <button
              type="button"
              className="btn btn-primary w-100"
              onClick={handleApplyFilters}
            >
              Search
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary w-100"
              onClick={handleClearFilters}
            >
              Clear Filters
            </button>
          </div>
        </div>

        <div className="sap-find-results-row mb-3">
          <div className="sap-find-global-field">
            <label className="form-label mb-1">Global Search</label>
            <input
              type="text"
              className="form-control"
              name="query"
              value={filters.query}
              onChange={handleFilterChange}
              onKeyDown={handleFilterKeyDown}
              placeholder={`Search by Doc No., ${partnerLabel} Code, ${partnerLabel} Name${includeSellerFilters ? ', Seller Code or Seller Name' : ''}`}
            />
          </div>

          <div className="sap-find-results-tools">
            <div className="d-flex flex-column flex-sm-row align-items-sm-center justify-content-sm-end gap-2 h-100">
              <small className="text-muted">
                {pageState.loading
                  ? 'Searching...'
                  : pagination.totalCount === 0
                    ? `0 ${emptyLabel}`
                    : `${pagination.totalCount} ${emptyLabel}`}
              </small>
              <label className="d-flex align-items-center gap-2 text-muted mb-0">
                <span>Rows</span>
                <select
                  className="form-select form-select-sm"
                  value={pageSize}
                  onChange={handlePageSizeChange}
                  style={{ width: 'auto' }}
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </div>

        <div className="table-responsive sap-find-table-wrap">
          <table className="table table-bordered table-hover align-middle mb-0">
            <thead className="table-light">
              <tr>
                <th>Action</th>
                <th>Doc No</th>
                <th>{partnerLabel} Code</th>
                <th>{partnerLabel} Name</th>
                {includeSellerFilters && <th>Seller Code</th>}
                {includeSellerFilters && <th>Seller Name</th>}
                <th>Posting Date</th>
                <th>Delivery Date</th>
                <th>Status</th>
                <th>Lines</th>
                <th className="text-end">Total</th>
              </tr>
            </thead>
            <tbody>
              {pageState.loading && (
                <tr>
                  <td colSpan={includeSellerFilters ? 11 : 9} className="text-center py-4">
                    {loadingLabel}
                  </td>
                </tr>
              )}

              {!pageState.loading && documents.length === 0 && (
                <tr>
                  <td colSpan={includeSellerFilters ? 11 : 9} className="text-center text-muted py-4">
                    {hasActiveFilters ? `No ${emptyLabel} found for the selected filters.` : `No ${emptyLabel} found.`}
                  </td>
                </tr>
              )}

              {!pageState.loading &&
                documents.map((document) => (
                  <tr key={document.doc_entry}>
                    <td>
                      <button
                        type="button"
                        className="btn btn-outline-primary btn-sm"
                        onClick={() =>
                          navigate(editPath, {
                            state: createCompanyScopedRouteState({ [editStateKey]: document.doc_entry }, company),
                          })
                        }
                      >
                        Select
                      </button>
                    </td>
                    <td>{document.doc_num}</td>
                    <td>{document[codeField] || '-'}</td>
                    <td>{document[nameField] || '-'}</td>
                    {includeSellerFilters && <td>{document[sellerCodeField] || '-'}</td>}
                    {includeSellerFilters && <td>{document[sellerNameField] || '-'}</td>}
                    <td>{document.posting_date || ''}</td>
                    <td>{document.delivery_date || ''}</td>
                    <td>{document.status || ''}</td>
                    <td>{document.line_count ?? '-'}</td>
                    <td className="text-end">{Number(document.total_amount || 0).toFixed(2)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <div className="d-flex flex-column flex-md-row justify-content-between align-items-md-center gap-2 mt-3">
          <small className="text-muted">
            {pagination.totalCount === 0
              ? `Showing 0 ${emptyLabel}`
              : `Showing ${pageStart}-${pageEnd} of ${pagination.totalCount} ${emptyLabel}`}
          </small>
          <div className="d-flex align-items-center gap-2">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={pageState.loading || pagination.page <= 1}
            >
              Previous
            </button>
            <small className="text-muted mb-0">
              Page {pagination.page} of {pagination.totalPages}
            </small>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => setPage((current) => Math.min(pagination.totalPages, current + 1))}
              disabled={pageState.loading || pagination.page >= pagination.totalPages}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DocumentFindPage;
