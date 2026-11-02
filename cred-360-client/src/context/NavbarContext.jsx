// src/context/NavbarContext.js
import React, { createContext, useContext, useState } from 'react';

const NavbarContext = createContext({});

export const NavbarProvider = ({ children }) => {
  const [recordCount, setRecordCount] = useState(0);
  const [filterCount, setFilterCount] = useState(0);

  return (
    <NavbarContext.Provider value={{ recordCount, setRecordCount, filterCount, setFilterCount }}>
      {children}
    </NavbarContext.Provider>
  );
};

export const useNavbar = () => useContext(NavbarContext);