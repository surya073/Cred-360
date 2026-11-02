import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import {
  RiPriceTag3Line, RiAddLine, RiEditLine, RiDeleteBinLine,
  RiRefreshLine, RiCloseLine, RiCheckLine, RiSearchLine,
} from 'react-icons/ri';
import Toast, { useToast } from '../components/Toast';

const API = '/server/cred_360_function';
const PER_PAGE = 8;

// ── Name-based color map — same name always gets same color ──
const COLOR_PALETTE = [
  '#7c3aed', '#2563eb', '#059669', '#d97706',
  '#dc2626', '#db2777', '#0891b2', '#65a30d',
  '#9333ea', '#ea580c', '#0284c7', '#16a34a',
  '#b45309', '#be185d', '#0f766e', '#4338ca',
];

function nameToColor(name = '') {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLOR_PALETTE[Math.abs(hash) % COLOR_PALETTE.length];
}

const COLOR_PRESETS = [
  '#7c3aed', '#2563eb', '#059669', '#d97706',
  '#dc2626', '#db2777', '#0891b2', '#65a30d',
  '#9333ea', '#ea580c', '#0284c7', '#16a34a',
];

const DEFAULT_CATEGORIES = [
  { name: 'General',      color: '#7c3aed' },
  { name: 'Social Media', color: '#2563eb' },
  { name: 'Banking',      color: '#059669' },
  { name: 'Email',        color: '#d97706' },
  { name: 'Work',         color: '#dc2626' },
  { name: 'Shopping',     color: '#db2777' },
  { name: 'Other',        color: '#0891b2' },
];

const emptyForm = { name: '', color: '#7c3aed', icon: 'tag' };

// stored color takes priority; if missing/default, derive from name
const resolveColor = (cat) =>
  cat.color && cat.color !== '#7c3aed'
    ? cat.color
    : nameToColor(cat.name);

