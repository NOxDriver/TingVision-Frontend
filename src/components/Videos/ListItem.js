//import useState hook to create menu collapse state
import React from "react";

//import sidebar css from react-pro-sidebar module and our custom css 
import "react-pro-sidebar/dist/css/styles.css";
import "./ListItem.css";

import useAuthStore from "../../stores/authStore";
import { useNavigate } from 'react-router-dom';

const ListItem = ({ page }) => {
    
    return (
        <>

            <div
                class={`listitem_container ${page}`}
            >
                <div class="listitem_row">

                    <div class="listitem_box">
                        <div class="listitem_logo">
                            <img src={page.picture}
                                alt="logo"
                                // border radius
                                // link to page
                                onClick={() => window.open(page.link, "_blank")}
                                style={{ borderRadius: 5 }}
                            />
                        </div>
                    </div>

                    <div class="listitem_box group">
                        <div class={`listitem_clickable ${page}`}>
                            <a href={page.link}
                                target="_blank"
                                rel="noopener noreferrer"
                            >{page.name}</a>
                        </div>
                    </div>
                    <div class="listitem_box group">
                        <div class={`listitem_clickable ${page}`}>
                            <a href={page.link}
                                target="_blank"
                                rel="noopener noreferrer"
                            >(Page ID: {page.id})</a>
                        </div>

                    </div>
                </div>
            </div>
        </>
    );
};

export default ListItem;