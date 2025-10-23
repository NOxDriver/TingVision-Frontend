//import useState hook to create menu collapse state
import React, { useState } from "react";

//import react pro sidebar components
import {
  ProSidebar,
  Menu,
  MenuItem,
  SidebarHeader,
  SidebarFooter,
  SidebarContent,
} from "react-pro-sidebar";

//import icons from react icons
import { FaList } from "react-icons/fa";
// IoIosPeople
import { BsFillPeopleFill, BsFillPinAngleFill } from 'react-icons/bs'
import { FiHome, FiLogOut, FiArrowLeftCircle, FiArrowRightCircle } from "react-icons/fi";
import { BiCog } from "react-icons/bi";


//import sidebar css from react-pro-sidebar module and our custom css 
import "react-pro-sidebar/dist/css/styles.css";
import "./SideMenu.css";

import useAuthStore from "../../stores/authStore";
import { useNavigate } from 'react-router-dom';

const Header = () => {

  //create initial menuCollapse state using useState hook
  const [menuCollapse, setMenuCollapse] = useState(false)

  //create a custom function that will change menucollapse state from false to true and true to false
  const menuIconClick = () => {
    //condition checking to change state from true to false and vice versa
    menuCollapse ? setMenuCollapse(false) : setMenuCollapse(true);
  };

  const logout = useAuthStore(state => state.logout);
  const navigate = useNavigate();

  return (
    <>
      <div id="header">
        {/* collapsed props to change menu size using menucollapse state */}
        <ProSidebar collapsed={menuCollapse}>
          <SidebarHeader>
            <div className="logotext">
              {/* small and big change using menucollapse state */}
              <p>{menuCollapse ? "Logo" : "Big Logo"}</p>
            </div>
            <div className="closemenu" onClick={menuIconClick}>
              {/* changing menu collapse icon on click */}
              {menuCollapse ? (
                <FiArrowRightCircle />
              ) : (
                <FiArrowLeftCircle />
              )}
            </div>
          </SidebarHeader>
          <SidebarContent>
            <Menu iconShape="square">
              <MenuItem
                active={window.location.pathname === "/"}
                onClick={() => navigate("/")} icon={<FiHome />}>Dashboard</MenuItem>
              <MenuItem
                active={window.location.pathname === "/sightings"}
                onClick={() => navigate("/sightings")}
                icon={<BsFillPeopleFill />}
              >Sightings</MenuItem>
              <MenuItem active={window.location.pathname === "/video"} icon={<FaList />}>Videos</MenuItem>
              <MenuItem active={window.location.pathname === "/pages"}
                onClick={() => navigate("/pages")} icon={<BsFillPinAngleFill />}>Pages</MenuItem>
              <MenuItem icon={<BiCog />}>Settings</MenuItem>
            </Menu>
          </SidebarContent>
          <SidebarFooter>
            <Menu iconShape="square">
              <MenuItem
                onClick={(e) => {
                  logout(e);
                  navigate('/login')
                }}
                icon={<FiLogOut />}>Logout</MenuItem>
            </Menu>
          </SidebarFooter>
        </ProSidebar>
      </div>
    </>
  );
};

export default Header;