const Categories = () => {
  const { toasts, removeToast, toast } = useToast();

  const [allCategories, setAllCategories] = useState([]);
  const [loading, setLoading]             = useState(true);
  const [search, setSearch]               = useState('');
  const [searchInput, setSearchInput]     = useState('');
  const [page, setPage]                   = useState(1);
  const [showModal, setShowModal]         = useState(false);
  const [editItem, setEditItem]           = useState(null);
  const [form, setForm]                   = useState(emptyForm);
  const [saving, setSaving]               = useState(false);
  const [deleteId, setDeleteId]           = useState(null);
  const [deleting, setDeleting]           = useState(false);
  const [seeding, setSeeding]             = useState(false);
  const searchTimer                       = useRef(null);

  const fetchCategories = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/api/categories`);
      if (res.data.success) setAllCategories(res.data.data || []);
    } catch {
      toast.error('Failed to load categories');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCategories(); }, [fetchCategories]);

  // ── Debounced search (300ms) ──
  const handleSearchInput = (val) => {
    setSearchInput(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(val);
      setPage(1);
    }, 300);
  };

  // ── Client-side filter + paginate ──
  const filtered   = allCategories.filter(c =>
    c.name?.toLowerCase().includes(search.toLowerCase())
  );
  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paginated  = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  // ── Modal ──
  const openAdd = () => {
    setEditItem(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEdit = (item) => {
    setEditItem(item);
    setForm({ name: item.name, color: resolveColor(item), icon: item.icon || 'tag' });
    setShowModal(true);
  };

  // In Add mode: auto-pick color from name hash while typing
  const handleNameChange = (val) => {
    setForm(f => ({
      ...f,
      name:  val,
      color: editItem ? f.color : (nameToColor(val) || f.color),
    }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error('Category name is required');
    setSaving(true);
    try {
      if (editItem) {
        await axios.put(`${API}/api/categories/${editItem.ROWID}`, form);
        toast.success('Category updated!');
      } else {
        await axios.post(`${API}/api/categories`, form);
        toast.success('Category created!');
      }
      setShowModal(false);
      fetchCategories();
    } catch (e) {
      toast.error(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await axios.delete(`${API}/api/categories/${deleteId}`);
      toast.success('Category deleted');
      setDeleteId(null);
      fetchCategories();
    } catch (e) {
      toast.error(e.response?.data?.error || e.message);
      setDeleteId(null);
    } finally {
      setDeleting(false);
    }
  };

  const handleSeedDefaults = async () => {
    setSeeding(true);
    const existing = allCategories.map(c => c.name.toLowerCase());
    const toCreate = DEFAULT_CATEGORIES.filter(
      d => !existing.includes(d.name.toLowerCase())
    );
    if (toCreate.length === 0) {
      toast.info('All default categories already exist');
      setSeeding(false);
      return;
    }
    try {
      await Promise.all(
        toCreate.map(d =>
          axios.post(`${API}/api/categories`, { name: d.name, color: d.color, icon: 'tag' }).catch(() => null)
        )
      );
      toast.success(`${toCreate.length} default categories added`);
      fetchCategories();
    } catch (e) {
      toast.error('Seed failed: ' + e.message);
    } finally {
      setSeeding(false);
    }
  };

  const deleteTarget = allCategories.find(c => c.ROWID === deleteId);

  return (
    <div>
      <Toast toasts={toasts} removeToast={removeToast} />

      {/* ── Header ── */}
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Categories</h1>
          <p className="page-subtitle">
            {filtered.length} categor{filtered.length === 1 ? 'y' : 'ies'}
            {search && ` matching "${search}"`}
          </p>
        </div>
        <div className="flex gap-8">
          <button className="btn btn-secondary" onClick={fetchCategories} title="Refresh">
            <RiRefreshLine size={16} />
          </button>
          <button className="btn btn-secondary" onClick={handleSeedDefaults} disabled={seeding}>
            {seeding ? 'Adding...' : 'Add Defaults'}
          </button>
          <button className="btn btn-primary" onClick={openAdd}>
            <RiAddLine size={16} /> Add Category
          </button>
        </div>
      </div>

      {/* ── Table card ── */}
      <div className="card">

        {/* ── Toolbar ── */}
        <div className="table-toolbar">
          <div className="search-box">
            <RiSearchLine size={16} className="search-icon" />
            <input
              type="text"
              className="search-input"
              placeholder="Search categories..."
              value={searchInput}
              onChange={e => handleSearchInput(e.target.value)}
            />
            {searchInput && (
              <button
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)', padding: '0 6px',
                  display: 'flex', alignItems: 'center',
                }}
                onClick={() => { setSearchInput(''); setSearch(''); setPage(1); }}
                title="Clear"
              >
                <RiCloseLine size={15} />
              </button>
            )}
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>
            {allCategories.length} total
          </span>
        </div>

        {/* ── Table ── */}
        {loading ? (
          <div className="table-loading">
            {[...Array(5)].map((_, i) => <div key={i} className="skeleton-row" />)}
          </div>
        ) : paginated.length === 0 ? (
          <div className="empty-state">
            <RiPriceTag3Line size={40} />
            <p>
              {search
                ? `No categories match "${search}"`
                : 'No categories yet — click "Add Defaults" to get started'}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 48 }}>#</th>
                  <th>Category</th>
                  <th>Created By</th>
                  <th>Created</th>
                  <th style={{ width: 100 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((cat, idx) => {
                  const color = resolveColor(cat);
                  return (
                    <tr key={cat.ROWID}>

                      {/* Row number */}
                      <td className="td-muted" style={{ fontSize: 12 }}>
                        {(page - 1) * PER_PAGE + idx + 1}
                      </td>

                      {/* Letter avatar + name badge */}
                      <td>
                        <div className="flex gap-8" style={{ alignItems: 'center' }}>
                          <div style={{
                            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                            background: color + '22',
                            border: `2px solid ${color}55`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontWeight: 600, fontSize: 13, color,
                          }}>
                            {cat.name.charAt(0).toUpperCase()}
                          </div>
                          <span
                            className="badge"
                            style={{
                              background: color + '18',
                              color,
                              border: `1px solid ${color}44`,
                              fontSize: 12, fontWeight: 500,
                            }}
                          >
                            {cat.name}
                          </span>
                        </div>
                      </td>

                    <td>
                      <div className="flex gap-8" style={{ alignItems: 'center' }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                          background: resolveColor(cat) + '22',
                          border: `2px solid ${resolveColor(cat)}55`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: 600, fontSize: 11, color: resolveColor(cat),
                        }}>
                          {(cat.created_by_name || '?').charAt(0).toUpperCase()}
                        </div>
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                          {cat.created_by_name || '—'}
                        </span>
                      </div>
                    </td>
                      {/* Created */}
                      <td className="td-muted">
                        {cat.created_time
                          ? new Date(cat.created_time).toLocaleDateString()
                          : '—'}
                      </td>

                      {/* Actions */}
                      <td>
                        <div className="flex gap-8">
                          <button className="icon-btn" onClick={() => openEdit(cat)} title="Edit">
                            <RiEditLine size={15} />
                          </button>
                          <button className="icon-btn danger" onClick={() => setDeleteId(cat.ROWID)} title="Delete">
                            <RiDeleteBinLine size={15} />
                          </button>
                        </div>
                      </td>

                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div className="pagination">
            <button
              className="page-btn"
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
            >
              Previous
            </button>
            {[...Array(totalPages)].map((_, i) => (
              <button
                key={i}
                className={`page-btn ${page === i + 1 ? 'active' : ''}`}
                onClick={() => setPage(i + 1)}
              >
                {i + 1}
              </button>
            ))}
            <button
              className="page-btn"
              disabled={page === totalPages}
              onClick={() => setPage(p => p + 1)}
            >
              Next
            </button>
          </div>
        )}

      </div>

      {/* ── Add / Edit Modal ── */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">
                <RiPriceTag3Line size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                {editItem ? 'Edit Category' : 'Add Category'}
              </h2>
              <button className="modal-close" onClick={() => setShowModal(false)}>
                <RiCloseLine size={16} />
              </button>
            </div>

            <div className="modal-body">

              {/* Name */}
              <div className="form-group" style={{ marginBottom: 16 }}>
                <label className="form-label">Category Name *</label>
                <input
                  className="form-input"
                  placeholder="e.g. DevOps, Finance, Personal"
                  value={form.name}
                  onChange={e => handleNameChange(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSave()}
                  autoFocus
                />
                {form.name && !editItem && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                    <div style={{
                      width: 10, height: 10, borderRadius: '50%',
                      background: nameToColor(form.name),
                    }} />
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      Auto color from name — override below
                    </span>
                  </div>
                )}
              </div>

              {/* Color swatches */}
              <div className="form-group" style={{ marginBottom: 16 }}>
                <label className="form-label">Color</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                  {COLOR_PRESETS.map(color => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, color }))}
                      style={{
                        width: 28, height: 28, borderRadius: 8,
                        background: color, border: 'none', cursor: 'pointer',
                        outline: form.color === color
                          ? '3px solid var(--text-primary)'
                          : '2px solid transparent',
                        outlineOffset: 2,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'outline 0.1s',
                      }}
                    >
                      {form.color === color && <RiCheckLine size={13} style={{ color: '#fff' }} />}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                    background: form.color,
                    border: '2px solid var(--border-color)',
                  }} />
                  <input
                    className="form-input"
                    type="text"
                    placeholder="#7c3aed"
                    value={form.color}
                    onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                    style={{ fontFamily: 'monospace', flex: 1 }}
                  />
                  <input
                    type="color"
                    value={form.color}
                    onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                    style={{
                      width: 36, height: 36, border: 'none',
                      borderRadius: 6, cursor: 'pointer', padding: 2, flexShrink: 0,
                    }}
                    title="Pick custom color"
                  />
                </div>
              </div>

              {/* Live preview */}
              <div className="form-group">
                <label className="form-label">Preview</label>
                <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 34, height: 34, borderRadius: 8,
                    background: form.color + '22',
                    border: `2px solid ${form.color}55`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 600, fontSize: 14, color: form.color,
                  }}>
                    {(form.name || 'C').charAt(0).toUpperCase()}
                  </div>
                  <span
                    className="badge"
                    style={{
                      background: form.color + '18',
                      color: form.color,
                      border: `1px solid ${form.color}44`,
                      fontSize: 13, padding: '5px 14px',
                    }}
                  >
                    {form.name || 'Category name'}
                  </span>
                </div>
              </div>

            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : editItem ? 'Update Category' : 'Save Category'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm ── */}
      {deleteId && (
        <div className="modal-overlay" onClick={() => setDeleteId(null)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Delete Category</h2>
              <button className="modal-close" onClick={() => setDeleteId(null)}>
                <RiCloseLine size={16} />
              </button>
            </div>
            <div className="modal-body">
              {deleteTarget && (() => {
                const color = resolveColor(deleteTarget);
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                      background: color + '22', border: `2px solid ${color}55`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 600, fontSize: 15, color,
                    }}>
                      {deleteTarget.name.charAt(0).toUpperCase()}
                    </div>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 15 }}>
                      {deleteTarget.name}
                    </span>
                  </div>
                );
              })()}
              <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: 0 }}>
                Are you sure? If any passwords are still using this category,
                deletion will be blocked — reassign them first.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeleteId(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Deleting...' : 'Delete Category'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default Categories;