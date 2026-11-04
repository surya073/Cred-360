import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import Toast, { useToast } from '../components/Toast';
import axios from '../services/api';
import {
  RiUserLine, RiPaletteLine, RiShieldLine,
  RiSaveLine, RiMoonLine, RiSunLine,
  RiCheckLine, RiCameraLine, RiUploadLine,
  RiGlobalLine, RiMapPinTimeLine
} from 'react-icons/ri';
import { useTimeZone } from '../context/TimezoneContext';
import {
  DEFAULT_TIMEZONE, listTimeZones, offsetLabel, formatDate, formatTime, formatDateTime
} from '../utils/dateHelper';
import {
  FaChrome, FaEdge, FaFirefox, FaSafari, FaOpera, FaGlobe
} from 'react-icons/fa';
import ImageCropper from '../components/ImageCropper';
import { useProfile } from '../context/ProfileContext';


const API = '/server/cred_360_function';

const Settings = () => {
  const { user } = useAuth();
  const { toasts, removeToast, toast } = useToast();
  const fileInputRef = useRef(null);
  const { theme, toggleTheme } = useTheme();
  const { timeZone, setTimeZone } = useTimeZone();
  const [activeTab, setActiveTab]     = useState('profile');
  const [tzSearch, setTzSearch] = useState('');
  const [now, setNow] = useState(() => new Date());
  const zones = React.useMemo(() => listTimeZones(), []);
  const deviceTz = React.useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return null; }
  }, []);

  // live clock for the Region preview
  useEffect(() => {
    if (activeTab !== 'region') return undefined;
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const applyTimeZone = (tz, label) => {
    setTimeZone(tz);
    toast.success(`Time zone set to ${label || tz.replace(/_/g, ' ')}`);
  };

  const visibleZones = zones.filter(z =>
    !tzSearch || z.label.toLowerCase().includes(tzSearch.toLowerCase()));
  const zonesByRegion = visibleZones.reduce((acc, z) => {
    (acc[z.region] = acc[z.region] || []).push(z);
    return acc;
  }, {});


  const [username, setUsername]      = useState(user?.first_name || '');
  const [saving, setSaving]           = useState(false);
  const [profileImage, setProfileImage] = useState(null);
  const [imageFileId, setImageFileId]   = useState(null);
  const [uploading, setUploading]       = useState(false);
  const [previewUrl, setPreviewUrl]     = useState(null);

  const { updateProfileImage } = useProfile();
  const [cropSrc, setCropSrc] = useState(null);
  const [showCropper, setShowCropper] = useState(false);

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

  const tabs = [
    { id: 'profile',    label: 'Profile',    icon: <RiUserLine size={16} />    },
    { id: 'appearance', label: 'Appearance', icon: <RiPaletteLine size={16} /> },
    { id: 'region',     label: 'Region & Time', icon: <RiGlobalLine size={16} /> },
    { id: 'security',  label: 'Security',   icon: <RiShieldLine size={16} />  },
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
  auth.signOut(window.location.origin + "/app/index.html");
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

            </div>
          )}

          {activeTab === 'region' && (
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">Region &amp; Time</h2>
              </div>

              <div className="tz-hero">
                <div className="tz-hero-icon"><RiMapPinTimeLine size={26} /></div>
                <div className="tz-hero-body">
                  <div className="tz-hero-label">Current time zone</div>
                  <div className="tz-hero-zone">{timeZone.replace(/_/g, ' ')} <span>{offsetLabel(timeZone, now)}</span></div>
                </div>
                <div className="tz-hero-clock">
                  <div className="tz-clock-time">{formatTime(now)}</div>
                  <div className="tz-clock-date">{formatDate(now)}</div>
                </div>
              </div>

              <div className="tz-quick">
                <button
                  className={`tz-chip ${timeZone === DEFAULT_TIMEZONE ? 'active' : ''}`}
                  onClick={() => applyTimeZone(DEFAULT_TIMEZONE, 'India Standard Time')}
                >
                  India (IST)
                </button>
                {deviceTz && !['Asia/Kolkata', 'Asia/Calcutta'].includes(deviceTz) && (
                  <button
                    className={`tz-chip ${timeZone === deviceTz ? 'active' : ''}`}
                    onClick={() => applyTimeZone(deviceTz)}
                  >
                    📍 This device ({deviceTz.replace(/_/g, ' ')})
                  </button>
                )}
                <button className={`tz-chip ${timeZone === 'UTC' ? 'active' : ''}`} onClick={() => applyTimeZone('UTC', 'UTC')}>
                  🌐 UTC
                </button>
              </div>

              <div className="settings-section-label">Choose any time zone in the world</div>
              <input
                className="form-input"
                style={{ maxWidth: 360, marginBottom: 10 }}
                placeholder="Search city or region… e.g. London, Tokyo"
                value={tzSearch}
                onChange={e => setTzSearch(e.target.value)}
              />
              <div className="tz-list">
                {Object.keys(zonesByRegion).length === 0 && <div className="tz-empty">No time zone matches “{tzSearch}”</div>}
                {Object.entries(zonesByRegion).map(([region, list]) => (
                  <div key={region} className="tz-group">
                    <div className="tz-group-title">{region}</div>
                    {list.map(z => (
                      <button
                        key={z.value}
                        className={`tz-item ${timeZone === z.value ? 'active' : ''}`}
                        onClick={() => applyTimeZone(z.value)}
                      >
                        <span>{z.label}</span>
                        {timeZone === z.value && <RiCheckLine size={16} />}
                      </button>
                    ))}
                  </div>
                ))}
              </div>

              <p className="tz-note">
                Every date and time in KeyShare — tables, activity logs, shares, notifications and date filters — is shown in this zone.
                The default is India Standard Time. This preference is saved on this browser.
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
        {getBrowser().icon} {getBrowser().name} · {formatDateTime(new Date())}
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