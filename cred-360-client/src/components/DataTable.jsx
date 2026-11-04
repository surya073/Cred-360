import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RiSearchLine, RiRefreshLine, RiCloseLine, RiArrowLeftSLine, RiArrowRightSLine,
  RiArrowLeftDoubleLine, RiArrowRightDoubleLine, RiArrowUpSLine, RiArrowDownSLine,
  RiInboxLine, RiCalendarLine,
} from 'react-icons/ri';
import { inDateRange, parseServerDate } from '../utils/dateHelper';

/*
 * One table for the whole app: same toolbar, same pagination, same look.
 *
 * Two data modes
 *   • client mode  – pass `rows`; search / filters / date range / sort / paging run in memory
 *   • ajax mode    – pass `fetchPage({ page, pageSize, search, from, to, sort, dir, filters })`
 *                    returning `{ rows, total }`; every change re-queries the server
 *                    (search is debounced, stale responses are ignored).
 *
 * Columns: [{ key, label, render?(row), sortable?, width?, align?, className?, sortValue?(row) }]
 */

const PAGE_SIZES = [10, 25, 50, 100];

const useDebounced = (value, ms = 350) => {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
};

export const Checkbox = ({ checked, indeterminate, onChange, onClick, disabled, ariaLabel }) => {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = !!indeterminate && !checked; }, [indeterminate, checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="ks-check"
      checked={!!checked}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={onChange}
      onClick={onClick}
    />
  );
};

const Pagination = ({ page, pageSize, total, onPage, onPageSize, sizes }) => {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from  = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to    = Math.min(total, page * pageSize);

  const nums = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 1) nums.push(i);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }

  return (
    <div className="dt-pagination">
      <div className="dt-page-info">
        Showing <b>{from}</b>–<b>{to}</b> of <b>{total}</b>
        <select className="dt-size" value={pageSize} onChange={e => onPageSize(Number(e.target.value))} aria-label="Rows per page">
          {sizes.map(s => <option key={s} value={s}>{s} / page</option>)}
        </select>
      </div>
      <div className="dt-pager">
        <button className="dt-pbtn" disabled={page <= 1} onClick={() => onPage(1)} aria-label="First page"><RiArrowLeftDoubleLine size={15} /></button>
        <button className="dt-pbtn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><RiArrowLeftSLine size={16} /></button>
        {nums.map((n, i) => n === '…'
          ? <span key={`e${i}`} className="dt-ellipsis">…</span>
          : <button key={n} className={`dt-pbtn ${n === page ? 'active' : ''}`} onClick={() => onPage(n)}>{n}</button>)}
        <button className="dt-pbtn" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><RiArrowRightSLine size={16} /></button>
        <button className="dt-pbtn" disabled={page >= pages} onClick={() => onPage(pages)} aria-label="Last page"><RiArrowRightDoubleLine size={15} /></button>
      </div>
    </div>
  );
};

