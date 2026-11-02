import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import Toast, { useToast } from '../components/Toast';
import axios from 'axios';
import {
  RiUserLine, RiPaletteLine, RiShieldLine,
  RiSaveLine, RiMoonLine, RiSunLine,
  RiCheckLine, RiCameraLine, RiUploadLine
} from 'react-icons/ri';
import {
  FaChrome, FaEdge, FaFirefox, FaSafari, FaOpera, FaGlobe
} from 'react-icons/fa';
import ImageCropper from '../components/ImageCropper';
import { useProfile } from '../context/ProfileContext';


const API = '/server/cred_360_function';

const COLORS = [
  { label: 'Violet',  value: '#7c3aed', dark: '#6d28d9', light: '#ede9fe' },
  { label: 'Indigo',  value: '#4f46e5', dark: '#4338ca', light: '#eef2ff' },
  { label: 'Blue',    value: '#2563eb', dark: '#1d4ed8', light: '#eff6ff' },
  { label: 'Sky',     value: '#0284c7', dark: '#0369a1', light: '#f0f9ff' },
  { label: 'Cyan',    value: '#0891b2', dark: '#0e7490', light: '#ecfeff' },
  { label: 'Teal',    value: '#0d9488', dark: '#0f766e', light: '#f0fdfa' },
  { label: 'Emerald', value: '#059669', dark: '#047857', light: '#ecfdf5' },
  { label: 'Green',   value: '#16a34a', dark: '#15803d', light: '#f0fdf4' },
  { label: 'Lime',    value: '#65a30d', dark: '#4d7c0f', light: '#f7fee7' },
  { label: 'Amber',   value: '#d97706', dark: '#b45309', light: '#fffbeb' },
  { label: 'Orange',  value: '#ea580c', dark: '#c2410c', light: '#fff7ed' },
  { label: 'Crimson', value: '#dc2626', dark: '#b91c1c', light: '#fef2f2' },
  { label: 'Rose',    value: '#e11d48', dark: '#be123c', light: '#fff1f2' },
  { label: 'Pink',    value: '#db2777', dark: '#be185d', light: '#fdf2f8' },
  { label: 'Fuchsia', value: '#c026d3', dark: '#a21caf', light: '#fdf4ff' },
  { label: 'Slate',   value: '#475569', dark: '#334155', light: '#f1f5f9' },
];

const STYLES = [
  {
    id: 'modern',
    label: 'Modern',
    description: 'Bold curves, layered depth',
    radius: '14px',
    shadow: '0 8px 20px rgba(0,0,0,0.14)',
    border: '1px solid var(--border)',
  },
  {
    id: 'classic',
    label: 'Classic',
    description: 'Crisp corners, structured lines',
    radius: '4px',
    shadow: '0 1px 3px rgba(0,0,0,0.12)',
    border: '1.5px solid var(--border-strong)',
  },
  {
    id: 'elegant',
    label: 'Elegant',
    description: 'Soft curves, hushed depth',
    radius: '20px',
    shadow: '0 10px 28px rgba(0,0,0,0.08)',
    border: '1px solid var(--border)',
  },
  {
    id: 'minimal',
    label: 'Minimal',
    description: 'Flat, quiet, no shadow',
    radius: '2px',
    shadow: 'none',
    border: '1px solid var(--border)',
  },
];

  const THEME_PRESETS = [
  {
    id: 'plain', label: 'Plain', description: 'Your custom primary color',
    preview: 'linear-gradient(135deg, var(--bg-secondary) 50%, var(--bg-tertiary) 50%)',
    color: null,
  },
  {
    id: 'sunset', label: 'Sunset', description: 'Warm dusk gradient',
    preview: 'linear-gradient(135deg, #ff9a56, #ff6b9d, #845ec2)',
    color: { value: '#f97316', dark: '#c2410c', light: '#fff2e8' },
  },
  {
    id: 'midnight', label: 'Midnight', description: 'Deep indigo glow',
    preview: 'linear-gradient(135deg, #0f0c29, #302b63, #24243e)',
    color: { value: '#6366f1', dark: '#4338ca', light: '#eef2ff' },
  },
  {
    id: 'ocean', label: 'Ocean', description: 'Cool teal depths',
    preview: 'linear-gradient(135deg, #0f2027, #203a43, #2c5364)',
    color: { value: '#0891b2', dark: '#0e7490', light: '#ecfeff' },
  },
  {
    id: 'aurora', label: 'Aurora', description: 'Northern lights shimmer',
    preview: 'linear-gradient(135deg, #00c6a7, #7c3aed, #1e0a45)',
    color: { value: '#14b8a6', dark: '#0f766e', light: '#f0fdfa' },
  },
  {
    id: 'forest', label: 'Forest', description: 'Muted evergreen tones',
    preview: 'linear-gradient(135deg, #0f3d2e, #1a5f4a, #2d6a4f)',
    color: { value: '#16a34a', dark: '#15803d', light: '#f0fdf4' },
  },
];


