import SapDateInput from '../components/common/SapDateInput';
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  fetchSalesOrderCustomerOptions,
  fetchSalesOrderFilterOptions,
  fetchSalesOrders,
} from '../api/salesOrderApi';
import ComboBox from '../modules/item-master/components/ComboBox';
import { createCompanyScopedRouteState } from '../utils/companyStorageScope';
import '../modules/item-master/styles/itemMaster.css';
import '../styles/sales-order-list.css';

const PAGE_SIZE_OPTIONS = [25, 50, 100];
const STATUS_OPTIONS = [
  { code: 'Open', name: 'Open sales orders' },
  { code: 'Closed', name: 'Closed sales orders' },
];
const INITIAL_FILTERS = {
  query: '',
  docNum: '',
  customerRefNo: '',
  customerCode: '',
  customerName: '',
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

const buildFilterParams = (filters, extra = {}) => ({
  openOnly: false,
  query: filters.query || '',
  docNum: filters.docNum || '',
  customerRefNo: filters.customerRefNo || '',
  customerCode: filters.customerCode || '',
  customerName: filters.customerName || '',
  sellerCode: filters.sellerCode || '',
  sellerName: filters.sellerName || '',
  status: filters.status || '',
  postingDateFrom: filters.postingDateFrom || '',
  postingDateTo: filters.postingDateTo || '',
  ...extra,
});

function SalesOrderListPage() {
  const navigate = useNavigate();
  const { company } = useAuth();
  const [orders, setOrders] = useState([]);
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

    const loadOrders = async () => {
      setPageState({ loading: true, error: '' });

      try {
        const response = await fetchSalesOrders({
          ...buildFilterParams(appliedFilters),
          page,
          pageSize,
        });

        if (!ignore) {
          setOrders(response.data.orders || []);
          setPagination(response.data.pagination || {
            page,
            pageSize,
            totalCount: response.data.orders?.length || 0,
            totalPages: 1,
          });
          setPageState({ loading: false, error: '' });
        }
      } catch (error) {
        if (!ignore) {
          setPageState({
            loading: false,
            error: getErrorMessage(error, 'Failed to load sales orders.'),
          });
        }
      }
    };

    loadOrders();

    return () => {
      ignore = true;
    };
  }, [appliedFilters, page, pageSize]);

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

  const fetchLookupOptions = (field) => async (searchTerm = '') => {
    if (field === 'customerCode' || field === 'customerName') {
      const response = await fetchSalesOrderCustomerOptions({
        query: searchTerm,
        customerCode: field === 'customerName' ? (filters.customerCode || '') : '',
        customerName: field === 'customerCode' ? (filters.customerName || '') : '',
        top: 50,
        display: field === 'customerName' ? 'name' : 'code',
      });

      return response.data?.options || [];
    }

    const response = await fetchSalesOrderFilterOptions(
      buildFilterParams(filters, {
        field,
        query: searchTerm,
        top: 50,
      })
    );

    return response.data?.options || [];
  };

  return (
    <div className="container-fluid sap-find-page">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="mb-1">Sales Orders</h2>
          <small className="text-muted">Filter by document, customer, status, and posting date.</small>
        </div>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          onClick={() => navigate('/sales-order')}
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

          <div className="sap-find-field">
            <label className="form-label mb-1">Customer Ref. No.</label>
            <input
              type="text"
              className="form-control"
              name="customerRefNo"
              value={filters.customerRefNo}
              onChange={handleFilterChange}
              onKeyDown={handleFilterKeyDown}
              placeholder="Enter Customer Ref. No."
            />
          </div>

          <div className="sap-find-field">
            <label className="form-label mb-1">Seller Code</label>
            <div onKeyDown={handleFilterKeyDown}>
              <ComboBox
                key="seller-code-filter"
                name="sellerCode"
                value={filters.sellerCode}
                onChange={handleFilterChange}
                onSelect={(option) => handleFilterSelect('sellerCode', option)}
                fetchOptions={fetchLookupOptions('sellerCode')}
                className="sales-order-list__filter-combobox"
                dropdownSearchable
                dropdownSearchPlaceholder="Search seller code"
                placeholder="Choose Seller Code"
                title="Search seller codes from documents"
              />
            </div>
          </div>

          <div className="sap-find-field">
            <label className="form-label mb-1">Seller Name</label>
            <div onKeyDown={handleFilterKeyDown}>
              <ComboBox
                key="seller-name-filter"
                name="sellerName"
                value={filters.sellerName}
                onChange={handleFilterChange}
                onSelect={(option) => handleFilterSelect('sellerName', option)}
                fetchOptions={fetchLookupOptions('sellerName')}
                className="sales-order-list__filter-combobox"
                dropdownSearchable
                dropdownSearchPlaceholder="Search seller name"
                placeholder="Choose Seller Name"
                title="Search seller names from documents"
              />
            </div>
          </div>

          <div className="sap-find-field">
            <label className="form-label mb-1">Customer Code</label>
            <div onKeyDown={handleFilterKeyDown}>
              <ComboBox
                key="customer-code-filter"
                name="customerCode"
                value={filters.customerCode}
                onChange={handleFilterChange}
                onSelect={(option) => handleFilterSelect('customerCode', option)}
                fetchOptions={fetchLookupOptions('customerCode')}
                className="sales-order-list__filter-combobox"
                dropdownSearchable
                dropdownSearchPlaceholder="Search customer code"
                placeholder="Choose Customer Code"
                title="Search customer codes from database"
              />
            </div>
          </div>

          <div className="sap-find-field">
            <label className="form-label mb-1">Customer Name</label>
            <div onKeyDown={handleFilterKeyDown}>
              <ComboBox
                key="customer-name-filter"
                name="customerName"
                value={filters.customerName}
                onChange={handleFilterChange}
                onSelect={(option) => handleFilterSelect('customerName', option)}
                fetchOptions={fetchLookupOptions('customerName')}
                className="sales-order-list__filter-combobox"
                dropdownSearchable
                dropdownSearchPlaceholder="Search customer name"
                placeholder="Choose Customer Name"
                title="Search customer names from database"
              />
            </div>
          </div>

          <div className="sap-find-field">
            <label className="form-label mb-1">Status</label>
            <div onKeyDown={handleFilterKeyDown}>
              <ComboBox
                key="status-filter"
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
              placeholder="Search by Doc No., Customer Ref. No., Customer Code, Customer Name, Seller Code or Seller Name"
            />
          </div>

          <div className="sap-find-results-tools">
            <div className="d-flex flex-column flex-sm-row align-items-sm-center justify-content-sm-end gap-2 h-100">
              <small className="text-muted">
                {pageState.loading
                  ? 'Searching...'
                  : pagination.totalCount === 0
                    ? '0 orders found'
                    : `${pagination.totalCount} orders found`}
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
                <th>Customer Ref. No.</th>
                <th>Customer Code</th>
                <th>Customer Name</th>
                <th>Seller Code</th>
                <th>Seller Name</th>
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
                  <td colSpan="12" className="text-center py-4">
                    Loading sales orders...
                  </td>
                </tr>
              )}

              {!pageState.loading && orders.length === 0 && (
                <tr>
                  <td colSpan="12" className="text-center text-muted py-4">
                    {hasActiveFilters ? 'No sales orders found for the selected filters.' : 'No sales orders found.'}
                  </td>
                </tr>
              )}

              {!pageState.loading &&
                orders.map((order) => (
                  <tr key={order.doc_entry}>
                    <td>
                      <button
                        type="button"
                        className="btn btn-outline-primary btn-sm"
                        onClick={() =>
                          navigate('/sales-order', {
                            state: createCompanyScopedRouteState({
                              salesOrderDocEntry: order.doc_entry,
                              docEntry: order.doc_entry,
                            }, company),
                          })
                        }
                      >
                        Select
                      </button>
                    </td>
                    <td>{order.doc_num}</td>
                    <td>{order.customer_ref_no || '-'}</td>
                    <td>{order.customer_code}</td>
                    <td>{order.customer_name}</td>
                    <td>{order.seller_code || '-'}</td>
                    <td>{order.seller_name || '-'}</td>
                    <td>{order.posting_date}</td>
                    <td>{order.delivery_date}</td>
                    <td>{order.status}</td>
                    <td>{order.line_count ?? '-'}</td>
                    <td className="text-end">{Number(order.total_amount || 0).toFixed(2)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <div className="d-flex flex-column flex-md-row justify-content-between align-items-md-center gap-2 mt-3">
          <small className="text-muted">
            {pagination.totalCount === 0
              ? 'Showing 0 orders'
              : `Showing ${pageStart}-${pageEnd} of ${pagination.totalCount} orders`}
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

export default SalesOrderListPage;