const DataTable = ({
  columns,
  rows,                 // client mode
  fetchPage,            // ajax mode
  rowKey = 'ROWID',
  dateField,            // row field used by the from/to filter (enables the date toolbar)
  searchKeys,           // client mode: row fields searched (default: every column key)
  searchPlaceholder = 'Search…',
  filters = [],         // [{ key, label, options:[{value,label}], match?(row,value) }]
  selectable = false,
  selected,             // controlled selection (array of ids)
  onSelectedChange,
  bulkActions,          // (selectedIds) => node
  onRowClick,
  toolbarExtra,
  toolbarEnd,
  pageSizes = PAGE_SIZES,
  defaultPageSize = 10,
  refreshKey,           // change to force a reload
  onRefresh,
  loading: loadingProp = false,
  emptyText = 'Nothing to show yet',
  emptyIcon,
  rowClassName,
  minWidth = 640,
}) => {
  const ajax = typeof fetchPage === 'function';

  const [search, setSearch]     = useState('');
  const [from, setFrom]         = useState('');
  const [to, setTo]             = useState('');
  const [filterVals, setFilterVals] = useState({});
  const [sort, setSort]         = useState({ key: null, dir: 'asc' });
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  const [remote, setRemote]     = useState({ rows: [], total: 0 });
  const [fetching, setFetching] = useState(ajax);
  const [innerSel, setInnerSel] = useState([]);
  const reqId = useRef(0);

  const debouncedSearch = useDebounced(search);
  const q = ajax ? debouncedSearch : search;

  const sel    = selected ?? innerSel;
  const setSel = onSelectedChange ?? setInnerSel;

  // any query change → back to page 1
  useEffect(() => { setPage(1); }, [q, from, to, filterVals, pageSize, sort.key, sort.dir]);

  // ── ajax mode ───────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!ajax) return;
    const id = ++reqId.current;
    setFetching(true);
    try {
      const res = await fetchPage({ page, pageSize, search: q, from, to, sort: sort.key, dir: sort.dir, filters: filterVals });
      if (id === reqId.current) setRemote({ rows: res?.rows || [], total: res?.total ?? (res?.rows || []).length });
    } catch (e) {
      if (id === reqId.current) setRemote({ rows: [], total: 0 });
    } finally {
      if (id === reqId.current) setFetching(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ajax, page, pageSize, q, from, to, sort.key, sort.dir, filterVals, refreshKey]);

  useEffect(() => { load(); }, [load]);

  // ── client mode ─────────────────────────────────────────────────────────
  const processed = useMemo(() => {
    if (ajax) return [];
    let list = rows || [];
    if (q) {
      const needle = q.toLowerCase();
      const keys = searchKeys || columns.map(c => c.key);
      list = list.filter(r => keys.some(k => String(r[k] ?? '').toLowerCase().includes(needle)));
    }
    if (dateField && (from || to)) list = list.filter(r => inDateRange(r[dateField], from, to));
    filters.forEach(f => {
      const v = filterVals[f.key];
      if (v && v !== 'all') list = list.filter(r => (f.match ? f.match(r, v) : String(r[f.key]) === String(v)));
    });
    if (sort.key) {
      const col = columns.find(c => c.key === sort.key);
      const val = (r) => (col?.sortValue ? col.sortValue(r) : r[sort.key]);
      list = [...list].sort((a, b) => {
        let x = val(a), y = val(b);
        const dx = dateField === sort.key ? parseServerDate(x) : null;
        if (dx) { x = dx.getTime(); y = parseServerDate(y)?.getTime() ?? 0; }
        if (x == null) return 1;
        if (y == null) return -1;
        const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
        return sort.dir === 'asc' ? c : -c;
      });
    }
    return list;
  }, [ajax, rows, q, from, to, filterVals, sort, columns, searchKeys, dateField, filters]);

  const total    = ajax ? remote.total : processed.length;
  const pageRows = ajax ? remote.rows : processed.slice((page - 1) * pageSize, page * pageSize);
  const busy     = ajax ? fetching : loadingProp;

  // keep page in range when data shrinks (e.g. after delete)
  useEffect(() => {
    const max = Math.max(1, Math.ceil(total / pageSize));
    if (page > max) setPage(max);
  }, [total, pageSize, page]);

  // ── selection ───────────────────────────────────────────────────────────
  const idsOnPage  = pageRows.map(r => r[rowKey]);
  const allOnPage  = idsOnPage.length > 0 && idsOnPage.every(id => sel.includes(id));
  const someOnPage = idsOnPage.some(id => sel.includes(id));
  const toggleAll  = () => setSel(allOnPage ? sel.filter(id => !idsOnPage.includes(id)) : Array.from(new Set([...sel, ...idsOnPage])));
  const toggleOne  = (id) => setSel(sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]);

  const toggleSort = (col) => {
    if (!col.sortable) return;
    setSort(s => s.key !== col.key ? { key: col.key, dir: 'asc' } : s.dir === 'asc' ? { key: col.key, dir: 'desc' } : { key: null, dir: 'asc' });
  };

  const hasActiveFilters = !!(search || from || to || Object.values(filterVals).some(v => v && v !== 'all'));
  const clearAll = () => { setSearch(''); setFrom(''); setTo(''); setFilterVals({}); };

  const handleRefresh = () => { if (ajax) load(); if (onRefresh) onRefresh(); };

  return (
    <div className="dt">
      <div className="dt-toolbar">
        <div className="dt-search">
          <RiSearchLine size={16} className="dt-search-icon" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label="Search"
          />
          {search && <button className="dt-clear" onClick={() => setSearch('')} aria-label="Clear search"><RiCloseLine size={14} /></button>}
        </div>

        {filters.map(f => (
          <select
            key={f.key}
            className="dt-select"
            value={filterVals[f.key] || 'all'}
            onChange={e => setFilterVals(v => ({ ...v, [f.key]: e.target.value }))}
            aria-label={f.label}
          >
            <option value="all">{f.label}</option>
            {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ))}

        {dateField && (
          <div className="dt-dates" title="Filter by date (India time by default — change in Settings)">
            <RiCalendarLine size={15} className="dt-dates-icon" />
            <input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} aria-label="From date" />
            <span>to</span>
            <input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} aria-label="To date" />
          </div>
        )}

        {toolbarExtra}

        <div className="dt-toolbar-end">
          {hasActiveFilters && <button className="dt-link" onClick={clearAll}>Clear filters</button>}
          {toolbarEnd}
          <button className="dt-icon-btn" onClick={handleRefresh} title="Refresh" aria-label="Refresh">
            <RiRefreshLine size={16} className={busy ? 'dt-spin' : ''} />
          </button>
        </div>
      </div>

      {selectable && sel.length > 0 && (
        <div className="dt-bulk">
          <span><b>{sel.length}</b> selected</span>
          {bulkActions && bulkActions(sel)}
          <button className="dt-link" onClick={() => setSel([])}>Clear</button>
        </div>
      )}

      <div className="dt-scroll">
        <table className="dt-table" style={{ minWidth }}>
          <thead>
            <tr>
              {selectable && (
                <th className="dt-check-col">
                  <Checkbox checked={allOnPage} indeterminate={someOnPage} onChange={toggleAll} ariaLabel="Select all rows on this page" />
                </th>
              )}
              {columns.map(c => (
                <th
                  key={c.key}
                  style={{ width: c.width, textAlign: c.align }}
                  className={`${c.sortable ? 'dt-sortable' : ''} ${c.className || ''}`}
                  onClick={() => toggleSort(c)}
                  aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  <span className="dt-th">
                    {c.label}
                    {c.sortable && (
                      <span className={`dt-sort ${sort.key === c.key ? 'on' : ''}`}>
                        {sort.key === c.key && sort.dir === 'desc' ? <RiArrowDownSLine size={14} /> : <RiArrowUpSLine size={14} />}
                      </span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={busy ? 'dt-busy' : ''}>
            {busy && pageRows.length === 0 && Array.from({ length: 5 }).map((_, i) => (
              <tr key={`sk${i}`} className="dt-skel">
                {selectable && <td />}
                {columns.map(c => <td key={c.key}><span className="dt-skel-bar" /></td>)}
              </tr>
            ))}
            {!busy && pageRows.length === 0 && (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0)} className="dt-empty">
                  <div className="dt-empty-inner">
                    {emptyIcon || <RiInboxLine size={30} />}
                    <p>{hasActiveFilters ? 'No results match your filters' : emptyText}</p>
                    {hasActiveFilters && <button className="dt-link" onClick={clearAll}>Clear filters</button>}
                  </div>
                </td>
              </tr>
            )}
            {pageRows.map(r => {
              const id = r[rowKey];
              const isSel = selectable && sel.includes(id);
              return (
                <tr
                  key={id}
                  className={`${onRowClick ? 'dt-clickable' : ''} ${isSel ? 'dt-selected' : ''} ${rowClassName ? rowClassName(r) : ''}`}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                >
                  {selectable && (
                    <td className="dt-check-col" onClick={e => e.stopPropagation()}>
                      <Checkbox checked={isSel} onChange={() => toggleOne(id)} ariaLabel="Select row" />
                    </td>
                  )}
                  {columns.map(c => (
                    <td key={c.key} style={{ textAlign: c.align }} className={c.className}>
                      {c.render ? c.render(r) : (r[c.key] ?? '—')}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} onPageSize={setPageSize} sizes={pageSizes} />
    </div>
  );
};

export default DataTable;