const Settings = () => {
  const { user } = useAuth();
  const { toasts, removeToast, toast } = useToast();
  const fileInputRef = useRef(null);
  const { theme, toggleTheme, bgFeel, setBgFeel } = useTheme();



  const [activeTab, setActiveTab]     = useState('profile');
  const [username, setUsername]       = useState(user?.first_name || '');
  const [saving, setSaving]           = useState(false);
  const [profileImage, setProfileImage] = useState(null);
  const [imageFileId, setImageFileId]   = useState(null);
  const [uploading, setUploading]       = useState(false);
  const [previewUrl, setPreviewUrl]     = useState(null);

  const { updateProfileImage } = useProfile();
  const [cropSrc, setCropSrc] = useState(null);
  const [showCropper, setShowCropper] = useState(false);

  const [activeColor, setActiveColor] = useState(() => {
    try {
      const saved = localStorage.getItem('ks-primary');
      if (saved) return JSON.parse(saved).value;
    } catch(e) {}
    return '#7c3aed';
  });

  const [activeStyle, setActiveStyle] = useState(() => {
    try {
      return localStorage.getItem('ks-style') || 'modern';
    } catch(e) {}
    return 'modern';
  });

  const getBrowser = () => {
  const ua = navigator.userAgent;
  if (ua.includes('Edg/'))     return { icon: <FaEdge size={12} />,    name: 'Edge'    };
  if (ua.includes('OPR/'))     return { icon: <FaOpera size={12} />,   name: 'Opera'   };
  if (ua.includes('Chrome/'))  return { icon: <FaChrome size={12} />,  name: 'Chrome'  };
  if (ua.includes('Firefox/')) return { icon: <FaFirefox size={12} />, name: 'Firefox' };
  if (ua.includes('Safari/'))  return { icon: <FaSafari size={12} />,  name: 'Safari'  };
  return { icon: <FaGlobe size={12} />, name: 'Browser' };
};



const isDirty = username !== (user?.first_name || '');

  useEffect(() => {
    fetchProfileInfo();
  }, []);

  const fetchProfileInfo = async () => {
    try {
      const res = await axios.get(`${API}/api/profile/info`);
      if (res.data.success && res.data.profileImage) {
        setImageFileId(res.data.profileImage);
        setPreviewUrl(`${API}/api/profile/image/${res.data.profileImage}`);
      }
    } catch(e) {
      console.log('Profile info error:', e.message);
    }
  };

  const applyColorToRoot = (color) => {
  const root = document.documentElement;
  root.style.setProperty('--primary', color.value);
  root.style.setProperty('--primary-dark', color.dark);
  root.style.setProperty('--primary-light', color.light);
};

  const handleSaveProfile = async () => {
  if (!username.trim()) return toast.error('Username cannot be empty.');
  setSaving(true);
  try {
    await axios.put(`${API}/api/profile/update`, { name: username }); // ← actually save
    toast.success('Profile updated successfully!');
  } catch(e) {
    toast.error('Failed to update profile.');
  } finally {
    setSaving(false);
  }
};

  const handleImageSelect = (e) => {
  const file = e.target.files[0];
  if (!file) return;

  if (file.size > 5 * 1024 * 1024) {
    return toast.error('Image must be under 5MB.');
  }

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowedTypes.includes(file.type)) {
    return toast.error('Only JPG, PNG, WEBP or GIF allowed.');
  }

  const reader = new FileReader();
  reader.onload = () => {
    setCropSrc(reader.result);
    setShowCropper(true);
  };
  reader.readAsDataURL(file);
  e.target.value = '';
};

  const uploadImage = async (blob) => {
  setShowCropper(false);
  setUploading(true);
  try {
    const file = new File([blob], 'profile.jpg', { type: 'image/jpeg' });
    const localUrl = URL.createObjectURL(blob);
    setPreviewUrl(localUrl);

    const formData = new FormData();
    formData.append('file', file);

    const res = await axios.post(`${API}/api/profile/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });

    if (res.data.success) {
      const imgUrl = `${API}/api/profile/image/${res.data.fileId}`;
      setImageFileId(res.data.fileId);
      setPreviewUrl(imgUrl);
      updateProfileImage(imgUrl);
      toast.success('Profile image updated!');
    } else {
      toast.error('Upload failed. Try again.');
    }
  } catch(e) {
    toast.error('Upload failed: ' + e.message);
  } finally {
    setUploading(false);
  }
};

 const applyColor = (color) => {
    applyColorToRoot(color);
    localStorage.setItem('ks-primary', JSON.stringify(color));
    localStorage.setItem('ks-primary-custom', JSON.stringify(color));
    setActiveColor(color.value);
    toast.success(`Theme color changed to ${color.label}`);
  };

  const applyStyle = (style) => {
    document.documentElement.setAttribute('data-style', style.id);
    localStorage.setItem('ks-style', style.id);
    setActiveStyle(style.id);
    toast.success(`Theme style set to ${style.label}`);
  };

const applyBgFeel = (preset) => {
    setBgFeel(preset.id);
    if (preset.id === 'plain') {
      try {
        const saved = localStorage.getItem('ks-primary-custom');
        const color = saved ? JSON.parse(saved) : COLORS[0];
        applyColorToRoot(color);
        setActiveColor(color.value);
      } catch(e) {}
    } else {
      applyColorToRoot(preset.color);
      localStorage.setItem('ks-primary', JSON.stringify(preset.color));
      setActiveColor(preset.color.value);
    }
    toast.success(`Theme set to ${preset.label}`);
  };

  const tabs = [
    { id: 'profile',    label: 'Profile',    icon: <RiUserLine size={16} />    },
    { id: 'appearance', label: 'Appearance', icon: <RiPaletteLine size={16} /> },
    { id: 'security',   label: 'Security',   icon: <RiShieldLine size={16} />  },
  ];

  const getInitial = () =>
    (user?.first_name || user?.email_id || 'U').charAt(0).toUpperCase();


  const [resetting, setResetting] = useState(false);

const handleResetPassword = async () => {
  setResetting(true);
  try {
    const res = await axios.post(`${API}/api/auth/reset-password`);
    if (res.data.success) {
      toast.success('Password reset email sent! Check your inbox.');
    }
  } catch(e) {
    toast.error('Failed to send reset email. Try again.');
  } finally {
    setResetting(false);
  }
};

const handleLogout = () => {
  const auth = window.catalyst.auth;
  auth.signOut(window.location.origin);
};

  return (
    <div>
      <Toast toasts={toasts} removeToast={removeToast} />

      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Manage your account preferences</p>
      </div>

      <div className="settings-layout">
        <div className="settings-sidebar">
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={`settings-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        <div className="settings-content">

          {activeTab === 'profile' && (
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">Profile Information</h2>
              </div>

              <div className="settings-avatar-row">
                <div className="settings-avatar-wrap">
                  <div className="settings-avatar">
                    {previewUrl ? (
                      <img
                        src={previewUrl}
                        alt="Profile"
                        className="settings-avatar-img"
                      />
                    ) : (
                      getInitial()
                    )}
                  </div>
                  <button
                    className="settings-avatar-upload-btn"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    title="Change profile photo"
                  >
                    {uploading
                      ? <RiUploadLine size={14} />
                      : <RiCameraLine size={14} />
                    }
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    style={{ display: 'none' }}
                    onChange={handleImageSelect}
                  />
                </div>

                <div>
                  <div className="settings-avatar-name">
                    {user?.first_name} {user?.last_name}
                  </div>
                  <div className="settings-avatar-email">{user?.email_id}</div>
                  <div className="settings-avatar-role">
                    {user?.role_details?.role_name || 'Employee'}
                  </div>
                  <button
                    className="settings-upload-label"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                  >
                    {uploading ? 'Uploading...' : 'Change profile photo'}
                  </button>
                </div>
              </div>

              <div className="settings-divider" />

              <div className="form-group" style={{ marginBottom: 16 }}>
                <label className="form-label">Display Name</label>
                <input
                  className="form-input"
                  style={{ maxWidth: 360 }}
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="Your display name"
                />
              </div>

              <div className="form-group" style={{ marginBottom: 20 }}>
                <label className="form-label">Email Address</label>
                <input
                  className="form-input"
                  style={{ maxWidth: 360 }}
                  value={user?.email_id || ''}
                  disabled
                />
                <span style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  Email cannot be changed here
                </span>
              </div>
              <button className="btn btn-primary" onClick={handleSaveProfile} disabled={saving}>
                <RiSaveLine size={15} />
                {saving ? 'Saving...' : isDirty ? 'Save Changes •' : 'Save Changes'}
              </button>
            </div>
          )}

          {activeTab === 'appearance' && (
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">Appearance</h2>
              </div>

              <div className="settings-section-label">Theme Mode</div>
              <div className="theme-toggle-row">
                <div
                  className={`theme-option ${theme === 'light' ? 'active' : ''}`}
                  onClick={() => theme === 'dark' && toggleTheme()}
                >
                  <RiSunLine size={22} />
                  <span>Light</span>
                </div>
                <div
                  className={`theme-option ${theme === 'dark' ? 'active' : ''}`}
                  onClick={() => theme === 'light' && toggleTheme()}
                >
                  <RiMoonLine size={22} />
                  <span>Dark</span>
                </div>
              </div>

              <div className="settings-divider" />

              <div className="settings-section-label">Theme Style</div>
           <div className="style-grid stagger-in">
                {STYLES.map(style => {
                  const isActive = activeStyle === style.id;
                  return (
                    <div
                      key={style.id}
                      className={`style-card ${isActive ? 'active' : ''}`}
                      onClick={() => applyStyle(style)}
                    >
                      {isActive && <RiCheckLine className="style-card-check" size={14} />}
                      <div
                        className="style-card-preview"
                        style={{
                          borderRadius: style.radius,
                          boxShadow: style.shadow,
                          border: style.border,
                        }}
                      >
                        <span
                          className="style-card-preview-bar"
                          style={{ borderRadius: `calc(${style.radius} / 2)` }}
                        />
                      </div>
                      <div className="style-card-label">{style.label}</div>
                      <div className="style-card-desc">{style.description}</div>
                    </div>
                  );
                })}
              </div>

              <div className="settings-divider" />

              <div className="settings-section-label">Theme Presets</div>
              <div className="bgfeel-grid stagger-in">
                {THEME_PRESETS.map(preset => {
                  const isActive = bgFeel === preset.id;
                  return (
                    <div
                      key={preset.id}
                      className={`bgfeel-card ${isActive ? 'active' : ''}`}
                      onClick={() => applyBgFeel(preset)}
                    >
                      {isActive && <RiCheckLine className="bgfeel-card-check" size={14} />}
                      <div className="bgfeel-card-preview" style={{ background: preset.preview }} />
                      <div className="bgfeel-card-label">{preset.label}</div>
                      <div className="bgfeel-card-desc">{preset.description}</div>
                    </div>
                  );
                })}
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12 }}>
                A preset applies its own accent color across the app and locks manual color picking below. Choose "Plain" to customize your own color again.
              </p>

              <div className="settings-divider" />

              <div className="settings-section-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Primary Color</span>
                {bgFeel !== 'plain' && (
                  <span className="badge badge-neutral" style={{ textTransform: 'none', fontWeight: 500 }}>
                    Controlled by {THEME_PRESETS.find(p => p.id === bgFeel)?.label} preset
                  </span>
                )}
              </div>
              <div className={`color-grid stagger-in ${bgFeel !== 'plain' ? 'color-grid-locked' : ''}`}>
                {COLORS.map(color => {
                  const isActive = activeColor === color.value;
                  return (
                    <div
                      key={color.value}
                      className={`color-chip ${isActive ? 'active' : ''}`}
                      style={{ background: color.value }}
                      onClick={() => bgFeel === 'plain' && applyColor(color)}
                      title={color.label}
                    >
                      {isActive && <RiCheckLine size={16} color="#fff" />}
                    </div>
                  );
                })}
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12 }}>
                {bgFeel === 'plain'
                  ? 'Color changes apply instantly across the app.'
                  : 'Switch to the "Plain" preset above to pick a custom color.'}
              </p>
            </div>
          )}

         {activeTab === 'security' && (
  <div className="card">
    <div className="card-header">
      <h2 className="card-title">Security</h2>
    </div>

    <div className="security-item">
      <div className="security-item-info">
        <div className="security-item-title">Change Password</div>
        <div className="security-item-sub">
          A password reset link will be sent to {user?.email_id}
        </div>
      </div>
      <button
        className="btn btn-secondary"
        style={{ fontSize: 13, whiteSpace: 'nowrap' }}
        onClick={handleResetPassword}
        disabled={resetting}
      >
        {resetting ? 'Sending...' : 'Send Reset Link'}
      </button>
    </div>

    <div className="settings-divider" />

    <div className="security-item">
      <div className="security-item-info">
        <div className="security-item-title">Account Role</div>
        <div className="security-item-sub">
          Your current role in KeyShare
        </div>
      </div>
      <span className="badge badge-info" style={{ fontSize: 13, padding: '4px 12px' }}>
        {user?.role_details?.role_name || 'Employee'}
      </span>
    </div>

    <div className="settings-divider" />

    <div className="security-item">
      <div className="security-item-info">
        <div className="security-item-title">Two Factor Auth</div>
        <div className="security-item-sub">
          Managed by Zoho Catalyst Authentication
        </div>
      </div>
      <span className="badge badge-success">Enabled</span>
    </div>

    <div className="settings-divider" />

    <div className="security-item">
        <div className="security-item-info">
    <div className="security-item-title">Active Session</div>
    <div className="security-item-sub">
      Logged in as {user?.email_id}
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
        {getBrowser().icon} {getBrowser().name} · {new Date().toLocaleDateString(undefined, { dateStyle: 'medium' })}
      </div>
    </div>
  </div>
      <button
        className="btn btn-danger"
        style={{ fontSize: 13, whiteSpace: 'nowrap' }}
        onClick={handleLogout}
      >
        Logout
      </button>
    </div>
  </div>
)}
        </div>
      </div>
       {showCropper && cropSrc && (
        <ImageCropper
          imageSrc={cropSrc}
          onCropDone={(blob) => uploadImage(blob)}
          onCancel={() => { setShowCropper(false); setCropSrc(null); }}
        />
      )}
    </div>
  );
};

export default Settings;