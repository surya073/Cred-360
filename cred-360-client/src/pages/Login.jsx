import React, { useEffect, useState } from 'react';
import { FiLock, FiShield, FiUsers, FiLink, FiActivity } from 'react-icons/fi';
import KeyShareLogo from '../components/KeyShareLogo';

// Where Catalyst sends the user after a successful sign-in (legacy web client hosting)
const LOGIN_REDIRECT = window.location.origin + '/app/index.html';
const CONTAINER_ID   = 'login-container';

// Embedded authentication: renders Catalyst's sign-in widget inside our own page.
const Login = () => {
  const [sdkFailed, setSdkFailed] = useState(false);

  useEffect(() => {
    let tries = 0;
    // The Catalyst SDK is loaded by <script> tags; wait until it is ready.
    const timer = setInterval(() => {
      const sdk = window.catalyst;
      if (sdk?.auth?.signIn) {
        clearInterval(timer);
        sdk.auth.signIn(CONTAINER_ID, { login_redirect: LOGIN_REDIRECT });
      } else if (++tries > 100) {          // ~10s
        clearInterval(timer);
        setSdkFailed(true);
      }
    }, 100);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="login-page">
      <section className="login-hero">
        <div className="login-hero-brand">
          <KeyShareLogo size={34} />
          <span>keyShare</span>
        </div>
        <h2>Store, share &amp; <em>control</em> every credential.</h2>
        <p>One secure workspace for your team's passwords, with granular permissions, expiring links and a full audit trail.</p>
        <div className="login-features">
          <div className="login-feature"><FiLock size={20} /><b>AES-256 vault</b><small>Secrets encrypted server-side.</small></div>
          <div className="login-feature"><FiUsers size={20} /><b>Team sharing</b><small>Share with users, teams or folders.</small></div>
          <div className="login-feature"><FiLink size={20} /><b>Secure links</b><small>Passphrase-protected, expiring.</small></div>
          <div className="login-feature"><FiActivity size={20} /><b>Audit logs</b><small>Know who accessed what, when.</small></div>
        </div>
      </section>
      <div className="login-card">
        <KeyShareLogo size={60} className="login-logo" />
        <h1 className="login-title">Welcome back</h1>
        <p className="login-sub">Sign in to your secure password workspace</p>

        <div className="login-badges">
          <span className="login-badge"><FiLock size={11} /> AES-256 encrypted</span>
          <span className="login-badge"><FiShield size={11} /> Zero-trust sharing</span>
        </div>

        <div id={CONTAINER_ID} className="login-widget" />

        {sdkFailed && (
          <p className="login-error">
            Couldn't load the sign-in form. Please refresh the page.
          </p>
        )}
      </div>
      <p className="login-footer">KEYSHARE · Secure Password Management</p>
    </div>
  );
};

export default Login;
