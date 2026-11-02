import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

const ProfileContext = createContext(null);
const API = '/server/cred_360_function';

export const ProfileProvider = ({ children }) => {
  const [profileImageUrl, setProfileImageUrl] = useState(null);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const res = await axios.get(`${API}/api/profile/info`);
      if (res.data.success && res.data.profileImage) {
        setProfileImageUrl(`${API}/api/profile/image/${res.data.profileImage}`);
      }
    } catch(e) {}
  };

  const updateProfileImage = (url) => {
    setProfileImageUrl(url);
  };

  return (
    <ProfileContext.Provider value={{ profileImageUrl, updateProfileImage, fetchProfile }}>
      {children}
    </ProfileContext.Provider>
  );
};

export const useProfile = () => useContext(ProfileContext);
