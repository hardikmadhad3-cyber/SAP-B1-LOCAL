import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { matchesSapSearchText } from "../../utils/sapSearch";
import { consumePendingLookupQuery } from "../../utils/sapTabNavigation";
import SapModalShell from "./SapModalShell";

export default function SapLookupModal({
  open,
  title,
  columns = [],
  fetchOptions,
  rows,
  loading: externalLoading = false,
  onClose,
  onSelect,
  onNew,
  onQueryChange,
  footerNote,
  footerControls,
  initialQuery = "",
  consumePendingQuery = true,
  searchLabel = "Find",
  searchPlaceholder = "Search",
  emptyMessage = "No matching records found.",
  newLabel = "New",
  chooseLabel = "Choose",
  cancelLabel = "Cancel",
  getRowKey,
  width = "min(980px, calc(100% - 40px))",
  portalTarget,
  fetchOnOpen = true,
  pageSize,
}) {
  const searchId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [fetchedRows, setFetchedRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const requestId = useRef(0);
  const loadingMoreRef = useRef(false);
  const bodyRef = useRef(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const baseRows = Array.isArray(rows) ? rows : fetchedRows;
  const isLoading = externalLoading || loading;
  const visibleColumns = useMemo(
    () => columns.filter(Boolean),
    [columns],
  );
  const activeRows = useMemo(() => {
    if (!Array.isArray(rows)) return baseRows;
    if (!query.trim()) return baseRows;

    return baseRows.filter((row) =>
      visibleColumns.some((column) => {
        if (column.searchable === false || column.key === "rowNumber") return false;
        const value = typeof column.render === "function" ? column.render(row, 0) : row[column.key];
        return matchesSapSearchText(value, query);
      })
    );
  }, [baseRows, query, rows, visibleColumns]);

  useEffect(() => {
    if (!open || !fetchOptions) {
      requestId.current += 1;
      return undefined;
    }
    requestId.current += 1;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    if (!fetchOnOpen && !query.trim()) {
      setFetchedRows([]);
      setLoading(false);
      setHasMore(false);
      return undefined;
    }

    let ignore = false;
    setFetchedRows([]);
    setHasMore(false);
    setFetchError('');
    setLoading(true);
    Promise.resolve(pageSize ? fetchOptions(query, { skip: 0, top: pageSize }) : fetchOptions(query))
      .then((nextRows) => {
        if (!ignore) {
          const next = Array.isArray(nextRows) ? nextRows : [];
          setFetchedRows(next);
          setHasMore(Boolean(pageSize && next.length === pageSize));
        }
      })
      .catch(() => {
        if (!ignore) setFetchError('Could not load records. Try another search.');
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [open, query, fetchOptions, fetchOnOpen, pageSize]);

  const loadMore = useCallback(async () => {
    if (!pageSize || !hasMore || loading || loadingMoreRef.current || !fetchOptions) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setFetchError('');
    const currentRequest = requestId.current;
    try {
      const nextRows = await fetchOptions(query, { skip: fetchedRows.length, top: pageSize });
      if (currentRequest !== requestId.current) return;
      const next = Array.isArray(nextRows) ? nextRows : [];
      setFetchedRows((current) => [...current, ...next]);
      setHasMore(next.length === pageSize);
    } catch (_error) {
      if (currentRequest === requestId.current) setFetchError('Could not load more records. Try again.');
    } finally {
      loadingMoreRef.current = false;
      if (currentRequest === requestId.current) setLoadingMore(false);
    }
  }, [pageSize, hasMore, loading, fetchOptions, query, fetchedRows.length]);

  useEffect(() => {
    if (open) setQuery(initialQuery || (consumePendingQuery ? consumePendingLookupQuery() : ''));
  }, [open, initialQuery, consumePendingQuery]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [query]);

  useEffect(() => {
    setSelectedIndex(-1);
  }, [query, open, activeRows.length]);

  const chooseRow = (row) => {
    if (!row) return;
    onSelect(row);
  };

  const handleChoose = () => {
    if (selectedIndex < 0) return;
    chooseRow(activeRows[selectedIndex]);
  };

  // SAP Choose From List: arrows move the highlight from the search box and
  // Enter picks it (the first row when nothing is highlighted yet).
  const handleSearchKeyDown = (event) => {
    if (!activeRows.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = Math.min(activeRows.length - 1, Math.max(0, selectedIndex + step));
      setSelectedIndex(next);
      bodyRef.current?.querySelectorAll('tbody tr')[next]?.scrollIntoView?.({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      chooseRow(activeRows[selectedIndex >= 0 ? selectedIndex : 0]);
    }
  };

  if (!open) return null;

  return (
    <SapModalShell
      open={open}
      title={title}
      onClose={onClose}
      size="wide"
      width={width}
      portalTarget={portalTarget}
      ariaLabel={title}
      overlayClassName="sap-lookup-modal__overlay"
      className="sap-lookup-modal"
      bodyClassName="sap-lookup-modal__content"
      footerClassName="sap-lookup-modal__footer"
      footer={(
        <>
          <span>{footerNote || `${activeRows.length} ${query.trim() ? 'matching ' : ''}records loaded${hasMore ? ' (more available)' : ''}`}</span>
          {pageSize && hasMore ? <button type="button" className="sap-lookup-modal__btn" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading...' : 'Load more'}</button> : null}
          {footerControls ? <div className="sap-lookup-modal__footer-controls">{footerControls}</div> : null}
          <button
            type="button"
            className="sap-lookup-modal__btn sap-lookup-modal__btn--primary"
            onClick={handleChoose}
            disabled={selectedIndex < 0}
          >
            {chooseLabel}
          </button>
          <button type="button" className="sap-lookup-modal__btn" onClick={onClose}>
            {cancelLabel}
          </button>
          {onNew ? (
            <button type="button" className="sap-lookup-modal__btn sap-lookup-modal__btn--primary" onClick={onNew}>
              {newLabel}
            </button>
          ) : null}
        </>
      )}
    >
        <div className="sap-lookup-modal__filter">
          <label htmlFor={searchId}>{searchLabel}</label>
          <input
            id={searchId}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              onQueryChange?.(event.target.value);
            }}
            onKeyDown={handleSearchKeyDown}
            placeholder={searchPlaceholder}
            aria-controls={`${searchId}-results`}
            autoFocus
          />
          {query ? <button type="button" className="sap-lookup-modal__btn" onClick={() => {
            setQuery('');
            onQueryChange?.('');
          }}>Clear</button> : null}
        </div>

        <div className="sap-lookup-modal__body" ref={bodyRef} onScroll={(event) => {
          const element = event.currentTarget;
          if (element.scrollHeight - element.scrollTop - element.clientHeight < 80) loadMore();
        }}>
          {isLoading ? (
            <div className="sap-lookup-modal__empty">{query.trim() && pageSize ? 'Searching all records...' : 'Loading...'}</div>
          ) : activeRows.length === 0 ? (
            <div className="sap-lookup-modal__empty">{emptyMessage}</div>
          ) : (
            <table className="sap-lookup-modal__table" id={`${searchId}-results`}>
              <thead>
                <tr>
                  {visibleColumns.map((column) => (
                    <th key={column.key} style={column.width ? { width: column.width } : undefined}>
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeRows.map((row, index) => (
                  <tr
                    key={getRowKey ? getRowKey(row, index) : (row.code || row.CardCode || row.ItemCode || row.value || index)}
                    className={selectedIndex === index ? "is-selected" : undefined}
                    aria-selected={selectedIndex === index}
                    onClick={() => setSelectedIndex(index)}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      chooseRow(row);
                    }}
                  >
                    {visibleColumns.map((column) => (
                      <td key={column.key} className={column.align === "right" ? "is-right" : undefined}>
                        {typeof column.render === "function" ? column.render(row, index) : (row[column.key] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {fetchError ? <div className="sap-lookup-modal__empty" role="alert">{fetchError}</div> : null}
        </div>

    </SapModalShell>
  );
}
